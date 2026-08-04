/** @format */

// My own tests for the costing engine, covering what the supplied contract test does not reach.
//
// The contract test in estimatePlanCosts.test.ts pins single rate, midnight-wrapping TOU and the GST /
// solar-credit rules. Its five fixture plans are all flat or simple TOU, so nothing there exercises
// controlled load, weekday-vs-weekend windows, annualisation from a partial year, tiered blocks or
// demand charges. This file covers those.
//
// Expected figures are hand-computed from DATA_DICTIONARY.md, not read back off the implementation:
//   - unitPrice and dailySupplyCharge are GST-EXCLUSIVE; ×1.1 applies to usage + supply
//   - solar feed-in credit is NOT GST-bearing and is subtracted after
//   - controlled load is a SEPARATELY metered register with its own rate and its own supply charge
// Where a day count other than 365 is used, the annual figure is the observed cost scaled by 365/days.

import { describe, expect, it } from "vitest";
import { estimatePlanCosts } from "./estimatePlanCosts.js";
import { priceTieredUsage } from "./utils/helpers.js";
import type { EnergyPlanDetail, RawConsumption, RawServicePoints } from "./types.js";

// ───────────────────────── household + usage builders ─────────────────────────

const CITIPOWER_SP: RawServicePoints = {
  service_points: [
    {
      service_point_id: "SP1",
      jurisdiction_code: "VIC",
      related_participants: [{ party: "CitiPower Pty", role: "LNSP" }],
    },
  ],
};

const HALF_HOURS = 48;
const ALL_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** The same kWh value in every half-hour interval of a day. */
function flat(value: number): number[] {
  return Array.from({ length: HALF_HOURS }, () => value);
}

/** `value` in the listed interval indices, zero everywhere else. */
function only(indices: number[], value: number): number[] {
  const reads = Array.from({ length: HALF_HOURS }, () => 0);
  for (const index of indices) reads[index] = value;
  return reads;
}

const range = (from: number, toExclusive: number) =>
  Array.from({ length: toExclusive - from }, (_, i) => from + i);

interface DaySpec {
  date: string;
  /** kWh per interval on the main import register (E1). */
  import?: number | number[];
  /** kWh per interval EXPORTED — pass positive; stored negative, as the real B1 feed does. */
  export?: number | number[];
  /** kWh per interval on the separately-metered controlled-load register. */
  controlledLoad?: number | number[];
}

function usageFrom(days: DaySpec[]): RawConsumption {
  const usage: RawConsumption["usage"] = [];

  const push = (
    date: string,
    suffix: string,
    reads: number[],
    controlled_load?: boolean,
  ) => {
    usage.push({
      service_point_id: "SP1",
      register_suffix: suffix,
      read_start_date: date,
      ...(controlled_load ? { controlled_load } : {}),
      interval_read: {
        read_interval_length: 30,
        interval_reads: reads,
        aggregate_value: reads.reduce((a, b) => a + b, 0),
      },
    });
  };

  const asReads = (v: number | number[]) => (Array.isArray(v) ? v : flat(v));

  for (const day of days) {
    if (day.import !== undefined) push(day.date, "E1", asReads(day.import));
    if (day.export !== undefined) push(day.date, "B1", asReads(day.export).map((v) => -v));
    if (day.controlledLoad !== undefined) push(day.date, "E2", asReads(day.controlledLoad), true);
  }

  return { usage };
}

/** `count` consecutive dates from 2025-01-01. 365 of them makes annual cost exactly 365 × per-day. */
function dates(count: number, startDay = 1): string[] {
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(2025, 0, startDay + i)).toISOString().slice(0, 10),
  );
}

const YEAR = dates(365);
/** 2025-01-06 is a Monday, so this is exactly one MON→SUN week. */
const ONE_WEEK = dates(7, 6);

// ───────────────────────── plan builders ─────────────────────────

function planOf(
  planId: string,
  contract: EnergyPlanDetail["electricityContract"],
): EnergyPlanDetail {
  return {
    planId,
    displayName: `Plan ${planId}`,
    fuelType: "ELECTRICITY",
    customerType: "RESIDENTIAL",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    geography: { distributors: ["CITIPOWER"] },
    electricityContract: contract,
  };
}

