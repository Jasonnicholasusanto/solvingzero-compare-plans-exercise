/**
 * Public surface of the cost engine — this is what `apps/web` (or any other consumer)
 * is allowed to import. Everything else in `src/` is an internal detail.
 *
 * @format
 */

/** Fetch + filter the ten retailers' CDR plans down to the ones this household could take. */
export { fetchPlans, type FetchPlansInput } from "./fetchPlans.js";

/** What the household pays today, from usage and from their bills. */
export {
  calculateCurrentEnergyCosts,
  extractCurrentPlan,
  normaliseCurrentContract,
  type CurrentEnergyCostsInput,
  type CurrentEnergySpend,
  type CurrentPlan,
  type UsageBasedSpend,
  type BillBasedSpend,
  type SpendReconciliation,
  type ReconciledLine,
} from "./calculateCurrentEnergyCosts.js";

/** Cost every applicable plan and rank them cheapest-first. */
export {
  estimatePlanCosts,
  calculateAnnualPlanCost,
  type EstimateInput,
  type EstimatedPlanCost,
  type PlanCostResult,
  type ObservedPlanCost,
} from "./estimatePlanCosts.js";

/** The top-level answer: today's cost vs. the best switch, with the saving. */
export { recommendPlan, type RecommendPlanInput, type PlanRecommendation } from "./recommendPlan.js";

/** Household fixtures shipped with this package (`user_data/`, `retailers.json`). */
export {
  loadRetailers,
  loadUsage,
  loadServicePoints,
  loadAccounts,
  loadDer,
  loadBills,
  loadInstitutions,
} from "./loadData.js";

export type * from "./types.js";
