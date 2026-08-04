/** @format */

// Tests for the fetch + filter pipeline in fetchPlans.ts.
//
// Two halves, deliberately split the way the brief asks for:
//   FILTER — `isPlanApplicable` is pure, so it is tested directly against hand-built plans. No network,
//            no mocking, no clock dependency (every date case passes an explicit `asOfDate`).
//   FETCH  — `fetchPlans` is tested against a stubbed `globalThis.fetch` that behaves like a small CDR
//            server: it pages, it can 500, and it serves plan detail keyed by plan id. That pins the
//            wire contract (x-v versions, pagination, URL building) without ever hitting a retailer.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPlans } from "./fetchPlans.js";
import { isPlanApplicable } from "./utils/helpers.js";
import type { EnergyPlanDetail, RawServicePoints, Retailer } from "./types.js";

// ───────────────────────── household + plan fixtures ─────────────────────────

/** LNSP is "CitiPower Pty"; the FRMP participant must be ignored when deriving the distributor. */
const CITIPOWER_SP: RawServicePoints = {
  service_points: [
    {
      service_point_id: "SP1",
      jurisdiction_code: "VIC",
      related_participants: [
        { party: "CitiPower Pty", role: "LNSP" },
        { party: "Some Retailer Pty Ltd", role: "FRMP" },
      ],
    },
  ],
};

const CITIPOWER = new Set(["CITIPOWER"]);

/** A plan that applies to CITIPOWER_SP unless an override says otherwise. */
function plan(planId: string, overrides: Partial<EnergyPlanDetail> = {}): EnergyPlanDetail {
  return {
    planId,
    displayName: `Plan ${planId}`,
    fuelType: "ELECTRICITY",
    customerType: "RESIDENTIAL",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    geography: { distributors: ["CITIPOWER"] },
    electricityContract: {
      tariffPeriod: [
        { rateBlockUType: "singleRate", dailySupplyCharge: "1.00", singleRate: { rates: [{ unitPrice: "0.30" }] } },
      ],
    },
    ...overrides,
  };
}

const RETAILER_A: Retailer = { name: "Retailer A", baseUri: "https://a.test/energy" };
/** Trailing slash on purpose — the URL builder must not emit `//cds-au`. */
const RETAILER_B: Retailer = { name: "Retailer B", baseUri: "https://b.test/energy/" };

// ───────────────────────── fake CDR server ─────────────────────────

const LIST_PATH = "/cds-au/v1/energy/plans";

interface RetailerFixture {
  retailer: Retailer;
  /** Plan detail this retailer can serve, keyed by planId. */
  plans: EnergyPlanDetail[];
  /** Ids the LIST endpoint hands out, in order. Defaults to every plan. Duplicates allowed. */
  listedIds?: string[];
}

interface StubConfig {
  catalogue: RetailerFixture[];
  /** Server-side page cap, so a test can force multiple pages regardless of the requested page-size. */
  pageSize?: number;
  /** Retailer names whose LIST endpoint returns 500. */
  listFails?: string[];
  /** Plan ids whose DETAIL endpoint returns 500. */
  detailFails?: string[];
  /** Plan ids whose DETAIL endpoint returns 200 with an empty envelope. */
  detailEmpty?: string[];
}

interface CallLog {
  url: string;
  /** The `x-v` request header the client sent. */
  version: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Replaces global fetch with a tiny CDR server. Returns the (mutating) call log. */
function installFetch(config: StubConfig): CallLog[] {
  const calls: CallLog[] = [];
  const pageSize = config.pageSize ?? 100;
  const byBase = new Map(config.catalogue.map((f) => [stripTrailingSlash(f.retailer.baseUri), f]));

  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), version: new Headers(init?.headers).get("x-v") });

    const pathIndex = url.pathname.indexOf(LIST_PATH);
    if (pathIndex === -1) return json({ error: "unknown path" }, 404);

    // Anything before /cds-au/... is the retailer's baseUri. An unstripped trailing slash lands here as
    // ".../energy/" and finds no fixture — which is the point.
    const fixture = byBase.get(url.origin + url.pathname.slice(0, pathIndex));
    if (!fixture) return json({ error: "unknown retailer" }, 404);

    const tail = url.pathname.slice(pathIndex + LIST_PATH.length);

    if (tail === "") {
      if (config.listFails?.includes(fixture.retailer.name)) return json({ error: "list exploded" }, 500);

      const ids = fixture.listedIds ?? fixture.plans.map((p) => p.planId);
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
      const totalPages = Math.max(1, Math.ceil(ids.length / pageSize));

      return json({
        data: { plans: ids.slice((page - 1) * pageSize, page * pageSize).map((planId) => ({ planId })) },
        meta: { totalRecords: ids.length, totalPages },
      });
    }

    const planId = decodeURIComponent(tail.replace(/^\//, ""));
    if (config.detailFails?.includes(planId)) return json({ error: "detail exploded" }, 500);
    if (config.detailEmpty?.includes(planId)) return json({});

    const found = fixture.plans.find((p) => p.planId === planId);
    return found ? json({ data: found }) : json({ error: "no such plan" }, 404);
  });

  return calls;
}

