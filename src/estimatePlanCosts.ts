/**
 * Estimate each plan's annual cost for the household described by the usage
 *
 * @format
 */

import {
  type RawConsumption,
  type RawServicePoints,
  type EnergyPlanDetail,
  type RankedPlanCost,
  GST_MULTIPLIER,
  DAYS_PER_YEAR,
  CdrControlledLoad,
  type CdrRate,
  type CdrTariffPeriod,
} from "./types.js";
import { getControlledLoadRecords, getDayCode, getExportRecords, getHouseholdDistributors, getImportRecords, getLocalDate, getNormalImportRecords, isPlanApplicable, isTimeInWindow, parsePrice, parseTimeToMinutes, priceTieredUsage } from "./utils/helpers.js";

/** The usage records one pricing pass works over. */
type UsageRecords = ReturnType<typeof getNormalImportRecords>;

/**
 * A costing outcome. When `annualCostAud` is null, `notes` says why — an
 * unexplained null tells the household nothing about the plan.
 */
export interface PlanCostResult {
  annualCostAud: number | null;
  notes: string[];
  /**
   * What the plan would have cost over the usage actually observed, before it was
   * scaled to a year. Absent when the plan could not be costed.
   */
  observed?: ObservedPlanCost;
}

/**
 * Costs over the observed usage window, unrounded.
 *
 * `usageCost`, `supplyCost` and `controlledLoadCost` are GST-INCLUSIVE, so they match
 * what a bill shows. `solarCredit` is not GST-bearing and is a positive number to be
 * subtracted.
 */
export interface ObservedPlanCost {
  days: number;
  costAud: number;
  usageCost: number;
  supplyCost: number;
  controlledLoadCost: number;
  solarCredit: number;
  /** GST-inclusive usage cost keyed by band type. Empty for a non-time-of-use plan. */
  usageCostByBandType: Record<string, number>;
}

/** A plan that could not be costed, and the reason to surface with it. */
function uncostable(reason: string): PlanCostResult {
  return { annualCostAud: null, notes: [reason] };
}

/** The time-of-use bands published on a tariff period or a controlled load. */
type TimeOfUseBands = NonNullable<
  CdrTariffPeriod["timeOfUseRates"]
>;

/** A time-of-use costing, split by band so a caller can show peak vs off-peak. */
interface TimeOfUseCost {
  totalCost: number;
  /** GST-exclusive cost keyed by band type — PEAK, OFF_PEAK, SHOULDER. */
  byBandType: Record<string, number>;
}

/**
 * Tiered `volume` ceilings reset per period. CDR carries that period on the rate
 * itself, but no plan in the recorded snapshot publishes one, so a daily reset is
 * assumed — which is also the only reading the observed ceilings support: bands of
 * 15 kWh on a flat rate, or 50 kWh inside a three-hour window, are daily household
 * allowances, not monthly ones.
 */
function kwhByDate(
  records: UsageRecords,
  /** 1 reads an import register; -1 reads the export register, whose values are negative. */
  direction: 1 | -1 = 1,
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const record of records) {
    const kwh = record.interval_read.interval_reads.reduce(
      // Readings against the flow being measured are ignored defensively.
      (total, value) => total + Math.max(0, direction * value),
      0,
    );

    totals.set(
      record.read_start_date,
      (totals.get(record.read_start_date) ?? 0) + kwh,
    );
  }

  return totals;
}

/**
 * Price each day's energy as its own tiered block and sum the days.
 */
function costDailyTieredUsage(
  rates: CdrRate[] | undefined,
  records: UsageRecords,
): number | null {
  if (!rates || rates.length === 0) {
    return null;
  }

  let total = 0;

  for (const kwh of kwhByDate(records).values()) {
    const cost = priceTieredUsage(rates, kwh);

    if (cost === null) {
      return null;
    }

    total += cost;
  }

  return total;
}

export interface EstimateInput {
  usage: RawConsumption;
  servicePoints: RawServicePoints;
  plans: EnergyPlanDetail[];
}

export interface EstimatedPlanCost {
  planId: string;
  planName: string;
  brandName: string;
  applicable: boolean;
  annualCostAud: number | null;
  /** Why this plan could not be costed. Empty when `annualCostAud` is a number. */
  notes: string[];
}

/**
 * Count distinct observed consumption dates.
 *
 * E1 is used primarily because supply charges are normally
 * charged for every import-meter day.
 */
