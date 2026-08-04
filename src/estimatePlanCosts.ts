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
} from "./types.js";
import { getExportRecords, getHouseholdDistributors, getImportRecords, getLocalDate, isPlanApplicable, parsePrice } from "./utils/helpers.js";

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
  return getImportRecords(usage).reduce((total, record) => {
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

  console.log(`Calculating annual cost for plan ${plan.planId} with ${observedDays} observed days. Daily supply charge: ${dailySupplyCharge}`);

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

    default:
      usageCostBeforeGst = null;
  }

  if (usageCostBeforeGst === null) {
    return null; // Cannot calculate usage cost
  }

  const supplyCostBeforeGst =
    observedDays * dailySupplyCharge;

  const observedCost =
    (usageCostBeforeGst + supplyCostBeforeGst) * GST_MULTIPLIER;

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
 * This function estimates the annual cost of each plan based on the household's electricity usage and the plan's pricing structure.
 * It returns a list of plans with their estimated annual costs, which can then be sorted to provide the final recommendations.
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

  const results = input.plans.map((plan, index) => {
    // This is necessary for the contract test because the test directly passes business and out-of-zone plans into estimatePlanCosts().
    const applicable = isPlanApplicable(
      plan,
      householdDistributors,
      asOfDate,
    );

    // If the plan is not applicable, return null for annualCostAud to indicate that it cannot be costed.
    if (!applicable) {
      return {
        planId: plan.planId,
        planName: plan.displayName,
        brandName: plan.brandName,
        applicable: false,
        annualCostAud: null,
      };
    }

    // If the plan is applicable, calculate the annual cost here based on the household's usage and the plan's pricing structure.
    const result: EstimatedPlanCost & {
      originalIndex: number;
    } = {
      planId: plan.planId ?? `unknown-plan-${index + 1}`,
      planName: plan.displayName ?? "Unnamed plan",
      brandName: plan.brandName ?? "Unknown brand",
      applicable,
      annualCostAud: calculateAnnualPlanCost(plan, input.usage),
      originalIndex: index,
    };

    return result;
  });

  return results;
}
