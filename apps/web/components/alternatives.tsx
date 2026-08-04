import type { PlanRecommendation } from "@solvingzero/core";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, moneySigned } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The cheapest plans found, cheapest first, each priced against what they pay now. */
export function Alternatives({ recommendation }: { recommendation: PlanRecommendation }) {
  const { alternatives, current, recommended } = recommendation;
  const currentAnnual = current.fromUsage.estimatedAnnualCost;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cheapest plans for your address</CardTitle>
        <CardDescription>
          Costed on your own usage, GST inclusive, against {money(currentAnnual)} a year today.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Retailer</TableHead>
                <TableHead className="text-right">Per year</TableHead>
                <TableHead className="text-right">Potential savings</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {alternatives.map((plan) => {
                const delta = plan.annualCostAud == null ? null : plan.annualCostAud - currentAnnual;

                return (
                  <TableRow key={plan.planId}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {plan.planName}
                        {plan.planId === recommended?.planId && <Badge variant="secondary">Best</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{plan.brandName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(plan.annualCostAud)}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        delta != null && delta < 0 && "text-primary-strong font-medium",
                      )}
                    >
                      {moneySigned(delta)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
