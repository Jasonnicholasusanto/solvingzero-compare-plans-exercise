import { fetchPlans } from "../src/fetchPlans";
import { loadRetailers, loadServicePoints } from "../src/loadData";

console.log("Fetching plans for all retailers and service points...");
const servicePoints = loadServicePoints();
const retailers = loadRetailers();
console.log(
  `Loaded ${servicePoints.service_points.length} service points and ${retailers.length} retailers`,
);

console.log("Fetching plans...");
const plans = await fetchPlans({
  servicePoints,
  retailers,
});
console.log(
  `Fetched ${plans.length} plans for ${servicePoints.service_points.length} service points`,
);

for (const plan of plans) {
  console.log(
    `Plan ${plan.planId} (${plan.displayName}) from ${plan.brandName} — ${
      plan.electricityContract?.tariffPeriod?.[0]?.rateBlockUType ?? "unknown"
    }`,
  );
}

