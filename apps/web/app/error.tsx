"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The plan fetch talks to ten third-party CDR endpoints, so a failed render is usually one of
 * them being down rather than a bug. Give the household a retry instead of a stack trace.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>We couldn&rsquo;t compare your plans</CardTitle>
          <CardDescription>
            Something went wrong reaching the retailers&rsquo; plan data. This is usually temporary.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-muted-foreground font-mono text-xs break-words">{error.message}</p>
          <Button onClick={reset}>Try again</Button>
        </CardContent>
      </Card>
    </main>
  );
}