/** Flat 30c/kWh, $1.00/day supply — the baseline every controlled-load case builds on. */
const MAIN_SINGLE_RATE = {
  rateBlockUType: "singleRate" as const,
  dailySupplyCharge: "1.00",
  singleRate: { rates: [{ unitPrice: "0.30" }] },
};

/** Costs one plan against one usage profile, asserting the fixture is actually applicable. */
function resultOf(plan: EnergyPlanDetail, usage: RawConsumption) {
  const [result] = estimatePlanCosts({ usage, servicePoints: CITIPOWER_SP, plans: [plan] });
  // Guard: a fixture that quietly fails eligibility would return null and pass a naive assertion.
  expect(result!.applicable).toBe(true);
  return result!;
}

function costOf(plan: EnergyPlanDetail, usage: RawConsumption): number | null {
  return resultOf(plan, usage).annualCostAud;
}

// ───────────────────────── controlled load ─────────────────────────

describe("controlled load", () => {
  // 24 kWh/day on the main register, 12 kWh/day on the controlled-load register.
  const usage = usageFrom(YEAR.map((date) => ({ date, import: 0.5, controlledLoad: 0.25 })));

  it("charges controlled-load kWh at the controlled-load rate, plus its own supply charge", () => {
    const plan = planOf("cl-single", {
      tariffPeriod: [MAIN_SINGLE_RATE],
      controlledLoad: [
        {
          rateBlockUType: "singleRate",
          dailySupplyCharge: "0.20",
          singleRate: { rates: [{ unitPrice: "0.10" }] },
        },
      ],
    });

    // Per day: main 24×0.30 = 7.20 ; CL 12×0.10 = 1.20 ; supply 1.00 ; CL supply 0.20
    //          → 9.60 ×1.1 = 10.56 → ×365 = 3854.40
    const expected = +(365 * (24 * 0.3 + 12 * 0.1 + 1.0 + 0.2) * 1.1).toFixed(2);

    expect(costOf(plan, usage)).toBeCloseTo(expected, 2);
  });

  it("does not also bill controlled-load kWh at the main usage rate", () => {
    const plan = planOf("cl-nodouble", {
      tariffPeriod: [MAIN_SINGLE_RATE],
      controlledLoad: [
        { rateBlockUType: "singleRate", dailySupplyCharge: "0.00", singleRate: { rates: [{ unitPrice: "0.10" }] } },
      ],
    });

    // Correct: 365 × (7.20 + 1.20 + 1.00) × 1.1 = 3775.10
    // Double-counted, the 12 kWh would also attract the 30c main rate: +365 × 12 × 0.30 × 1.1 = +1445.40
    const expected = +(365 * (24 * 0.3 + 12 * 0.1 + 1.0) * 1.1).toFixed(2);
    const doubleCounted = +(365 * (24 * 0.3 + 12 * 0.3 + 12 * 0.1 + 1.0) * 1.1).toFixed(2);

    const cost = costOf(plan, usage);
    expect(cost).toBeCloseTo(expected, 2);
    expect(cost).not.toBeCloseTo(doubleCounted, 2);
  });

  it("prices a time-of-use controlled load per interval", () => {
    // Hot water runs 22:00–07:00 only: intervals [44..47] (2h) + [0..13] (7h) = 18 × 0.5 = 9 kWh/day.
    const overnight = [...range(44, 48), ...range(0, 14)];
    const clUsage = usageFrom(
      YEAR.map((date) => ({ date, import: 0.5, controlledLoad: only(overnight, 0.5) })),
    );

    const plan = planOf("cl-tou", {
      tariffPeriod: [MAIN_SINGLE_RATE],
      controlledLoad: [
        {
          rateBlockUType: "timeOfUseRates",
          dailySupplyCharge: "0.20",
          timeOfUseRates: [
            {
              type: "OFF_PEAK",
              rates: [{ unitPrice: "0.08" }],
              timeOfUse: [{ days: ALL_DAYS, startTime: "22:00", endTime: "07:00" }],
            },
          ],
        },
      ],
    });

    // Per day: main 7.20 ; CL 9×0.08 = 0.72 ; supply 1.00 ; CL supply 0.20 → 9.12 ×1.1 = 10.032
    const expected = +(365 * (24 * 0.3 + 9 * 0.08 + 1.0 + 0.2) * 1.1).toFixed(2);

    expect(costOf(plan, clUsage)).toBeCloseTo(expected, 2);
  });

  it("returns null when the household has controlled load but the plan does not price it", () => {
    const plan = planOf("cl-missing", { tariffPeriod: [MAIN_SINGLE_RATE] });

    // Costing this at the main rate would understate a bill the household would actually receive,
    // so refusing to cost it is the safe answer.
    expect(costOf(plan, usage)).toBeNull();
  });

  it("charges no controlled-load supply charge when the household has no controlled load", () => {
    const noControlledLoad = usageFrom(YEAR.map((date) => ({ date, import: 0.5 })));

    const plan = planOf("cl-unused", {
      tariffPeriod: [MAIN_SINGLE_RATE],
      controlledLoad: [
        { rateBlockUType: "singleRate", dailySupplyCharge: "0.20", singleRate: { rates: [{ unitPrice: "0.10" }] } },
      ],
    });

    // The 20c/day CL supply charge must NOT apply: 365 × (7.20 + 1.00) × 1.1 = 3292.30
    const expected = +(365 * (24 * 0.3 + 1.0) * 1.1).toFixed(2);

    expect(costOf(plan, noControlledLoad)).toBeCloseTo(expected, 2);
  });
});

