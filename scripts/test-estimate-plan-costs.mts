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

console.log(`Estimated plan costs:`, planCosts);