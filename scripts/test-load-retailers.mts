import { loadRetailers } from "../src/loadData.js";

const retailers = loadRetailers();

console.log(retailers);
console.log(`Loaded ${retailers.length} retailers`);