function countObservedDays(usage: RawConsumption): number {
  const importDates = new Set(
    getImportRecords(usage).map((record) => record.read_start_date),
  );

  if (importDates.size > 0) {
    return importDates.size;
  }

  return new Set(
    usage.usage.map((record) => record.read_start_date),
  ).size;
}

/**
 * Calculate total solar export.
 *
 * The supplied B1 values are negative:
 *
 * -0.25 kWh means 0.25 kWh exported.
 */
function calculateExportedKwh(usage: RawConsumption): number {
  return getExportRecords(usage).reduce((total, record) => {
    const intervalTotal = record.interval_read.interval_reads.reduce(
      (recordTotal, value) => {
        return recordTotal + Math.max(0, -value);
      },
      0,
    );

    return total + intervalTotal;
  }, 0);
}

/**
 * Find which TOU band covers one interval, by index into the published bands.
 *
 * The index rather than the price, because a band's rates may be tiered — the price
 * cannot be known until the whole day's energy in that band has been accumulated.
 */
function findTimeOfUseBandIndex(
  bands: TimeOfUseBands,
  date: string,
  intervalMinutes: number,
): number | null {
  const dayCode = getDayCode(date);

  if (!dayCode) {
    return null;
  }

  for (let index = 0; index < bands.length; index += 1) {
    for (const window of bands[index]?.timeOfUse ?? []) {
      if (!(window.days ?? []).includes(dayCode)) {
        continue;
      }

      const startMinutes =
        parseTimeToMinutes(window.startTime);

      const endMinutes =
        parseTimeToMinutes(window.endTime);

      if (
        startMinutes === null ||
        endMinutes === null
      ) {
        continue;
      }

      if (
        isTimeInWindow(
          intervalMinutes,
          startMinutes,
          endMinutes,
        )
      ) {
        return index;
      }
    }
  }

  return null;
}

/**
 * Cost time-of-use records by bucketing energy into (day, band) first and pricing
 * each bucket afterwards.
 *
 * Bucketing before pricing is what lets a band's `volume` ceiling apply to the day's
 * total within that band. Pricing each half-hour as it is read would compare every
 * interval against the ceiling on its own and never leave the first tier.
 *
 * Shared by the main tariff and by controlled load, which publish the same shape.
 */
function costTimeOfUseRecords(
  bands: TimeOfUseBands,
  records: UsageRecords,
): TimeOfUseCost | null {
  if (bands.length === 0) {
    return null;
  }

  // date -> band index -> kWh
  const buckets = new Map<string, Map<number, number>>();

  for (const record of records) {
    const intervalLength =
      record.interval_read.read_interval_length;

    if (
      !Number.isFinite(intervalLength) ||
      intervalLength <= 0
    ) {
      return null;
    }

    for (
      let index = 0;
      index < record.interval_read.interval_reads.length;
      index += 1
    ) {
      const importedKwh = Math.max(
        0,
        record.interval_read.interval_reads[index] ?? 0,
      );

      if (importedKwh === 0) {
        continue;
      }

      const bandIndex = findTimeOfUseBandIndex(
        bands,
        record.read_start_date,
        index * intervalLength,
      );

      /*
       * If an imported interval cannot be matched to a published
       * tariff window, the plan cannot be costed reliably.
       */
      if (bandIndex === null) {
        return null;
      }

      const day =
        buckets.get(record.read_start_date) ??
        new Map<number, number>();

      day.set(
        bandIndex,
        (day.get(bandIndex) ?? 0) + importedKwh,
      );

      buckets.set(record.read_start_date, day);
    }
  }

  let totalCost = 0;
  const byBandType: Record<string, number> = {};

  for (const day of buckets.values()) {
    for (const [bandIndex, kwh] of day) {
      const band = bands[bandIndex];

      const cost = priceTieredUsage(band?.rates, kwh);

      if (cost === null) {
        return null;
      }

      totalCost += cost;

      // Bands sharing a type (a plan may publish several SHOULDER bands) are summed.
      const type = band?.type ?? "UNKNOWN";
      byBandType[type] = (byBandType[type] ?? 0) + cost;
    }
  }

  return { totalCost, byBandType };
}

/**
 * This function calculates the time-of-use rate usage cost for a given energy plan based on the household's electricity usage.
 *
 * Formula: Annual cost = (Σ each interval's imported kWh × matching TOU rate + days × daily supply charge) × 1.1 − (Total exported kWh × feed-in tariff)
 *
 * @param plan The energy plan to calculate the usage cost for.
 * @param usage The household's electricity usage data.
 * @returns The estimated usage cost for the time-of-use plan, or null if it cannot be calculated.
 */
