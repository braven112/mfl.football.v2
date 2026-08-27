# Playoff Performance — Insights

The "does the best regular season win anything" report
(`/theleague/playoff-performance`), built from
`data/theleague/derived/playoff-performance.json` by
`scripts/compute-playoff-performance.mjs`.

## 2026-08-26 - The playoff SEED is not derivable — read it off the bracket

**Context:** The report needed "the overall #1 seed" for all 19 completed
TheLeague seasons. Three sources look like they should answer it. All three are
wrong somewhere, and each is wrong in a *different* season, so no fallback chain
over them is correct either.

**Insight:** `leagueStandings` row order is the league's official standings
order — but it is **not playoff seed order**, and the two diverge whenever teams
tie on overall record. They diverge in both directions:

| Season | What the feed says | What the bracket did |
|---|---|---|
| 2008 | Acer FC Edge in row 1 | Bring the Pain (row 2) took the bye |
| 2010 | Silver Bullets in row 1 | Dark Magicians (row 2) took the bye |
| 2018 | Cowboy Up at row 6 | Under Siege (row 8) got the last slot |
| 2019 | Mariachi Ninjas at row 7 | Wascawy Wabbits (row 8) got it |
| 2024 | Pacific Pigskins at row 7 | Dark Magicians (row 8) got it |

The constitution's chains don't close the gap either. Wild Card ties break on
All Play first (`src/data/league-constitution.ts`), which is exactly right for
2018/2019/2024 and exactly **wrong** for 2007 and 2016 — 2016 seated the team
with both the worse all-play (.412 vs .541) and the worse points. A faithful
implementation of both chains reaches 75/76 division winners, 17/19 fields and
18/19 byes. Nothing reaches 19/19.

What IS reliable is the schedule. The championship bracket's bye team is
structural — it is whoever sat out the opening round and entered in the
semifinals — so it cannot be tied and does not depend on any tiebreaker we would
have to guess at. `solveBracket` walks it and `assertUniqueField` refuses any
season where more than one field satisfies the games.

**Evidence:** The walk reproduces MFL's own bracket **identically** for the five
seasons whose `playoff-brackets.json` carries franchise ids (2020-2023, 2025),
and every one of the 19 seasons has exactly one consistent field. Champions and
runners-up are pinned per season in
`tests/playoff-performance-data.test.ts`, which also pins 2008 and 2010
specifically so a regression to "feed row 0 is the 1 seed" fails loudly.

Two related facts that came out of the same investigation and are worth keeping:

- **The division winner really is just the best overall record in its division**
  — 76 of 76 division-seasons, no exceptions. Division record is only step 2 of
  a tiebreak between teams already tied on overall record, and across 18 tied
  division titles the chain resolves h2h 11, division record 5, all-play 1,
  total points 1, unexplained 0. Reading a 6-0 division record as the *cause* of
  a division title is a correlation trap: that team usually swept the h2h, which
  is step 1.
- **Wild cards are the next best overall records too.** In 19/19 seasons no team
  with a better overall record was ever left out. Every field discrepancy above
  is an exact record tie at the cut line, never a better team being passed over.

**Recommendation:** For any historical seeding question, take the seed from the
bracket reconstruction, not from standings order and not from a tiebreaker
chain. Derive seeds only for the in-progress season, where no bracket exists
yet. `src/utils/standings.ts` still derives them for the live path and has two
known bugs there (division winners sorted on Most Points Allowed — step 7 used
as step 1, on a `pa` column that is absent before 2025 and evaluates to `NaN`;
and wild cards sorted with no tiebreaker at all).

## 2026-08-26 - `leagueStandings` ignores the W parameter; all-play spans the playoffs

**Context:** The report's secondary view wanted all-play as of the end of the
regular season. MFL's export takes a week parameter, so this looked like a
one-line fetch.

