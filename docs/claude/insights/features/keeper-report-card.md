# Keeper Report Card Insights

Feature knowledge for the AFL keeper hindsight-grading page
(`/afl-fantasy/keeper-analysis`, a Claude Schefter report), built August 2026.
Math lives in `src/utils/afl-keeper-analysis.ts` (pure, fixture-tested);
presentation in `KeeperAnalysisCard.astro`.

---

## 2026-08-10 - Points Over Replacement Replaced By Fixed Backup Credits (Owner Decision)

**Context:** One day after the PoR rewrite shipped, the owner reviewed the
page and couldn't follow the grading anymore ("I don't understand how it
works now"). A metric the league can't hold in its head fails at its actual
job, however principled the math. **This is user-decided product policy —
don't "fix" it back.**

**Insight:** The value model is now raw points with fixed backup discounts,
in `keeperValue` + `BENCH_CREDIT` (`afl-keeper-analysis.ts`):

- A **starter** counts his full season points.
- A **backup QB / PK / Def** counts **1/10** of his points (the starter's
  bye plus a few matchup calls).
- A **flex backup** (7th RB/WR/TE keep) counts **7/10** (he rotates in
  across six starters' byes and matchups).
- A third QB / eighth flex still counts 0 (`selectBestKeepers`' starters+1
  group cap, unchanged).

A **hit** = kept one of the lineup-legal seven with the most points valued
this way — "you picked the player who scored the most and you could have
started him." Everything structural from the PoR era survives: exact
per-group-count selection, hit/miss/filler partition (`hits + misses +
fillerKept === keptCount`), miss-only-when-someone-got-away, efficiency ≤ 1
by construction, ranking on share of own ceiling. What's gone: replacement
levels, the conference-sized pool (`teamsPerPool`), the `playerScores-ytd`
feed (fetch entry removed from `fetch-mfl-feeds.mjs` — it existed solely
for replacement level), mid-season bench proration (a fixed share of
accrued points needs none), and the estimated-baseline page banner.

Expect kickers/defenses to appear in optimal sevens on raw totals now (a
120-point PK outranks a 110-point WR at his own slot) — that is intended
under this model, not a regression.

## 2026-08-09 - Official Keepers Come From Post-Deadline Roster Snapshots (When They Exist)

**Insight:** Between the July 15 keeper cut deadline and the late-August
conference drafts, a franchise's MFL roster IS its keeper class — so the
daily `roster-history/rosters-<date>.json` snapshots contain the OFFICIAL
keeper list, no inference needed. But the cuts process over several days
after the deadline (2026: 10/24 franchises at 7 on the 15th, 19/24 on the
16th, 24/24 on the **17th**), so the rule is "first snapshot on/after July
16 where EVERY franchise has exactly `KEEPER_LIMIT` players"
(`resolveOfficialKeepers`), not a fixed date. The page globs only the
July 16–31 window (~260KB/year — bundle-safe) and falls back to
reconstruction when no snapshot qualifies. The snapshot archive only
began November 2025, so 2024→2025 always reconstructs. Cross-validated on
2026: the official July-17 list and the reconstruction agree exactly,
24/24 franchises. Official keeps are intersected with the prev-year
roster (an offseason-trade-in isn't a hindsight call about YOUR roster).

## 2026-08-09 - Keepers Have No MFL Construct; Reconstruction Is the Fallback Source

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

**Playoff contamination gotcha (found by /live review):** filtering matchups
is NOT enough. Playoff weeks list eliminated franchises in a top-level
`weeklyResults.franchise` array (outside any matchup) WITH real player
scores — 2025's week 17 carries six of them. Top-level blocks are legit on
regular-season bye weeks, so gate them on the week being a regular-season
week (≥1 non-`regularSeason:'0'` matchup, or no matchups at all). Ungated,
102 players' totals inflated, two grades flipped, and `maxCompletedWeek`
read 17 on a 14-week regular season. Any script summing these feeds by hand
(research one-offs included) has the same trap.

## 2026-08-10 - SUPERSEDED: The Four Special Cases Became One Metric (Points Over Replacement)

> **SUPERSEDED same day by the fixed-backup-credit rewrite above.** PoR
> lasted one review: technically sound, illegible to the league. Kept for
> the data runs and the structural pieces that survived it (exact
> selection, the miss/filler partition, efficiency bounded by
> construction, ceiling-share ranking).

**Context:** The rules recorded in the next entry ("Grading Rules Are
User-Decided Product Policy") were each hand-approximating the same thing —
that raw fantasy points overstate what a keeper decision actually bought. All
four were replaced. **Do not reinstate them.**

**Insight:** Value is `starts × (points/seasonWeeks − replacement_rate)`, and
the optimal seven is the value-maximising lineup-legal set (1 QB / 1 PK / 1 Def
/ 6 flex from RB/WR/TE — from `league.json`'s `starters`). Each old rule
dissolves:

**Charge a FULL season, not weeks rostered.** An earlier version used
`replacement × weeksRostered`, which reduces value to
`weeks × (rate − replacement)` and lets a hot small sample beat a full-season
starter — Younghoe Koo (1 week, 9.7 points) made a real franchise's optimal
seven and rendered as a green "Got away" row, and 17 of 168 optimal slots went
to sub-8-week players. A keeper slot is a season-long commitment: if he missed
games, the hole is his cost to carry. `REPLACEMENT_MIN_WEEKS` guards the
*baseline* against churn; it does not guard the graded players.
- **K/DEF exclusion + 40-point dominance threshold** → gone. A kicker's raw
  total collapses toward replacement while a stud RB keeps most of his, so
  K/DEF compete on value instead of needing an escape hatch that never once
  fired. **Do NOT repeat the claim that this makes K/DEF rarer in optimal
  sevens** — an earlier version of this file said "4 of 24 under PoR vs 9 of
  24 on raw points," which was measured at `teamsPerPool = 24` and does not
  reproduce at the correct conference-sized pool. Re-measured 2024→2025 at 12:
  a PK appears in **11/24** optimal sevens and a Def in **10/24**. PoR prices
  K/DEF honestly; it does not banish them. Any figure quoted here must name
  the `teamsPerPool` it was measured at.
- **One-QB cap** → falls out of the lineup slots, and bench keeps are PRICED
  rather than zeroed. `BENCH_EXPECTED_STARTS` = 6 for FLEX, 1 for QB/PK/Def:
  a seventh skill player covers the bye of any of the six flex starters, a
  second QB only covers QB1's single bye. Treating both as zero (or equal)
  misprices the most common keeper decision on the board.
- **Earned hits for kept K/DEF / QB2** → gone with them.

New invariant: `hits + misses + fillerKept === keptCount` — with bench cover priced there
is no exempt category, which also retired two mislabelling bugs the old
slot-count check had (a 2nd QB graded `miss` when the whole QB room was below
replacement; a below-replacement keep was excused whenever its group happened
to be full). Efficiency is bounded ≤1 **by construction** (both sides use the
same selection over the same values, and kept ⊆ roster). Selection is EXACT,
not greedy: within a group, value depends only on how many you take, so
enumerating per-group counts is cheap and needs no matroid argument.

**Recommendation:** If a future request is "kickers shouldn't count" or
"backup QBs distort this," check whether PoR already handles it before adding
a rule. The whole point of the metric is that it needs no position policy.

## 2026-08-10 - Replacement Level Is Sized By CONFERENCE (12), Not The League (24)

> **SUPERSEDED by the fixed-backup-credit rewrite above** — there is no
> replacement level anymore. Kept because the conference-vs-league pool
> fact (two 12-team conferences rostering independently from one NFL
> universe) still governs any future per-pool math on this page.

**Context:** First PoR implementation used all 24 franchises as the pool.

**Insight:** The AFL is two 12-team conferences that roster **independently
from the same NFL universe** — the same player can sit on a roster in both at
once (which is also why `computeSeasonPoints` dedupes `pid|week`, and why the
free-agents page tracks availability per conference). A manager competes with
11 rivals for starters, not 23, so startable slots are `LINEUP_SLOTS[g] × 12`.
Using 24 put replacement roughly twice as deep and inflated every value over
it: 2025 baselines moved QB 11.19→19.59/wk and FLEX 1.83→11.03/wk, and the
grade spread went from 64–100% to 29–98%. A QB who scored 207 over 13 rostered
weeks is correctly **below** replacement in a 12-team league.

**Measured, not assumed:** the two conferences share ONE baseline on purpose.
273 of ~306 rostered players appeared in both conferences in 2025, and
computing replacement from either conference alone returns rates identical to
the merged pool at every slot. Splitting it per conference is a guaranteed
no-op. `teamsPerPool` is an input sized from the config's conference split, so
realignment needs no code change.

## 2026-08-10 - Ranking On Raw Totals Grades The Roster You Inherited

**Insight:** Whatever the value metric, ranking classes by *absolute* value
mostly measures roster quality, not decision quality — the optimal-seven
ceiling swings ~2.1x from the league's thinnest roster to its deepest, which
nobody chose. Ranking on raw kept points once labelled The Show the league's
worst keeper class for capturing 89% of a thin roster's ceiling (9th-best
decision-making), while a franchise that went a perfect 7-for-7 ranked third.
Rank on the **share of its own ceiling** a class captured; break ties on
absolute value captured, then franchise id for determinism.

## 2026-08-10 - A Rounded Display Can Hide A Broken Invariant

**Insight:** Boondock Saints sat at **100.49%** of optimal — kept value
genuinely exceeding their own ceiling — and the page rendered a tidy "100%"
because `Math.round` swallowed it. It was also deciding the #1 ranking, ahead
of a team that had kept a literally perfect seven. The bug had shipped and
looked fine.

**Recommendation:** When a metric has a name that implies a bound ("% of
optimal"), assert the bound in a test over the REAL committed feeds, not just
fixtures — `expect(f.efficiency).toBeLessThanOrEqual(1)` across every
franchise. Rounding hides violations exactly at the boundary where they matter.

## 2026-08-09 - Grading Rules Are User-Decided Product Policy (Don't "Fix" Them)

> **SUPERSEDED 2026-08-10 by the points-over-replacement rewrite above.**
> Kept for the data runs and reasoning, which explain why the rules existed.
> The rules themselves are gone — do not restore them.

**Insight:** Three rules came from explicit owner decisions backed by data
runs — they are not bugs to simplify away:
- **K/DEF dominance rule:** kickers/defenses are excluded from the optimal
  seven unless the position's league #1 finished 40+ points clear of #2.
  Without it, ~60% of team-seasons (53/88 across 2020→2025) had a K/DEF in
  the raw top 7; with it, no unit has ever qualified — closest was the 2021
  Patriots defense at 33. (An earlier "2021 Pats qualified at 49" figure was
  an artifact of the playoff-week contamination bug below.)
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
