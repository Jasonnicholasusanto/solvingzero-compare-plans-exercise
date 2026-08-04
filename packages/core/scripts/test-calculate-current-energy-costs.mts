import { calculateCurrentEnergyCosts } from "../src/calculateCurrentEnergyCosts.js";
import { loadAccounts, loadBills, loadUsage } from "../src/loadData.js";

const accounts = loadAccounts();
const usage = loadUsage();
const bills = loadBills();

console.log("Calculating current energy costs...");
const currentEnergyCosts = calculateCurrentEnergyCosts({accounts, usage, bills});

console.log("Current energy costs calculated:");
console.log(JSON.stringify(currentEnergyCosts, null, 2));