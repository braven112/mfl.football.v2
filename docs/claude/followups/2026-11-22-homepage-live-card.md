---
slug: homepage-live-card
status: open
severity: P1
opened: 2026-11-22
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1808
hotfix_sha: 5100c1e
followup_issue: 1809
followup_pr:
followup_session:
---

# Follow-up: homepage live card (throwback logos, game links, View all)

## What broke
AFL homepage "Sunday Games Scoring" card (Sunday of Throwback Week, week 11) showed today's logos instead of throwback eras, its games linked nowhere, and there was no way to the full board. TheLeague's homepage shares the card.

## What the hotfix did
`buildLiveScoringHeroProps` resolves era identities via `applyThrowbackToBoard`; `LiveScoringHero` wraps each matchup in a link to `<league>/live-scoring?matchup=<sorted ids>` and adds a "View all matchups" `cta cta--primary`; `LiveBoard` opens the matching game on arrival and strips the param.

## Deferred items
- [ ] **F1 — Cache the throwback preference read for the homepage card**
  - Source: deferred at implementation
  - Where: `src/utils/live-scoring-hero-props.ts` (`resolveEraIdentities`) → `applyThrowbackToBoard` → `getAllThrowbackPreferences`
  - Why deferred: during a throwback week every live-slot homepage render does an uncached Redis read. `resolveThrowbackRequestState` (`src/utils/throwback-request-state.ts`) already has a 60s per-scope cache; reuse it rather than duplicate. Performance, not correctness.
- [ ] **F2 — Board-side test for `?matchup=` opening the drill-in**
  - Source: deferred at implementation
  - Where: `src/components/shared/live/LiveBoard.tsx` (the `LIVE_MATCHUP_PARAM` effect), `tests/live-matchup-link.test.ts`
  - Why deferred: the shipped guard pins the key format and the param name; a render test that the board actually opens the card (and drops the param) needs a jsdom LiveBoard fixture.
- [ ] **F3 — Visual baselines red on main**
  - Source: CI on #1808 and #1805
  - Where: `live-emptystate--all-reasons--{light,dark}`, `shared-quicklinks--the-league-signed-in--{light,dark}`
  - Why deferred: pre-existing (same 4 failed on #1805); baselines are rebuilt from staging, which main lags. Unrelated to this diff.

## Context to start cold
- Throwback weeks are per league in the registry (`throwbackWeeks`: TheLeague [4], AFL [11]), so TheLeague's card correctly shows today's logos this week.
- Links go to each league's own Live Scoring page (`ensureLeaguePrefix(league, '/live-scoring')` / `resolveLeaguePath('/theleague/live-scoring')`), not mfl.football/live. Brandon was told and can ask to switch.

