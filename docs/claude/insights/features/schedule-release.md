# Schedule Release Day Insights

Feature: each league reveals next season's schedule on a fixed annual date —
The League June 1, the AFL the Sunday two weeks before its National League
draft. A cron locks the drawn schedule into
`data/<league>/schedule-release/<year>.json`; the reveal page shows a countdown
until then and the locked schedule after. Claude Schefter files a column and a
GroupMe post once the commissioner's paste actually lands in MFL.

Architecture, the date math, and why the reveal is locked live in
`docs/claude/rules/schedule-optimization.md#schedule-release-day` — that doc is
the authority. This file is the journal: what went wrong building it.

## 2026-08-22 - A Reason Every Card Gets Is a Reason That Says Nothing

**Context:** The reveal teases four marquee games, each with a list of reasons
it was picked. Two of those reasons are true of a large fraction of games:
"two of last year's best" (any two teams over .600) and the all-time series
line (in a sixteen-year league, most pairings have history).

**Insight:** Left alone they printed on three of four cards, and the tease read
as filler — the first thing the commissioner said on seeing it. The fix is to
separate WEIGHTING from SAYING. Both signals keep their full effect on which
games get picked; the decision about which card actually *prints* them happens
once, after the four are known (`trimReasons` in
`src/utils/schedule-release.mjs`): the quality tag prints only on a card with
nothing more specific to say, and then at most once; the series line prints on
the single most-charged rivalry plus the Throwback Week card, where the old
rivalry IS the reason for the pick.

**Evidence:** `tests/schedule-release.test.ts` — "says the series on at most one
card outside Throwback Week", "never says it alongside a more specific reason".

**Recommendation:** Any scored-then-explained list needs this split. When a
scoring signal is broad enough to be useful as a tiebreak, it is almost always
too broad to be worth stating. Score with it; narrate with something else.

## 2026-08-22 - A Stored Head-to-Head Record Belongs to Whoever Sorts First, Not Whoever Is Ahead

**Context:** `rivalrySeriesByPair` builds one entry per pairing from
`derived/franchise-history.json#matchupHistory`, which stores every meeting
twice — once from each side. To avoid double-counting, the entry keeps one
side's perspective.

**Insight:** That side is the franchise whose id sorts first, which has nothing
to do with who leads the series. `{wins: 14, losses: 11}` on the `0001-0005`
pairing means 0001 leads, but the identical shape on a pairing where the
first-sorting id is behind means the opposite. Formatting `wins`-`losses` at a
call site therefore prints the wrong team winning a rivalry roughly half the
time — in the chat, in front of the two owners it is about.

**Evidence:** `describeSeries(series, a, b, nameOf)` in
`src/utils/rivalry-intensity.mjs` is the only sanctioned renderer; the field is
named `perspective` rather than `leader` precisely so the trap is visible at the
call site. Pinned by "names the franchise that is actually ahead, not whichever
id sorts first".

**Recommendation:** Never format a record from this structure by hand. If a new
surface needs a different phrasing, add it to `describeSeries`, don't inline it.

## 2026-08-22 - A Reserved Slot Has to Be Claimed First, Not Spliced In Last

**Context:** Throwback Week (NFL Week 4) must always appear among the four
marquee games, and should be the week's oldest, closest rivalry.

**Insight:** Implementing "reserved" as a post-hoc splice — pick the best four,
then swap the weakest out for a Week 4 game — fails twice over. It ignores the
franchise-distinctness the main loop enforced, so the same two franchises
landed in three of the four cards; and by the time it runs, the other picks
have already claimed the franchises of the week's best series, so what is left
to splice in is a nine-meeting pairing standing in for a fifteen-meeting one.
Claiming the slot BEFORE the general pass fixes both: the reserved game takes
its two franchises off the board, and the rest fill around it.

**Evidence:** `marqueeMatchups` in `src/utils/schedule-release.mjs`. The pick
inside the week is ranked by `series.intensity`, NOT by the game's overall
score — score is dominated by opening-week/doubleheader/quality bonuses that
say nothing about how old a grudge is.

**Recommendation:** "Reserve a slot" means claim it first. A splice at the end
is a different, worse algorithm wearing the same words.

## 2026-08-22 - A Red Schedule Audit May Be a Stale Feed, Not a Bad Schedule

**Context:** Six assertions in `tests/schedule-optimization.test.ts` were red
after both leagues' schedules were regenerated and pasted into MFL.

**Insight:** The audit deliberately reads the PUBLISHED feed
(`data/<league>/mfl-feeds/<year>/schedule.json`), not the planner's output — a
planner checking its own work proves nothing. But that feed is a committed
snapshot refreshed by cron, so a paste that landed hours ago still reads as the
old schedule and the audit reports a failure that no longer exists. Four of the
six cleared on a plain refetch; the other two were real (that league's paste
had never been applied).

**Evidence:** Compare `export?TYPE=schedule` live against the committed feed
before believing the audit. Refresh with
`MFL_LEAGUE_ID=<id> MFL_YEAR=<y> MFL_HOST=https://<host> node scripts/fetch-mfl-feeds.mjs --refresh-live`.

**Recommendation:** On a red schedule audit, diff live-vs-committed first. Fix
the data before touching the optimiser.

## 2026-08-22 - The Article Gates on the Feed Matching the Reveal, Not on a Date

**Context:** MFL has no schedule write API, so the paste is a human step of
unknown duration — the commissioner may reveal on release day and paste that
evening, or three days later.

**Insight:** So the Schefter column (and the GroupMe post that rides with it)
cannot fire on a date. `scripts/article-types/schedule-release.mjs` fingerprints
the live schedule feed week-by-week and returns `null` until it matches the
locked reveal exactly. That makes the daily cron a no-op every other day of the
year, lets each league announce on its own timing with no second date to
maintain, and — the actual point — makes it impossible to publish an analysis
of a schedule that turned out not to be the one that got pasted.

**Recommendation:** When a human step sits between "we decided" and "it is
true", gate the announcement on observing the effect, never on the decision's
timestamp.
