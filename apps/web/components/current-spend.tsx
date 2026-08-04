import type { CurrentEnergySpend } from "@solvingzero/core";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { bandLabel, dateRange, kwh, money, moneySigned, percent } from "@/lib/format";
import { cn } from "@/lib/utils";

function Line({
  label,
  value,
  muted = false,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: "solar";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className={muted ? "text-muted-foreground text-sm" : "text-sm"}>{label}</span>
      <span
        className={cn("text-sm font-medium tabular-nums", accent === "solar" && "text-solar-strong")}
      >
        {value}
      </span>
    </div>
  );
}

/** What the household actually pays today, and where the money goes. */
export function CurrentSpend({ current }: { current: CurrentEnergySpend }) {
  const { fromUsage, fromBills, reconciliation } = current;

  return (
    <Card>
      <CardHeader>
        <CardTitle>What you pay today</CardTitle>
        <CardDescription>
          {current.planName} · {fromUsage.observedDays} days of meter reads (
          {dateRange(fromUsage.fromDate, fromUsage.toDate)})
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          {Object.entries(fromUsage.usageCostByBand).map(([band, cost]) => (
            <Line key={band} label={`${bandLabel(band)} usage`} value={money(cost)} />
          ))}

          {fromUsage.controlledLoadCost > 0 && (
            <Line label="Controlled load" value={money(fromUsage.controlledLoadCost)} />
          )}

          <Line label="Daily supply charge" value={money(fromUsage.supplyCost)} />

          {fromUsage.solarCredit !== 0 && (
            <Line
              label="Solar feed-in credit"
              value={moneySigned(-Math.abs(fromUsage.solarCredit))}
              accent="solar"
            />
          )}

          <Separator className="my-2" />

          <Line label={`Spent over ${fromUsage.observedDays} days`} value={money(fromUsage.totalSpentToDate)} />
          <Line label="Annualised" value={money(fromUsage.estimatedAnnualCost)} />
        </div>

        <Separator />

        <div>
          <Line label="Imported from the grid" value={kwh(fromUsage.importKwh)} muted />
          <Line label="Exported from solar" value={kwh(fromUsage.exportKwh)} muted />
        </div>

        {fromBills && reconciliation && (
          <>
            <Separator />
            <div>
              <p className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
                Checked against your bills
              </p>
              <Line
                label={`Invoiced over ${reconciliation.observedDays} days`}
                value={money(reconciliation.billedTotal)}
                muted
              />
              <Line label="Our figure for the same window" value={money(reconciliation.computedTotal)} muted />
              <Line
                label="Difference"
                value={`${money(reconciliation.differenceAud)} (${percent(reconciliation.differencePercent)})`}
                muted
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
