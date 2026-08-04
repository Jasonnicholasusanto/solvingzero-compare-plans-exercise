<!-- @format -->

# Solution & Development Decision Log

This document is intended to capture the decisions made during the solution and development process. It serves as a reference for the team and stakeholders to understand the rationale behind key choices, ensuring transparency and facilitating future decision-making. To be completely honest, I have been using AI to assist me in the development process, and I have been documenting the decisions made during the development process. AI tools that I have utilized include:
1. ChatGPT (OpenAI) - Providing contextual understanding, code breakdown, code suggestions, research the web, and explanations for business logic.
2. Claude Code agent (Anthropic) - Implementing code clean up, code refactoring, and code generation for specific functions and tests.
3. GitHub Copilot - Providing code suggestions and autocompletion within the IDE.

# Personal Checklist (to-do list)
- [✓] Read the README.md and GOAL_GUIDE.md to understand the requirements and goals of the exercise.
- [✓] Review the provided data files (`retailers.json`, `service-points.json`, etc.) to understand the structure and relationships of the data.
- [✓] Explore the existing codebase, including the stubs in `src/fetchPlans.ts` and `src/estimatePlanCosts.ts`, to understand where to implement the required functionality.
- [✓] Run the verification and test scripts (`pnpm verify` and `pnpm test`) to ensure the development environment is correctly set up and that the existing tests are passing.
- [✓] Implement the `fetchPlans` function to retrieve plans from the provided retailers, ensuring that the function adheres to the specified filtering criteria and handles pagination and concurrency appropriately.
- [✓] Implement unit tests for the `fetchPlans` function to validate its correctness and ensure that it handles various scenarios, including edge cases and error conditions.
- [✓] Implement the `estimatePlanCosts` function to calculate the annual cost of each applicable plan based on the household's electricity usage and the plan's pricing structure.
- [✓] Implement unit tests for the `estimatePlanCosts` function to validate its correctness and ensure that it handles various scenarios, including edge cases and error conditions.
- [✓] Integrate the `fetchPlans` and `estimatePlanCosts` functions to provide a complete solution that fetches applicable plans, calculates their costs, and returns a ranked list of recommendations for the household.
- [✓] Implement the `calculateCurrentEnergyCosts` function to calculate the current energy costs for the household based on their existing plan and usage data.
- [✓] Implement unit tests for the `calculateCurrentEnergyCosts` function to validate its correctness and ensure that it handles various scenarios, including edge cases and error conditions.
- [✓] Conduct end-to-end testing of the integrated solution to ensure that it meets the requirements and produces accurate and reliable results. Make sure all tests pass and that the solution handles various scenarios, including edge cases and error conditions.
- [✓] Complete the documentation, including updating the README.md and GOAL_GUIDE.md as necessary to reflect the implemented solution and any relevant usage instructions or considerations.

### Nice to have:
- [] Implement additional features or optimizations, such as caching plan details to reduce API calls, or providing more detailed cost breakdowns for each plan.
- [✓] Implement the Next.js frontend!
- [✓] Refine frontend UI/UX to improve usability and presentation of the plan recommendations and cost comparisons.


## Pre-development Process

### These were my steps taken before starting the development process:
1. **Understanding the Requirements**: I thoroughly read through the README.md and GOAL_GUIDE.md to understand the task requirements, the data provided, and the expected outcomes.
2. **Familiarization with the Data**: I reviewed the `retailers.json`, `service-points.json`, and the `DATA_DICTIONARY.md` to understand the structure and relationships of the data, as well as the specific fields that would be relevant for filtering and cost calculations.
3. **Went through the codebase**: I explored the existing code structure, including the stubs in `src/fetchPlans.ts` and `src/estimatePlanCosts.ts`, to understand where to implement the required functionality.
4. **Ran the verification and test scripts**: After reading the README.md, I executed `pnpm install` to set up the workspace, then ran `pnpm verify` and `pnpm test` to ensure that the development environment was correctly configured. At this point, `pnpm test` was failing because the stubs had not been implemented yet, which was expected.
5. **Utilized AI for assistance**: I leveraged AI tools to act as a senior full-stack engineer to assist in understanding the requirements, data structures, and to provide guidance on implementing the solution effectively. Breaking down the tasks and giving me a clear picture of where the codebase is at and what needs to be done.
6. **Understand & Test the API endpoints**: I used Postman to test some of the API endpoints provided by the retailers to ensure that I could successfully retrieve the plans and their details, and to understand the structure of the responses.
7. **Skimmed through the DATA_DICTIONARY.md & https://consumerdatastandardsaustralia.github.io/ page**: I reviewed the data dictionary and the Consumer Data Standards Australia documentation to ensure I had a clear understanding of the data formats, naming conventions, and any specific requirements for handling the data. A little bit of exploration to get a clearer picture of the data that I will be dealing with. Read through the schema and response examples to handle the data cleanly, implement the filtering, and error handling effectively.

