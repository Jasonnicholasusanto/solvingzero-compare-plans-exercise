"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

/**
 * Two bars, one comparison: what a year costs on the current plan against the cheapest
 * plan we could find. The engine only produces a total per plan — `RankedPlanCost.breakdown`
 * is declared but never populated — so plotting a component split would mean inventing it.
 */
const chartConfig = {
  cost: { label: "Cost per year" },
  today: { label: "Today", color: "var(--muted-foreground)" },
  best: { label: "Best plan", color: "var(--primary)" },
} satisfies ChartConfig;

export function SavingsChart({
  currentAnnual,
  currentLabel,
  bestAnnual,
  bestLabel,
}: {
  currentAnnual: number;
  currentLabel: string;
  bestAnnual: number;
  bestLabel: string;
}) {
  const data = [
    { key: "today", plan: "Today", fullName: currentLabel, cost: currentAnnual, fill: "var(--color-today)" },
    { key: "best", plan: "Best plan", fullName: bestLabel, cost: bestAnnual, fill: "var(--color-best)" },
  ];

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[180px] w-full">
      <BarChart accessibilityLayer data={data} margin={{ top: 24, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="plan" tickLine={false} axisLine={false} tickMargin={8} />
        {/* Bars start at zero — a truncated axis would exaggerate a 14% gap into a visual chasm. */}
        <YAxis domain={[0, "dataMax"]} hide />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              nameKey="key"
              labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
              formatter={(value) => (
                <span className="tabular-nums">
                  {new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(
                    Number(value),
                  )}{" "}
                  / yr
                </span>
              )}
            />
          }
        />
        <Bar dataKey="cost" radius={[6, 6, 0, 0]} maxBarSize={72}>
          <LabelList
            dataKey="cost"
            position="top"
            offset={8}
            className="fill-foreground text-sm font-semibold tabular-nums"
            formatter={(value) =>
              new Intl.NumberFormat("en-AU", {
                style: "currency",
                currency: "AUD",
                maximumFractionDigits: 0,
              }).format(Number(value))
            }
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
