/** @format */

// Tests for selecting the household's current plan out of the raw accounts payload.

import { describe, expect, it } from "vitest";
import {
  calculateCurrentEnergyCosts,
  extractCurrentPlan,
  normaliseCurrentContract,
  toCdrTime,
} from "./calculateCurrentEnergyCosts.js";
import { loadAccounts, loadBills, loadUsage } from "./loadData.js";
import type { RawAccounts, RawConsumption, RawElectricityContract } from "./types.js";

const SP = "sp-household";

/** Usage on one service point across the given dates — only the fields selection reads. */
function usageOn(servicePointId: string, dates: string[]): RawConsumption {
  return {
    usage: dates.map((date) => ({
      service_point_id: servicePointId,
      register_suffix: "E1",
      read_start_date: date,
      interval_read: { read_interval_length: 30, interval_reads: [1], aggregate_value: 1 },
    })),
  };
}

const USAGE = usageOn(SP, ["2025-08-07", "2026-06-20"]);

const CONTRACT: RawElectricityContract = {
  tariff_period: [
    { rate_block_u_type: "singleRate", daily_supply_charge: "1.00", single_rate: { rates: [{ unit_price: "0.30" }] } },
  ],
};

interface PlanOverrides {
  name?: string;
  fuel?: string;
  contract?: RawElectricityContract | undefined;
  servicePointIds?: string[] | undefined;
  start?: string;
  end?: string;
}

function accountsWith(...plans: PlanOverrides[]): RawAccounts {
  return {
    accounts: [
      {
        account_id: "acct-1",
        plans: plans.map((p) => ({
          plan_overview: { display_name: p.name ?? "A plan", start_date: p.start, end_date: p.end },
          plan_detail: {
            fuel_type: p.fuel ?? "ELECTRICITY",
            electricity_contract: "contract" in p ? p.contract : CONTRACT,
          },
          ...("servicePointIds" in p ? { service_point_ids: p.servicePointIds } : { service_point_ids: [SP] }),
        })),
      },
    ],
  };
}

describe("extractCurrentPlan", () => {
  it("finds the electricity plan covering the household's service point", () => {
    const plan = extractCurrentPlan(
      accountsWith({ name: "Origin Go Variable", start: "2025-08-07", end: "2026-08-07" }),
      USAGE,
    );

    expect(plan?.planName).toBe("Origin Go Variable");
    expect(plan?.servicePointIds).toEqual([SP]);
    expect(plan?.startDate).toBe("2025-08-07");
    expect(plan?.endDate).toBe("2026-08-07");
  });

  it("keeps a plan whose end date has passed in real time but not within the usage window", () => {
    // The reference date is the last meter read (2026-06-20), not today — otherwise this
    // plan would drop out the moment the calendar passed its expiry.
    const plan = extractCurrentPlan(accountsWith({ start: "2025-08-07", end: "2026-06-25" }), USAGE);

    expect(plan).not.toBeNull();
  });

  it("skips non-electricity plans", () => {
    expect(extractCurrentPlan(accountsWith({ fuel: "GAS" }), USAGE)).toBeNull();
  });

  it("matches the fuel type case-insensitively", () => {
    expect(extractCurrentPlan(accountsWith({ fuel: "electricity" }), USAGE)).not.toBeNull();
  });

  it("skips a plan with no contract or no tariff period", () => {
    expect(extractCurrentPlan(accountsWith({ contract: undefined }), USAGE)).toBeNull();
    expect(extractCurrentPlan(accountsWith({ contract: { tariff_period: [] } }), USAGE)).toBeNull();
  });

  it("skips a plan serving only other service points", () => {
    expect(extractCurrentPlan(accountsWith({ servicePointIds: ["sp-somewhere-else"] }), USAGE)).toBeNull();
  });

  it("keeps a plan that names no service points at all", () => {
    // The account simply did not say; that is not evidence the plan is for someone else.
    expect(extractCurrentPlan(accountsWith({ servicePointIds: undefined }), USAGE)).not.toBeNull();
  });

  it("skips a plan that ended before the usage window", () => {
    expect(extractCurrentPlan(accountsWith({ start: "2024-01-01", end: "2025-01-01" }), USAGE)).toBeNull();
  });

  it("skips a plan that starts after the usage window", () => {
    expect(extractCurrentPlan(accountsWith({ start: "2027-01-01" }), USAGE)).toBeNull();
  });

  it("treats a missing end date as still running", () => {
    expect(extractCurrentPlan(accountsWith({ start: "2025-08-07" }), USAGE)).not.toBeNull();
  });

  it("prefers the most recently started plan when several overlap", () => {
    const plan = extractCurrentPlan(
      accountsWith(
        { name: "older", start: "2024-01-01" },
        { name: "newer", start: "2025-08-07" },
      ),
      USAGE,
    );

    expect(plan?.planName).toBe("newer");
  });

  it("returns null when the account has no plans", () => {
    expect(extractCurrentPlan({ accounts: [{ account_id: "acct-1" }] }, USAGE)).toBeNull();
    expect(extractCurrentPlan({ accounts: [] }, USAGE)).toBeNull();
  });

  it("finds the real household's plan in user_data", () => {
    // Guards the selection rules against the actual payload, not just synthetic shapes.
    const plan = extractCurrentPlan(loadAccounts(), loadUsage());

    expect(plan?.planName).toBe("Origin Go Variable");
    expect(plan?.contract.tariff_period?.[0]?.rate_block_u_type).toBe("timeOfUseRates");
    expect(plan?.contract.tariff_period?.[0]?.daily_supply_charge).toBe("1.0151");
  });
});

