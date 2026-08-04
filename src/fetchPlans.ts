/**
 * Fetch the electricity plans available to THIS household from the 10 retailers we give you, using the
 * public, unauthenticated CDR "Product Reference Data" endpoints, and filter to the ones that apply.
 *
 * Notes:
 *  - These endpoints need NO auth — do NOT put any API key/token in here.
 *  - The 10 retailers (name + base URI) are provided in `retailers.json` (load via `loadRetailers()`).
 *    You do NOT need to discover retailers from the CDR register — that's optional bonus.
 *  - List endpoint uses header `x-v: 1`; plan DETAIL uses `x-v: 3`. Some retailers have 1000+ plans, so
 *    paginate (`meta.totalPages`). How you handle failures, expiry, dedup and eligibility is yours to
 *    decide and justify. Keep the HTTP call separate from the filtering so the filter is unit-testable.
 * 
 * Basically what this file is supposed to action is:
 * 1. Read the household’s distributor
 * 2. Fetch every retailer’s plan list, including all pages
 * 3. Fetch the detailed pricing for every plan
 * 4. Keep only plans applicable to the household
 * @format
 */

import { type RawServicePoints, type EnergyPlanDetail, type Retailer, type ListPlansResponse, type PlanDetailResponse, DETAIL_CONCURRENCY } from "./types.js";
import { getDatePart, getHouseholdDistributors, getLocalDate, isPlanApplicable, mapWithConcurrency, removeTrailingSlash } from "./utils/helpers.js";


/**
 * Generic JSON request with CDR version handling.
 */
async function fetchJson<T>(
  url: string | URL,
  version: "1" | "3",
): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "x-v": version,
    },
  });

  if (!response.ok) {
    throw new Error(
      `CDR request failed: ${response.status} ` +
        `${response.statusText} — ${String(url)}`,
    );
  }

  return (await response.json()) as T;
}

/**
 * List all plan IDs for one retailer.
 *
 * The endpoint may return many pages, so meta.totalPages determines whether another request is required.
 * This function utilizes the `Get Energy Plans` endpoint, which requires version 1 of the CDR API.
 * @see https://consumerdatastandardsaustralia.github.io/standards/?examples#cdr-energy-api_get-generic-plans
 */
async function listAllPlanIds(
  retailer: Retailer,
): Promise<string[]> {
  const planIds = new Set<string>();
  let page = 1;

  while (true) {
    const url = new URL(
      `${removeTrailingSlash(
        retailer.baseUri,
      )}/cds-au/v1/energy/plans`,
    );

    // Narrow the list before requesting every detail.
    url.searchParams.set("fuelType", "ELECTRICITY");
    url.searchParams.set("effective", "CURRENT");
    url.searchParams.set("page", String(page));
    url.searchParams.set("page-size", "100");

    const body = await fetchJson<ListPlansResponse>(
      url,
      "1",
    );

    for (const plan of body.data?.plans ?? []) {
      if (
        typeof plan.planId === "string" &&
        plan.planId.trim()
      ) {
        // Deduplicate IDs within this retailer.
        planIds.add(plan.planId);
      }
    }

    const totalPages = Number(
      body.meta?.totalPages ?? 1,
    );

    if (
      !Number.isFinite(totalPages) ||
      totalPages < 1 ||
      page >= totalPages
    ) {
      break;
    }

    page += 1;
  }

  return [...planIds];
}

/**
 * Retrieve one plan's detailed tariff information.
 * 
 * This function utilizes the `Get Energy Plan Detail` endpoint, which requires version 3 of the CDR API.
 * @see https://consumerdatastandardsaustralia.github.io/standards/?examples#cdr-energy-api_get-generic-plan-detail
 */
async function fetchPlanDetail(
  retailer: Retailer,
  planId: string,
): Promise<EnergyPlanDetail> {
  // This line of code ensures encoding of the planId to handle special characters in the URL.
  const encodedPlanId = encodeURIComponent(planId);

  const url =
    `${removeTrailingSlash(retailer.baseUri)}` +
    `/cds-au/v1/energy/plans/${encodedPlanId}`;

  const body = await fetchJson<PlanDetailResponse>(
    url,
    "3",
  );

  if (!body.data) {
    throw new Error(
      `Plan ${planId} returned no detail data`,
    );
  }

  return body.data;
}

/**
 * Retrieve every available plan detail for one retailer.
 *
 * A failed detail request is logged and skipped rather than
 * preventing every other plan from being processed.
 */
async function fetchRetailerPlanDetails(
  retailer: Retailer,
): Promise<EnergyPlanDetail[]> {
  const planIds = await listAllPlanIds(retailer);

  return mapWithConcurrency(
    planIds,
    DETAIL_CONCURRENCY,
    async (planId) => {
      try {
        return await fetchPlanDetail(
          retailer,
          planId,
        );
      } catch (error) {
        console.warn(
          `Skipping ${retailer.name} plan ${planId}:`,
          error instanceof Error
            ? error.message
            : error,
        );

        return null;
      }
    },
  );
}

export interface FetchPlansInput {
  servicePoints: RawServicePoints;
  /** The 10 companies to compare — from `loadRetailers()`. */
  retailers: Retailer[];
}

/**
 * Fetch and filter plans for this household.
 */
export async function fetchPlans(
  input: FetchPlansInput,
): Promise<EnergyPlanDetail[]> {
  const householdDistributors =
    getHouseholdDistributors(input.servicePoints);

  if (householdDistributors.size === 0) {
    throw new Error(
      "No LNSP distributor was found in service-points data",
    );
  }

  /*
   * Retailers are independent. One unavailable retailer should
   * not prevent the remaining retailers from being compared.
   */
  const retailerResults = await Promise.allSettled(
    input.retailers.map(async (retailer) => ({
      retailer,
      plans: await fetchRetailerPlanDetails(retailer),
    })),
  );

  const fetchedPlans: EnergyPlanDetail[] = [];
  let successfulRetailers = 0;

  for (const result of retailerResults) {
    if (result.status === "fulfilled") {
      successfulRetailers += 1;
      fetchedPlans.push(...result.value.plans);
      continue;
    }

    console.warn(
      "Unable to fetch one retailer:",
      result.reason instanceof Error
        ? result.reason.message
        : result.reason,
    );
  }

  if (
    input.retailers.length > 0 &&
    successfulRetailers === 0
  ) {
    throw new Error(
      "No retailer plan endpoints could be processed",
    );
  }

  const asOfDate = getLocalDate();

  return fetchedPlans.filter((plan) =>
    isPlanApplicable(
      plan,
      householdDistributors,
      asOfDate,
    ),
  );
}