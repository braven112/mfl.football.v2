---
slug: cowboy-up-degenerates
status: in-progress
severity: P2
opened: 2026-09-29
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1269
hotfix_sha: 393744b
followup_issue: 1270
followup_pr:
followup_session:
---

# Follow-up: Cowboy Up throws back as the Degenerates

> Recreated by `/followup` from issue #1270. The brief never reached main.

## What broke
Nothing was broken. This was a Throwback Week (Week 4, 2026) commissioner exception: Cowboy Up (TheLeague 0014) wears Da Dangsters' (0002) 2008–2014 "Degenerates" era as its default, and no other team can pick it.

## What the hotfix did
- Added `THROWBACK_ERA_GRANTS` (`ThrowbackRules.grants`), which lends an era from another franchise's `history[]`, keyed `0002:2008`.
- Added a conflict entry that removes Degenerates from 0002's picker, and set 0014's default to `'0002:2008'`.
- `getThrowbackFranchiseBrand` now passes the league's teams, so Set Lineup resolves lent and inherited eras.
- The PR also carried a derived-chain recompute, because main was red on `division-strength-data`.

## Deferred items
- [x] **F1 — The era picker labels a granted era as a former slot.** Granted eras now carry `grantedBy` (the lender's name), and `throwbackEraProvenance()` renders them "on loan from Da Dangsters". Inherited eras keep "as franchise NNNN". Pinned in `tests/throwback-identity.test.ts`.
- [x] **F2 — The derived chain went stale on main mid-season.** Root cause: `tests/division-strength-data.test.ts` "builds a season that is under way" replayed the LIVE season against a `schedule.json` that roster sync rewrites on every game. It was reproduced at b2560e1 as the only failing chain guard. No lane was wrong. The test now simulates on the newest finished season with later years cut, so it cannot race the sync. Freshness stays with the daily chain lane, whose own run fails on the replay invariant. The owner chose this over having roster sync dispatch the chain (extra production builds) or folding the chain into roster sync (hot-path risk).

## Context to start cold
- The grant is a one-off. To undo it, delete the grant, delete the matching conflict entry, and restore `'0014': 2007`.
- `tests/throwback-identity.test.ts`, "Cowboy Up wears the Degenerates by default", pins the behaviour.