const isListCall = (c: CallLog) => new URL(c.url).pathname.endsWith(LIST_PATH);
const isDetailCall = (c: CallLog) => !isListCall(c);
const ids = (plans: EnergyPlanDetail[]) => plans.map((p) => p.planId).sort();

beforeEach(() => {
  // fetchRetailerPlanDetails warns on every skipped plan; keep the test output readable.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ───────────────────────── FILTER — isPlanApplicable (pure, no network) ─────────────────────────

describe("isPlanApplicable", () => {
  const TODAY = "2026-08-03";

  it("accepts a residential electricity plan on the household's network", () => {
    expect(isPlanApplicable(plan("ok"), CITIPOWER, TODAY)).toBe(true);
  });

  it("rejects non-electricity fuel types", () => {
    expect(isPlanApplicable(plan("gas", { fuelType: "GAS" }), CITIPOWER, TODAY)).toBe(false);
    expect(isPlanApplicable(plan("dual", { fuelType: "DUAL" }), CITIPOWER, TODAY)).toBe(false);
  });

  it("rejects business plans", () => {
    expect(isPlanApplicable(plan("biz", { customerType: "BUSINESS" }), CITIPOWER, TODAY)).toBe(false);
  });

  it("rejects a plan for a different distributor", () => {
    const other = plan("zone", { geography: { distributors: ["POWERCOR", "AUSNET"] } });
    expect(isPlanApplicable(other, CITIPOWER, TODAY)).toBe(false);
  });

  it("matches distributors despite legal-suffix and punctuation differences", () => {
    const messy = plan("messy", { geography: { distributors: ["CitiPower Pty Ltd"] } });
    expect(isPlanApplicable(messy, CITIPOWER, TODAY)).toBe(true);
  });

  it("accepts a plan listing several distributors when one of them matches", () => {
    const multi = plan("multi", { geography: { distributors: ["POWERCOR", "CITIPOWER"] } });
    expect(isPlanApplicable(multi, CITIPOWER, TODAY)).toBe(true);
  });

  it("rejects a plan with no geography rather than assuming nationwide availability", () => {
    expect(isPlanApplicable(plan("nogeo", { geography: undefined }), CITIPOWER, TODAY)).toBe(false);
    expect(isPlanApplicable(plan("empty", { geography: { distributors: [] } }), CITIPOWER, TODAY)).toBe(false);
  });

  it("rejects a plan that has not started yet", () => {
    expect(isPlanApplicable(plan("future", { effectiveFrom: "2026-08-04" }), CITIPOWER, TODAY)).toBe(false);
  });

  it("accepts a plan starting today (both bounds are inclusive)", () => {
    expect(isPlanApplicable(plan("starts", { effectiveFrom: TODAY }), CITIPOWER, TODAY)).toBe(true);
    expect(isPlanApplicable(plan("ends", { effectiveTo: TODAY }), CITIPOWER, TODAY)).toBe(true);
  });

  it("rejects an expired plan", () => {
    expect(isPlanApplicable(plan("gone", { effectiveTo: "2026-08-02" }), CITIPOWER, TODAY)).toBe(false);
  });

  it("treats a missing or null effectiveTo as open-ended", () => {
    expect(isPlanApplicable(plan("null"), CITIPOWER, TODAY)).toBe(true);
    expect(isPlanApplicable(plan("absent", { effectiveTo: undefined }), CITIPOWER, TODAY)).toBe(true);
  });

  it("compares the date part of a full CDR timestamp", () => {
    const stamped = plan("stamped", { effectiveFrom: "2020-01-01T00:00:00Z", effectiveTo: "2026-08-03T23:59:59Z" });
    expect(isPlanApplicable(stamped, CITIPOWER, TODAY)).toBe(true);
  });

  it("rejects a plan whose published dates are unparseable instead of silently accepting it", () => {
    expect(isPlanApplicable(plan("bad-from", { effectiveFrom: "soon" }), CITIPOWER, TODAY)).toBe(false);
    expect(isPlanApplicable(plan("bad-to", { effectiveTo: "never" }), CITIPOWER, TODAY)).toBe(false);
  });

  it("rejects everything when the household has no known distributor", () => {
    expect(isPlanApplicable(plan("ok"), new Set<string>(), TODAY)).toBe(false);
  });
});

// ───────────────────────── FETCH — fetchPlans against a stubbed CDR ─────────────────────────

describe("fetchPlans", () => {
  const household = { servicePoints: CITIPOWER_SP };

  it("returns only the plans applicable to this household", async () => {
    installFetch({
      catalogue: [
        {
          retailer: RETAILER_A,
          plans: [
            plan("keep"),
            plan("biz", { customerType: "BUSINESS" }),
            plan("gas", { fuelType: "GAS" }),
            plan("zone", { geography: { distributors: ["POWERCOR"] } }),
            plan("expired", { effectiveTo: "2021-01-01" }),
          ],
        },
      ],
    });

    const result = await fetchPlans({ ...household, retailers: [RETAILER_A] });

    expect(ids(result)).toEqual(["keep"]);
  });

  it("merges applicable plans across every retailer", async () => {
    installFetch({
      catalogue: [
        { retailer: RETAILER_A, plans: [plan("a1"), plan("a2", { customerType: "BUSINESS" })] },
        { retailer: RETAILER_B, plans: [plan("b1"), plan("b2")] },
      ],
    });

    const result = await fetchPlans({ ...household, retailers: [RETAILER_A, RETAILER_B] });

    expect(ids(result)).toEqual(["a1", "b1", "b2"]);
  });

  it("builds retailer URLs without a doubled slash when baseUri ends in one", async () => {
    const calls = installFetch({ catalogue: [{ retailer: RETAILER_B, plans: [plan("b1")] }] });

    const result = await fetchPlans({ ...household, retailers: [RETAILER_B] });

    expect(ids(result)).toEqual(["b1"]);
    expect(calls.every((c) => !c.url.includes("//cds-au"))).toBe(true);
  });

  it("follows meta.totalPages until every page has been listed", async () => {
    const plans = ["p1", "p2", "p3", "p4", "p5"].map((id) => plan(id));
    const calls = installFetch({ catalogue: [{ retailer: RETAILER_A, plans }], pageSize: 2 });

    const result = await fetchPlans({ ...household, retailers: [RETAILER_A] });

    expect(ids(result)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(calls.filter(isListCall)).toHaveLength(3); // ceil(5 / 2)
  });

  it("requests a plan's detail only once when pages repeat an id", async () => {
    const calls = installFetch({
      catalogue: [{ retailer: RETAILER_A, plans: [plan("p1"), plan("p2")], listedIds: ["p1", "p2", "p1"] }],
      pageSize: 2,
    });

    const result = await fetchPlans({ ...household, retailers: [RETAILER_A] });

    expect(ids(result)).toEqual(["p1", "p2"]);
    expect(calls.filter(isDetailCall)).toHaveLength(2);
  });

  it("sends x-v: 1 to the list endpoint and x-v: 3 to the detail endpoint", async () => {
    const calls = installFetch({ catalogue: [{ retailer: RETAILER_A, plans: [plan("p1")] }] });

    await fetchPlans({ ...household, retailers: [RETAILER_A] });

    expect(calls.filter(isListCall).map((c) => c.version)).toEqual(["1"]);
    expect(calls.filter(isDetailCall).map((c) => c.version)).toEqual(["3"]);
  });

  it("percent-encodes plan ids in the detail URL", async () => {
    const awkward = plan("nsw/res b&w");
    const calls = installFetch({ catalogue: [{ retailer: RETAILER_A, plans: [awkward] }] });

    const result = await fetchPlans({ ...household, retailers: [RETAILER_A] });

    expect(ids(result)).toEqual(["nsw/res b&w"]);
    expect(calls.filter(isDetailCall)[0]!.url).toContain("nsw%2Fres%20b%26w");
  });

  it("skips a plan whose detail request fails and keeps the rest", async () => {
    installFetch({
      catalogue: [{ retailer: RETAILER_A, plans: [plan("p1"), plan("p2"), plan("p3")] }],
      detailFails: ["p2"],
    });

    const result = await fetchPlans({ ...household, retailers: [RETAILER_A] });

    expect(ids(result)).toEqual(["p1", "p3"]);
  });

  it("skips a plan whose detail response carries no data", async () => {
    installFetch({
      catalogue: [{ retailer: RETAILER_A, plans: [plan("p1"), plan("p2")] }],
      detailEmpty: ["p2"],
    });

    const result = await fetchPlans({ ...household, retailers: [RETAILER_A] });

    expect(ids(result)).toEqual(["p1"]);
  });

  it("keeps the other retailers' plans when one retailer's list endpoint fails", async () => {
    installFetch({
      catalogue: [
        { retailer: RETAILER_A, plans: [plan("a1")] },
        { retailer: RETAILER_B, plans: [plan("b1")] },
      ],
      listFails: ["Retailer A"],
    });

    const result = await fetchPlans({ ...household, retailers: [RETAILER_A, RETAILER_B] });

    expect(ids(result)).toEqual(["b1"]);
  });

  it("returns an empty array when nothing applies, without throwing", async () => {
    installFetch({
      catalogue: [{ retailer: RETAILER_A, plans: [plan("zone", { geography: { distributors: ["POWERCOR"] } })] }],
    });

    await expect(fetchPlans({ ...household, retailers: [RETAILER_A] })).resolves.toEqual([]);
  });

  it("makes no requests when given no retailers", async () => {
    const calls = installFetch({ catalogue: [] });

    await expect(fetchPlans({ ...household, retailers: [] })).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
