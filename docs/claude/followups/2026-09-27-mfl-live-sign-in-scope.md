---
slug: mfl-live-sign-in-scope
status: open
severity: P1
opened: 2026-09-27
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1241
hotfix_sha: 0ae1e3d
followup_issue: 1243
followup_pr:
followup_session:
---

# Follow-up: MFL Live sign-in was TheLeague-only, and open to any league by direct POST

## What broke
`v2.mfl.football/login` (MFL Live) always sent TheLeague's league id, so AFL,
Best Ball and pilot-league owners were refused ("not a member of league 13522").
And `/api/auth/login` trusted any body-supplied `leagueId` (a missing one fell
through to MFL's first league), so a hand-made POST got a session for any MFL
league, which `/live` would then serve.

## What the hotfix did
- `src/pages/login.astro` passes `scope="mfl-live"` to `LoginForm`, which then
  sends `{ scope }` instead of a `leagueId`.
- `src/pages/api/auth/login.ts`: the scope maps to `mflLiveSignInLeagueIds()`
  (registered leagues in registry order, then `MFL_LIVE_PILOT_LEAGUE_IDS`,
  `['10105']`, in `src/config/leagues-data.mjs`). Without the scope, any league
  not in the registry gets a 400 before any MFL call. Only a TheLeague session
  sets TheLeague's team-preference cookie.
- `src/utils/mfl-login.ts#authenticateWithMFL` accepts an ordered list, picks the
  first league in LIST order (never `myleagues` order), and refuses an account
  in none of them as invite-only.
- Guard: `tests/mfl-live-sign-in-scope.test.ts`.

## Deferred items

- [ ] **F1 — Feb 14 – Jun 1: an AFL/Best Ball-only owner is refused on the MFL Live sign-in**
  - Source: Copilot review on #1241 (medium)
  - Where: `src/pages/login.astro:74` (one `seasonYear` from TheLeague's
    `getCurrentLeagueYear()`), and the candidates block in `src/utils/mfl-login.ts`
    (one `TYPE=myleagues` lookup for that year)
  - Why deferred: it only bites while TheLeague has rolled (Feb 14) and the
    AFL/Best Ball have not (Jun 1). Every league is on 2026 now, so nobody is
    affected this season, and those owners couldn't sign in there at all before.
  - Fix: query `myleagues` for each candidate's OWN league year (at most two
    distinct years), then pick in list order. Needs to land before Feb 14, 2027.

- [ ] **F2 — Remove pilot league 10105 when the 2026 pilot ends**
  - Source: deferred at implementation (user: "let that league test it and find
    bugs this year")
  - Where: `src/config/leagues-data.mjs` `MFL_LIVE_PILOT_LEAGUE_IDS`
  - Why deferred: time-boxed by design. Ask Brandon first; he may keep it or
    add leagues.

- [ ] **F3 — Opening MFL Live to every MFL owner is a separate decision**
  - Source: `docs/plans/mfl-live-app.md`, "What is still genuinely missing" item 2
  - Where: `src/utils/mfl-login.ts`, the `leagueList[0]` fallback (now unreachable
    from the endpoint)
  - Why deferred: explicitly not wanted yet ("lock it down to just the leagues
    that are registered for now"). Do not build it without asking.

## Context to start cold
- Nothing here is urgent this season. F1 has a hard date (Feb 14, 2027). F2 and
  F3 are Brandon's calls, not engineering work to start on your own.
- Verified on the PR preview: `/login` renders `data-login-scope="mfl-live"`. Production verification is recorded on PR #1241.
- The session's league only decides who gets in and which franchise is "yours".
  The board itself reads every league from the MFL cookie's `myleagues`.
