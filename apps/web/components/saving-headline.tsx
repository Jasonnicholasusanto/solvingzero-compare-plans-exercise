import type { RecommendationView } from "@/lib/recommendation";

import { SavingsChart } from "@/components/savings-chart";
import SplitText from "@/components/split-text";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { money, moneyWhole, percent } from "@/lib/format";

/*
 * Shared across both lines so the second reads as a continuation of the first. Capped at
 * text-5xl: the longest line ("Save $1,234 a year.") has to survive its column without
 * orphaning a word, and SplitText animates per character, so a reflow is very visible.
 */
const HEADLINE = "text-4xl leading-[1.05] font-extrabold tracking-tight pb-1 sm:text-5xl";

/** `overflow: hidden` on the split parent is what gives the reveal; each line needs its own row. */
function HeadlineLine({ text, className, delay = 0 }: { text: string; className: string; delay?: number }) {
  return (
    <span className="block">
      <SplitText
        text={text}
        tag="span"
        textAlign="left"
        className={`${HEADLINE} ${className}`}
        splitType="chars"
        delay={28}
        duration={0.8}
        from={{ opacity: 0, y: "0.6em" }}
        to={{ opacity: 1, y: 0, delay }}
        threshold={0.05}
        rootMargin="0px"
      />
    </span>
  );
}

/**
 * The primary insight, given the whole width of the screen: the number on the left, the
 * working on the right. Everything further down the page exists to justify it.
 */
export function SavingHeadline({ recommendation }: { recommendation: RecommendationView }) {
  const {
    current,
    recommended,
    annualSavingAud,
    savingPercent,
    currentPlanRank,
    comparedPlans,
    currentBrandName,
  } = recommendation;

  const currentAnnual = current.fromUsage.estimatedAnnualCost;

  if (!recommended || annualSavingAud == null) {
    return (
      <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
        <div className="space-y-6">
          <Badge variant="secondary">Nothing cheaper found</Badge>
          <h2>
            {/* A real curly apostrophe — `text` is a JS string, so an HTML entity would render literally. */}
            <HeadlineLine text="You&apos;re on the" className="text-foreground" />
            <HeadlineLine text="best plan." className="text-primary-strong" delay={0.3} />
          </h2>
          <p className="text-muted-foreground max-w-md text-balance">
            <span className="text-foreground font-medium">{current.planName}</span> costs about{" "}
            {moneyWhole(currentAnnual)} a year on your usage. None of the {comparedPlans} plans we could
            cost beat it.
          </p>
        </div>

        <Card>
          <CardContent className="space-y-1">
            <p className="text-muted-foreground text-xs tracking-wide uppercase">You&rsquo;re on</p>
            <p className="font-medium">{current.planName}</p>
            <p className="text-muted-foreground text-sm tabular-nums">{money(currentAnnual)} / yr</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
      <div className="space-y-6">
        <Badge>Switching is worth it</Badge>

        <h2>
          <HeadlineLine text={`Save ${moneyWhole(annualSavingAud)} a year.`} className="text-primary-strong" />
          <HeadlineLine text="Same power." className="text-foreground" delay={0.3} />
        </h2>

        <p className="text-muted-foreground max-w-md text-balance">
          That&rsquo;s {percent(savingPercent)} off your electricity bill — {money(annualSavingAud / 12)} a
          month — for exactly the power you already use.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-5">
          <SavingsChart
            currentAnnual={currentAnnual}
            currentLabel={current.planName}
            bestAnnual={recommended.annualCostAud ?? 0}
            bestLabel={recommended.planName}
          />

          <Separator />

          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <dt className="text-muted-foreground text-xs tracking-wide uppercase">
                You&rsquo;re on {currentBrandName && <Badge variant="secondary">{currentBrandName}</Badge>}
              </dt>
              <dd className="text-sm font-medium">{current.planName}</dd>
              <dd className="text-muted-foreground text-sm tabular-nums">{money(currentAnnual)} / yr</dd>
            </div>

            <div className="space-y-1">
              <dt className="text-muted-foreground text-xs tracking-wide uppercase">
                Switch to {recommended.brandName && <Badge variant="secondary">{recommended.brandName}</Badge>}
              </dt>
              <dd className="text-sm font-medium">{recommended.planName}</dd>
              <dd className="text-muted-foreground text-sm tabular-nums">
                {money(recommended.annualCostAud)} / yr
              </dd>
            </div>
          </dl>

          <p className="text-muted-foreground text-sm">
            Your current plan ranks #{currentPlanRank} of the {comparedPlans + 1} plans we could cost for
            your address.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
