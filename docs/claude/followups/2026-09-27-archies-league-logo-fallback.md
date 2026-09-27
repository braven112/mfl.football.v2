---
slug: archies-league-logo-fallback
status: open                 # F1 + F2 shipped; F3 needs a signed-in 10105 owner
severity: P1
opened: 2026-09-27
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1245
hotfix_sha: e09a50f
followup_issue: https://github.com/braven112/mfl.football.v2/issues/1246
followup_pr:
---

# Follow-up: archies-league-logo-fallback

> Recreated from issue #1246 by `/followup`. The hotfix's step 8c never pushed
> this file to main.

## What broke
On MFL Live's league drill-down (`/live/league/<id>`), Archie's league (10105)
showed a Chicago Bears NFL logo for "Bears" and initials for everyone else,
instead of each franchise's uploaded MFL crest (Week 4 Sunday, 2026-09-27).

## What the hotfix did
Forward fix. `buildBoardFromSnapshot` (`src/utils/live/read.ts`) and
`decorateStandings` (`src/utils/live/standings.ts`) now take `franchiseIcons`,
which `src/utils/live/mfl-league-board.ts` forwards from `readCrossLeagueLive`.
The NFL-name rung in `resolveFranchiseIdentity` (`src/utils/mfl-live-identity.ts`)
is now league-level via `leagueHasMarks`: a league with any uploaded mark never
gets NFL logos (owner's rule). The fix covers the cross-league board, the league
board, standings and `/live/settings`.

## Deferred items
- [x] **F1: Use the shared helper in `readViewerFranchiseNames`**
  - `src/utils/cross-league-live.ts` computed `Object.values(marks).some((m) => !!m.icon)`
    inline. It now calls `leagueHasUploadedMarks`, which also trims blanks, so
    `/live/settings` and the boards share one definition of "this league has marks".
- [x] **F2: Behavioural test for `assembleMflLeagueBoard` wiring**
  - `tests/live-league-board-assemble.test.ts` mocks `readCrossLeagueLive` and
    `readLeagueStandings`, runs the real assembler, and asserts both tabs:
    uploaded crest on rung `mfl`, no NFL logo in a league with marks, and an NFL
    logo in a league without any. It fails with 2 of 3 tests when the
    `franchiseIcons` forwarding is removed. Added to the path-guard map next to
    the scan guard.
- [ ] **F3: Verify on production with a signed-in 10105 owner**
  - `https://mfl.football/live/league/10105`. Still true and still blocked: a
    cloud session has no MFL owner cookie, and the route is auth-gated. The owner
    has to check it.

## Late review findings on #1245
None. Only the Vercel deploy comment and the tracking link were posted.
