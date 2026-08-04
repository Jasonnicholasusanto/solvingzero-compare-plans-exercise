"use client";

import { useEffect, useState } from "react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * How a plan cost is arrived at, in the user's words rather than the code's.
 *
 * Every claim here describes what `calculateAnnualPlanCost` actually does — if the costing
 * changes, this copy has to change with it. Nothing tests prose against code.
 */
const STEPS: Array<{ title: string; detail: string }> = [
  {
    title: "Narrow to plans you can actually sign up to",
    detail:
      "Residential electricity plans that are currently offered and available on your distributor's network. Anything sold to another network or another state never enters the comparison.",
  },
  {
    title: "Price your own meter data, interval by interval",
    detail:
      "Not an average household — your reads. On a single-rate plan every kWh takes the same price; on time-of-use each interval is matched to the plan's peak, shoulder or off-peak window by time of day and day of week. Where a plan charges in tiered blocks, usage is filled band by band.",
  },
  {
    title: "Add the daily supply charge",
    detail:
      "The plan's fixed daily rate, once for every day of meter data — charged whether you use power or not.",
  },
  {
    title: "Add controlled load",
    detail:
      "Priced on its own separate rate. If you have controlled-load usage and a plan doesn't publish a rate for it, we drop the plan rather than pretend that load is free.",
  },
  {
    title: "Add 10% GST",
    detail:
      "Applied to usage, controlled load and supply together, so the figure matches how a bill is written.",
  },
  {
    title: "Subtract your solar credit",
    detail:
      "Exported kWh paid at the plan's feed-in rate, with tiered caps resetting each day. Feed-in credits don't carry GST, so this comes off after the GST step rather than before.",
  },
  {
    title: "Scale to a full year",
    detail:
      "The result covers only the days we have data for, so it's multiplied up to 365. Both your current plan and every alternative are annualised from the same days, which is what makes the saving a like-for-like number.",
  },
];

export function Methodology({ observedDays }: { observedDays?: number }) {
  const [api, setApi] = useState<CarouselApi>();
  const [selected, setSelected] = useState(0);
  const [snapCount, setSnapCount] = useState(0);

  /* Snap count, not step count — how many stops there are depends on how many slides fit. */
  useEffect(() => {
    if (!api) return;

    const sync = () => {
      setSelected(api.selectedScrollSnap());
      setSnapCount(api.scrollSnapList().length);
    };

    sync();
    api.on("select", sync);
    api.on("reInit", sync);

    return () => {
      api.off("select", sync);
      api.off("reInit", sync);
    };
  }, [api]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>How we cost a plan</CardTitle>
        <CardDescription>
          Every plan goes through the same seven steps, on your usage rather than a typical
          household&rsquo;s.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* The formula stays put rather than becoming a slide — it's the reference the steps expand on. */}
        <div className="bg-muted/60 rounded-lg p-3">
          <p className="text-muted-foreground mb-2 text-xs tracking-wide uppercase">The sum</p>
          <div className="space-y-1.5 font-mono text-xs leading-relaxed">
            <p>
              <span className="text-muted-foreground">period cost =</span> (usage + controlled load + supply)
              × 1.1 − solar credit
            </p>
            <p>
              <span className="text-muted-foreground">per year =</span> period cost × 365 ÷{" "}
              {observedDays ?? "days of data"}
            </p>
          </div>
        </div>

        <Carousel setApi={setApi} opts={{ align: "start" }} className="w-full">
          <CarouselContent>
            {STEPS.map((step, index) => (
              <CarouselItem key={step.title} className="sm:basis-1/2 lg:basis-1/3">
                <div className="bg-card ring-border/70 h-full space-y-2 rounded-lg p-4 ring-1">
                  <span className="bg-muted text-muted-foreground flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums">
                    {index + 1}
                  </span>
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="text-muted-foreground text-sm">{step.detail}</p>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>

          {/*
            `static` overrides the default absolute placement at -left-12/-right-12, which the
            Card's `overflow-hidden` would otherwise clip out of existence.
          */}
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-muted-foreground text-xs tabular-nums">
              {snapCount > 0 ? `${selected + 1} / ${snapCount}` : `${STEPS.length} steps`}
            </p>
            <div className="flex gap-2">
              <CarouselPrevious className="static translate-x-0 translate-y-0" />
              <CarouselNext className="static translate-x-0 translate-y-0" />
            </div>
          </div>
        </Carousel>
      </CardContent>
    </Card>
  );
}
