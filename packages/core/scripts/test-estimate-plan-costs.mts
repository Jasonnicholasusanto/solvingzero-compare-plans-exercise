import {estimatePlanCosts} from "../src/estimatePlanCosts.js";
import { fetchPlans } from "../src/fetchPlans.js";
import { loadRetailers, loadServicePoints, loadUsage } from "../src/loadData.js";

const usage = loadUsage();
const servicePoints = loadServicePoints();
const retailers = loadRetailers();

console.log("Fetching plans for all retailers and service points...");
const plans = await fetchPlans({
  servicePoints,
  retailers,
});

console.log(`Loaded ${usage.usage.length} usage records, ${servicePoints.service_points.length} service points, ${retailers.length} retailers, and fetched ${plans.length} plans`,
);
const planCosts = estimatePlanCosts({
  usage,
  servicePoints,
  plans,
});

for (const planCost of planCosts) {
  console.log(
    `Plan ${planCost.planId} (${planCost.planName}) from ${planCost.brandName} — Estimated annual cost: $${planCost.annualCostAud}`,
  );
}

const cheapest = planCosts[0];
if (cheapest) {
  console.log(`Cheapest plan is ${cheapest.planId} (${cheapest.planName}) from ${cheapest.brandName} — Estimated annual cost: AUD $${cheapest.annualCostAud}`);
} else {
  console.log("No plans could be costed.");
}