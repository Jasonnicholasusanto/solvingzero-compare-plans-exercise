import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

/**
 * The caveats attached to this particular run. The method itself lives in `Methodology` —
 * this card is only ever about what happened when these numbers were produced.
 */
export function MethodNotes({ notes, excludedPlans }: { notes: string[]; excludedPlans: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What we left out</CardTitle>
        <CardDescription>
          A saving you can&rsquo;t interrogate is one you won&rsquo;t act on.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {excludedPlans > 0 ? `Where we stopped (${excludedPlans} plans left out)` : "Where we stopped"}
          </p>
          <p className="text-muted-foreground text-sm">
            Two pricing structures this engine deliberately won&rsquo;t guess at: demand charges billed on
            your peak kW, and feed-in tariffs that pay different rates by time of day. Plans using either are
            excluded and counted below rather than costed on a guess.
          </p>
        </div>

        {notes.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-sm font-medium">From this run</p>
              <ul className="text-muted-foreground space-y-2 text-sm">
                {notes.map((note) => (
                  <li key={note} className="flex gap-2">
                    <span aria-hidden="true">·</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
