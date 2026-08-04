import { RawAccounts, RawConsumption } from "./types";

interface CurrentEnergySpend {
  planName: string;
  observedDays: number;

  peakUsageCost: number;
  offPeakUsageCost: number;
  supplyCost: number;
  solarCredit: number;

  totalSpentToDate: number;
  estimatedAnnualCost: number;
}

export function calculateCurrentEnergyCosts(
  accounts: RawAccounts,
  usage: RawConsumption,
): CurrentEnergySpend | null {
    // 1. Extract the current plan.
    // 2. Cost every E1 interval using peak/off-peak windows.
    // 3. Add the daily supply charge.
    // 4. Apply GST.
    // 5. Calculate and subtract the B1 solar credit.
    // 6. Return observed and annualised values.

    return null;
}