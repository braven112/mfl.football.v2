## 2026-08-27 - The Roster Page Shipped 320 Team-Seasons To Render One

**Context:** Starting the rosters.astro split (`docs/plans/rosters-page-split.md`).
The goal included "let users check other rosters really quickly", so the first
step was measuring what the page actually costs.

**Insight:** A single authenticated request returned **14.08 MB of HTML**, of
which **10.37 MB was the `#roster-config` JSON**. It carried all 20 seasons x 16
teams — 320 team-seasons — so that the season picker could switch without a
fetch. Nobody looks at 320 rosters; they look at one. Team switching *felt*
instant only because the entire cost had already been paid before first paint.

Three of its keys were byte-identical duplicates of data already in the same
payload, and all three were read only as fallbacks sitting *behind* the very
lookups they duplicated, so no consumer could reach them:

| key | size | duplicate of |
|---|---:|---|
| `adjustmentsBySeason` | 1,574 KB | `seasons[y].salaryAdjustments`, all 20 |
| `initialSeasonData` | 557 KB | `seasons[defaultSeason]` |
| `initialTeamData` | 35 KB | `seasons[ds].teams[dt]` |

The blocker to loading seasons on demand turned out to be dead code:
`createPlayerLookup()` walked all 320 team-seasons on init to build a
2,027-entry name map "for dead money", but its only reader was
`findPlayerData()`, which had no callers — `renderDeadMoney()` resolves identity
from the build-time enriched fields on each adjustment instead.

**Evidence:** 10.37 MB -> 1.17 MB (-88.7%); page HTML 14.08 -> 4.88 MB; gzipped
1.25 -> 0.45 MB. Only live (non-frozen) seasons ship inline; the rest come from
`/api/roster-season/[league]/[year]` with an idle prefetch after first paint.
Verified render-identical across 64 (season, team) pairs.

**Recommendation:** Never pre-resolve into the client config anything that is
already a key of `seasons`. When adding data to this page, ask whether it is
needed for the *current* view or only for a view the user may never open — the
second kind belongs behind the season endpoint or a dynamic import. And note the
general shape: the expensive thing was not slow code, it was correct code
operating on 320x the data anyone asked for.

## 2026-08-27 - A Parity Harness Needs A Decodable Placeholder Image, Not An Empty 200

**Context:** Building `scripts/roster-parity-check.mjs` so the rosters split
could be proven behavior-preserving. It drives a real browser, walks a
(season, team) matrix and fingerprints rendered output.

**Insight:** Three separate ways the harness lied before it was trustworthy, all
worth knowing before writing the next one:

1. **Text-only capture missed image URLs.** Swapping the function that builds
   headshot and crest URLs diffed completely clean. Fixed by fingerprinting
   `img` src attributes too (3,879 of them).
2. **A zero-byte placeholder image manufactured 291 phantom diffs.** Headshots
   carry an inline `onerror` cascade (ESPN NFL -> ESPN college -> MFL photo ->
   placeholder) that REASSIGNS `this.src`, which rewrites the attribute. An
   empty 200 fails to decode, fires the cascade, and makes the captured src a
   race against how far it walked. Serving a real 1x1 GIF made two runs of
   identical code produce identical fingerprints.
3. **The page keeps mutating after load.** `hydrateTeamFromSession()` awaits
   `/api/auth/session` and then re-selects the owner's team, so walking the
   matrix immediately after load captured a team the harness never asked for.
   Fixed with a `settle()` pass that polls a render signature until it stops
   changing — deliberately not `networkidle`, which the season prefetch keeps
   busy long after the page is visually done.

**Evidence:** `scripts/roster-parity-check.mjs`. 64 renders in ~23s. The
`--compare` mode diffs two fingerprints and fails on any new page error.

**Recommendation:** Before trusting any before/after harness, run it twice
against UNCHANGED code and require an empty diff. Every one of the three
problems above would have been read as a real regression — or worse, masked one.

## 2026-03-08 - Roster Page Secondary Tabs Should Warm After Primary Render

**Context:** Improving the `/theleague/rosters` page without regressing the fast in-page tab switching that makes roster, analytics, and planner comparisons feel good.

**Insight:** The main client bottleneck was not just the size of the route; `updateView()` was recalculating analytics charts, college/NFL grouping reports, planner metrics, and planner component datasets on every team switch even when the user stayed on the roster tab. Splitting that work into `renderAnalyticsForContext()` and `renderPlannerForContext()` and warming them with `requestIdleCallback` preserved instant tab switching while letting the roster table finish first.

**Evidence:** `src/pages/theleague/rosters.astro` now keeps roster rendering in `updateView()` and defers secondary work through `ensureSecondaryViewReady()` and `scheduleSecondaryWarmup()`. The same pass also removed an unused `PlayerNewsModal` payload from the page and replaced one-off eager feed globs (`playoff-brackets`, `draftResults`, `transactions`, `fetch.meta`) with direct `loadFeedJson()` reads.

**Recommendation:** Future roster-page work should keep the roster table and summary path separate from analytics/planner enrichment. If a new feature is hidden behind a secondary tab or modal, prefer lazy warming or on-demand rendering rather than recomputing it on every team change.

## 2026-03-08 - Demo Highlighting Must Stay Isolated From Real Eligibility

**Context:** Fixing the roster page when franchise `0001` was logged in and every player appeared highlighted, even outside the contract demo flow.

**Insight:** The page had two separate visual systems: mock/demo rows were supposed to use `roster-row--mock`, while normal eligibility wiring also added `player-cell__avatar--eligible` to any eligible roster row. That leaked demo-like emphasis into real roster views. The intended demo-only styling works best when mock players are explicitly tagged with `isMock: true` and normal eligibility logic stays functional without avatar glow.

**Evidence:** `src/pages/theleague/rosters.astro` now tags both `?testEligibility=true` fixtures and `buildDemoPlayers()` fixtures with `isMock: true`, and `applyEligibilityStyling()` no longer adds `player-cell__avatar--eligible` to live roster rows.

**Recommendation:** If future roster walkthroughs need extra visual emphasis, attach it to explicit demo/mock markers rather than auth state or generic eligibility checks. Keep real-owner flows limited to actionable controls like chips, buttons, and modal entry points.

## 2026-07-21 - Contract Demo Overlay Retired; Its JS Deliberately Remains Inert

**Context:** Disabling the "How It Works" contract-declaration walkthrough tab on `/theleague/rosters` after declaration season ended.

**Insight:** The overlay's DOM lives in `src/components/theleague/ContractDemoOverlay.astro`, but ALL of its interactivity (~500 lines: tutorial stepper, demo mode, mock player injection via `buildDemoPlayers()`) lives inline in `rosters.astro` and is fully null-guarded (`if (demoTrigger) ...`, `demoTutorial?.`). Removing just the component render + import disables the whole feature cleanly — the demo JS goes inert without its DOM and was intentionally left in place.

**Evidence:** Commit "Remove 'How It Works' contract demo tab from TheLeague rosters page" removed only the import and `<ContractDemoOverlay />` from `src/pages/theleague/rosters.astro`. The component file and the `cdemo-*` JS block (search `cdemo` in rosters.astro) remain.

**Recommendation:** To re-enable for next declaration season, re-add the import and render — nothing else. If instead the demo is ever removed for good, delete the component file, the `cdemo` JS block, `buildDemoPlayers()`, and the `window.__cdemoSetStep` export together. (Note: `__cdemoSetStep` is defined in rosters.astro but nothing calls it — the overlay's step-2 glossary link is wired by the component's own inline script, despite what the old comment next to the export claims.)
