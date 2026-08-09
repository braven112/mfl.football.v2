# Keeper Report Card Insights

Feature knowledge for the AFL keeper hindsight-grading page
(`/afl-fantasy/keeper-analysis`, a Claude Schefter report), built August 2026.
Math lives in `src/utils/afl-keeper-analysis.ts` (pure, fixture-tested);
presentation in `KeeperAnalysisCard.astro`.

---

## 2026-08-09 - Keepers Have No MFL Construct; Reconstruction Is the Source of Truth

**Context:** The AFL keeps 7 players per franchise, but MFL has no keeper
feature for this league — keeps are implicit (whoever survives the offseason
cut). The Keeper Planner's Redis plans (`afl-keepers` hash) record *intent*,
not outcome, and only exist since the planner launched.

**Insight:** Actual keeps reconstruct exactly from committed feeds:
`kept(F) = prevYearRoster(F) ∩ curYearOpeningRoster(F) − curYearDraftPicks(F)`.
The opening roster for a completed season is week 1's `starters + nonstarters`
in `weekly-results-raw.json` (a full roster snapshot nobody thinks to look
for); pre-week-1 the current `rosters.json` works because it contains only the
7 keeps until the draft fills rosters. Verified: 2024→2025 gives 18/24 exactly
7 (the rest 6 — pre-week-1 drops are real; grade out of 6, no phantom miss),
2025→2026 gives 24/24 exactly 7. **The keeper era began with the 2024→2025
transition** — earlier cycles reconstruct to ~0 keeps (full redraft era), so
`AFL_KEEPER_ERA_FIRST_PREV_YEAR = 2024` gates the year selector.

## 2026-08-09 - Season Points Must Dedupe (playerId, week) — Duplicate Conferences

**Insight:** The AFL's AL/NL conferences draft from the same NFL player pool,
so one NFL player can be rostered by a franchise in EACH conference the same
week. Summing `weekly-results-raw.json` scores naively double-counts him.
`computeSeasonPoints` keys on `pid|week` before totaling. Also filter
`matchup.regularSeason === '1'` — the same file carries playoff weeks.

## 2026-08-09 - Grading Rules Are User-Decided Product Policy (Don't "Fix" Them)

**Insight:** Three rules came from explicit owner decisions backed by data
runs — they are not bugs to simplify away:
- **K/DEF dominance rule:** kickers/defenses are excluded from the optimal
  seven unless the position's league #1 finished 40+ points clear of #2.
  Without it, 61% of team-seasons (54/88 across 2020→2025) had a K/DEF in the
  raw top 7; with it, only the 2021 Patriots defense (49-pt gap) ever
  qualifies. Kicker gaps historically max out at 26.
- **One-QB cap:** only a roster's top-scoring QB is optimal-eligible
  (`MAX_OPTIMAL_QBS = 1`) — no team keeps two, so a backup QB is never a miss
  and never "got away."
- **Earned hits:** a kept K/DEF or backup QB that outscored the lowest-scoring
  optimal player the team did NOT keep grades as a hit (it beat the actual
  alternative), else neutral (`kdef-neutral`/`qb2-neutral`) — never a miss.
Invariant locked by tests: `hits + misses + kdefNeutralKept +
backupQbNeutralKept === keptCount`.

## 2026-08-09 - Pre-Season Default Is the Completed Cycle, Not the Empty One

**Insight:** Before week 1 the live cycle has zero points, so grades can't
exist; the page defaults to the newest cycle whose points season has actually
produced scores (`previewMode` = league-total points === 0 renders the live
cycle as a declared-keepers preview with no grades). Don't default to the
"current" year just because it's current — an empty report card is a worse
landing than last year's finished one.

## 2026-08-09 - PlayerCell Needs espnId Explicitly — mflId Alone Skips ESPN

**Insight:** `PlayerCell`'s headshot cascade only reaches ESPN when the caller
passes `espnId` (from the players feed's `espn_id` field, like rosters.astro
does). Passing only `mflId` silently degrades every avatar to MFL photo URLs.
When overlaying multi-year `players.json` files, keep the prev-year `espn_id`
when the newer record lacks one (retired players keep their headshots).