**Insight:** `TYPE=leagueStandings` accepts `W=` and **silently ignores it**.
The response is byte-identical at `W=1`, `W=5`, `W=14` and `W=17` — same
`all_play_pct`, same `all_play_wlt`, and the full-season record and points too.
`WEEK=`, `THRU_WEEK=` and `ENDWEEK=` are ignored the same way. The parameter is
not being stripped in transit: `TYPE=weeklyResults&W=` on the same host returns
week 1 for `W=1` and week 14 for `W=14`.

Worse, the published figure is not a regular-season number at all. `all_play_wlt`
totals **255 = 17 weeks x 15 opponents**, so it includes the playoff weeks —
which makes it circular for any "did the best regular-season team win the
title" question, because the champion's own title run inflates it. TheLeague's
exports also only carry the column from 2015 on, so reading it straight would
cut a 19-season report to 11.

**Evidence:** `W=1` returning a 17-week figure is the proof — if the parameter
did anything at all, week 1 could not look like the full season.

**Recommendation:** For any windowed MFL statistic, aggregate from
`weeklyResults` (which honors `W`) rather than trusting a week parameter on a
standings-shaped export. Validate the aggregation against MFL's own published
figure over the full window first — totalling weekly scores across all 17 weeks
reproduces `all_play_pct` to three decimals in 11 of 11 seasons that have one,
and that equivalence is what licenses using the shorter window. `verifyAllPlay`
re-runs that check on every build and throws on drift, so a change to MFL's
definition surfaces as a failed build rather than a quietly different statistic.

## 2026-08-26 - All-play must dedupe doubleheader weeks

**Context:** A first all-play implementation ranked the wrong team in several
seasons and missed MFL's published figure in all of them.

**Insight:** TheLeague plays **doubleheaders** — weeks where each team appears in
two matchups against two different opponents while posting a **single** score.
Both leagues do it, in weeks 1-3 nearly every year plus a late week (12 or 13,
whichever is bye-free; see `docs/claude/rules/schedule-optimization.md`). Walking
`schedule.json` matchups and pushing every franchise entry into the week's score
pool therefore counts a doubleheader team's score **twice**, which distorts both
its own all-play and everyone else's denominator.

The fix is to key the week's scores by franchise id before comparing — one score
per team per week. `weekly-results.json` gives that shape directly and is the
better input for anything all-play-shaped.

**Evidence:** Deduping moved the from-scratch model from 14/19 to 17/19 playoff
fields and from 17/19 to 18/19 byes in a single change. The doubleheader shape is
visible in any 16-matchup week: 2024 week 1 lists `0001` twice, once against
`0003` and once against `0016`, with the same 123.66 both times.

**Recommendation:** Any per-week cross-league comparison (all-play, luck,
scoring ranks, weekly percentiles) must dedupe by franchise per week. A week with
more matchups than half the league size is the tell.

## 2026-08-26 - "We cannot reproduce h2h" was not true

**Context:** `docs/claude/rules/standings-brackets-draft-order.md` justifies
"never re-sort MFL's standings rows" partly on the grounds that the constitution's
chain includes head-to-head, "which we cannot reproduce (the feed's `h2h*`
columns only echo the overall record)".

**Insight:** The h2h *columns* do only echo the overall record — but `schedule.json`
carries every regular-season game, so head-to-head is computable directly, and
doing so reproduces all 18 of TheLeague's tied division titles with zero
contradictions.

The rule itself still stands, for a better reason than the one given: not that
h2h is unknowable, but that the full official chain has steps we cannot
reproduce or reconstruct reliably (Power Rank, Victory Points, and an era where
the wild-card rule appears to have changed — 2007/2016 follow standings order,
2018+ follow all-play). Feed order remains authoritative for division winners.

**Recommendation:** When a rules doc gives a *reason* for a rule, the reason is
as reviewable as the rule. This one had gone unchallenged long enough to shape
how later work approached seeding. The rule survived; the reason did not.
