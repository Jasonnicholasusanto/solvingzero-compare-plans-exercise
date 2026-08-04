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
function costOf(plan: EnergyPlanDetail, usage: RawConsumption): number | null {
  const [result] = estimatePlanCosts({ usage, servicePoints: CITIPOWER_SP, plans: [plan] });
  // Guard: a fixture that quietly fails eligibility would return null and pass a naive assertion.
  expect(result!.applicable).toBe(true);
  return result!.annualCostAud;
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

// ───────────────────────── ranking + unpriced structures ─────────────────────────
//
// These four assert behaviour the brief requires but the engine does not implement yet. They are
// expected to FAIL until it does — see the notes in DECISIONS.md. Keeping them red is deliberate:
// deleting them would hide the gap rather than close it.

describe("known gaps", () => {
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

  it("does not price a tiered block plan as if every kWh were at the first tier", () => {
    // DATA_DICTIONARY.md: multiple rates[] with a `volume` ceiling = a stepped price by consumption.
    // Whatever the reset window, 24 kWh/day cannot all be billed at the 10 kWh tier's 20c rate.
    const tiered = planOf("tiered", {
      tariffPeriod: [
        {
          rateBlockUType: "singleRate",
          dailySupplyCharge: "1.00",
          singleRate: { rates: [{ unitPrice: "0.20", volume: 10, period: "P1D" }, { unitPrice: "0.40" }] },
        },
      ],
    });

    const allAtFirstTier = +(365 * (24 * 0.2 + 1.0) * 1.1).toFixed(2);
    const cost = costOf(tiered, usage);

    expect(cost === null || cost > allAtFirstTier).toBe(true);
  });

  it("does not make a plan with demand charges look cheaper than the same plan without them", () => {
    // types.ts: "a costing engine that treats this as ordinary usage makes the plan look falsely cheap".
    // Ignoring the charge entirely has the same effect.
    const withoutDemand = planOf("no-demand", { tariffPeriod: [MAIN_SINGLE_RATE] });
    const withDemand = planOf("with-demand", {
      tariffPeriod: [MAIN_SINGLE_RATE],
      demandCharges: [
        { amount: "12.00", measureUnit: "KW", chargePeriod: "MONTH", days: ALL_DAYS, startTime: "16:00", endTime: "21:00" },
      ],
    });

    const baseline = costOf(withoutDemand, usage)!;
    const cost = costOf(withDemand, usage);

    expect(cost === null || cost > baseline).toBe(true);
  });
});
