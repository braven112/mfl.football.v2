---
slug: salary-averages-doubleheader-double-count
status: shipped
shipped: 2026-09-16
severity: P2
opened: 2026-09-15
found_by: /live step 5b cross-cutting sweep on the Free Agents season-points PR
source_pr: https://github.com/braven112/mfl.football.v2/pull/1129
followup_issue:
followup_pr: https://github.com/braven112/mfl.football.v2/pull/1140
followup_session:
---

# Follow-up: `update-salary-averages.mjs` sums player points the doubled way

## Resolution (2026-09-16, PR #1140)

Shipped, and wider than this brief scoped. Two things turned out differently:

- **The damage was historical, not just going-forward.** Every season since 2007
  had at least three doubleheader weeks inside the week-1-14 window (2013 had
  eleven; this brief assumed "one late-season week"), and the inflated totals
  are DISPLAYED on the MVP page and drive the Dead Money and franchise-history
  awards. So the fix corrected all 44 committed salary files, proven
  doubling-only per file by `scripts/repair-salary-points-doubling.mjs`, and 11
  of 57 franchise-history awards changed winner — by explicit decision.
- **The P2 reasoning below was wrong about scale.** It is not "full-season
  players stay comparable": the doubleheader weeks differ by season, and within
  the window a full-season starter was inflated ~34% in 2024.

The fix itself is `scripts/lib/player-season-points.mjs`, keyed by
`(player, week)` as proposed below. A separate bug found during the repair is
filed as `2026-09-16-salary-freeze-before-week-scored.md`.

## What was found

The Free Agents points work established that **summing player scores across
`weeklyResults.matchup[].franchise[].player[]` double-counts in a doubleheader
week** — a franchise appears in two matchups, so the same performance is billed
twice. Measured against MFL's own `playerScores&W=YTD` totals for 2026 week 1,
all 260 of TheLeague's scored players came out at exactly 2x.

A sweep of every other consumer of that feed found one more place with the same
shape and no dedupe:

- `scripts/update-salary-averages.mjs:704` — `buildPlayerPoints()` accumulates
  `totals.set(id, (totals.get(id) ?? 0) + score)` straight into a Map keyed by
  player id only, with no week in the key.

Everything else checked out and is listed under "Not affected" below, so this
is the only known remaining instance.

## Why it was not fixed in that PR

It is one line, but its blast radius is not. `buildPlayerPoints` feeds the
committed `src/data/mfl-salary-averages-*.json` artifact, which drives the
`$ Value`, `Est. Cost`, `Steal` and surplus columns. Halving the points side of
every ratio moves numbers owners read as dollars, so it wants its own PR, its
own before/after diff of the generated artifact, and a look at whether any
downstream constant was tuned against the inflated figures.

## Why it is P2 and not P1

The distortion is **not** a clean uniform scale that cancels out. A doubleheader
is league-wide, so a player rostered all season is inflated by the same factor
as every other player rostered all season — but a player rostered for only part
of the year is inflated by a factor that depends on whether HIS weeks included
a doubleheader. Full-season players stay comparable with each other; partial
-season players are mispriced against them. That is a real skew, not a
cosmetic one, but it is not visibly wrong on screen the way a doubled points
column was.

## The fix

Key the accumulator by player AND week before totalling, which is what
`src/utils/afl-keeper-analysis.ts:305` already does correctly:

```js
perPlayerWeek.set(`${player.id}|${week}`, score);   // last write wins
// …then sum perPlayerWeek into totals
```

A Map keyed `id|week` makes a duplicate franchise entry an overwrite instead of
an addition. Note `buildPlayerPoints` already parses `weekNumber` for its
`maxWeek` cutoff, so the week is in hand.

Alternatively, read `playerScores&W=YTD` — now fetched and committed per league
year as `playerScores-ytd.json` — which is MFL's own total and needs no
summation at all. That is the better fix if the script only needs season totals.

## Verification

Regenerate the salary averages and diff the artifact. The tell that the fix
landed is full-season players moving by ~2x while partial-season players move
by less — if everything moves by exactly 2x, the doubleheader weeks were not
where you thought they were and the premise needs rechecking.

## Not affected (checked, 2026-09-15)

- `src/utils/afl-keeper-analysis.ts` — keys `perPlayerWeek` by `id|week`, so
  the duplicate overwrites. This is the pattern to copy.
- `src/pages/theleague/players.astro`, `src/pages/afl-fantasy/players.astro`
  (via `scripts/compute-afl-free-agents.mjs`) and
  `src/pages/theleague/projected-free-agents.astro` — points now come from
  `playerScores-ytd.json`; their remaining weekly sum feeds only `games`/`ppg`,
  a RATE, where the double appears in numerator and denominator and cancels.
- Every other `weeklyResults` reader found by the sweep consumes per-week or
  per-franchise values rather than accumulating a per-player season total.

## Context

`docs/claude/insights/features/free-agent-season-points.md` has the measurement
tables and the full reasoning.