// ───────────────────────── time-of-use day handling ─────────────────────────

describe("time-of-use windows", () => {
  it("applies different weekday and weekend rates to the right days", () => {
    const usage = usageFrom(ONE_WEEK.map((date) => ({ date, import: 0.5 })));

    const plan = planOf("tou-weekend", {
      tariffPeriod: [
        {
          rateBlockUType: "timeOfUseRates",
          dailySupplyCharge: "1.00",
          timeOfUseRates: [
            {
              type: "PEAK",
              rates: [{ unitPrice: "0.40" }],
              // "00:00"–"00:00" is the CDR way of writing an all-day window.
              timeOfUse: [{ days: ["MON", "TUE", "WED", "THU", "FRI"], startTime: "00:00", endTime: "00:00" }],
            },
            {
              type: "OFF_PEAK",
              rates: [{ unitPrice: "0.20" }],
              timeOfUse: [{ days: ["SAT", "SUN"], startTime: "00:00", endTime: "00:00" }],
            },
          ],
        },
      ],
    });

    // 5 weekdays × 24 × 0.40 = 48.00 ; 2 weekend days × 24 × 0.20 = 9.60 ; supply 7 × 1.00
    // → 64.60 ×1.1 = 71.06 over 7 observed days → ×365/7 annualised
    const expected = +((5 * 24 * 0.4 + 2 * 24 * 0.2 + 7 * 1.0) * 1.1 * (365 / 7)).toFixed(2);

    expect(costOf(plan, usage)).toBeCloseTo(expected, 1);
  });

  it("returns null when an imported interval falls outside every published window", () => {
    const usage = usageFrom(YEAR.map((date) => ({ date, import: 0.5 })));

    const plan = planOf("tou-gap", {
      tariffPeriod: [
        {
          rateBlockUType: "timeOfUseRates",
          dailySupplyCharge: "1.00",
          timeOfUseRates: [
            {
              type: "PEAK",
              rates: [{ unitPrice: "0.40" }],
              // Covers 07:00–21:00 only; overnight import has no published price.
              timeOfUse: [{ days: ALL_DAYS, startTime: "07:00", endTime: "21:00" }],
            },
          ],
        },
      ],
    });

    // Treating the uncovered intervals as free would make this plan look artificially cheap.
    expect(costOf(plan, usage)).toBeNull();
  });
});

// ───────────────────────── annualisation ─────────────────────────

