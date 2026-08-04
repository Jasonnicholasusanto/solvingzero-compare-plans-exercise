import type { PlanRecommendation } from "@solvingzero/core";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { money } from "@/lib/format";

/**
 * Mirrors `recommendPlan`'s own DEFAULT_MATERIAL_SAVING_AUD. The engine doesn't publish the
 * threshold on its result, so it's restated here — if that default moves, this moves with it.
 * Below it, a "saving" is inside the estimate's own margin of error.
 */
const MATERIAL_SAVING_AUD = 30;

/** Smallest visible sliver, so a near-zero difference still reads as a bar rather than nothing. */
const MIN_BAR_PERCENT = 3;

type Colours = { bar: string; text: string };

const NEUTRAL: Colours = { bar: "var(--muted-foreground)", text: "var(--muted-foreground)" };
const COSTS_MORE: Colours = { bar: "var(--destructive)", text: "var(--destructive)" };
const NEGLIGIBLE: Colours = { bar: "var(--solar)", text: "var(--solar-strong)" };
const BEST_IN_CLASS: Colours = { bar: "var(--primary)", text: "var(--primary-strong)" };

/**
 * Colour ramps green → amber across the list, so each row reads differently rather than five
 * identical green bars.
 *
 * `spread` is null when every plan lands within a material saving of every other — colouring a
 * ranked ramp then would imply a difference of a few dollars a year is meaningful, when the
 * whole point of the threshold is that it isn't.
 *
 * The text ramp is safe at every mix: `primary-strong` and `solar-strong` sit at almost the
 * same lightness (oklch L .514 / .519), so interpolating holds 5.3:1 or better throughout.
 */
function coloursFor(saving: number | null, spread: { best: number; worst: number } | null): Colours {
  if (saving == null) return NEUTRAL;
  if (saving <= 0) return COSTS_MORE;
  if (saving < MATERIAL_SAVING_AUD) return NEGLIGIBLE;
  if (!spread) return BEST_IN_CLASS;

  const position = (saving - spread.worst) / (spread.best - spread.worst);
  const towardAmber = Math.round((1 - position) * 100);

  return {
    bar: `color-mix(in oklch, var(--primary), var(--solar) ${towardAmber}%)`,
    text: `color-mix(in oklch, var(--primary-strong), var(--solar-strong) ${towardAmber}%)`,
  };
}

function caption(saving: number | null): string {
  if (saving == null) return "Could not be costed";
  if (saving > 0) return `Saves ${money(saving)} a year`;
  if (saving === 0) return "Same as you pay today";
  return `Costs ${money(-saving)} more a year`;
}

/**
 * The cheapest plans found, cheapest first, each priced against what they pay now.
 *
 * Bar *length* is zero-based against the biggest saving, so it encodes magnitude honestly.
 * Bar *colour* is relative to this list, which is what separates rows that are only a few
 * dollars apart. Length says how much; colour says where it ranks.
 */
export function Alternatives({ recommendation }: { recommendation: PlanRecommendation }) {
  const { alternatives, current, recommended } = recommendation;
  const currentAnnual = current.fromUsage.estimatedAnnualCost;

  const rows = alternatives.map((plan) => ({
    plan,
    saving: plan.annualCostAud == null ? null : currentAnnual - plan.annualCostAud,
  }));

  const material = rows
    .map((row) => row.saving)
    .filter((saving): saving is number => saving != null && saving >= MATERIAL_SAVING_AUD);

  const best = material.length > 0 ? Math.max(...material) : 0;
  const worst = material.length > 0 ? Math.min(...material) : 0;
  const spread = material.length > 1 && best - worst >= MATERIAL_SAVING_AUD ? { best, worst } : null;

  /* Length scales off the largest magnitude either way, so a plan that costs more still fits. */
  const scale = Math.max(...rows.map((row) => Math.abs(row.saving ?? 0)), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cheapest plans for your address</CardTitle>
        <CardDescription>
          Costed on your own usage, GST inclusive, against {money(currentAnnual)} a year today. Bars run
          longest and greenest for the biggest saving.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ul className="space-y-4">
          {rows.map(({ plan, saving }) => {
            const colours = coloursFor(saving, spread);
            const percent =
              saving == null
                ? 0
                : Math.max(MIN_BAR_PERCENT, Math.min(100, (Math.abs(saving) / scale) * 100));

            return (
              <li key={plan.planId} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-medium">
                    {plan.planName}
                    {plan.brandName && (
                      <span className="text-muted-foreground font-normal"> · {plan.brandName}</span>
                    )}
                  </p>

                  <p className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums" style={{ color: colours.text }}>
                      {money(plan.annualCostAud)}
                      <span className="text-muted-foreground font-normal">/yr</span>
                    </span>
                    {plan.planId === recommended?.planId && <Badge>Best</Badge>}
                  </p>
                </div>

                {/*
                  Decorative: the figure it encodes is already stated in text beside it, and
                  role="progressbar" would have a screen reader announce a percentage that means
                  nothing on its own.
                */}
                <div aria-hidden="true" className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{ width: `${percent}%`, backgroundColor: colours.bar }}
                  />
                </div>

                <p className="text-muted-foreground text-xs tabular-nums">{caption(saving)}</p>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
