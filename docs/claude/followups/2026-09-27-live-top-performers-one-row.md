---
slug: live-top-performers-one-row
status: shipped
shipped: 2026-09-27
severity: P1
opened: 2026-09-27
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1249
hotfix_sha: e412558
followup_issue: 1250
followup_pr: https://github.com/braven112/mfl.football.v2/pull/1251
followup_session: https://claude.ai/code/session_01RxZ2td6WineXiE1pYjb5zk
---

# Follow-up: MFL Live Top Performances repeated a player once per owner

## What broke
On MFL Live league boards the Top Performances strip listed a player once per
owner starting him. Routine in the AFL, where players are rostered in both
conferences, so the 10-row strip showed only ~5 distinct players.

## What the hotfix did
`buildLeaders` (`src/utils/live/leaders.ts`) emits one row per player with an
`owners: LiveLeaderOwner[]` list sorted by franchise id (`src/types/live.ts`);
the cap counts players. `src/components/shared/live/LvLeaders.tsx` renders the
owners comma-separated on a second line (`.lv-leaders__who` /
`.lv-leaders__owners`, `src/styles/live.css`), wrapping rather than truncating.
Tests: `tests/live-league-board-outside.test.ts`.

## Deferred items

- [x] **F1 — Defensive read of `row.owners` in LvLeaders**
  - Source: Claude review (self), hotfix step 5
  - Where: `src/components/shared/live/LvLeaders.tsx:80`
  - Why deferred: leaders are rebuilt per request (never stored), so a new
    client never sees the old shape; an old tab on old JS just shows a blank
    owner. `row.owners ?? []` is hardening, not a fix.
  - Shipped (#1251): `?? []`, and owners + "playing" joined as one list so an
    ownerless row never leads with ` · `.

- [x] **F2 — Component-level render test for the two-line owner layout**
  - Source: deferred at implementation
  - Where: `src/components/shared/live/LvLeaders.tsx`, new test in `tests/`
  - Why deferred: builder is unit-tested; nothing renders the component to
    assert every owner name appears and the row key is the player id.
  - Shipped (#1251): `tests/live-leaders-render.test.ts` — one `<li>` per
    player, every owner named (keys are not in SSR markup, so the row COUNT pins
    one-row-per-player). An `owners[0]`-only mutant fails it.

- [ ] ~~**F3 — Layout scope confirmation**~~ — DROPPED (#1251): owner approved
  the two-line layout for every league as shipped; nothing to do unless asked.
  - Source: deferred at implementation
  - Where: `LvLeaders.tsx`, `live.css`
  - Why deferred: owners moved to line two for EVERY league (TheLeague rows
    have one owner) for a consistent layout. Owner approved as shipped;
    revisit only if they ask for single-owner rows to keep the right-side
    owner.

## Context to start cold
- `docs/claude/insights/features/live-scoring.md` (2026-09-20) was updated:
  merging owners onto one row is fine, dropping any owner is not. The
  per-FRANCHISE doubleheader gate in `buildLeaders` is a separate thing and
  must stay.
- Points come from the first owner seen; within one panel a player's score is
  the same for every owner.

## Provenance
This file was committed to the hotfix branch after #1249 merged and never
reached `main`; #1251 recreated it from a61ecdc.
