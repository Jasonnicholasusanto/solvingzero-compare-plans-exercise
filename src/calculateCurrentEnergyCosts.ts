/**
 * Work out what this household is actually paying on the plan they are on today, from
 * their own usage rather than from their invoices.
 *
 * @format
 */

import { calculateAnnualPlanCost } from "./estimatePlanCosts.js";
import type { CdrRate, EnergyPlanDetail, RawAccounts, RawBilling, RawConsumption, RawElectricityContract } from "./types.js";
import { getDatePart, getExportRecords, getLocalDate, getNormalImportRecords, parsePrice } from "./utils/helpers.js";

/** Spend worked out from meter reads, priced through the plan's published tariffs. */
export interface UsageBasedSpend {
  observedDays: number;
  fromDate: string | null;
  toDate: string | null;

  peakUsageCost: number;
  offPeakUsageCost: number;
  supplyCost: number;
  solarCredit: number;

  totalSpentToDate: number;
  estimatedAnnualCost: number;

  /**
   * Every usage band the contract publishes, GST-inclusive. `peakUsageCost` and
   * `offPeakUsageCost` are read from here; this keeps a SHOULDER band visible on a
   * contract that has one rather than silently dropping it.
   */
  usageCostByBand: Record<string, number>;
  controlledLoadCost: number;

  importKwh: number;
  exportKwh: number;

  /** Anything the caller should know about how this figure was produced. */
  notes: string[];
}

/**
 * Spend as the retailer actually invoiced it. Every amount is GST-INCLUSIVE, which is
 * how invoices are written, and matches the usage-based figures.
 */
export interface BillBasedSpend {
  fromDate: string;
  toDate: string;
  /** Number of billing periods covered. */
  periods: number;

  peakUsageCost: number;
  offPeakUsageCost: number;
  supplyCost: number;
  solarCredit: number;

  /** Every energy line the retailer issued, under its own description. */
  energyChargesByLine: Record<string, number>;
  /** Net energy charged: the energy lines including the feed-in credit. */
  energyCharges: number;

  /** Fees, rebates and adjustments outside the energy lines. */
  adjustmentsByLine: Record<string, number>;
  adjustments: number;

  /** What the household was actually asked to pay: energy plus adjustments. */
  netInvoiced: number;
  /** Payments made against the account. Not a cost — context only. */
  paymentsMade: number;
}

/** One line of the usage-based figure set against the retailer's own. */
export interface ReconciledLine {
  line: string;
  billed: number;
  computed: number;
  differenceAud: number;
}

/**
 * The two methods compared like for like.
 *
 * The usage-based side is re-costed over ONLY the window the bills cover, because the
 * meter data usually runs past the last invoice — comparing 318 days of usage against
 * 304 days of invoices would show a difference that is purely calendar.
 */
export interface SpendReconciliation {
  fromDate: string;
  toDate: string;
  observedDays: number;

  computedTotal: number;
  billedTotal: number;
  differenceAud: number;
  differencePercent: number;

  byLine: ReconciledLine[];
}

export interface CurrentEnergySpend {
  planName: string;
  fromUsage: UsageBasedSpend;
  /** Null when no bills were supplied. */
  fromBills: BillBasedSpend | null;
  /** Null when no bills were supplied. */
  reconciliation: SpendReconciliation | null;
}

export interface CurrentEnergyCostsInput {
  accounts: RawAccounts,
  usage: RawConsumption,
  /** Historical invoices. Supplying them adds a billed figure and a reconciliation. */
  bills?: RawBilling,
}

/** The household's own contract, lifted out of the raw accounts payload. */
export interface CurrentPlan {
  planName: string;
  contract: RawElectricityContract;
  /** Service points this plan covers, as published. Empty when the account does not say. */
  servicePointIds: string[];
  startDate: string | null;
  endDate: string | null;
}

