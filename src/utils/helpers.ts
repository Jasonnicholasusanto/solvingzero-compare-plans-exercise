import { EnergyPlanDetail, RawServicePoints } from "../types";


/**
 * Remove a trailing slash so URLs are built consistently.
 */
export function removeTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Extract YYYY-MM-DD from a CDR date or datetime.
 */
export function getDatePart(value: string): string | null {
  return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

/**
 * Make distributor names comparable.
 *
 * Basically:
 * "CitiPower Pty" -> "CITIPOWER"
 * "CITIPOWER" -> "CITIPOWER"
 */
export function normaliseDistributor(value: string): string {
  return value
    .toUpperCase()
    .replace(/\bPROPRIETARY\b/g, "")
    .replace(/\bPTY\b/g, "")
    .replace(/\bLIMITED\b/g, "")
    .replace(/\bLTD\b/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Extract all household distributors from service points.
 *
 * The relevant participant has the LNSP role.
 */
export function getHouseholdDistributors(
  servicePoints: RawServicePoints,
): Set<string> {
  const distributors = new Set<string>();

  for (const servicePoint of servicePoints.service_points) {
    for (const participant of servicePoint.related_participants ?? []) {
      if (
        participant.role.toUpperCase() === "LNSP" &&
        participant.party.trim()
      ) {
        distributors.add(
          normaliseDistributor(participant.party),
        );
      }
    }
  }

  return distributors;
}

/**
 * Map over `items` with at most `concurrency` mappers in flight.
 *
 * A fixed pool of workers pulls from a shared cursor, so a slow item
 * never blocks the rest of the queue the way batching would.
 *
 * A mapper returning `null`/`undefined` opts that item out of the
 * result — this is how callers skip failures without aborting the
 * whole run. Surviving results keep their input order.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R | null | undefined>,
): Promise<R[]> {
  // Guard against 0, negative and non-numeric limits.
  const limit = Math.max(
    1,
    Math.floor(concurrency) || 1,
  );

  const results = new Array<R | null | undefined>(
    items.length,
  );

  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      // Claim an index before awaiting so no two workers share one.
      const index = nextIndex;
      nextIndex += 1;

      results[index] = await mapper(
        items[index]!,
        index,
      );
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );

  // A rejecting mapper propagates — callers that want to skip
  // failures should catch inside the mapper and return null.
  await Promise.all(workers);

  return results.filter(
    (result): result is R =>
      result !== null && result !== undefined,
  );
}

/**
 * Return today's local calendar date as YYYY-MM-DD.
 *
 * Calendar-date comparison avoids unnecessary timezone conversion
 * for effectiveFrom/effectiveTo fields.
 */
export function getLocalDate(): string {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * Determine if a plan is active on the given date.
 *
 * This is a pure function, so it can be unit-tested without any HTTP.
 */
function isPlanActive(
  plan: EnergyPlanDetail,
  asOfDate: string,
): boolean {
  const effectiveFrom = plan.effectiveFrom
    ? getDatePart(plan.effectiveFrom)
    : null;

  const effectiveTo = plan.effectiveTo
    ? getDatePart(plan.effectiveTo)
    : null;

  // Invalid published dates should not be silently accepted.
  if (plan.effectiveFrom && !effectiveFrom) {
    return false;
  }

  if (plan.effectiveTo && !effectiveTo) {
    return false;
  }

  if (effectiveFrom && effectiveFrom > asOfDate) {
    return false;
  }

  if (effectiveTo && effectiveTo < asOfDate) {
    return false;
  }

  return true;
}

/**
 * This function checks if a plan is applicable to the household, based on fuel type, customer type, and distributor.
 */
export function isPlanApplicable(
  plan: EnergyPlanDetail,
  householdDistributors: Set<string>,
  asOfDate = getLocalDate(),
): boolean {
  // Hard-coded eligibility rules for this coding exercise household.
  if (plan.fuelType !== "ELECTRICITY") {
    return false;
  }

  // Hard-coded eligibility rules for this coding exercise household.
  if (plan.customerType !== "RESIDENTIAL") {
    return false;
  }

  if (!isPlanActive(plan, asOfDate)) {
    return false;
  }

  const planDistributors =
    plan.geography?.distributors ?? [];

  return planDistributors.some((distributor) =>
    householdDistributors.has(
      normaliseDistributor(distributor),
    ),
  );
}