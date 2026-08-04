<!-- @format -->

# Solution & Development Decision Log

This document is intended to capture the decisions made during the solution and development process. It serves as a reference for the team and stakeholders to understand the rationale behind key choices, ensuring transparency and facilitating future decision-making.

## Pre-development Process

### These were my steps taken before starting the development process:
1. **Understanding the Requirements**: I thoroughly read through the README.md and GOAL_GUIDE.md to understand the task requirements, the data provided, and the expected outcomes.
2. **Familiarization with the Data**: I reviewed the `retailers.json`, `service-points.json`, and the `DATA_DICTIONARY.md` to understand the structure and relationships of the data, as well as the specific fields that would be relevant for filtering and cost calculations.
3. **Went through the codebase**: I explored the existing code structure, including the stubs in `src/fetchPlans.ts` and `src/estimatePlanCosts.ts`, to understand where to implement the required functionality.
4. **Ran the verification and test scripts**: After reading the README.md, I executed `npm install` to setup the workspace, then ran the following commands of `npm run verify` and `npm test` to ensure that my development environment was correctly set up and that the existing tests were passing. At this point in time, I observed that `npm test` was failing due to the stubs not being implemented yet, which was expected.
5. **Utilized AI for assistance**: I leveraged AI tools to act as a senior full-stack engineer to assist in understanding the requirements, data structures, and to provide guidance on implementing the solution effectively. Breaking down the tasks and giving me a clear picture of where the codebase is at and what needs to be done.
6. **Understand & Test the API endpoints**: I used Postman to test some of the API endpoints provided by the retailers to ensure that I could successfully retrieve the plans and their details, and to understand the structure of the responses.
7. **Skimmed through the DATA_DICTIONARY.md & https://consumerdatastandardsaustralia.github.io/ page**: I reviewed the data dictionary and the Consumer Data Standards Australia documentation to ensure I had a clear understanding of the data formats, naming conventions, and any specific requirements for handling the data. A little bit of exploration to get a clearer picture of the data that I will be dealing with. Read through the schema and response examples to handle the data cleanly, implement the filtering, and error handling effectively.

## My thought process and approach to the solution:
I drew this simple flow chart to show my thought process and approach to the solution:

```
Load household data 
        ↓ 
fetchPlans() 
        ↓ 
Detailed applicable energy plans 
        ↓ 
estimatePlanCosts() 
        ↓
Retrieve annual cost per plan 
        ↓ 
Sort valid plans cheapest-first
        ↓
Return ranked plan recommendations
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