function calculateTimeOfUseUsageCost(
  plan: EnergyPlanDetail,
  usage: RawConsumption,
): TimeOfUseCost | null {
  return costTimeOfUseRecords(
    plan.electricityContract?.tariffPeriod?.[0]
      ?.timeOfUseRates ?? [],
    getNormalImportRecords(usage),
  );
}

/**
 * This function calculates the single rate usage cost for a given energy plan based on the household's electricity usage.
 *
 * Formula: Annual cost = ((Σ each day's imported kWh priced through the rate block) + (days × daily supply charge)) × 1.1 − (Total exported kWh × feed-in tariff)
 *
 * A block holding one unbounded rate is a flat price; multiple rates with `volume`
 * ceilings are a stepped tariff, priced per day by `costDailyTieredUsage`.
 *
 * @param plan The energy plan to calculate the usage cost for.
 * @param usage The household's electricity usage data.
 * @returns The estimated usage cost for the single rate plan, or null if it cannot be calculated.
 */
function calculateSingleRateUsageCost(plan: EnergyPlanDetail, usage: RawConsumption): number | null {
  const tariffPeriod = plan.electricityContract?.tariffPeriod?.[0];

  if (!tariffPeriod || tariffPeriod.rateBlockUType !== "singleRate") {
    return null; // Not a single rate plan
  }

  return costDailyTieredUsage(
    tariffPeriod.singleRate?.rates,
    getNormalImportRecords(usage),
  );
}

/**
 * This function calculates the solar feed-in credit (export kWh) for a given energy plan based on the household's electricity usage.
 *
 * Formula: Solar feed-in credit = Σ each day's exported kWh priced through the feed-in rate block
 *
 * A feed-in tariff can be tiered exactly like a usage rate — "Solar Max" credits the
 * first 10 kWh exported each day at 8c and everything above at 1.5c. Crediting every
 * kWh at the headline rate overstates the credit for a household that exports more
 * than the allowance, which is precisely the household most drawn to such a plan.
 *
 * @param plan The energy plan to calculate the usage cost for.
 * @param usage The household's electricity usage data. In this case, export B1 channel.
 * @returns The credit, or null when a published feed-in tariff cannot be priced.
 */
function calculateSolarCredit(plan: EnergyPlanDetail, usage: RawConsumption): number | null {
  // Nothing exported means no credit, whatever the plan publishes.
  if (calculateExportedKwh(usage) === 0) {
    return 0;
  }

  const solarFeedInTariff = plan.electricityContract?.solarFeedInTariff?.[0];

  if (!solarFeedInTariff) {
    return 0; // Plan publishes no feed-in tariff at all.
  }

  /*
   * `timeVaryingTariffs` credits export at different rates by time of day.
   * Falling back to zero would bury an otherwise competitive plan for a
   * household that exports heavily, so it is reported as uncostable instead.
   */
  const rates = solarFeedInTariff.singleTariff?.rates;

  if (!rates || rates.length === 0) {
    return null;
  }

  let credit = 0;

  // Tiered feed-in ceilings reset daily — the snapshot's tiered blocks say `period: "day"`.
  for (const kwh of kwhByDate(getExportRecords(usage), -1).values()) {
    const dayCredit = priceTieredUsage(rates, kwh);

    if (dayCredit === null) {
      return null;
    }

    credit += dayCredit;
  }

  return credit;
}

/**
 * This function calculates the controlled-load single rate cost for a given energy plan based on the household's electricity usage.
 * 
 * @param tariff The controlled-load tariff to calculate the cost for.
 * @param records The household's controlled-load electricity usage records.
 * @returns The estimated controlled-load cost, or null if it cannot be calculated.
 */
function calculateControlledLoadSingleRateCost(
  tariff: CdrControlledLoad,
  records: ReturnType<typeof getControlledLoadRecords>,
): number | null {
  return costDailyTieredUsage(
    tariff.singleRate?.rates,
    records,
  );
}

/**
 * This function calculates the controlled-load time-of-use cost for a given energy plan based on the household's electricity usage.
 * 
 * @param tariff The controlled-load tariff to calculate the cost for.
 * @param records The household's controlled-load electricity usage records.
 * @returns The estimated controlled-load cost, or null if it cannot be calculated.
 */
