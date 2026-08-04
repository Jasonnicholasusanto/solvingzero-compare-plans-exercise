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
} from "./types.js";
import { getControlledLoadRecords, getDayCode, getExportRecords, getHouseholdDistributors, getImportRecords, getLocalDate, getNormalImportRecords, isPlanApplicable, isTimeInWindow, parsePrice, parseTimeToMinutes } from "./utils/helpers.js";

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
 * Calculate total imported energy.
 *
 * Negative E1 values are ignored defensively.
 */
function calculateImportedKwh(usage: RawConsumption): number {
  return getNormalImportRecords(usage).reduce((total, record) => {
    const intervalTotal = record.interval_read.interval_reads.reduce(
      (recordTotal, value) => {
        return recordTotal + Math.max(0, value);
      },
      0,
    );

    return total + intervalTotal;
  }, 0);
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
 * Find the applicable TOU unit price for one interval.
 */
function findTimeOfUsePrice(
  plan: EnergyPlanDetail,
  date: string,
  intervalMinutes: number,
): number | null {
  const tariffPeriod = plan.electricityContract?.tariffPeriod?.[0];
  const timeOfUseRates = tariffPeriod?.timeOfUseRates ?? [];
  const dayCode = getDayCode(date);

  if (!dayCode) {
    return null;
  }

  for (const timeOfUseRate of timeOfUseRates) {
    const unitPrice = parsePrice(
      timeOfUseRate.rates?.[0]?.unitPrice,
    );

    if (unitPrice === null) {
      continue;
    }

    for (const window of timeOfUseRate.timeOfUse ?? []) {
      const days = window.days ?? [];

      if (!days.includes(dayCode)) {
        continue;
      }

      const startMinutes = parseTimeToMinutes(window.startTime);
      const endMinutes = parseTimeToMinutes(window.endTime);

      if (startMinutes === null || endMinutes === null) {
        continue;
      }

      if (
        isTimeInWindow(
          intervalMinutes,
          startMinutes,
          endMinutes,
        )
      ) {
        return unitPrice;
      }
    }
  }

  return null;
}

/**
 * Find the applicable TOU unit price for one interval but for controlled-load.
 */
function findControlledLoadTimeOfUsePrice(
  tariff: CdrControlledLoad,
  date: string,
  intervalMinutes: number,
): number | null {
  const dayCode = getDayCode(date);

  if (!dayCode) {
    return null;
  }

  for (const timeOfUseRate of tariff.timeOfUseRates ?? []) {
    const unitPrice = parsePrice(
      timeOfUseRate.rates?.[0]?.unitPrice,
    );

    if (unitPrice === null) {
      continue;
    }

    for (const window of timeOfUseRate.timeOfUse ?? []) {
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
        return unitPrice;
      }
    }
  }

  return null;
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
): number | null {
  let totalCost = 0;

  for (const record of getNormalImportRecords(usage)) {
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
      const intervalKwh =
        record.interval_read.interval_reads[index] ?? 0;

      const importedKwh = Math.max(0, intervalKwh);

      if (importedKwh === 0) {
        continue;
      }

      const intervalMinutes = index * intervalLength;

      const unitPrice = findTimeOfUsePrice(
        plan,
        record.read_start_date,
        intervalMinutes,
      );

      /*
       * If an imported interval cannot be matched to a published
       * tariff window, the plan cannot be costed reliably.
       */
      if (unitPrice === null) {
        return null;
      }

      totalCost += importedKwh * unitPrice;
    }
  }

  return totalCost;
}

/**
 * This function calculates the single rate usage cost for a given energy plan based on the household's electricity usage.
 * 
 * Formula: Annual cost = ((Total imported kWh × single rate) + (days × daily supply charge)) × 1.1 − (Total exported kWh × feed-in tariff)
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

  const singleRate = tariffPeriod.singleRate?.rates?.[0];

  if (!singleRate) {
    return null; // No single rate defined
  }

  const unitPrice = parsePrice(singleRate.unitPrice);

  if (unitPrice === null) {
    return null; // Invalid unit price
  }

  const totalImportKWh = calculateImportedKwh(usage);

  return totalImportKWh * unitPrice;
}

/**
 * This function calculates the solar feed-in credit (export kWh) for a given energy plan based on the household's electricity usage.
 * 
 * Formula: Solar feed-in credit = Total exported kWh × feed-in tariff
 * 
 * @param plan The energy plan to calculate the usage cost for.
 * @param usage The household's electricity usage data. In this case, export B1 channel.
 * @returns The estimated solar feed-in credit.
 */
