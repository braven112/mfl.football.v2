# League Planner Feature Insights

Feature-specific learnings from building the League Planner.

---

## 2026-02-23 - Planner Phase Year Resolution

**Context:** The planner phase utility needed to bridge the Dec → Feb year boundary.

**Insight:** `getCurrentSeasonYear()` has a year-boundary discontinuity (drops from N+1 to N at Jan 1) that makes it unreliable for determining which "offseason cycle" we're in. Instead, the planner phase utility computes the most recent championship date by trying `championship(calendarYear)` first and falling back to `championship(calendarYear - 1)` if it's in the future.

**Evidence:** `src/utils/planner-phase.ts:findMostRecentChampionship()`

**Recommendation:** When building features that span the Dec→Feb boundary, resolve dates directly from calendar year context rather than relying on `getCurrentSeasonYear()`.

---

## 2026-02-23 - Free Agent Needs Thresholds

**Context:** Evaluating team roster gaps for FA recommendations.

**Insight:** Thresholds are position-dependent:
- QB, TE, DEF, PK: need 1 player in top 8 at position
- WR, RB: need 2 players in top 16 at position

Rankings are based on MFL projected points (build-time). This is the most reliable build-time metric since custom rankings live in localStorage (client-side only).

**Evidence:** `src/utils/free-agent-needs.ts:POSITION_THRESHOLDS`

---

## 2026-02-23 - Pre-Rendered Per-Team Panels Pattern

**Context:** The planner pre-renders FA needs cards for all teams and toggles visibility on team switch.

**Insight:** This follows the same pattern as `data-assets-team-id` panels for draft assets. Pre-rendering avoids client-side rendering complexity. The data is small (5 players × 6 positions max per team) so HTML bulk is modest.

**Evidence:** `src/pages/theleague/rosters.astro` uses `data-fa-needs-team-id` attribute pattern.

---

## 2026-02-23 - CSS Order for Phase-Based Section Reordering

**Context:** Different offseason phases need different section ordering.

**Insight:** Used CSS `order` property on `[data-planner-phase]` attribute selector to reorder sections without JavaScript DOM manipulation. The `data-planner-phase` attribute is set at build time from `getPlannerPhase()`.

**Evidence:** Planner layout CSS in `rosters.astro` style block.
