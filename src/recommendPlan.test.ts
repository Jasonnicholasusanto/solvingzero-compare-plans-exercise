/** @format */

// Tests for joining "what they pay today" to "what is cheapest available".

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recommendPlan } from "./recommendPlan.js";
import { loadAccounts, loadBills, loadServicePoints, loadUsage } from "./loadData.js";
import type { EnergyPlanDetail, RawAccounts, RawConsumption, RawServicePoints } from "./types.js";

const SP = "sp-1";

const SERVICE_POINTS: RawServicePoints = {
  service_points: [
    { service_point_id: SP, related_participants: [{ party: "CitiPower Pty", role: "LNSP" }] },
  ],
};

/** 100 days at 24 kWh/day imported, no solar. */
function usage(): RawConsumption {
  return {
    usage: Array.from({ length: 100 }, (_, d) => ({
      service_point_id: SP,
      register_suffix: "E1",
      read_start_date: new Date(Date.UTC(2025, 0, 1 + d)).toISOString().slice(0, 10),
      interval_read: {
        read_interval_length: 30,
        interval_reads: Array.from({ length: 48 }, () => 0.5),
        aggregate_value: 24,
      },
    })),
  };
}

/** Current plan: flat 30c + $1.00/day → (24×0.30 + 1.00) × 1.1 × 365 = $3,292.30/yr. */
const ACCOUNTS: RawAccounts = {
  accounts: [
    {
      account_id: "acct-1",
      plans: [
        {
          plan_overview: { display_name: "Current Plan", start_date: "2024-01-01" },
          plan_detail: {
            fuel_type: "ELECTRICITY",
            electricity_contract: {
              tariff_period: [
                {
                  rate_block_u_type: "singleRate",
                  daily_supply_charge: "1.00",
                  single_rate: { rates: [{ unit_price: "0.30" }] },
                },
              ],
            },
          },
          service_point_ids: [SP],
        },
      ],
    },
  ],
};

const CURRENT_ANNUAL = +(365 * (24 * 0.3 + 1.0) * 1.1).toFixed(2); // 3292.30

function plan(planId: string, unitPrice: string, extra: Partial<EnergyPlanDetail> = {}): EnergyPlanDetail {
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
        { rateBlockUType: "singleRate", dailySupplyCharge: "1.00", singleRate: { rates: [{ unitPrice }] } },
      ],
    },
    ...extra,
  };
}

const run = (plans: EnergyPlanDetail[], overrides = {}) =>
  recommendPlan({ accounts: ACCOUNTS, usage: usage(), servicePoints: SERVICE_POINTS, plans, ...overrides })!;

