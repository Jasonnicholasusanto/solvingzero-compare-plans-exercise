import { Suspense } from "react";
import Image from "next/image";
import { Recommendation } from "@/components/recommendation";
import { RecommendationSkeleton } from "@/components/recommendation-skeleton";
import SplitText from "@/components/split-text";

/**
 * Costing every plan means fetching ~220 plan details across ten CDR endpoints, which takes
 * roughly 25 seconds cold. Retailers republish their pricing far less often than that, so the
 * route is rendered once and revalidated hourly rather than on every request.
 */
export const revalidate = 3600;

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-13">
      <header className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <Image
            src="/images/sz-logo-icon.png"
            alt=""
            width={600}
            height={600}
            sizes="32px"
            className="h-8 w-auto"
            priority
          />
          <Image
            src="/images/sz-logo.png"
            alt="SolvingZero"
            width={300}
            height={63}
            sizes="96px"
            className="h-5 w-auto"
            priority
          />
        </div>
        <SplitText
          text="Choosing the best choice for you"
          tag="h1"
          textAlign="left"
          className="text-sm tracking-tight"
          splitType="chars"
          delay={20}
          duration={0.6}
          from={{ opacity: 0, y: "0.6em" }}
          to={{ opacity: 1, y: 0 }}
          threshold={0.05}
          rootMargin="0px"
        />
      </header>

      <Suspense fallback={<RecommendationSkeleton />}>
        <Recommendation />
      </Suspense>
    </main>
  );
}
