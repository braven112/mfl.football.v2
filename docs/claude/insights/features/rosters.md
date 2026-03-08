## 2026-03-08 - Roster Page Secondary Tabs Should Warm After Primary Render

**Context:** Improving the `/theleague/rosters` page without regressing the fast in-page tab switching that makes roster, analytics, and planner comparisons feel good.

**Insight:** The main client bottleneck was not just the size of the route; `updateView()` was recalculating analytics charts, college/NFL grouping reports, planner metrics, and planner component datasets on every team switch even when the user stayed on the roster tab. Splitting that work into `renderAnalyticsForContext()` and `renderPlannerForContext()` and warming them with `requestIdleCallback` preserved instant tab switching while letting the roster table finish first.

**Evidence:** `src/pages/theleague/rosters.astro` now keeps roster rendering in `updateView()` and defers secondary work through `ensureSecondaryViewReady()` and `scheduleSecondaryWarmup()`. The same pass also removed an unused `PlayerNewsModal` payload from the page and replaced one-off eager feed globs (`playoff-brackets`, `draftResults`, `transactions`, `fetch.meta`) with direct `loadFeedJson()` reads.

**Recommendation:** Future roster-page work should keep the roster table and summary path separate from analytics/planner enrichment. If a new feature is hidden behind a secondary tab or modal, prefer lazy warming or on-demand rendering rather than recomputing it on every team change.
