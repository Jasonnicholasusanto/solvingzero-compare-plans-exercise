import { cache } from "react";
import {
  fetchPlans,
  loadAccounts,
  loadBills,
  loadInstitutions,
  loadRetailers,
  loadServicePoints,
  loadUsage,
  recommendPlan,
  type Institution,
  type PlanRecommendation,
  type RawAccounts,
} from "@solvingzero/core";

/**
 * The engine names the retailer for every plan it costs, but not for the plan the household
 * is already on — an account carries an `institution_id`, not a brand. Resolving it is a join
 * against the retailer directory, so it happens here rather than inside the cost engine.
 */
export type RecommendationView = PlanRecommendation & { currentBrandName: string | null };

function resolveCurrentBrand(
  accounts: RawAccounts,
  institutions: Institution[],
  currentPlanName: string,
): string | null {
  /* Prefer the account that actually holds the costed plan; fall back to the only one there is. */
  const owning =
    accounts.accounts.find((account) =>
      account.plans?.some((plan) => plan.plan_overview?.display_name === currentPlanName),
    ) ?? accounts.accounts[0];

  if (!owning?.institution_id) return null;

  return institutions.find((institution) => institution.id === owning.institution_id)?.name ?? null;
}

/**
 * Server-only. `@solvingzero/core` reads the household fixtures off disk and calls the
 * retailers' CDR endpoints, so this must never be pulled into a client component —
 * `serverExternalPackages` in `next.config.ts` keeps the package out of client bundles.
 *
 * `cache()` dedupes within a single render pass; the expensive part (fetching ~220 plan
 * details across ten retailers, roughly 25s cold) is held between requests by the route's
 * `revalidate` window — see `app/page.tsx`.
 */
export const getRecommendation = cache(async (): Promise<RecommendationView> => {
  const accounts = loadAccounts();
  const usage = loadUsage();
  const servicePoints = loadServicePoints();
  const bills = loadBills();
  const retailers = loadRetailers();
  const institutions = loadInstitutions();

  const plans = await fetchPlans({ servicePoints, retailers });

  const recommendation = recommendPlan({
    accounts,
    usage,
    servicePoints,
    bills,
    plans,
  });

  if (!recommendation) {
    throw new Error(
      "Could not work out what this household pays today — no current electricity contract was found in accounts.json.",
    );
  }

  return {
    ...recommendation,
    currentBrandName: resolveCurrentBrand(accounts, institutions, recommendation.current.planName),
  };
});