## My thought process and approach to the solution:
I drew this simple flow chart to show my thought process and approach to the solution:

```text
Load household data
        │
        ├── usage
        ├── service points
        └── retailers
        │
        ▼
fetchPlans()
        │
        ├── fetch retailer plan lists
        ├── handle pagination
        ├── fetch detailed plan pricing
        └── filter plans for the household
        │
        ▼
Detailed applicable energy plans
        │
        ▼
estimatePlanCosts(input)
        │
        ├── Prepare household information
        │       ├── identify household distributors
        │       ├── identify normal import records
        │       ├── identify controlled-load records
        │       └── identify solar-export records
        │
        ├── Map over every plan
        │       │
        │       ├── Check whether the plan is applicable
        │       │       ├── ELECTRICITY
        │       │       ├── RESIDENTIAL
        │       │       ├── active plan
        │       │       └── matching distributor
        │       │
        │       ├── If not applicable
        │       │       └── annualCostAud = null
        │       │
        │       └── If applicable
        │               │
        │               ▼
        │       calculateAnnualPlanCost()
        │                 │
        │                 ├── Reject demand-charge plans
        │                 ├── Validate tariff and supply charge
        │                 ├── Count observed days
        │                 ├── Calculate normal usage cost
        │                 │     ├── Single-rate
        │                 │     └── Time-of-use
        │                 ├── Calculate controlled-load cost
        │                 ├── Calculate solar credit
        │                 ├── Add GST
        │                 ├── Subtract solar credit
        │                 └── Annualise the result
        │
        ├── Return one result per plan
        │
        └── Sort applicable, costable plans cheapest-first
        │
        ▼
Return ranked plan recommendations
        │
        ├── planId
        ├── planName
        ├── brandName
        ├── applicable
        └── annualCostAud
```

### Annual Cost Formula

```text
Observed cost =
  (
    normal import usage cost
    + controlled-load cost
    + daily supply cost
  )
  × GST
  − solar feed-in credit

Annual cost =
  observed cost × 365 / observed days
```

## Development Process & Decisions

I broke down the development process into several key decisions and steps, which are documented below:

### Development 1: Fetching Plans from Retailers
- **Decision**: Implement the `fetchPlans` function to retrieve plans from the provided retailers.
- **Rationale**: This is the first step in the process, as we need to gather all available plans to filter and compare them against the household's current plan.
- **AI Hand-off**: I used AI to generate the fetchPlans.test.ts file. Understood the need to call the fetchPlanDetails function concurrently to avoid long wait times, hence directed AI to assist me with the mapWithConcurrency function to handle concurrent requests efficiently.
- **Implementation**: I built the function as a four-stage pipeline — derive the household's distributor, list every retailer's plan IDs, fetch the detail for each ID, then filter down to what actually applies. The stages below record the decisions worth justifying.

  **1. Keeping the HTTP separate from the filtering.** The brief calls this out, and it drove the file's structure. `fetchJson`, `listAllPlanIds` and `fetchPlanDetail` do the I/O; `isPlanApplicable` and `isPlanActive` are pure functions that take a plan and a date and return a boolean. That split means the eligibility rules — the part most likely to be wrong — are unit-tested directly against hand-built plans with no network and no mocking, while the HTTP layer is tested separately against a stubbed `fetch`.

  **2. Narrowing server-side, but not trusting it.** The list request sends `fuelType=ELECTRICITY`, `effective=CURRENT` and `page-size=100` so that retailers with 1000+ plans don't turn into 1000+ detail requests. I still apply the full eligibility filter client-side afterwards, because a retailer that ignores or partially honours those query parameters would otherwise silently leak gas or expired plans into the comparison. The query parameters are an optimisation; the filter is the guarantee.

  **3. Pagination and de-duplication.** `listAllPlanIds` loops until `page >= meta.totalPages`, and treats a missing, non-numeric or less-than-one `totalPages` as "stop" rather than looping forever on a malformed response. IDs collect into a `Set`, so a plan appearing on two pages — which can happen if the retailer's catalogue shifts between page requests — produces one detail call, not two. De-duplication is per retailer, since CDR plan IDs are only unique within a retailer.

  **4. Bounded concurrency.** Fetching details serially is too slow across ten retailers, and firing every request at once is both rude to a public endpoint and a good way to get rate-limited. `mapWithConcurrency` runs a fixed pool of `DETAIL_CONCURRENCY` (5) workers pulling from a shared cursor, so a slow request never blocks the queue behind it the way fixed batching would, and the retailer never sees more than five in-flight requests from us.

  **5. Failure isolation at two levels, and where I chose to stop.** A single failed plan detail is logged and skipped — one bad plan should not cost us the other 999 from that retailer. A single failed retailer is contained by `Promise.allSettled`, so nine retailers still produce a comparison. But if *every* retailer fails I throw rather than return `[]`, because an empty array is indistinguishable from "no plans suit this household" — that would present a total outage to the user as a legitimate answer. The same reasoning applies to a household with no LNSP participant: without a distributor there is no eligibility rule to apply, so I fail loudly instead of returning plans I cannot vouch for.

  **6. Eligibility rules.** A plan is kept if it is `ELECTRICITY`, `RESIDENTIAL`, active today, and lists a distributor matching the household's LNSP. Three details were worth deciding explicitly:
    - *Distributor matching is normalised.* The LNSP arrives from Fiskil as `"CitiPower Pty"` while plans publish `"CITIPOWER"`, so `normaliseDistributor` strips legal suffixes and punctuation before comparing. A raw string comparison would drop every valid plan.
    - *Dates compare as `YYYY-MM-DD` strings.* `effectiveFrom`/`effectiveTo` arrive as either bare dates or full timestamps, so I take the date part and compare lexically. This avoids converting to `Date` and having a UTC/local shift change which plans look active near midnight. Both bounds are inclusive.
    - *Ambiguity fails closed.* A plan with an unparseable date, or with no `geography` at all, is excluded rather than assumed current or assumed nationwide. Recommending a plan the household cannot actually buy is a worse failure than omitting one they could.

  **7. Evaluating "today" once per run.** `asOfDate` is computed once in `fetchPlans` and threaded through the filter, rather than each call reading the clock. A long run that crosses midnight would otherwise apply two different dates to different plans in the same result set.

  **8. No HTTP library.** I used the platform `fetch` rather than adding axios. Node 20+ has `fetch` globally, the only things axios would add here are JSON parsing and throwing on non-2xx — about six lines that `fetchJson` already covers — and it would have been the project's first runtime dependency. Using `fetch` also let me test the HTTP layer by stubbing `globalThis.fetch` and asserting on real `Response` objects and headers, rather than mocking a library's internals.

- **Known gaps**: `fetchJson` has no request timeout, so a retailer that accepts a connection and never responds would stall that retailer indefinitely (`fetch` has no default timeout). There is also no retry, so a transient 429 or 503 costs us that retailer's plans for the run. Both are fixable without a new dependency — `AbortSignal.timeout()` and a small backoff loop honouring `Retry-After` — and are the first thing I would add next.

