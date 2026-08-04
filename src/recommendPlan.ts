/**
 * Put the two cost goals together: what this household pays today, the cheapest plan
 * available to them, and the difference between the two.
 *
 * Plans are passed in rather than fetched here, so the recommendation can be tested
 * against the recorded snapshot without touching the network.
 *
 * @format
 */

import {
  calculateCurrentEnergyCosts,
  type CurrentEnergySpend,
} from "./calculateCurrentEnergyCosts.js";
import { estimatePlanCosts } from "./estimatePlanCosts.js";
import type {
  EnergyPlanDetail,
  RankedPlanCost,
  RawAccounts,
  RawBilling,
  RawConsumption,
  RawServicePoints,
} from "./types.js";
import { roundToCents } from "./utils/helpers.js";

/**
 * A saving smaller than this is not worth acting on.
 *
 * The costing reconciles to well under 1% against this household's invoices, but the
 * usage window omits deep winter, so an annual figure carries more uncertainty than
 * the reconciliation alone suggests. Twenty-odd dollars a year sits inside that.
 */
const DEFAULT_MATERIAL_SAVING_AUD = 30;

const DEFAULT_ALTERNATIVES = 5;

export interface RecommendPlanInput {
  accounts: RawAccounts;
  usage: RawConsumption;
  servicePoints: RawServicePoints;
  /** Plans to compare, e.g. from `fetchPlans` or the recorded snapshot. */
  plans: EnergyPlanDetail[];
  /** Historical invoices. Supplying them adds a billed figure and a reconciliation. */
  bills?: RawBilling;
  /** How many alternatives to return. Defaults to 5. */
  alternatives?: number;
  /** Savings below this are reported but flagged as not worth acting on. */
  materialSavingAud?: number;
}

export interface PlanRecommendation {
  /** What the household pays today, from their usage and their invoices. */
  current: CurrentEnergySpend;

  /**
   * The cheapest plan that actually beats the current one. Null when nothing does —
   * "the cheapest plan available" is not a recommendation if they are already on it.
   */
  recommended: RankedPlanCost | null;
  annualSavingAud: number | null;
  savingPercent: number | null;

  /** Where the current plan sits against everything costed. 1 means nothing is cheaper. */
  currentPlanRank: number;
  /** The cheapest plans found, cheapest first, whether or not they beat the current one. */
  alternatives: RankedPlanCost[];

  /** Plans that produced a comparable annual cost. */
  comparedPlans: number;
  /** Plans that apply to this household but could not be costed, so were left out. */
  excludedPlans: number;

  notes: string[];
}

/** Group the reasons uncostable plans were left out, so one note can summarise them. */
function summariseExclusions(
  excluded: RankedPlanCost[],
): string[] {
  const reasons = new Map<string, number>();

  for (const plan of excluded) {
    for (const note of plan.notes ?? []) {
      reasons.set(note, (reasons.get(note) ?? 0) + 1);
    }
  }

  return [...reasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count} × ${reason}`);
}

/**
 * Compare the household's current plan against everything available to them.
 *
 * Both sides are annualised from the SAME usage, so the saving is like for like.
 * Comparing the observed "spent so far" figure against an annual plan cost would
 * invent a saving out of nothing but the length of the usage window.
 */
export function recommendPlan(
  input: RecommendPlanInput,
): PlanRecommendation | null {
  const current = calculateCurrentEnergyCosts({
    accounts: input.accounts,
    usage: input.usage,
    bills: input.bills,
  });

  if (!current) {
    return null;
  }

  const currentAnnual =
    current.fromUsage.estimatedAnnualCost;

  const ranked = estimatePlanCosts({
    usage: input.usage,
    servicePoints: input.servicePoints,
    plans: input.plans,
  });

  // estimatePlanCosts already returns costable plans first, cheapest first.
  const costable = ranked.filter(
    (
      plan,
    ): plan is RankedPlanCost & { annualCostAud: number } =>
      plan.applicable &&
      typeof plan.annualCostAud === "number",
  );

  const excluded = ranked.filter(
    (plan) =>
      plan.applicable && plan.annualCostAud === null,
  );

  const cheapest = costable[0] ?? null;

  const recommended =
    cheapest && cheapest.annualCostAud < currentAnnual
      ? cheapest
      : null;

  const annualSavingAud = recommended
    ? roundToCents(currentAnnual - recommended.annualCostAud)
    : null;

  const savingPercent =
    annualSavingAud !== null && currentAnnual > 0
      ? roundToCents(
          (annualSavingAud / currentAnnual) * 100,
        )
      : null;

  const materialSaving =
    input.materialSavingAud ?? DEFAULT_MATERIAL_SAVING_AUD;

  const notes: string[] = [];

  if (recommended === null) {
    notes.push(
      costable.length === 0
        ? "No plan could be costed, so there is nothing to compare against."
        : "No available plan is cheaper than the current plan.",
    );
  } else if (annualSavingAud !== null && annualSavingAud < materialSaving) {
    notes.push(
      `A saving of $${annualSavingAud.toFixed(2)} a year is within the accuracy of this ` +
        "estimate, so it is closer to break-even than a reason to switch.",
    );
  }

  if (excluded.length > 0) {
    notes.push(
      `${excluded.length} applicable plans could not be costed and were left out of the ` +
        `comparison: ${summariseExclusions(excluded).join("; ")}.`,
    );
  }

  if (current.reconciliation) {
    notes.push(
      `Costing reconciles to ${current.reconciliation.differencePercent.toFixed(2)}% against ` +
        `the household's own invoices over ${current.reconciliation.observedDays} days.`,
    );
  }

  notes.push(
    `Annual figures are scaled from ${current.fromUsage.observedDays} days of meter reads ` +
      `(${current.fromUsage.fromDate} to ${current.fromUsage.toDate}).`,
  );

  return {
    current,

    recommended,
    annualSavingAud,
    savingPercent,

    /*
     * Rank counts plans strictly cheaper than the current one, so 1 means nothing
     * available beats it. Derived from the cost rather than by finding the current
     * plan in the fetched list, which would depend on the retailer publishing it.
     */
    currentPlanRank:
      costable.filter(
        (plan) => plan.annualCostAud < currentAnnual,
      ).length + 1,

    alternatives: costable.slice(
      0,
      input.alternatives ?? DEFAULT_ALTERNATIVES,
    ),

    comparedPlans: costable.length,
    excludedPlans: excluded.length,

    notes,
  };
}
