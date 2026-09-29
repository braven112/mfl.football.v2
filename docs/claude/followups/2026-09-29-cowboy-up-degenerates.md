---
slug: cowboy-up-degenerates
status: open
severity: P1
opened: 2026-09-29
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1269
hotfix_sha: 393744b
followup_issue: 1270
followup_pr:
followup_session:
---

# Follow-up: Cowboy Up throws back as the Degenerates

## What broke
Nothing was broken. This was a Throwback Week (NFL Week 4, 2026) commissioner
exception that had to ship before the games. Cowboy Up (TheLeague 0014) should
wear Da Dangsters' (0002) 2008–2014 "Degenerates" era, exclusively. Until then a
franchise could only throw back to its own `history[]`, or to an era inherited
from a slot it had held.

## What the hotfix did
- `src/data/theleague/throwback-config.ts`: new `THROWBACK_ERA_GRANTS`; a
  `THROWBACK_ASSET_CONFLICTS` entry that removes the era from 0002's picker;
  0014's default is now `'0002:2008'`. `DEFAULT_THROWBACK_ERA` widened to
  `number | string`.
- `src/utils/throwback-scope.ts`: `ThrowbackRules.grants`. The AFL's is `[]`.
- `src/utils/throwback-identity.ts`: `getGrantedThrowbackEras`, folded into
  `getEligibleThrowbackEras` next to inherited eras (tagged with
  `sourceFranchiseId`, so the pick key is `0002:2008`).
- `src/utils/franchise-brand.ts`: `getThrowbackFranchiseBrand` now passes the
  league's teams. Before this, Set Lineup could not resolve an inherited or
  granted era.
- `src/pages/api/schedule-release.ts`: stopped passing the default as an owner
  override.
- The PR also carried a derived-chain recompute (`data/*/derived/*`). `main`'s
  `Tests` job was red on `division-strength-data`: the 2026 ledger said 4
  games, `schedule.json` replayed 6.

## Deferred items

- [ ] **F1 — The era picker labels a granted era as a former slot**
  - Source: deferred at implementation (my own review of the diff)
  - Where: `src/components/shared/ThrowbackEraPicker.astro:111-115`
  - What: any era with `sourceFranchiseId` renders "· as franchise 0002",
    with the tooltip "Your team wore this under an earlier franchise slot".
    That is true for an inherited era and false for a granted one: Cowboy Up
    never was 0002. The picker needs to know the difference. Mark granted
    eras (for example `granted: true` from `getGrantedThrowbackEras`) and
    render something like "· on loan from Da Dangsters".
  - Why deferred: label only; the scoreboard, lineup and default resolution
    are correct and covered by `tests/throwback-identity.test.ts`.

- [ ] **F2 — Why did the derived chain go stale on main mid-season?**
  - Source: CI failure on the hotfix PR (not this PR's code)
  - Where: `scripts/recompute-derived-chain.mjs`, the roster-sync workflow
    that commits `schedule.json`, `tests/division-strength-data.test.ts`
  - What: roster sync kept committing 2026 schedule results while nothing
    recommitted the ledger, so `division-strength-data`'s integrity check
    threw on main (4 ledger games vs 6 replayed). It was fixed once by hand
    in #1269. Find which lane should recompute the chain after a week's
    results land, and make it do so. Otherwise main goes red again next week.
  - Why deferred: out of scope for a throwback exception; it needs a look at
    the workflow cadence, not a guess.

## Context to start cold
- The grant is a one-off. Removing it = delete the `THROWBACK_ERA_GRANTS`
  entry, the matching conflict, and restore `'0014': 2007`.
- `tests/throwback-identity.test.ts` "Cowboy Up wears the Degenerates by
  default" pins the scoreboard, lineup-brand and picker behaviour.
- `docs/claude/insights/features/throwback-week.md` has the architecture (two
  chokepoints, one resolver). Consider adding a dated note about grants.