### Development 2: Estimating Plan Costs
- **Decision**: Implement the `estimatePlanCosts` function to calculate the annual cost of each applicable plan based on the household's electricity usage and the plan's pricing structure.
- **Rationale**: After fetching the applicable plans, we need to estimate the annual cost for each plan to provide a ranked list of recommendations for the household. This step is crucial for comparing the plans and determining which one offers the best value based on the household's electricity usage.
- **AI Hand-off**: I used AI to generate another estimatePlanCosts.test.ts file. I provided the AI with the requirements and the expected calculations, and it helped me outline the key steps and calculations needed to implement the function correctly. 
- **Implementation**: The function will take the household's electricity usage and the plan's pricing structure as inputs, and calculate the total annual cost by applying the relevant rates and fees. The calculation will consider factors such as fixed charges, usage charges, and any applicable discounts or incentives. The function will return a list of plans with their estimated annual costs, which can then be sorted to provide the final recommendations. What I need to implement (key calculations and implementations) include:

        1. Calculate imported electricity: Sum the positive imported kWh from normal and controlled-load usage records.
        2. Calculate exported electricity: Sum the solar-export kWh, converting negative B1 interval values into positive export quantities.
        3. Calculate usage charges: Apply the appropriate pricing model to imported electricity:
          a. single-rate pricing;
          b. time-of-use pricing based on each interval’s day and time;
          c. controlled-load pricing where applicable.
        4. Calculate supply charges: Multiply each applicable daily supply charge by the number of observed usage days.
        5. Apply GST: Apply the 1.1 GST multiplier to usage and supply charges.
        6. Calculate the solar feed-in credit: Apply the relevant flat or time-varying feed-in tariff to exported electricity. Do not apply GST to the feed-in credit.
        7. Calculate the net observed cost: Net cost = (usage charges + supply charges) × 1.1 − solar feed-in credit
        8. Annualise the result: Scale the observed-period cost to 365 days when the provided usage period is shorter than one year.
        9. Handle missing pricing safely: Return annualCostAud: null when a plan cannot be reliably costed, rather than returning zero or throwing an error.
        10. Return all plan results: Return one identified result for every supplied plan, including applicable and inapplicable plans.
        11. Rank the plans: Sort applicable plans with numeric annual costs from cheapest to most expensive.

### Development 3: Calculating Current Energy Costs
- **Decision**: Implement the `calculateCurrentEnergyCosts` function to calculate the current energy costs for the household based on their existing plan and usage data.
- **Rationale**: This function is necessary to provide a baseline for comparison against the fetched plans. By calculating the current energy costs, we can determine how much the household is currently spending and how much they could potentially save by switching to a different plan. This will help in making informed recommendations for the household. Public holidays are billed at ordinary rates (no holiday calendar), and the plan's conditional fees — disconnection, card processing, paper bill — are excluded deliberately.
- **Implementation**: The function will take the household's current plan and usage data as inputs, and calculate the total energy costs based on the existing rates and fees. The calculation will consider factors such as fixed charges, usage charges, and any applicable discounts or incentives. The function will return the total current energy costs, which can then be compared against the estimated costs of the fetched plans to provide a comprehensive analysis for the household. The implementation will follow similar steps as the `estimatePlanCosts` function, but will use the current plan's pricing structure instead of the fetched plans.

### Development 4: Recommending a plan — joining the two cost goals
- **Decision**: Add `recommendPlan`, which sets the household's current annual cost against every plan I can cost and reports the single best switch and what it saves.
- **Rationale**: The brief asks for the saving *versus what they pay today*, so the two cost goals only answer the question once something joins them. Keeping that join in its own function meant neither cost engine had to know about the other.
- **Implementation**: The five decisions worth defending:
  - **Plans are passed in, not fetched.** `recommendPlan` takes an array of plans rather than calling `fetchPlans` itself, so the whole recommendation runs against the recorded snapshot in tests with no network.
  - **Annual is compared against annual.** Both sides are scaled from the same 318 days of meter reads. Comparing the observed "spent so far" figure against an annual plan cost would have invented about $190 of saving out of nothing but the length of the usage window, so there is a test pinning it.
  - **No recommendation when nothing beats the current plan.** `recommended` is null rather than the cheapest-available, because the cheapest plan on the market is not advice if the household is already on it.
  - **Rank is derived from cost, not by lookup.** The current plan's position comes from counting plans cheaper than it, rather than finding it in the CDR feed — the household's own retailer may not publish it.
  - **A materiality floor of $30/year.** Below that the saving is reported with a note that it is closer to break-even. The costing reconciles to 0.57% against their invoices, but the usage window omits deep winter, so presenting a $12 difference as a reason to switch would overclaim.
- **Result**: Origin Go Variable at $1,474.30/yr against HomeDeal Smart — Time of Use at $1,269.62/yr: **$204.68/yr saved (13.9%)**, with the current plan ranking 87th of 207 costed plans.
- **Honesty about coverage**: the output states how much of the market it could not compare — 31 applicable plans excluded, 19 for demand charges and 12 for time-varying feed-in tariffs. A recommendation drawn from 85% of the market without saying so would be worse than one that admits the gap.
- **What I would do next**: the two cheapest results are the same product with and without controlled load, at the same price. This household has no controlled-load register, so the variant is noise in the list; dropping controlled-load plans when the household has no such usage would tidy it.
---

## Frontend Development

