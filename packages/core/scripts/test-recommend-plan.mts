import { recommendPlan } from "../src/recommendPlan.js";
import { loadAccounts, loadBills, loadServicePoints, loadUsage, loadRetailers } from "../src/loadData.js";
import { fetchPlans } from "../src/fetchPlans.js";

const usage = loadUsage();
const servicePoints = loadServicePoints();
const retailers = loadRetailers();
const accounts = loadAccounts();
const bills = loadBills();

console.log(`Loaded ${usage.usage.length} usage records, ${servicePoints.service_points.length} service points, ${retailers.length} retailers, ${accounts.accounts.length} accounts, and ${bills.billing.length} bills`,
);

console.log("Fetching plans for all retailers and service points...");
const plans = await fetchPlans({
  servicePoints,
  retailers,
});
console.log(`Fetched ${plans.length} plans`);

const result = recommendPlan({
  accounts,
  usage,
  servicePoints,
  bills,
  plans,
})!;

const money = (n: number) => `$${n.toFixed(2)}`;

console.log(`\nToday:  ${result.current.planName} — ${money(result.current.fromUsage.estimatedAnnualCost)}/yr`);
console.log(`        (${money(result.current.fromUsage.totalSpentToDate)} spent over ${result.current.fromUsage.observedDays} days)\n`);

if (result.recommended) {
  console.log(`Switch to: ${result.recommended.planName} by ${result.recommended.brandName}`);
  console.log(`           ${money(result.recommended.annualCostAud!)}/yr`);
  console.log(`Save:      ${money(result.annualSavingAud!)}/yr  (${result.savingPercent}%)\n`);
} else {
  console.log("No cheaper plan found.\n");
}

console.log(`Current plan ranks #${result.currentPlanRank} of ${result.comparedPlans + 1} costed plans.\n`);
console.log("Cheapest alternatives:");
for (const p of result.alternatives) {
  console.log(`  ${money(p.annualCostAud!).padStart(10)}  ${(p.planName ?? "").slice(0, 50)}`);
}
console.log("\nNotes:");
for (const n of result.notes) console.log(`  - ${n}`);
