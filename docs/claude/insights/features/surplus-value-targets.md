# Surplus Value & Free Agent Targets — Feature Insights

## 2026-02-28 - Phase 1: Surplus Value Calculator

**Context:** Building the foundational surplus value utility that converts projected fantasy points into dollar values, compares against likely auction costs, and produces surplus value per player. This is Phase 1 of the Dynasty Value Analysis system.

**Architecture decisions:**

1. **Pure functions only** — `src/utils/surplus-value.ts` has zero side effects. All data passed as arguments, returns arrays. Same pattern as `salary-calculations.ts`.

2. **Points-per-dollar baseline** — Uses all rostered players with projections AND salary > 0 to establish conversion rate. Excludes $0 salary players (practice squad) and players with no projections.

3. **Cost estimation requires rank signals** — `estimateAuctionCost()` uses `customRank` (primary) or `adpDynasty` (fallback) to place players on an exponential decay multiplier curve. Without either signal, players default to rank 999 which hits the minimum floor ($425K → rounds to $600K after the $50K rounding). This is by design — surplus values improve as more data becomes available.

4. **ADP data is seasonal** — The 2026 dynasty ADP data has zero drafts immediately after league year rollover (Feb 14). Costs will be more accurate once MFL draft data populates. Custom rankings (via the rankings import system) provide the best signal.

5. **Cost clamping** — Floor at `LEAGUE_MINIMUM` ($425K), ceiling at `positionSalaryAvg.top3Average * 1.2`, rounded to nearest $50K.

**Key files:**
- Types: `src/types/surplus-value.ts`
- Utility: `src/utils/surplus-value.ts`
- Tests: `tests/surplus-value.test.ts` (32 tests)

## 2026-02-28 - Phase 2: Free Agent Targets UI

**Context:** Admin-only "Targets" view on the Free Agents page (`/theleague/players`) that ranks free agents by surplus value.

**Integration pattern — CustomEvent communication:**

The targets module script communicates with the inline `define:vars` script via CustomEvents, following the same pattern as the rankings integration:

- `targets:set-available` — Module → Inline: signals that targets data loaded, toggle bar should show Targets button
- `targets:activate` — Module → Inline: switch view to targets (hide main table, show targets section)
- `targets:deactivate` — Module → Inline: switch back to stats view
- `targets:get-position` — Module → Inline (synchronous): reads current position filter tab

**Why this pattern:**
- Inline scripts (`define:vars`) can't import modules. Module scripts can't access inline script variables.
- CustomEvents bridge the gap cleanly with zero coupling.
- The inline script owns view state (`activeView`, `hasTargetsAvailable`) and the toggle bar rendering.
- The module script owns data loading, rendering, sorting, and admin gating.

**Admin gating:**
- Build-time: Surplus values computed for ALL players (data is in the HTML as `<script type="application/json">`)
- Client-side: `isAdminFromCookie()` checks `theleague_team_pref` cookie for `franchiseId === '0001'`
- If not admin, `initTargets()` returns immediately — button never shown, section never visible
- The prerendered page includes the data but non-admins never see the UI

**Gotcha — view toggle conflicts:**
- `applyGroupVisibility()` in the inline script controls toggle bar visibility
- It must check BOTH `hasRankingColumns` (from rankings module) AND `hasTargetsAvailable` (from targets module) to decide whether to show the toggle bar
- Button active states must loop through all three groups: 'stats', 'rankings', 'targets'
- When targets view is active, hide: main table wrapper, show-more wrapper, table controls. Show: targets section.

**CSS approach:**
- `src/styles/free-agent-targets.css` — standalone file imported in players.astro
- Surplus color coding via CSS custom properties (`--surplus-positive: #059669`, `--surplus-negative: #dc2626`)
- Surplus bars use percentage width with green/red color variants
- Mobile card layout at `max-width: 640px` transforms table rows into stacked cards

**Testing note:**
- Preview browser doesn't persist cookies across reloads (ephemeral context)
- To test admin features in preview: set cookie via JS eval, then dispatch `targets:set-available` event manually
- Full module initialization requires the cookie at DOMContentLoaded time