describe("annualisation", () => {
  const plan = planOf("annualise", {
    tariffPeriod: [MAIN_SINGLE_RATE],
    solarFeedInTariff: [{ singleTariff: { rates: [{ unitPrice: "0.10" }] } }],
  });

  const profile = (dayList: string[]) =>
    usageFrom(dayList.map((date) => ({ date, import: 0.5, export: 0.25 })));

  it("scales a 30-day sample to the same annual figure as a full identical year", () => {
    expect(costOf(plan, profile(dates(30)))).toBeCloseTo(costOf(plan, profile(YEAR))!, 1);
  });

  it("scales a single observed day to 365 days", () => {
    // Day: usage 7.20 + supply 1.00 = 8.20 ×1.1 = 9.02, less 12×0.10 solar = 7.82 → ×365 = 2854.30
    const expected = +(365 * ((24 * 0.3 + 1.0) * 1.1 - 12 * 0.1)).toFixed(2);

    expect(costOf(plan, profile(dates(1)))).toBeCloseTo(expected, 1);
  });
});

// ───────────────────────── robustness ─────────────────────────

describe("robustness", () => {
  const usage = usageFrom(YEAR.map((date) => ({ date, import: 0.5 })));

  it("returns null for a plan with no daily supply charge published", () => {
    const plan = planOf("no-supply", {
      tariffPeriod: [{ rateBlockUType: "singleRate", singleRate: { rates: [{ unitPrice: "0.30" }] } }],
    });

    expect(costOf(plan, usage)).toBeNull();
  });

  it("returns null for an unrecognised rateBlockUType rather than costing it as zero", () => {
    const plan = planOf("unknown-block", {
      tariffPeriod: [{ rateBlockUType: "quarterlyRate", dailySupplyCharge: "1.00" }],
    });

    expect(costOf(plan, usage)).toBeNull();
  });

  it("returns null when there is no usage at all", () => {
    const plan = planOf("no-usage", { tariffPeriod: [MAIN_SINGLE_RATE] });

    expect(costOf(plan, { usage: [] })).toBeNull();
  });

  it("ignores a negative reading on the import register instead of crediting it", () => {
    const plan = planOf("negative-import", { tariffPeriod: [MAIN_SINGLE_RATE] });

    const clean = usageFrom(YEAR.map((date) => ({ date, import: only(range(0, 24), 0.5) })));
    const withNegative = usageFrom(
      YEAR.map((date) => ({ date, import: only(range(0, 24), 0.5).map((v, i) => (i === 30 ? -5 : v)) })),
    );

    expect(costOf(plan, withNegative)).toBeCloseTo(costOf(plan, clean)!, 2);
  });

  it("gives no solar credit when the plan publishes no feed-in tariff", () => {
    const plan = planOf("no-fit", { tariffPeriod: [MAIN_SINGLE_RATE] });

    const exporting = usageFrom(YEAR.map((date) => ({ date, import: 0.5, export: 0.25 })));
    const expected = +(365 * (24 * 0.3 + 1.0) * 1.1).toFixed(2);

    expect(costOf(plan, exporting)).toBeCloseTo(expected, 2);
  });
});

// ───────────────────────── ranking, tiered blocks, demand charges ─────────────────────────

