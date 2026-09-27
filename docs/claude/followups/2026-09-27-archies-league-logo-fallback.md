---
slug: archies-league-logo-fallback
status: open
severity: P1
opened: 2026-09-27
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1245
hotfix_sha: e09a50f
followup_issue: 1246
followup_pr:
followup_session:
---

# Follow-up: an outside league's live board lost its uploaded crests

## What broke
On MFL Live's league drill-down (`/live/league/<id>`), Archie's league (10105)
showed a Chicago Bears NFL logo for its "Bears" franchise and initials for every
other team, instead of the crest each franchise uploaded to MFL. Seen on the
Week 4 Sunday board, 2026-09-27.

## What the hotfix did
Forward fix. `buildBoardFromSnapshot` (`src/utils/live/read.ts`) and
`decorateStandings` (`src/utils/live/standings.ts`) now take `franchiseIcons`,
which `src/utils/live/mfl-league-board.ts` forwards from `readCrossLeagueLive` —
they had only ever received the names from that read. The NFL-name rung in
`resolveFranchiseIdentity` (`src/utils/mfl-live-identity.ts`) is now
league-level via `leagueHasMarks`: a league with any uploaded mark never lends
an NFL logo (the owner's rule), so a franchise without art drops to initials.
Applied on the cross-league board (`mfl-live-board.ts`), the league board,
standings and `/live/settings`.

## Deferred items

- [ ] **F1 — Use the shared helper in `readViewerFranchiseNames`**
  - Source: Claude review
  - Where: `src/utils/cross-league-live.ts:291` computes
    `Object.values(marks).some((m) => !!m.icon)` inline instead of
    `leagueHasUploadedMarks`
  - Why deferred: DRY only; the marks it sees are already https-filtered, so
    behaviour is equivalent

- [ ] **F2 — Behavioural test for `assembleMflLeagueBoard`'s wiring**
  - Source: Claude review
  - Where: `tests/live-league-board-guard.test.ts:100-101` pins the forwarding
    by source scan only
  - Why deferred: needs `readCrossLeagueLive` and `readLeagueStandings` mocked;
    the scan already fails on the pre-fix file

- [ ] **F3 — Verify on production with a signed-in 10105 owner**
  - Source: hotfix step 7
  - Where: `/live/league/10105` on the shared host
  - Why deferred: the route is auth-gated and the hotfix session had no MFL
    owner cookie; unit tests and the guard are the proof so far

## Context to start cold
Uploaded marks already render as a centred 1:1 `object-fit: cover` crop
(`.lv-side__crest--crop`, `.lv-standings__crest--crop`,
`.lv-leaders__crest--crop` in `src/styles/live.css`; `.mls__mark--crop` in
`src/styles/mfl-live.css`) — the owner confirmed that is the intended
treatment. The image host `*.myfantasyleague.com` is allowlisted in
`REMOTE_MARK_HOSTS` (`src/utils/remote-image.ts`), and a mark that fails to
load falls back to initials in `LvMark`. Registered leagues are unaffected:
rung 1 answers first and their `franchiseIcons` are `{}`.
