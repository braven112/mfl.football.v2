# Two full-pool weekly-score feeds, built independently, both live

**Filed:** 2026-09-18, by `/release-review` for the 2026-09-18 promotion.
**Source:** surfaced by the main→staging merge-down on 2026-09-18 (`d7b0b61`).
**Bucket:** follow-up. Both are correct and both are load-bearing; this is a
cost and coherence problem, not a defect.

## What happened

`weekly-results-raw.json` is MFL's weeklyResults export, which lists a
franchise's ACTIVE LINEUP only — so free agents, practice squad and IR are
structurally invisible in it. Two features hit that wall in the same week and
each solved it from scratch, on different branches:

| | staging's | main's |
|---|---|---|
| Writes | `player-scores-weekly.json` | `playerScores-by-week.json` |
| Shape | array of week records | `{ weeks: { week: { playerId: score } } }` |
| Helper | inline in `scripts/fetch-mfl-feeds.mjs` | `src/utils/player-week-scores.mjs` |
| Week range | from `league.json` `startWeek`/`endWeek` | all 18, merge-never-replace |
| For | Top Players (#1143) | the player modal full-pool fix (#1150) |

Consumers today:

- `player-scores-weekly.json` → `scripts/compute-top-players.mjs`,
  `TopPlayersPage.astro`, a prebuild step, `tests/top-players-data.test.ts`
- `playerScores-by-week.json` → `weekly-player-results-feed.ts`,
  `players.astro`, `rosters.astro`, `front-office/projected-free-agents.astro`,
  `tests/weekly-player-results-full-pool.test.ts`

Each has a guard test that greps `scripts/fetch-mfl-feeds.mjs` for its OWN
`writeOut` call, so neither could be dropped during the merge.

## The cost

`scripts/fetch-mfl-feeds.mjs` now runs two per-week loops over MFL's
playerScores for every league, every sync — roughly double the per-week
requests for one underlying dataset, on a cron that already runs often.

## Why it was deferred

Merge day is the wrong time to pick a winner between two shipped features with
two live consumer sets and two guard tests. Keeping both was the only
resolution that left production and the queued feature working.

## Done looks like

One fetch loop and one stored shape, with the other exposed as a derived view
so neither consumer set has to change at once. `player-week-scores.mjs`'s
merge-never-replace semantics (empty week refused, shrink floor) is the better
foundation of the two — it already handles MFL answering an unplayed week with
a blank placeholder row at HTTP 200. Retire the loser's `writeOut` and its
guard line together, or the guard will block the cleanup.