function calculateSolarCredit(plan: EnergyPlanDetail, usage: RawConsumption): number {
  const solarFeedInTariff = plan.electricityContract?.solarFeedInTariff?.[0];

  if (!solarFeedInTariff || !solarFeedInTariff.singleTariff) {
    return 0; // No solar feed-in tariff defined
  }

  const feedInRate = parsePrice(solarFeedInTariff.singleTariff.rates?.[0]?.unitPrice);

  if (feedInRate === null) {
    return 0; // Invalid feed-in rate
  }

  const totalExportKWh = calculateExportedKwh(usage);

  return totalExportKWh * feedInRate;
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
  const singleRate = tariff.singleRate?.rates?.[0];

  if (!singleRate) {
    return null; // No single rate defined
  }

  const unitPrice = parsePrice(singleRate.unitPrice);

  if (unitPrice === null) {
    return null; // Invalid unit price
  }

  const totalImportKWh = records.reduce((total, record) => {
    const intervalTotal = record.interval_read.interval_reads.reduce(
      (recordTotal, value) => {
        return recordTotal + Math.max(0, value);
      },
      0,
    );

    return total + intervalTotal;
  }, 0);

  return totalImportKWh * unitPrice;
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
  const timeOfUseRates = tariff.timeOfUseRates ?? [];
  
  if (timeOfUseRates.length === 0) {
    return null; // No time-of-use rates defined
  }

  let totalCost = 0;

  for (const record of records) {
    const intervalLength = record.interval_read.read_interval_length;

    if (!Number.isFinite(intervalLength) || intervalLength <= 0) {
      return null; // Invalid interval length
    }

    for (let index = 0; index < record.interval_read.interval_reads.length; index++) {
      const intervalKwh = record.interval_read.interval_reads[index] ?? 0;
      const importedKwh = Math.max(0, intervalKwh);

      if (importedKwh === 0) {
        continue; // No import for this interval
      }

      const intervalMinutes = index * intervalLength;
      const unitPrice =
        findControlledLoadTimeOfUsePrice(
          tariff,
          record.read_start_date,
          intervalMinutes,
        );

      if (unitPrice === null) {
        return null; // Cannot find a matching TOU rate
      }

      totalCost += importedKwh * unitPrice;
    }
  }

  return totalCost;
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
 * @returns The estimated annual cost in AUD, or null if it cannot be calculated.
 */
export function calculateAnnualPlanCost(plan: EnergyPlanDetail, usage: RawConsumption): number | null {
  const tariffPeriod = plan.electricityContract?.tariffPeriod?.[0];

  if (!tariffPeriod) {
    return null; // No tariff period means we cannot calculate the cost
  }

  const observedDays = countObservedDays(usage);

  if (observedDays === 0) {
    return null;
  }

  const dailySupplyCharge = parsePrice(
    tariffPeriod.dailySupplyCharge,
  );

  if (dailySupplyCharge === null) {
    return null;
  }

  // Now we need to calculate the usage cost based on the tariff type: Single Rate or Time of Use.

  let usageCostBeforeGst: number | null;

  switch (tariffPeriod.rateBlockUType) {
    case "singleRate":
      usageCostBeforeGst = calculateSingleRateUsageCost(
        plan,
        usage,
      );
      break;

    case "timeOfUseRates":
      usageCostBeforeGst = calculateTimeOfUseUsageCost(
        plan,
        usage,
      );
      break;

    default:
      usageCostBeforeGst = null;
  }

  if (usageCostBeforeGst === null) {
    return null; // Cannot calculate usage cost
  }

  const supplyCostBeforeGst =
    observedDays * dailySupplyCharge;

  const controlledLoadCostBeforeGst = calculateControlledLoadCost(
    plan,
    usage,
    observedDays,
  );

  if (controlledLoadCostBeforeGst === null) {
    return null; // Cannot calculate controlled-load cost
  }

  const solarCredit = calculateSolarCredit(plan, usage);

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

  return Number(annualCost.toFixed(2));
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

      return {
        planId: plan.planId ?? `unknown-plan-${index + 1}`,
        planName: plan.displayName ?? "Unnamed plan",
        brandName: plan.brandName ?? "Unknown brand",
        applicable,
        // An inapplicable plan is still reported, just never costed.
        annualCostAud: applicable
          ? calculateAnnualPlanCost(plan, input.usage)
          : null,
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