// ───────────────────────── adapting the snake_case contract ─────────────────────────

describe("toCdrTime", () => {
  it("drops the offset and seconds from a start time", () => {
    expect(toCdrTime("15:00:00+10:00", "start")).toBe("15:00");
    expect(toCdrTime("00:00:00+10:00", "start")).toBe("00:00");
  });

  it("rounds an inclusive end time up to CDR's exclusive end", () => {
    expect(toCdrTime("20:59:59.999999+10:00", "end")).toBe("21:00");
    expect(toCdrTime("14:59:59.999999+10:00", "end")).toBe("15:00");
  });

  it("wraps an end-of-day end time to midnight", () => {
    // The engine reads startTime > endTime as a window running through midnight.
    expect(toCdrTime("23:59:59.999999+10:00", "end")).toBe("00:00");
  });

  it("leaves a whole-minute end time alone", () => {
    expect(toCdrTime("21:00:00+10:00", "end")).toBe("21:00");
  });

  it("returns null for a time it cannot parse", () => {
    expect(toCdrTime("not-a-time", "start")).toBeNull();
    expect(toCdrTime("25:00:00+10:00", "start")).toBeNull();
  });
});

/** The household's real contract shape, in miniature. */
const TOU_CONTRACT: RawElectricityContract = {
  tariff_period: [
    {
      rate_block_u_type: "timeOfUseRates",
      daily_supply_charge: "1.00",
      time_of_use_rates: [
        {
          type: "PEAK",
          rates: [{ unit_price: "0.30" }],
          time_of_use: [
            {
              days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN", "PUBLIC_HOLIDAYS"],
              start_time: "15:00:00+10:00",
              end_time: "20:59:59.999999+10:00",
            },
          ],
        },
        {
          type: "OFF_PEAK",
          rates: [{ unit_price: "0.20" }],
          time_of_use: [
            {
              days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN", "PUBLIC_HOLIDAYS"],
              start_time: "00:00:00+10:00",
              end_time: "14:59:59.999999+10:00",
            },
            {
              days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN", "PUBLIC_HOLIDAYS"],
              start_time: "21:00:00+10:00",
              end_time: "23:59:59.999999+10:00",
            },
          ],
        },
      ],
    },
  ],
  solar_feed_in_tariff: [
    { single_tariff: { rates: [{ unit_price: "-0.05", measure_unit: "KWH" }] } },
    // A daily meter charge, not a per-kWh feed-in rate — must not be picked up.
    { single_tariff: { rates: [{ unit_price: "0.00", measure_unit: "DAYS" }] } },
  ],
};

const CURRENT = {
  planName: "Test TOU",
  contract: TOU_CONTRACT,
  servicePointIds: [SP],
  startDate: "2025-01-01",
  endDate: null,
};

