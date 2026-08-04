/**
 * Estimate each plan's annual cost for the household described by the usage
 *
 * @format
 */

import type {
  RawConsumption,
  RawServicePoints,
  EnergyPlanDetail,
  RankedPlanCost,
} from "./types.js";
import { getHouseholdDistributors, getLocalDate, isPlanApplicable } from "./utils/helpers.js";

export interface EstimateInput {
  usage: RawConsumption;
  servicePoints: RawServicePoints;
  plans: EnergyPlanDetail[];
}

export interface EstimatedPlanCost {
  planId: string;
  planName: string;
  applicable: boolean;
  annualCostAud: number | null;
}

export function estimatePlanCosts(input: EstimateInput): RankedPlanCost[] {
  const asOfDate = getLocalDate();
  const householdDistributors =
      getHouseholdDistributors(input.servicePoints);

  const results = input.plans.map((plan, index) => {
    const applicable = isPlanApplicable(
      plan,
      householdDistributors,
      asOfDate,
    );

    return applicable;
  });

  return results as any;
}
