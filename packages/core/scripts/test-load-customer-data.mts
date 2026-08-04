import { loadUsage, loadServicePoints } from "../src/loadData.js";

const usage = loadUsage().usage;
const servicePoints = loadServicePoints().service_points;

console.log(`Number of records loaded for usage:`, usage.length);
console.log(`Loaded usage:`, usage);
console.log(`Number of records loaded for service points:`, servicePoints.length);
console.log(`Loaded service points:`, servicePoints);