describe("ranking and unusual rate structures", () => {
  const usage = usageFrom(YEAR.map((date) => ({ date, import: 0.5 })));

  const cheap = planOf("cheap", {
    tariffPeriod: [{ ...MAIN_SINGLE_RATE, singleRate: { rates: [{ unitPrice: "0.20" }] } }],
  });
  const pricey = planOf("pricey", {
    tariffPeriod: [{ ...MAIN_SINGLE_RATE, singleRate: { rates: [{ unitPrice: "0.50" }] } }],
  });

  it("ranks costable plans cheapest-first regardless of input order", () => {
    // GOAL_GUIDE.md: "cost every applicable fetched plan ... rank cheapest-first".
    // The supplied contract test only passes because its fixtures happen to be listed cheapest-first.
    const result = estimatePlanCosts({ usage, servicePoints: CITIPOWER_SP, plans: [pricey, cheap] });

    expect(result.map((r) => r.planId)).toEqual(["cheap", "pricey"]);
  });

  it("keeps inapplicable plans out of the ranked positions but still reports them", () => {
    const business = { ...cheap, planId: "business", customerType: "BUSINESS" };
    const result = estimatePlanCosts({ usage, servicePoints: CITIPOWER_SP, plans: [business, pricey, cheap] });

    expect(result).toHaveLength(3);
    const costable = result.filter((r) => typeof r.annualCostAud === "number").map((r) => r.annualCostAud as number);
    expect(costable).toEqual([...costable].sort((a, b) => a - b));
  });

  it("prices a tiered block plan band by band, per day", () => {
    // DATA_DICTIONARY.md: multiple rates[] with a `volume` ceiling = a stepped price by consumption.
    const tiered = planOf("tiered", {
      tariffPeriod: [
        {
          rateBlockUType: "singleRate",
          dailySupplyCharge: "1.00",
          singleRate: { rates: [{ unitPrice: "0.20", volume: 10 }, { unitPrice: "0.40" }] },
        },
      ],
    });

    // Per day: first 10 kWh @20c = 2.00 ; remaining 14 kWh @40c = 5.60 ; supply 1.00
    //          → 8.60 ×1.1 = 9.46 → ×365 = 3452.90
    const expected = +(365 * (10 * 0.2 + 14 * 0.4 + 1.0) * 1.1).toFixed(2);
    // Billing all 24 kWh at the cheapest band would give 2328.70 — a 32% understatement.
    const allAtFirstTier = +(365 * (24 * 0.2 + 1.0) * 1.1).toFixed(2);

    expect(costOf(tiered, usage)).toBeCloseTo(expected, 2);
    expect(costOf(tiered, usage)).not.toBeCloseTo(allAtFirstTier, 2);
  });

  it("prices a tiered time-of-use band on the day's total in that band", () => {
    // Modelled on GloBird ZEROHERO in the recorded snapshot: a SHOULDER window whose first
    // 5 kWh/day are nearly free, then 23c. Pricing each half-hour separately would never
    // leave the first tier, making the plan look almost free inside the window.
    const shoulder = range(24, 30); // 12:00–15:00, 6 intervals
    const touUsage = usageFrom(YEAR.map((date) => ({ date, import: only(shoulder, 1.5) })));

    const plan = planOf("tou-tiered", {
      tariffPeriod: [
        {
          rateBlockUType: "timeOfUseRates",
          dailySupplyCharge: "1.00",
          timeOfUseRates: [
            {
              type: "SHOULDER",
              rates: [{ unitPrice: "0.01", volume: 5 }, { unitPrice: "0.23" }],
              timeOfUse: [{ days: ALL_DAYS, startTime: "12:00", endTime: "15:00" }],
            },
          ],
        },
      ],
    });

    // 9 kWh/day in the window: 5 @1c = 0.05 ; 4 @23c = 0.92 ; supply 1.00 → 1.97 ×1.1
    const expected = +(365 * (5 * 0.01 + 4 * 0.23 + 1.0) * 1.1).toFixed(2);

    expect(costOf(plan, touUsage)).toBeCloseTo(expected, 2);
  });

  it("reports a demand-charge plan as uncostable with a reason, not as cheaper", () => {
    // types.ts: "a costing engine that treats this as ordinary usage makes the plan look falsely
    // cheap". Silently ignoring the charge has the same effect, so the plan is refused instead.
    const withDemand = planOf("with-demand", {
      tariffPeriod: [MAIN_SINGLE_RATE],
      demandCharges: [
        { amount: "12.00", measureUnit: "KW", chargePeriod: "MONTH", days: ALL_DAYS, startTime: "16:00", endTime: "21:00" },
      ],
    });

    const result = resultOf(withDemand, usage);

    expect(result.annualCostAud).toBeNull();
    expect((result.notes ?? []).join(" ")).toMatch(/demand/i);
  });

  it("explains every null cost, so an uncostable plan is never silently blank", () => {
    const inapplicable = { ...cheap, planId: "wrong-network", geography: { distributors: ["POWERCOR"] } };
    const noPricing = planOf("no-pricing", {
      tariffPeriod: [{ rateBlockUType: "singleRate", dailySupplyCharge: "1.00", singleRate: { rates: [] } }],
    });

    const results = estimatePlanCosts({
      usage,
      servicePoints: CITIPOWER_SP,
      plans: [cheap, inapplicable, noPricing],
    });

    for (const result of results) {
      if (result.annualCostAud === null) {
        expect(result.notes?.length ?? 0).toBeGreaterThan(0);
      } else {
        expect(result.notes ?? []).toHaveLength(0);
      }
    }
  });
});