describe("recommendPlan", () => {
  it("recommends the cheapest plan and states the saving against today", () => {
    const result = run([plan("dear", "0.40"), plan("cheap", "0.20"), plan("middle", "0.25")]);

    expect(result.recommended?.planId).toBe("cheap");
    // Cheapest: (24×0.20 + 1.00) × 1.1 × 365 = 2328.70 → saves 963.60
    expect(result.annualSavingAud).toBeCloseTo(CURRENT_ANNUAL - 2328.7, 1);
    expect(result.savingPercent).toBeCloseTo((963.6 / CURRENT_ANNUAL) * 100, 0);
  });

  it("compares annual against annual, not annual against spend-so-far", () => {
    // The usage window is 100 days, so "spent so far" is far below the annual figure.
    const result = run([plan("cheap", "0.20")]);

    expect(result.current.fromUsage.observedDays).toBe(100);
    expect(result.current.fromUsage.totalSpentToDate).toBeLessThan(result.current.fromUsage.estimatedAnnualCost);
    expect(result.annualSavingAud).toBeCloseTo(
      result.current.fromUsage.estimatedAnnualCost - result.recommended!.annualCostAud!,
      2,
    );
  });

  it("recommends nothing when no plan beats the current one", () => {
    const result = run([plan("dear", "0.40"), plan("dearer", "0.50")]);

    expect(result.recommended).toBeNull();
    expect(result.annualSavingAud).toBeNull();
    expect(result.currentPlanRank).toBe(1);
    expect(result.notes.join(" ")).toMatch(/no available plan is cheaper/i);
  });

  it("ranks the current plan among the alternatives", () => {
    const result = run([plan("a", "0.20"), plan("b", "0.25"), plan("c", "0.40")]);

    // Two plans beat 30c, so the current plan is third.
    expect(result.currentPlanRank).toBe(3);
  });

  it("flags a saving too small to act on", () => {
    // 29.9c vs 30c ≈ $9.6/yr, below the $30 materiality floor.
    const result = run([plan("marginal", "0.299")]);

    expect(result.recommended?.planId).toBe("marginal");
    expect(result.annualSavingAud).toBeLessThan(30);
    expect(result.notes.join(" ")).toMatch(/closer to break-even/i);
  });

  it("respects a caller-supplied materiality threshold", () => {
    const result = run([plan("marginal", "0.299")], { materialSavingAud: 1 });

    expect(result.notes.join(" ")).not.toMatch(/closer to break-even/i);
  });

  it("counts and explains plans it could not cost", () => {
    const withDemand = plan("demand", "0.10", {
      electricityContract: {
        tariffPeriod: [
          { rateBlockUType: "singleRate", dailySupplyCharge: "1.00", singleRate: { rates: [{ unitPrice: "0.10" }] } },
          { rateBlockUType: "demandCharges" } as never,
        ],
      },
    });

    const result = run([plan("cheap", "0.20"), withDemand]);

    // The demand plan is nominally cheapest but cannot be costed, so it must not win.
    expect(result.recommended?.planId).toBe("cheap");
    expect(result.comparedPlans).toBe(1);
    expect(result.excludedPlans).toBe(1);
    expect(result.notes.join(" ")).toMatch(/could not be costed/i);
    expect(result.notes.join(" ")).toMatch(/demand/i);
  });

  it("ignores plans the household is not eligible for", () => {
    const result = run([
      plan("cheap-but-business", "0.05", { customerType: "BUSINESS" }),
      plan("cheap-but-elsewhere", "0.05", { geography: { distributors: ["POWERCOR"] } }),
      plan("eligible", "0.20"),
    ]);

    expect(result.recommended?.planId).toBe("eligible");
    expect(result.comparedPlans).toBe(1);
  });

  it("limits the alternatives returned", () => {
    const plans = ["0.10", "0.12", "0.14", "0.16", "0.18", "0.20"].map((p, i) => plan(`p${i}`, p));

    expect(run(plans).alternatives).toHaveLength(5);
    expect(run(plans, { alternatives: 2 }).alternatives).toHaveLength(2);
  });

  it("returns null when the household has no costable current plan", () => {
    const result = recommendPlan({
      accounts: { accounts: [] },
      usage: usage(),
      servicePoints: SERVICE_POINTS,
      plans: [plan("cheap", "0.20")],
    });

    expect(result).toBeNull();
  });
});

// ───────────────────────── the real household, real plans ─────────────────────────

describe("the real household against the recorded snapshot", () => {
  const snapshot = JSON.parse(
    readFileSync(new URL("../fixtures/sample-plans.json", import.meta.url), "utf8"),
  );
  const plans: EnergyPlanDetail[] = Array.isArray(snapshot)
    ? snapshot
    : (snapshot.plans ?? snapshot.data?.plans ?? []);

  const result = recommendPlan({
    accounts: loadAccounts(),
    usage: loadUsage(),
    servicePoints: loadServicePoints(),
    bills: loadBills(),
    plans,
  })!;

  it("finds a cheaper plan than Origin Go Variable", () => {
    expect(result.current.planName).toBe("Origin Go Variable");
    expect(result.recommended).not.toBeNull();
    expect(result.annualSavingAud).toBeGreaterThan(0);
  });

  it("does not recommend a plan it could not fully cost", () => {
    expect(result.recommended!.annualCostAud).toEqual(expect.any(Number));
    expect(result.recommended!.notes ?? []).toHaveLength(0);
  });

  it("reports the saving as the difference between two annual figures", () => {
    expect(result.annualSavingAud).toBeCloseTo(
      result.current.fromUsage.estimatedAnnualCost - result.recommended!.annualCostAud!,
      2,
    );
  });

  it("tells the user how much of the market it could not compare", () => {
    expect(result.comparedPlans).toBeGreaterThan(100);
    expect(result.excludedPlans).toBeGreaterThan(0);
    expect(result.notes.join(" ")).toMatch(/could not be costed/i);
  });

  it("carries the bill reconciliation into the recommendation", () => {
    expect(result.notes.join(" ")).toMatch(/reconciles to/i);
    expect(Math.abs(result.current.reconciliation!.differencePercent)).toBeLessThan(2);
  });
});