describe("normaliseCurrentContract", () => {
  it("converts the tariff windows into CDR times", () => {
    const bands = normaliseCurrentContract(CURRENT).electricityContract.tariffPeriod[0]!.timeOfUseRates!;

    expect(bands[0]!.timeOfUse).toEqual([{ days: expect.any(Array), startTime: "15:00", endTime: "21:00" }]);
    expect(bands[1]!.timeOfUse.map((w) => `${w.startTime}-${w.endTime}`)).toEqual(["00:00-15:00", "21:00-00:00"]);
  });

  it("drops PUBLIC_HOLIDAYS from the day list", () => {
    const bands = normaliseCurrentContract(CURRENT).electricityContract.tariffPeriod[0]!.timeOfUseRates!;

    expect(bands[0]!.timeOfUse[0]!.days).toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
  });

  it("reads the feed-in as a credit, ignoring the invoice sign", () => {
    // The contract publishes "-0.05"; the bills prove that is a credit, not a charge.
    const fit = normaliseCurrentContract(CURRENT).electricityContract.solarFeedInTariff!;

    expect(fit[0]!.singleTariff!.rates[0]!.unitPrice).toBe("0.05");
  });

  it("ignores a feed-in entry measured in DAYS", () => {
    const fit = normaliseCurrentContract(CURRENT).electricityContract.solarFeedInTariff!;

    expect(fit).toHaveLength(1);
  });

  it("carries the supply charge and rate block through", () => {
    const period = normaliseCurrentContract(CURRENT).electricityContract.tariffPeriod[0]!;

    expect(period.rateBlockUType).toBe("timeOfUseRates");
    expect(period.dailySupplyCharge).toBe("1.00");
  });
});

// ───────────────────────── the spend figures ─────────────────────────

/** 10 days of 0.5 kWh imported and 0.25 kWh exported every half-hour. */
function tenDays(): RawConsumption {
  const usage: RawConsumption["usage"] = [];

  for (let d = 0; d < 10; d++) {
    const date = new Date(Date.UTC(2025, 5, 1 + d)).toISOString().slice(0, 10);
    const mk = (suffix: string, v: number) => ({
      service_point_id: SP,
      register_suffix: suffix,
      read_start_date: date,
      interval_read: {
        read_interval_length: 30,
        interval_reads: Array.from({ length: 48 }, () => v),
        aggregate_value: v * 48,
      },
    });
    usage.push(mk("E1", 0.5), mk("B1", -0.25));
  }

  return { usage };
}

describe("calculateCurrentEnergyCosts", () => {
  const accounts: RawAccounts = {
    accounts: [
      {
        account_id: "acct-1",
        plans: [
          {
            plan_overview: { display_name: "Test TOU", start_date: "2025-01-01" },
            plan_detail: { fuel_type: "ELECTRICITY", electricity_contract: TOU_CONTRACT },
            service_point_ids: [SP],
          },
        ],
      },
    ],
  };

  const spend = calculateCurrentEnergyCosts({ accounts, usage: tenDays() })!;
  const fromUsage = spend.fromUsage;

  // PEAK is 15:00–21:00 = 12 intervals = 6 kWh/day; OFF_PEAK the other 36 = 18 kWh/day.
  it("splits usage into peak and off-peak, GST inclusive", () => {
    expect(fromUsage.peakUsageCost).toBeCloseTo(10 * 6 * 0.3 * 1.1, 2); // 19.80
    expect(fromUsage.offPeakUsageCost).toBeCloseTo(10 * 18 * 0.2 * 1.1, 2); // 39.60
  });

  it("charges the daily supply charge for each observed day, GST inclusive", () => {
    expect(fromUsage.observedDays).toBe(10);
    expect(fromUsage.supplyCost).toBeCloseTo(10 * 1.0 * 1.1, 2); // 11.00
  });

  it("credits solar export without GST", () => {
    expect(fromUsage.solarCredit).toBeCloseTo(10 * 12 * 0.05, 2); // 6.00
  });

  it("totals spend over the observed window without annualising it", () => {
    expect(fromUsage.totalSpentToDate).toBeCloseTo(19.8 + 39.6 + 11.0 - 6.0, 2); // 64.40
  });

  it("annualises separately", () => {
    expect(fromUsage.estimatedAnnualCost).toBeCloseTo(64.4 * (365 / 10), 1); // 2350.60
  });

  it("reports the energy volumes and the window behind the money", () => {
    expect(fromUsage.importKwh).toBeCloseTo(10 * 24, 2);
    expect(fromUsage.exportKwh).toBeCloseTo(10 * 12, 2);
    expect(fromUsage.fromDate).toBe("2025-06-01");
    expect(fromUsage.toDate).toBe("2025-06-10");
  });

  it("omits the billed figures when no bills are supplied", () => {
    expect(spend.fromBills).toBeNull();
    expect(spend.reconciliation).toBeNull();
  });

  it("returns null when the household has no costable plan", () => {
    expect(calculateCurrentEnergyCosts({ accounts: { accounts: [] }, usage: tenDays() })).toBeNull();
  });
});

