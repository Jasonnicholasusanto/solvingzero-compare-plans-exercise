import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Shown while the ten retailers' plan catalogues are being fetched and costed. */
export function RecommendationSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Fetching plans from the ten retailers and costing them on your usage.</span>

      {/* Mirrors the split hero: headline left, detail card right. */}
      <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
        <div className="space-y-6">
          <Skeleton className="h-5 w-36" />
          <div className="space-y-3">
            <Skeleton className="h-14 w-full sm:h-16" />
            <Skeleton className="h-14 w-2/3 sm:h-16" />
          </div>
          <Skeleton className="h-4 w-5/6" />
        </div>

        <Card>
          <CardContent className="space-y-5">
            <Skeleton className="h-[180px] w-full" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <Skeleton key={row} className="h-4" />
          ))}
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {[0, 1].map((card) => (
          <Card key={card}>
            <CardHeader className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
            </CardHeader>
            <CardContent className="space-y-3">
              {[0, 1, 2, 3, 4].map((row) => (
                <Skeleton key={row} className="h-4" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