The engine answers the question; the UI has to make someone act on it. This section covers the tooling decisions taken to get there, and the judgement calls inside the interface itself.

### Restructuring into a monorepo

The exercise ships as a flat library — `src/`, `scripts/`, `user_data/` at the root. Adding a web app to that root would have meant one `package.json` carrying both `vitest` and `next`, and one `tsconfig.json` trying to serve Node ESM and a JSX bundler at once. Those two things want genuinely different compiler settings, so I split them:

```text
apps/web/          Next.js UI              @solvingzero/web
packages/core/     the cost engine         @solvingzero/core
```

The engine moved wholesale into `packages/core` — source, scripts, tests, and its data fixtures (`user_data/`, `retailers.json`) — so the package is self-contained and never reaches outside its own directory for data. `loadData.ts` resolves paths relative to its own module, so the move needed no code change.

**The one constraint I held onto**: `pnpm test`, `pnpm verify` and `pnpm typecheck` still work from the repo root, because that is what the README tells a reviewer to run. They now delegate through Turborepo rather than running Vitest directly.

**Why Turborepo.** With two packages there is a real build order — the web app can't typecheck until the engine has emitted its declarations. Turborepo's `dependsOn: ["^build"]` expresses that once, in `turbo.json`, instead of me remembering to build core first. Caching is a secondary benefit at this size, though `typecheck` and `test` replaying from cache does make the loop noticeably tighter.

**Why the engine is compiled rather than consumed as source.** Turborepo's docs favour "just-in-time" packages that export raw TypeScript, and it is less setup. I built `packages/core` to `dist/` instead, because the engine's imports carry explicit `.js` extensions (Node ESM style) and relying on a bundler to resolve those back to `.ts` is a subtle failure mode I did not want between me and the UI. Compiling also forces the package to declare a real public surface, which is `src/index.ts` — the web app can import `recommendPlan` and cannot reach into `src/utils/helpers.ts`.

### npm → pnpm

The repo started on npm and I moved it to pnpm once the second package existed.

- **Disk and install time.** pnpm's content-addressed store hard-links packages instead of copying them. With Next, React, recharts and shadcn's dependency tree duplicated across two workspaces, that is a meaningful difference on every install.
- **`workspace:*` is explicit.** `"@solvingzero/core": "workspace:*"` cannot silently resolve to something from the registry. Under npm's `*` it could, if a package of that name ever existed publicly.
- **Strict `node_modules` by default.** pnpm won't let a package import a dependency it hasn't declared. That caught nothing here, but it is the class of bug that only surfaces in someone else's checkout.

**The cost, honestly**: a reviewer now needs pnpm rather than the npm they already have, and `packageManager` in the root `package.json` pins the version. For a take-home that is a small extra hurdle, and I judged the workspace ergonomics worth it. `corepack enable` is enough to get it.

### Next.js and shadcn/ui

**Next.js** because the goal guide names it, and because the App Router lets the engine run where it already works. `recommendPlan` reads fixtures off disk and calls ten CDR endpoints — that is server work, and a server component calls it directly with no API route in between. The one configuration this needs is `serverExternalPackages: ["@solvingzero/core"]`: bundling the package would rewrite `import.meta.url` and break the on-disk paths its loaders depend on.

**shadcn/ui** because it is copied into the repo rather than installed as a dependency. Every component lands in `components/ui/` as editable source, so restyling `Card` to carry the brand shadow was an edit, not a battle with a library's theming API. Tailwind v4's `@theme` then carries the palette as tokens.

**The costing is slow and that shaped the page.** A cold run is ~25 seconds — 223 plan details across ten retailers. Options were to fetch on every request (unusable), fetch at build time only (stale), or cache. The route uses `export const revalidate = 3600`: rendered once, refreshed hourly in the background, instant for the visitor. Retailers republish pricing far less often than hourly, so the staleness is theoretical. **The trade-off is that `pnpm build` now needs network access and takes ~25 seconds longer**, because the page is prerendered. A `<Suspense>` boundary around the data-dependent subtree keeps the shell instant when the page does render on demand.

### Interface decisions