// ───────────────────────── totalling the invoices ─────────────────────────

describe("summarising bills", () => {
  const spend = calculateCurrentEnergyCosts({
    accounts: loadAccounts(),
    usage: loadUsage(),
    bills: loadBills(),
  })!;

  const bills = spend.fromBills!;

  it("classifies each energy line the retailer issued", () => {
    expect(bills.peakUsageCost).toBeCloseTo(331.88, 2);
    expect(bills.offPeakUsageCost).toBeCloseTo(440.91, 2);
    expect(bills.supplyCost).toBeCloseTo(339.43, 2);
    // Invoiced as a negative line; reported as a positive credit, like the usage side.
    expect(bills.solarCredit).toBeCloseTo(47.28, 2);
  });

  it("nets the energy lines into the amount charged for energy", () => {
    expect(bills.energyCharges).toBeCloseTo(1064.94, 2);
    expect(bills.periods).toBe(10);
  });

  it("keeps adjustments separate from energy, and payments out of the cost", () => {
    // Card fees appear as a charge and a matching reversal, so only the rebate is left.
    expect(bills.adjustmentsByLine.GOVERNMENT_ENERGY_RELIEF_REBATE_FY26).toBeCloseTo(-75, 2);
    expect(bills.adjustments).toBeCloseTo(-75, 2);
    expect(bills.netInvoiced).toBeCloseTo(1064.94 - 75, 2);
    expect(bills.paymentsMade).toBeGreaterThan(0);
  });

  it("does not count payments as a cost", () => {
    expect(bills.netInvoiced).toBeLessThan(bills.energyCharges);
  });
});

// ───────────────────────── the two methods, side by side ─────────────────────────

describe("reconciliation against the real invoices", () => {
  const spend = calculateCurrentEnergyCosts({
    accounts: loadAccounts(),
    usage: loadUsage(),
    bills: loadBills(),
  })!;

  const reconciliation = spend.reconciliation!;
  const line = (name: string) => reconciliation.byLine.find((l) => l.line === name)!;

  it("compares only the window the bills cover, not the whole usage set", () => {
    // Meter data runs to 2026-06-20; the last invoice ends 2026-06-06.
    expect(spend.fromUsage.observedDays).toBe(318);
    expect(reconciliation.observedDays).toBe(304);
    expect(reconciliation.toDate).toBe("2026-06-06");
  });

  it("matches the billed daily supply charge to the cent", () => {
    expect(Math.abs(line("DAILY_SUPPLY").differenceAud)).toBeLessThan(0.1);
  });

  it("matches the billed solar feed-in credit to the cent", () => {
    expect(Math.abs(line("FEED_IN_CREDIT").differenceAud)).toBeLessThan(0.1);
  });

  it("shifts energy between peak and off-peak but keeps the sum", () => {
    // The retailer applies the published +10:00 windows while we read local wall-clock,
    // so the boundary moves across daylight saving. The energy either side still agrees.
    const shifted = line("PEAK").differenceAud + line("OFF_PEAK").differenceAud;
    const billedUsage = line("PEAK").billed + line("OFF_PEAK").billed;

    expect(line("PEAK").differenceAud).toBeGreaterThan(0);
    expect(line("OFF_PEAK").differenceAud).toBeLessThan(0);
    expect(Math.abs(shifted) / billedUsage).toBeLessThan(0.015);
  });

  it("lands within 2% of what the household was actually charged for energy", () => {
    expect(Math.abs(reconciliation.differencePercent)).toBeLessThan(2);
    expect(reconciliation.billedTotal).toBeCloseTo(1064.94, 2);
  });
});