// ───────────────────────── tier pricing in isolation ─────────────────────────

describe("priceTieredUsage", () => {
  const TIERED = [{ unitPrice: "0.20", volume: 10 }, { unitPrice: "0.40" }];

  it("treats a single unbounded rate as a flat price", () => {
    expect(priceTieredUsage([{ unitPrice: "0.30" }], 24)).toBeCloseTo(7.2, 9);
  });

  it("splits usage across bands at the cumulative ceiling", () => {
    expect(priceTieredUsage(TIERED, 24)).toBeCloseTo(10 * 0.2 + 14 * 0.4, 9);
  });

  it("keeps usage inside the first band when it stays below the ceiling", () => {
    expect(priceTieredUsage(TIERED, 5)).toBeCloseTo(1, 9);
    expect(priceTieredUsage(TIERED, 10)).toBeCloseTo(2, 9);
    expect(priceTieredUsage(TIERED, 10.5)).toBeCloseTo(2.2, 9);
  });

  it("walks three bands in order", () => {
    const rates = [{ unitPrice: "0.10", volume: 10 }, { unitPrice: "0.20", volume: 20 }, { unitPrice: "0.30" }];
    expect(priceTieredUsage(rates, 24)).toBeCloseTo(1 + 2 + 1.2, 9);
  });

  it("sorts bands that are published out of ascending order", () => {
    const reversed = [{ unitPrice: "0.40" }, { unitPrice: "0.20", volume: 10 }];
    expect(priceTieredUsage(reversed, 24)).toBeCloseTo(10 * 0.2 + 14 * 0.4, 9);
  });

  it("returns zero for no usage", () => {
    expect(priceTieredUsage(TIERED, 0)).toBe(0);
    expect(priceTieredUsage(TIERED, -3)).toBe(0);
  });

  it("returns null when usage runs past the highest published ceiling", () => {
    const capped = [{ unitPrice: "0.20", volume: 10 }];
    expect(priceTieredUsage(capped, 24)).toBeNull();
    expect(priceTieredUsage(capped, 8)).toBeCloseTo(1.6, 9);
  });

  it("returns null for unusable rate blocks", () => {
    expect(priceTieredUsage([{ unitPrice: "abc" }], 24)).toBeNull();
    expect(priceTieredUsage([], 24)).toBeNull();
    expect(priceTieredUsage(undefined, 24)).toBeNull();
    expect(priceTieredUsage([{ unitPrice: "0.2", volume: 0 }, { unitPrice: "0.4" }], 24)).toBeNull();
  });

  it("prices the real tiered blocks found in the recorded snapshot", () => {
    // GloBird GLOSAVE: first 15 kWh at 25.8c, then 27.9c.
    expect(priceTieredUsage([{ unitPrice: "0.258", volume: 15 }, { unitPrice: "0.279" }], 24))
      .toBeCloseTo(15 * 0.258 + 9 * 0.279, 9);

    // GloBird ZEROHERO: first 50 kWh effectively free, then 23c.
    const zeroHero = [{ unitPrice: "0.000001", volume: 50 }, { unitPrice: "0.23" }];
    expect(priceTieredUsage(zeroHero, 6)).toBeCloseTo(6 * 0.000001, 9);
    expect(priceTieredUsage(zeroHero, 60)).toBeCloseTo(50 * 0.000001 + 10 * 0.23, 9);
  });
});
