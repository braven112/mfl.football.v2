---
slug: afl-recap-cast-week-scope
status: open
severity: P3
opened: 2026-09-15
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1085
hotfix_sha: 415bbf0ac2b15b82426c2299a9ef68f128689a3f
followup_issue: 1086
followup_pr:
followup_session:
---

# Follow-up: the AFL recap card labels one week and casts from another

Found during the cross-cutting pass on the #1086 F1/F3/F4 PR. Not a regression
from that PR — it is the AFL half of a mismatch that PR fixed on TheLeague side.

## The shape

TheLeague's `RecapCompositeHero` and the AFL's `slot:recap` both render the same
card: a week label over a deterministically-cast Top Scorer. Both now take their
WEEK from `getWeekInTheBooks`, which caps the feed's week at the calendar's last
completable one. Neither takes its SCORER from a week-scoped read by default —
`getWeeklyTopScorerCandidates` reads every scored row in `playerScores.json`,
and that feed holds whichever single week MFL currently considers live.

So when MFL rolls the feed before the Tuesday the slot runs, the label says
week N-1 and the cast comes from week N.

- **TheLeague: fixed.** `RecapCompositeHero.astro` now passes the capped week
  into `getWeeklyTopScorerCandidates(year, 'theleague', week)`, so a
  disagreement yields no candidates and the stub, rather than a wrong caption.
- **AFL: not fixed.** `src/utils/afl-hero-casting.ts:207` still calls
  `getWeeklyTopScorerCandidates(leagueYear, AFL)` unfiltered, while
  `afl-hero-resolver.ts:739` (`slot:recap`) captions with `recap?.week`.

## Why it was left

The AFL degrades gracefully where TheLeague did not. An unplayed week scores
0 for everyone, `getWeeklyTopScorerCandidates` drops any row with `score <= 0`,
so a rolled feed yields an EMPTY candidate list, `castBestScoredModel` returns
null, and the slot falls back to `headliner('Headliner')`. The card is then a
correct week label over a generic headliner — the descriptor silently changes
from "Top Scorer" to "Headliner", which is mildly off but never wrong data
under a wrong caption.

It is also not reachable on the schedule the slot actually runs: `getDailySlot`
returns `recap` only on Tuesday before 2pm PT, when week N has had no games. A
mid-week partial (some week-N scores present, which WOULD mis-caption) needs the
slot to render on a day it does not.

## The fix, when someone takes it

One line in the `case 'recap'` block of `castAflHeroModel`, passing a week into
the candidates call. The wrinkle to resolve first, and the reason this was not
done blind: the casting has `leagueYear` (the AFL LEAGUE year, which rolls
June 1) while the page derives the recap's week from `aflRecapSeasonYear`
(`getCurrentSeasonYear`, which rolls Labor Day). Those agree in season and
diverge Feb–May, so computing the cap inside the casting from `leagueYear`
would read one year's feed against another year's label. Either thread the
page's already-computed recap week through `AflCastingInput`, or establish that
the two years are the same on every path that renders this slot.

Note the same latent inconsistency already exists without this change: the cast
reads the `leagueYear` feed while the label's week came from the
`aflRecapSeasonYear` feed.

Guard to add with the fix: extend
`tests/offseason-hero-data.test.ts`'s week-scoping block to the AFL casting
path, or assert in `tests/afl-hero-casting.test.ts` that the recap cast and the
resolved `recap.week` name the same week.
