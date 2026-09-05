---
name: rollover-check
description: Render a page at the six dates where the league-year (Feb 14) and season-year (Labor Day) clocks turn, and report which year each render shows, so a page on the wrong clock is caught before it ships. Use for any new or edited page that shows a year, standings, rosters, contracts, draft order or playoffs, and whenever getCurrentLeagueYear / getCurrentSeasonYear is touched. Trigger on /rollover-check, "check the rollover", "which clock is this page on", "test at Labor Day".
---

# /rollover-check — the six dates that matter

CLAUDE.md "Year rollover — two independent clocks": Feb 14 advances the
LEAGUE year (rosters, contracts, cap, auctions); Labor Day advances the
SEASON year (standings, playoffs, MVP, draft order). The wrong clock shows
the wrong year for half the calendar and nothing errors.

`scripts/rollover-check.ts` fetches a page at both sides of each boundary
plus mid-season, via the existing `?testDate=YYYY-MM-DD` mechanism, and
prints the EXPECTED league and season years (imported from
`src/utils/league-year.ts`, never re-derived) next to what the page rendered.

## Procedure

1. **Start the dev server** per `.claude/skills/verify/SKILL.md` (it also
   explains forging a session cookie for owner-gated pages). Default base is
   `http://localhost:4321`.

2. **Decide which clock the page SHOULD be on** before looking at output:
   roster-management-shaped → league clock; results-shaped → season clock.
   Write it down.

3. **Run it.**
   ```bash
   pnpm exec tsx scripts/rollover-check.ts /theleague/draft/order
   pnpm exec tsx scripts/rollover-check.ts /theleague/contracts --cookie "session=<jwt>"
   ```
   Add `--year YYYY` to test a different calendar year's boundaries.

4. **Read the table as pairs.** Each row shows the expected league year,
   the expected season year, the HTTP status, the title, and how many times
   each candidate year appears in the visible text.
   - League-clock page: the dominant year column must shift between the
     Feb 13 and Feb 15 rows and must NOT shift across the Labor Day rows.
   - Season-clock page: the reverse.
   - A column that jumps by TWO across one boundary is the double-advance
     bug (a base year that itself moves at Labor Day). Fix by importing the
     year from `league-year.ts`, not by re-porting the formula.
   - Any non-2xx is a failure on its own (a 302 on a gated page means you
     need `--cookie`).

5. **If the page uses `?testDate` nowhere**, the rows will all match the real
   clock and the check tells you nothing. Wire
   `getTestDateFromSearchParams(Astro.url.searchParams)` through to the year
   calls first (see `src/pages/theleague/draft/order.astro`).

6. **Report** the clock you expected, the clock the page is on, and the row
   pair that proves it. Paste the table.

## Don'ts

- Don't test with the system clock. `?testDate` exists so the calendar
  never has to be right.
- Don't bump `PUBLIC_BASE_YEAR` / `PUBLIC_MFL_YEAR` to "fix" a row — pins are
  floors and a pin equal to the calendar year double-advances the math.
- Don't copy the Labor Day formula into the page; import `getLaborDayForYear`.
