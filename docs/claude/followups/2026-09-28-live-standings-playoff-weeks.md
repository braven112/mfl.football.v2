---
slug: live-standings-playoff-weeks
status: open
severity: P2              # dormant until the first playoff week (TheLeague: week 15)
opened: 2026-09-28
source_pr: https://github.com/braven112/mfl.football.v2/pull/1254
origin_pr: https://github.com/braven112/mfl.football.v2/pull/1252
followup_issue: TBD
followup_pr: TBD
---

# Follow-up: Live / Projected standings add PLAYOFF games to the regular-season table

Found by the Claude review during `/live` for #1254 (Live standings page). The
bug lives in #1252's code, which is on `main` and in production via every
`/live/league/<id>` board's Standings tab. Deferred instead of fixed in #1254
because the proper fix needs a new per-league read (below), and the bug stays
dormant until week 15.

## What breaks

`markWeekCounted` (`src/utils/live/standings.ts`) works out how many of this
week's games MFL has already counted:

    weekGamesCounted = (W + L + T) − priorGames[franchise]

`priorGames` comes from `parsePriorGameCounts`
(`src/utils/mfl-schedule-pairings.ts`), which counts every schedule matchup
before `week`. **MFL's `schedule` export includes playoff and consolation
weeks; the standings W-L does not.** Verified against committed data:
TheLeague 2025 `schedule.json` lists weeks 1–17, while franchise 0009's
record is 15-3 = 18 games, exactly weeks 1–14 (3×16 + 10×8 + 16 = 144
matchups / 16 teams × 2 = 18 each).

So in a playoff week:
- week 15: prior = 18 = record → counted 0 → the week-15 playoff game is ADDED;
- week 16+: prior > record → negative, clamped to 0 → that week's game is ADDED.

Live and Projected then show playoff and consolation results (with their
points) folded into the final regular-season table and re-rank it. Final is
unaffected: it is MFL's own table.

## The fix (proposal)

After the regular season there is no regular-season week to add, so Live and
Projected should show exactly what Final shows:

1. Read the league's `lastRegularSeasonWeek` (MFL `TYPE=league`). For
   registered leagues it is in the committed `league.json`. For outside leagues,
   `readLeagueFranchiseMarks` (`src/utils/cross-league-live.ts`) already makes a
   cached `TYPE=league` read for names, so extend it rather than adding a second
   read.
2. In `assembleMflLeagueBoard`, when `week > lastRegularSeasonWeek`, pass no
   matchups to the standings (or stamp every row `weekGamesCounted` = the
   week's game count) so `projectStandings` adds nothing, and have the caption
   say why ("the regular season is over — this is the final table").
3. Unknown `lastRegularSeasonWeek` → keep today's behaviour (can't tell).
4. Guard test: TheLeague's 2025 `schedule.json` + `standings.json` at week 15
   must produce `includesWeek: false` for every row in Live and Projected.

`/live/standings` (#1254) uses `assembleMflLeagueBoard` too, so it gets the fix
for free.