function calculateControlledLoadTimeOfUseCost(
  tariff: CdrControlledLoad,
  records: ReturnType<typeof getControlledLoadRecords>,
): number | null {
  // Controlled load is a single circuit, so its band split is not surfaced.
  return (
    costTimeOfUseRecords(tariff.timeOfUseRates ?? [], records)
      ?.totalCost ?? null
  );
}

/**
 * This function calculates the controlled-load cost for a given energy plan based on the household's electricity usage.
 * 
 * Formula: Annual cost = (Σ each controlled-load interval's imported kWh × matching controlled-load rate + observed days × daily supply charge)
 *
 * @param plan The energy plan to calculate the controlled-load cost for.
 * @param usage The household's electricity usage data. In this case, controlled-load channel.
 * @param observedDays The number of days observed in the usage data.
 * @returns The estimated controlled-load cost, or null if it cannot be calculated.
 */
function calculateControlledLoadCost(
  plan: EnergyPlanDetail,
  usage: RawConsumption,
  observedDays: number,
): number | null {
  const records = getControlledLoadRecords(usage);

  // No controlled-load usage means no controlled-load charge.
  if (records.length === 0) {
    return 0;
  }

  const controlledLoadTariffs =
    plan.electricityContract.controlledLoad ?? [];

  // The household has controlled-load usage, but the plan
  // does not publish controlled-load pricing.
  if (controlledLoadTariffs.length === 0) {
    return null;
  }

  /*
   * A plan can potentially publish multiple controlled-load
   * tariffs. This first implementation uses the first tariff.
   *
   * Supporting multiple controlled-load channels properly would
   * require mapping each meter register to the correct tariff.
   */
  const tariff = controlledLoadTariffs[0];

  if (!tariff) {
    return null;
  }

  let usageCost: number | null;

  switch (tariff.rateBlockUType) {
    case "singleRate":
      usageCost = calculateControlledLoadSingleRateCost(
        tariff,
        records,
      );
      break;

    case "timeOfUseRates":
      usageCost = calculateControlledLoadTimeOfUseCost(
        tariff,
        records,
      );
      break;

    default:
      usageCost = null;
  }

  if (usageCost === null) {
    return null;
  }

  const dailySupplyCharge =
    parsePrice(tariff.dailySupplyCharge) ?? 0;

  const supplyCost =
    observedDays * dailySupplyCharge;

  return usageCost + supplyCost;
}

/**
 * This function is the calculation engine, it calculates the annual cost of a given energy plan based on the household's electricity usage.
 * 
 * i.e. takes into account for single rate and time of use rates calculations.
 *
 * @param plan The energy plan to calculate the cost for.
 * @param usage The household's electricity usage data.
 * @returns The estimated annual cost in AUD, plus a note whenever it could not be calculated.
 */
