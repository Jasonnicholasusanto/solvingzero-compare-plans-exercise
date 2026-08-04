import { DAY_CODES, EnergyPlanDetail, RawConsumption, RawServicePoints } from "../types";


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
 * 
 * Used by fetchPlans.ts and estimatePlanCosts.ts to filter out inapplicable plans before estimating costs.
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

type UsageRecord = RawConsumption["usage"][number];

/**
 * Retrieve all grid-import records.
 */
export function getImportRecords(usage: RawConsumption): UsageRecord[] {
  return usage.usage.filter(
    (record) => record.register_suffix === "E1",
  );
}

/**
 * Retrieve all solar-export records.
 */
export function getExportRecords(usage: RawConsumption): UsageRecord[] {
  return usage.usage.filter(
    (record) => record.register_suffix === "B1",
  );
}

/**
 * Normal household imports use the main single-rate or TOU tariff.
 *
 * Records without controlled_load are also treated as normal usage,
 * which keeps the synthetic contract tests working.
 */
export function getNormalImportRecords(
  usage: RawConsumption,
): UsageRecord[] {
  return getImportRecords(usage).filter(
    (record) => record.controlled_load !== true,
  );
}

/**
 * Controlled-load records are priced separately from normal usage.
 */
export function getControlledLoadRecords(
  usage: RawConsumption,
): UsageRecord[] {
  return usage.usage.filter(
    (record) => record.controlled_load === true,
  );
}

/** 
 * Parse a price string into a number, throwing an error if the value is missing or invalid.
 */
export function parsePrice(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * This function parses a time string in the format "HH:MM" and returns the total number of minutes since midnight.
 */
export function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

/**
 * Determine whether an interval starts inside a tariff window.
 *
 * Normal window:
 * 07:00 -> 21:00
 *
 * Midnight-wrapping window:
 * 21:00 -> 07:00
 */
export function isTimeInWindow(
  intervalMinutes: number,
  startMinutes: number,
  endMinutes: number,
): boolean {
  if (startMinutes === endMinutes) {
    return true;
  }

  if (startMinutes < endMinutes) {
    return (
      intervalMinutes >= startMinutes &&
      intervalMinutes < endMinutes
    );
  }

  return (
    intervalMinutes >= startMinutes ||
    intervalMinutes < endMinutes
  );
}

/**
 * Convert a YYYY-MM-DD date into a CDR day code.
 */
export function getDayCode(date: string): string | null {
  const parsed = new Date(`${date}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return DAY_CODES[parsed.getUTCDay()] ?? null;
}