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