- **The saving leads.** The primary insight is one number — *"Save $205 a year"* — at the top left, with the working beside it. Everything below exists to justify that number rather than compete with it.
- **Charts start at zero.** The bar chart comparing today against the best plan, and the ranked bars in the alternatives list, both scale from zero. A truncated axis would turn a 14% difference into a visual chasm; on a page whose job is telling someone how much they would save, that is the line between informing and overselling.
- **Bar length and bar colour encode different things.** In the alternatives list, length is zero-based against the biggest saving, so it is honest about magnitude. Colour ramps green → amber *relative to this list*, which is what separates plans that sit within a few dollars of each other. The ramp is suppressed entirely when every plan falls within the materiality threshold, so a trivial spread is never dressed up as a meaningful one.
- **The method is on the page, not in this document.** A "How we cost a plan" card carries the formula and the seven steps as a carousel. A saving figure the household cannot interrogate is one they will not act on.
- **Brand colours were taken from the source, and corrected.** solvingzero.com publishes its palette as `--chakra-colors-landing-*` tokens; I converted them to oklch rather than eyeballing screenshots. Their signature green `#40ab6d` fails WCAG AA as text (2.89:1), so green *type* uses their own darker `#1f7a44` (5.35:1) while fills keep the brighter green with ink text on top.

### What I would do next

- **`RankedPlanCost.breakdown` is declared but never populated**, so the comparison chart can only plot totals. Threading the per-component figures the engine already computes in `ObservedPlanCost` through `estimatePlanCosts` would allow a stacked usage/supply/solar comparison.
- **The materiality threshold is duplicated.** `recommendPlan` takes `materialSavingAud` (default 30) as an input but does not publish it on the result, so the UI restates the constant. Exposing it on `PlanRecommendation` would remove the drift risk.
- **No frontend tests.** The engine has 127; the UI has none. Nothing checks that the methodology copy still matches what `calculateAnnualPlanCost` does — that coupling is prose against code, and it will rot silently.
- **No loading state is ever seen in production.** Because the route prerenders, the skeleton only appears in development. It is built and correct, but effectively untested by real use.

---

## Testing

`pnpm test` — **127 tests across 5 files, all passing.** `pnpm typecheck` is clean.

| File | Tests | What it covers |
| --- | ---: | --- |
| `src/estimatePlanCosts.test.ts` | 8 | The supplied contract test, unmodified — GST, solar credit, midnight-wrapping time-of-use, ranking. |
| `src/estimatePlanCosts.extra.test.ts` | 38 | My own cost-engine tests: controlled load, tiered blocks, annualisation, robustness, and the recorded snapshot. |
| `src/fetchPlans.test.ts` | 26 | Eligibility filtering, and the CDR wire contract against a stubbed `fetch`. |
| `src/calculateCurrentEnergyCosts.test.ts` | 40 | Plan selection, the snake_case adapter, spend figures, and reconciliation against the real invoices. |
| `src/recommendPlan.test.ts` | 15 | Saving arithmetic, ranking, materiality, and the real household against all 249 snapshot plans. |

### How I approached testing

**I separated the pure logic from the I/O so the risky parts need no mocking.** `isPlanApplicable`, `priceTieredUsage` and `toCdrTime` are pure functions tested directly against hand-built inputs. Only `fetchPlans` needs a stub, and that stubs `globalThis.fetch` with a small fake CDR server rather than mocking a library — so the tests assert on real `Response` objects, real status codes and the real `x-v` headers.

**Expected figures are hand-computed from `DATA_DICTIONARY.md`, never read back off my own implementation.** A test whose expected value came from running the code only proves the code has not changed, not that it is right. Every cost fixture in `estimatePlanCosts.extra.test.ts` carries the arithmetic in a comment above it.

**Dates never depend on the clock.** Every eligibility test passes an explicit `asOfDate`, so nothing turns red when the calendar moves.

**I mutation-checked the tests that matter.** After writing the `fetchPlans` suite I deliberately broke the source four ways — removed the de-duplication `Set`, sent the wrong `x-v` version, ignored `meta.totalPages`, and re-threw instead of skipping a failed plan — and confirmed each one failed exactly the test aimed at it, then restored the file. I did the same when extending the demand-charge guard. A stub-driven suite can pass for the wrong reasons, and this is the cheapest way to find out that it does.

### Two tests doing unusual work

**Reconciliation against the real invoices.** `bills.json` breaks down into the same four components I compute, so I cost the usage over exactly the window the retailer billed and compare line by line:

| Line | Billed | Computed | Difference |
| --- | ---: | ---: | ---: |
| PEAK | $331.88 | $347.23 | +4.6% |
| OFF_PEAK | $440.91 | $431.60 | −2.1% |
| DAILY_SUPPLY | $339.43 | $339.45 | 0.0% |
| FEED_IN_CREDIT | −$47.28 | −$47.28 | 0.0% |
| **Total** | **$1,064.94** | **$1,071.00** | **+0.57%** |

Supply and feed-in match to the cent. Peak and off-peak each differ by a few percent but their sum agrees to 0.78% and the total kWh is identical — the boundary moves, not the energy, because the retailer applies the published `+10:00` windows while I read local wall-clock, which shifts an hour across daylight saving. The test asserts that direction explicitly, not just that the totals are close, so a change in window handling would say which way it moved.

**Tests against the 249-plan recorded snapshot.** The synthetic fixtures pin the rules; the snapshot pins them against shapes real retailers actually publish. This is what caught the demand-charge bug: my first guard checked `electricityContract.demandCharges`, which no real plan populates, while all 19 plans that carry a demand charge express it as a `tariffPeriod` with `rateBlockUType: "demandCharges"`. A purely synthetic suite would still be passing and the ranking would still be wrong at the top.

### What is not covered

- **No live network test.** `fetchPlans` is tested against a stub; nothing exercises the real retailer endpoints in CI. That is deliberate — the tests stay fast and offline — but it means a change to a retailer's response shape would not be caught here.
- **No test for the request timeout and retry**, because neither is implemented yet (see the known gaps under Development 1).
- **Seasonal tariff periods are untested** because they are unhandled: only `tariffPeriod[0]` is read, so a plan with summer and winter energy rates is costed entirely at the first season's prices. 19 snapshot plans have multiple periods, and all 19 are already excluded for carrying demand charges — so this does not currently affect any costed plan, but it would if a retailer published seasonal rates without a demand charge.
- **Public holidays** are billed at ordinary rates; there is no holiday calendar to test against.

---

## Scripts — how to run this yourself

Everything is runnable from the repo root. **Start with `scripts/test-recommend-plan.mts`** — it is the headline answer, and the other scripts are the pieces underneath it.

| Command | Network | What it shows |
| --- | :---: | --- |
| `pnpm verify` | no | Provided smoke test: toolchain works and the household data loads. |
| `pnpm test` | no | The full suite — 127 tests, all offline. |
| `pnpm typecheck` | no | `tsc --noEmit`. |
| `pnpm --filter @solvingzero/core exec tsx scripts/test-load-retailers.mts` | no | The 10 retailers and their CDR base URIs. |
| `pnpm --filter @solvingzero/core exec tsx scripts/test-load-customer-data.mts` | no | Raw usage and service-point records (verbose — mostly a sanity check that the loaders work). |
| `pnpm --filter @solvingzero/core exec tsx scripts/test-calculate-current-energy-costs.mts` | no | **What the household pays today.** Full JSON: usage-based spend, the billed figures, and the line-by-line reconciliation between them. |
| `pnpm --filter @solvingzero/core exec tsx scripts/test-fetch-plans.mts` | **yes** | Fetches every retailer's plans live, filters to the ones this household is eligible for, and lists them with their rate-block type. |
| `pnpm --filter @solvingzero/core exec tsx scripts/test-estimate-plan-costs.mts` | **yes** | Fetches live, costs every applicable plan, prints them all and names the cheapest. |
| `pnpm --filter @solvingzero/core exec tsx scripts/test-recommend-plan.mts` | **yes** | **The answer.** Today's cost, the best switch, the saving, where the current plan ranks, the cheapest alternatives, and what could not be compared. |

The three network scripts hit the public CDR endpoints (no auth, no keys). A full run takes about **30 seconds** — roughly 220 applicable plans, each needing a detail request, at five concurrent requests per retailer.

A reviewer with no network can still see all of it: `pnpm test` exercises the same code paths offline, including the recommendation end-to-end against the 249-plan recorded snapshot in `fixtures/`.

### Live vs snapshot

The recommendation is the same either way — **HomeDeal Smart – Time of Use, saving $204.68/yr** — which is a useful check that the snapshot tests are not passing on stale assumptions. The surrounding counts do drift, because the live CDR feed has moved since the snapshot was recorded: live returns 191 costable plans with 33 excluded (24 time-varying feed-in, 9 demand charge), where the snapshot has 207 costable and 31 excluded (12 and 19). Retailers add and withdraw plans continually, so exact counts in this document are point-in-time.