export function calculateAnnualPlanCost(plan: EnergyPlanDetail, usage: RawConsumption): PlanCostResult {
  /*
   * Demand charges bill peak kW, not energy. Estimating one needs a demand
   * model this engine does not have, and ignoring it would quietly understate
   * the plan — so the plan is reported as uncostable instead of made to look
   * cheap. No plan in the recorded snapshot carries one.
   */
  if (plan.electricityContract?.demandCharges?.length) {
    return uncostable(
      "Plan includes a demand charge billed on peak demand (kW); this engine costs energy only.",
    );
  }

  const tariffPeriod = plan.electricityContract?.tariffPeriod?.[0];

  if (!tariffPeriod) {
    return uncostable("Plan publishes no tariff period.");
  }

  const observedDays = countObservedDays(usage);

  if (observedDays === 0) {
    return uncostable("No usage data to cost this plan against.");
  }

  const dailySupplyCharge = parsePrice(
    tariffPeriod.dailySupplyCharge,
  );

  if (dailySupplyCharge === null) {
    return uncostable("Plan publishes no daily supply charge.");
  }

  // Now we need to calculate the usage cost based on the tariff type: Single Rate or Time of Use.

  let usageCostBeforeGst: number | null;
  let usageByBandType: Record<string, number> = {};

  switch (tariffPeriod.rateBlockUType) {
    case "singleRate":
      usageCostBeforeGst = calculateSingleRateUsageCost(
        plan,
        usage,
      );
      break;

    case "timeOfUseRates": {
      const timeOfUse = calculateTimeOfUseUsageCost(
        plan,
        usage,
      );

      usageCostBeforeGst = timeOfUse?.totalCost ?? null;
      usageByBandType = timeOfUse?.byBandType ?? {};
      break;
    }

    default:
      return uncostable(
        `Plan uses an unsupported rate block type "${tariffPeriod.rateBlockUType}".`,
      );
  }

  if (usageCostBeforeGst === null) {
    return uncostable(
      "Plan's published usage rates do not cover this household's consumption.",
    );
  }

  const supplyCostBeforeGst =
    observedDays * dailySupplyCharge;

  const controlledLoadCostBeforeGst = calculateControlledLoadCost(
    plan,
    usage,
    observedDays,
  );

  if (controlledLoadCostBeforeGst === null) {
    return uncostable(
      "Household has controlled-load usage the plan does not publish pricing for.",
    );
  }

  const solarCredit = calculateSolarCredit(plan, usage);

  if (solarCredit === null) {
    return uncostable(
      "Plan publishes a time-varying feed-in tariff, which this engine cannot price.",
    );
  }

  const observedCost =
  (
    usageCostBeforeGst +
    controlledLoadCostBeforeGst +
    supplyCostBeforeGst
  ) *
    GST_MULTIPLIER -
  solarCredit;

  /*
   * The visible test contains exactly 365 days, so the
   * multiplier becomes 1.
   *
   * Shorter datasets are scaled to an annual estimate.
   */
  const annualCost =
    observedCost * (DAYS_PER_YEAR / observedDays);

  const usageCostByBandType: Record<string, number> = {};

  for (const [type, cost] of Object.entries(usageByBandType)) {
    usageCostByBandType[type] = cost * GST_MULTIPLIER;
  }

  return {
    annualCostAud: Number(annualCost.toFixed(2)),
    notes: [],
    observed: {
      days: observedDays,
      costAud: observedCost,
      usageCost: usageCostBeforeGst * GST_MULTIPLIER,
      supplyCost: supplyCostBeforeGst * GST_MULTIPLIER,
      controlledLoadCost:
        controlledLoadCostBeforeGst * GST_MULTIPLIER,
      solarCredit,
      usageCostByBandType,
    },
  };
}

/**
 * Ranking group for one costed plan:
 *
 *   0 — applicable and costable
 *   1 — applicable, but the plan publishes no usable pricing
 *   2 — not applicable to this household
 *
 * A plan we could not cost still ranks above one the household cannot buy,
 * because the first is a gap in the published data and the second is a
 * definite "no".
 */
function rankGroup(result: RankedPlanCost): number {
  if (!result.applicable) {
    return 2;
  }

  return typeof result.annualCostAud === "number" ? 0 : 1;
}

/**
 * This function estimates the annual cost of each plan based on the household's electricity usage and the plan's pricing structure.
 * It returns a list of plans with their estimated annual costs, ranked cheapest-first.
 *
 * This is the function that will be assessed within the coding exercise.
 * 
 * @param input: EstimateInput object
 * @returns a list of RankedPlanCost objects
 */
export function estimatePlanCosts(input: EstimateInput): RankedPlanCost[] {
  const asOfDate = getLocalDate();
  const householdDistributors =
      getHouseholdDistributors(input.servicePoints);

  const results = input.plans.map(
    (plan, index): EstimatedPlanCost => {
      /*
       * Applicability is decided here rather than assumed from fetchPlans,
       * because callers (including the contract test) can pass in plans
       * that were never filtered.
       */
      const applicable = isPlanApplicable(
        plan,
        householdDistributors,
        asOfDate,
      );

      // An inapplicable plan is still reported, just never costed.
      const { annualCostAud, notes } = applicable
        ? calculateAnnualPlanCost(plan, input.usage)
        : uncostable(
            "Plan is not available to this household.",
          );

      return {
        planId: plan.planId ?? `unknown-plan-${index + 1}`,
        planName: plan.displayName ?? "Unnamed plan",
        brandName: plan.brandName ?? "Unknown brand",
        applicable,
        annualCostAud,
        notes,
      };
    },
  );

  /*
   * Cheapest first within the costable group; the groups themselves order
   * as described on rankGroup.
   *
   * Plans in the same group with no cost compare equal, and sort has been
   * stable since ES2019, so they keep the order they were supplied in.
   */
  results.sort((a, b) => {
    const byGroup = rankGroup(a) - rankGroup(b);

    if (byGroup !== 0) {
      return byGroup;
    }

    return (
      (a.annualCostAud ?? 0) - (b.annualCostAud ?? 0)
    );
  });

  return results;
}
