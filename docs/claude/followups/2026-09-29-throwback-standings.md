---
slug: throwback-standings
status: shipped
severity: P1
opened: 2026-09-29
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1273
hotfix_sha: 5bfdac0
followup_issue: 1274
followup_pr: https://github.com/braven112/mfl.football.v2/pull/1277
shipped: 2026-09-30
followup_session:
---

# Follow-up: Throwback Week standings (era art + today's name)

## What broke
Nothing was broken. This was a time-boxed enhancement. TheLeague's Throwback
Week (NFL week 4) started 2026-09-29, and the standings pages were still
showing every club's current banner. The normal `/live` → staging → weekly
promote path would have shipped it after the week ended, so it went through
the fast lane.

## What the hotfix did
The current season's standings rows now use each club's era art during that
league's throwback week, with today's team name on a second line underneath.
- New `src/utils/throwback-standings.ts` (`applyThrowbackToStandingsConfig`)
  wraps the existing `applyThrowbackOverrides` chokepoint.
- `StandingsTable.astro` takes an optional `throwbackTodayNames` prop and
  renders `.team-today-name`.
- Wired into `src/pages/theleague/standings.astro` and
  `src/pages/afl-fantasy/standings.astro`, including the AFL NIT table.
- Guard test: `tests/throwback-standings.test.ts`.

Copilot's three findings (AFL conference-view `flex-wrap`, and the testDate
clock in both pages) were fixed in the PR before merge, so none of them are
deferred.

## Deferred items

- [x] **F1: Record standings as a throwback consumer in the insights journal**
  - Source: deferred at implementation (`/hotfix` skips `/update-insights`)
  - Where: `docs/claude/insights/features/throwback-week.md`
  - Why deferred: an insight entry is not needed to ship. Worth recording:
    (a) the standings helper deliberately keeps archived seasons on
    their own year's identity; (b) the throwback gate must read the SAME
    `?testDate=` clock as the week gate, or previews disagree with themselves
    (Copilot caught this); (c) a new second-line element needs `flex-wrap` in
    EVERY table variant. `.v-conf` lacked it, and only Copilot noticed.
  - **Done:** new section "Standings is a throwback consumer, and it has one
    clock" in `docs/claude/insights/features/throwback-week.md` records all three.

- [x] **F2: Standings pages ignore `?testDate=` when picking the default year**
  - Source: noticed while fixing Copilot's testDate comment (pre-existing)
  - Where: `src/pages/theleague/standings.astro` (`currentSeasonYear` /
    `defaultYear`, ~line 48), and the same in `src/pages/afl-fantasy/standings.astro`
  - Why deferred: pre-existing and outside the hotfix's scope. The hotfix only
    made the throwback gate use the test clock. A page opened with
    `?testDate=2025-09-28` and no `year=` still defaults to the real current
    season, so `/rollover-check` cannot drive these pages by date alone.
    Decide whether `defaultYear` should follow the test date too.
  - **Done (decision: yes, follow the test date):** TheLeague's page and the
    AFL family's `resolveStandingsRoute` (`src/utils/afl-family-standings.ts`,
    where the AFL page's season logic moved in the 2026-09-29 release) now
    compute `currentSeasonYear` from `?testDate=`, the throwback gate compares against
    that same value, and the fallback redirects keep `testDate`. Checked on a
    dev server: `?testDate=2025-09-28` alone renders 2025 with 16 era rows, and
    `?year=1900&testDate=…` redirects to `?year=2025&testDate=…`. Guard: the
    "standings pages share one season clock" block in
    `tests/throwback-standings.test.ts` (fails on the pre-fix pages).

## Context to start cold
- Throwback weeks come from the registry: TheLeague week 4, the AFL week 8
  (`throwbackWeeks` in `src/config/leagues-data.mjs`).
- Preview with `/theleague/standings?week=4` or `/afl-fantasy/standings?week=8`.
  Add `&year=2025&testDate=2025-09-28` to exercise the clock path.
- Every rule for throwback surfaces is in
  `docs/claude/insights/features/throwback-week.md`. Never resolve eras inline.
  Go through `applyThrowbackOverrides`.