/** Service points the usage was actually recorded against. */
function getUsageServicePointIds(usage: RawConsumption): Set<string> {
  const ids = new Set<string>();

  for (const record of usage.usage) {
    if (record.service_point_id) {
      ids.add(record.service_point_id);
    }
  }

  return ids;
}

/** The most recent date the household has a meter read for. */
function getLatestUsageDate(usage: RawConsumption): string | null {
  let latest: string | null = null;

  for (const record of usage.usage) {
    const date = getDatePart(record.read_start_date);

    if (date && (latest === null || date > latest)) {
      latest = date;
    }
  }

  return latest;
}

/**
 * Find the plan the household was on for the usage being costed.
 *
 * A plan qualifies when it is electricity, publishes tariffs, covers one of the
 * household's service points, and was in force on the reference date.
 *
 * The reference date is the END OF THE USAGE WINDOW, not today. Contracts carry an
 * expiry — this household's runs to 2026-08-07 — and picking "the plan active today"
 * would start returning null the moment that date passes, even though the usage being
 * costed was incurred entirely under it.
 */
export function extractCurrentPlan(
  accounts: RawAccounts,
  usage: RawConsumption,
): CurrentPlan | null {
  const householdServicePoints = getUsageServicePointIds(usage);
  const asOfDate = getLatestUsageDate(usage) ?? getLocalDate();

  const candidates: CurrentPlan[] = [];

  for (const account of accounts.accounts ?? []) {
    for (const plan of account.plans ?? []) {
      if (
        plan.plan_detail?.fuel_type?.toUpperCase() !==
        "ELECTRICITY"
      ) {
        continue;
      }

      const contract = plan.plan_detail?.electricity_contract;

      // Without a tariff period there is nothing to cost against.
      if (!contract?.tariff_period?.length) {
        continue;
      }

      const servicePointIds = plan.service_point_ids ?? [];

      /*
       * A plan that names service points must name one of the household's. A plan
       * that names none is not excluded — the account simply did not say.
       */
      if (
        servicePointIds.length > 0 &&
        !servicePointIds.some((id) =>
          householdServicePoints.has(id),
        )
      ) {
        continue;
      }

      const startDate = plan.plan_overview?.start_date
        ? getDatePart(plan.plan_overview.start_date)
        : null;

      const endDate = plan.plan_overview?.end_date
        ? getDatePart(plan.plan_overview.end_date)
        : null;

      // Not started yet, or already finished, as at the reference date.
      if (startDate && startDate > asOfDate) {
        continue;
      }

      if (endDate && endDate < asOfDate) {
        continue;
      }

      candidates.push({
        planName:
          plan.plan_overview?.display_name ?? "Current plan",
        contract,
        servicePointIds,
        startDate,
        endDate,
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  /*
   * Overlapping contracts should not happen, but if the account lists several the
   * most recently started one is the live one. Sort is stable, so plans with no
   * start date keep their published order.
   */
  candidates.sort((a, b) =>
    (b.startDate ?? "").localeCompare(a.startDate ?? ""),
  );

  return candidates[0]!;
}

/**
 * Convert a Fiskil contract time into the CDR `"HH:MM"` the costing engine parses.
 *
 * The household's contract publishes full offset times — `"15:00:00+10:00"` — and its
 * window ends are INCLUSIVE (`"20:59:59.999999+10:00"` means "up to and including the
 * last instant before 21:00"), where CDR window ends are exclusive. Rounding a non-zero
 * seconds value up to the next whole minute converts one convention to the other, so
 * `"20:59:59.999999"` becomes `"21:00"` and `"23:59:59.999999"` becomes `"00:00"`,
 * which the engine already reads as a window running to midnight.
 *
 * The published offset is ignored: reads are stamped in local time and the windows are
 * local wall-clock, so both sides are already in the same frame.
 */
export function toCdrTime(
  value: string,
  bound: "start" | "end",
): string | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/.exec(
    value,
  );

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  const roundUp = bound === "end" && seconds > 0 ? 1 : 0;
  const total = (hours * 60 + minutes + roundUp) % (24 * 60);

  return (
    `${String(Math.floor(total / 60)).padStart(2, "0")}:` +
    `${String(total % 60).padStart(2, "0")}`
  );
}

function toCdrRates(
  rates: Array<{ unit_price: string }> | undefined,
): CdrRate[] {
  return (rates ?? []).map((rate) => ({
    unitPrice: rate.unit_price,
  }));
}

/**
 * Restate the household's own contract in the CDR shape, so the same costing engine
 * prices it as prices every retailer plan — one GST rule, one time-of-use
 * implementation, one annualisation.
 */
export function normaliseCurrentContract(
  current: CurrentPlan,
): EnergyPlanDetail {
  const period = current.contract.tariff_period?.[0];

  const timeOfUseRates = (period?.time_of_use_rates ?? []).map(
    (band) => ({
      type: band.type,
      rates: toCdrRates(band.rates),
      timeOfUse: (band.time_of_use ?? []).flatMap((window) => {
        const startTime = toCdrTime(window.start_time, "start");
        const endTime = toCdrTime(window.end_time, "end");

        if (startTime === null || endTime === null) {
          return [];
        }

        return [
          {
            /*
             * PUBLIC_HOLIDAYS is not a weekday code the engine can match, and every
             * window here also lists all seven days, so dropping it changes nothing.
             * It does mean public holidays are billed at ordinary rates.
             */
            days: (window.days ?? []).filter(
              (day) => day !== "PUBLIC_HOLIDAYS",
            ),
            startTime,
            endTime,
          },
        ];
      }),
    }),
  );

  /*
   * A contract can carry several feed-in entries; this household's second one is a
   * "Solar Meter Charge" measured in DAYS, not a per-kWh rate. Only KWH entries are
   * a feed-in tariff.
   */
  const feedIn = (current.contract.solar_feed_in_tariff ?? []).find(
    (tariff) =>
      (tariff.single_tariff?.rates?.[0]?.measure_unit ?? "KWH") ===
      "KWH",
  );

  /*
   * Feed-in unit prices arrive signed the way they appear on an invoice, where a
   * credit is negative — this contract publishes "-0.01" and the bills show a
   * matching $47.28 CREDIT. The engine treats a feed-in rate as a credit already,
   * so the magnitude is what it wants.
   */
  const feedInRates = toCdrRates(
    feedIn?.single_tariff?.rates,
  ).map((rate) => ({
    unitPrice: String(
      Math.abs(parsePrice(rate.unitPrice) ?? 0),
    ),
  }));

  return {
    planId: "CURRENT",
    displayName: current.planName,
    fuelType: "ELECTRICITY",
    customerType: "RESIDENTIAL",
    electricityContract: {
      tariffPeriod: [
        {
          rateBlockUType: period?.rate_block_u_type ?? "singleRate",
          dailySupplyCharge: period?.daily_supply_charge,
          singleRate: period?.single_rate
            ? { rates: toCdrRates(period.single_rate.rates) }
            : undefined,
          timeOfUseRates: timeOfUseRates.length
            ? timeOfUseRates
            : undefined,
        },
      ],
      solarFeedInTariff: feedInRates.length
        ? [{ singleTariff: { rates: feedInRates } }]
        : undefined,
    },
  };
}

function sumKwh(
  records: ReturnType<typeof getNormalImportRecords>,
  direction: 1 | -1,
): number {
  return records.reduce(
    (total, record) =>
      total +
      record.interval_read.interval_reads.reduce(
        (dayTotal, value) =>
          dayTotal + Math.max(0, direction * value),
        0,
      ),
    0,
  );
}

const round2 = (value: number): number =>
  Number(value.toFixed(2));

/** Cost meter reads through the plan's published tariffs. */
function costFromUsage(
  plan: EnergyPlanDetail,
  usage: RawConsumption,
): UsageBasedSpend | null {
  const result = calculateAnnualPlanCost(plan, usage);

  if (result.annualCostAud === null || !result.observed) {
    return null;
  }

  const { observed } = result;

  const usageCostByBand: Record<string, number> = {};

  for (const [band, cost] of Object.entries(
    observed.usageCostByBandType,
  )) {
    usageCostByBand[band] = round2(cost);
  }

  const dates = usage.usage
    .map((record) => record.read_start_date)
    .sort();

  return {
    observedDays: observed.days,
    fromDate: dates[0] ?? null,
    toDate: dates[dates.length - 1] ?? null,

    peakUsageCost: usageCostByBand.PEAK ?? 0,
    offPeakUsageCost: usageCostByBand.OFF_PEAK ?? 0,
    supplyCost: round2(observed.supplyCost),
    solarCredit: round2(observed.solarCredit),

    // "Spent so far" is the observed window; annualising it is a separate figure.
    totalSpentToDate: round2(observed.costAud),
    estimatedAnnualCost: result.annualCostAud,

    usageCostByBand,
    controlledLoadCost: round2(observed.controlledLoadCost),

    importKwh: round2(sumKwh(getNormalImportRecords(usage), 1)),
    exportKwh: round2(sumKwh(getExportRecords(usage), -1)),

    notes: result.notes,
  };
}

/**
 * Classify a billed energy line from the retailer's own wording.
 *
 * OFF_PEAK is tested before PEAK, since the first string contains the second.
 */
function classifyBillLine(
  description: string,
): "peak" | "offPeak" | "supply" | "solar" | "other" {
  const text = description.toUpperCase();

  if (text.includes("FEED")) {
    return "solar";
  }

  if (text.includes("SUPPLY")) {
    return "supply";
  }

  if (text.includes("OFF") && text.includes("PEAK")) {
    return "offPeak";
  }

  if (text.includes("PEAK")) {
    return "peak";
  }

  return "other";
}

/** Total what the retailer actually invoiced, straight from the transaction lines. */
function summariseBills(
  bills: RawBilling,
): BillBasedSpend | null {
  const energyChargesByLine: Record<string, number> = {};
  const adjustmentsByLine: Record<string, number> = {};

  let peakUsageCost = 0;
  let offPeakUsageCost = 0;
  let supplyCost = 0;
  let solarCredit = 0;
  let energyCharges = 0;
  let adjustments = 0;
  let paymentsMade = 0;

  const periodStarts = new Set<string>();
  const dates: string[] = [];

  for (const transaction of bills.billing ?? []) {
    const energy = transaction.usage;

    if (energy) {
      const amount = parsePrice(energy.amount);

      if (amount === null) {
        continue;
      }

      const from = getDatePart(energy.start_date);
      const to = getDatePart(energy.end_date);

      if (from) {
        periodStarts.add(from);
        dates.push(from);
      }

      if (to) {
        dates.push(to);
      }

      energyChargesByLine[energy.description] =
        (energyChargesByLine[energy.description] ?? 0) + amount;

      energyCharges += amount;

      switch (classifyBillLine(energy.description)) {
        case "peak":
          peakUsageCost += amount;
          break;
        case "offPeak":
          offPeakUsageCost += amount;
          break;
        case "supply":
          supplyCost += amount;
          break;
        case "solar":
          // Invoiced as a negative line; carried here as a positive credit.
          solarCredit -= amount;
          break;
        default:
          break;
      }

      continue;
    }

    /*
     * Fees, rebates and reversals sit outside the energy lines. Payments are money
     * the household handed over, not a cost, so they are reported separately.
     */
    const adjustment =
      transaction.other_charges ?? transaction.once_off;

    if (adjustment) {
      const amount = parsePrice(adjustment.amount);

      if (amount === null) {
        continue;
      }

      adjustmentsByLine[adjustment.description] =
        (adjustmentsByLine[adjustment.description] ?? 0) + amount;

      adjustments += amount;
      continue;
    }

    if (transaction.payment) {
      paymentsMade +=
        parsePrice(transaction.payment.amount) ?? 0;
    }
  }

  if (dates.length === 0) {
    return null;
  }

  dates.sort();

  const round = (value: number) => round2(value);

  return {
    fromDate: dates[0]!,
    toDate: dates[dates.length - 1]!,
    periods: periodStarts.size,

    peakUsageCost: round(peakUsageCost),
    offPeakUsageCost: round(offPeakUsageCost),
    supplyCost: round(supplyCost),
    solarCredit: round(solarCredit),

    energyChargesByLine: Object.fromEntries(
      Object.entries(energyChargesByLine).map(([k, v]) => [k, round(v)]),
    ),
    energyCharges: round(energyCharges),

    adjustmentsByLine: Object.fromEntries(
      Object.entries(adjustmentsByLine).map(([k, v]) => [k, round(v)]),
    ),
    adjustments: round(adjustments),

    netInvoiced: round(energyCharges + adjustments),
    paymentsMade: round(paymentsMade),
  };
}

/**
 * Re-cost the usage over only the window the bills cover, and set the two side by side.
 */
function reconcile(
  plan: EnergyPlanDetail,
  usage: RawConsumption,
  bills: BillBasedSpend,
): SpendReconciliation | null {
  const windowed: RawConsumption = {
    usage: usage.usage.filter(
      (record) =>
        record.read_start_date >= bills.fromDate &&
        record.read_start_date <= bills.toDate,
    ),
  };

  const computed = costFromUsage(plan, windowed);

  if (!computed) {
    return null;
  }

  const byLine: ReconciledLine[] = [
    { line: "PEAK", billed: bills.peakUsageCost, computed: computed.peakUsageCost },
    { line: "OFF_PEAK", billed: bills.offPeakUsageCost, computed: computed.offPeakUsageCost },
    { line: "DAILY_SUPPLY", billed: bills.supplyCost, computed: computed.supplyCost },
    // Shown signed, the way the invoice writes a credit.
    { line: "FEED_IN_CREDIT", billed: -bills.solarCredit, computed: -computed.solarCredit },
  ].map((row) => ({
    ...row,
    differenceAud: round2(row.computed - row.billed),
  }));

  const billedTotal = bills.energyCharges;
  const computedTotal = computed.totalSpentToDate;

  return {
    fromDate: bills.fromDate,
    toDate: bills.toDate,
    observedDays: computed.observedDays,

    computedTotal,
    billedTotal,
    differenceAud: round2(computedTotal - billedTotal),
    differencePercent:
      billedTotal === 0
        ? 0
        : round2(
            ((computedTotal - billedTotal) /
              Math.abs(billedTotal)) *
              100,
          ),

    byLine,
  };
}

export function calculateCurrentEnergyCosts(
  input: CurrentEnergyCostsInput
): CurrentEnergySpend | null {
    // 1. Extract the current plan.
    const currentPlan = extractCurrentPlan(input.accounts, input.usage);

    if (!currentPlan) {
      return null;
    }

    // 2. Restate it in the CDR shape and cost it with the shared engine, which
    //    handles the time-of-use split, the supply charge, GST and the solar credit.
    const plan = normaliseCurrentContract(currentPlan);
    const fromUsage = costFromUsage(plan, input.usage);

    if (!fromUsage) {
      return null;
    }

    // 3. If invoices were supplied, total them and compare like for like.
    const fromBills = input.bills
      ? summariseBills(input.bills)
      : null;

    return {
      planName: currentPlan.planName,
      fromUsage,
      fromBills,
      reconciliation: fromBills
        ? reconcile(plan, input.usage, fromBills)
        : null,
    };
}
