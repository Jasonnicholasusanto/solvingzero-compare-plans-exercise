import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The engine's own caveats. Surfaced rather than hidden: a saving figure the household
 * can't interrogate is one they won't act on.
 */
export function MethodNotes({ notes, excludedPlans }: { notes: string[]; excludedPlans: number }) {
  if (notes.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>How we worked this out</CardTitle>
        <CardDescription>
          {excludedPlans > 0
            ? `${excludedPlans} plans applied to your address but couldn't be priced, so they're excluded.`
            : "Every plan that applies to your address was priced."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ul className="text-muted-foreground space-y-2 text-sm">
          {notes.map((note) => (
            <li key={note} className="flex gap-2">
              <span aria-hidden="true">·</span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
