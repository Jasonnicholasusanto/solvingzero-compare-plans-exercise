/**
 * Setup smoke-test — run `pnpm verify` after `pnpm install` to confirm your toolchain and the
 * bundled data load correctly before you start. It does NOT test your solution (that's `pnpm test`).
 *
 * @format
 */

import { loadAccounts, loadBills, loadDer, loadRetailers, loadServicePoints, loadUsage } from "../src/loadData.js";

const usage = loadUsage();
const sp = loadServicePoints().service_points[0];
const lnsp = sp?.related_participants?.find((p) => p.role === "LNSP")?.party ?? "unknown";
const days = new Set(usage.usage.map((r) => r.read_start_date)).size;

console.log("✓ Node + TypeScript (tsx) are working");
console.log(`✓ Loaded ${usage.usage.length} usage records across ${days} days`);
console.log(`✓ Household distributor (LNSP): ${lnsp}`);
console.log(
  `✓ ${loadRetailers().length} retailers · ${loadBills().billing.length} bill transactions · ` +
    `${loadDer().der_records.length} solar system(s) · ${loadAccounts().accounts.length} account(s)`,
);
console.log("\nYou're set up. Read GOAL_GUIDE.md, then implement the stubs in src/. Good luck!");
