import { Alternatives } from "@/components/alternatives";
import { CurrentSpend } from "@/components/current-spend";
import { MethodNotes } from "@/components/method-notes";
import { Methodology } from "@/components/methodology";
import { SavingHeadline } from "@/components/saving-headline";
import { getRecommendation } from "@/lib/recommendation";

/**
 * Async server component: everything that depends on the live plan fetch sits behind this
 * one boundary, so the page shell can render while the retailers are still being called.
 */
export async function Recommendation() {
  const recommendation = await getRecommendation();

  return (
    <div className="space-y-6">
      <SavingHeadline recommendation={recommendation} />

      <Alternatives recommendation={recommendation} />

      {/* `items-stretch`, not `items-start`: both cards take the taller one's height. */}
      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <CurrentSpend current={recommendation.current} />
        <MethodNotes notes={recommendation.notes} excludedPlans={recommendation.excludedPlans} />
      </div>

      <Methodology observedDays={recommendation.current.fromUsage.observedDays} />
    </div>
  );
}
