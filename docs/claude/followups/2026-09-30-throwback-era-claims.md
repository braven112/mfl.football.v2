---
slug: throwback-era-claims
status: open
severity: P1
opened: 2026-09-30
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1275
hotfix_sha: 0a354c2
followup_issue: 1276
followup_pr: https://github.com/braven112/mfl.football.v2/pull/1279
shipped: 2026-09-30 (F1, F2); F3 awaits the owner's preview check
followup_session: session_01AqVrTug8rqx8Zq42SiNNmR
---

# Follow-up: Throwback Week era claims

> Recreated by `/followup` from issue #1276. The brief never reached main.
> Status stays `open` until F3's two-session check on the preview is done.

## What broke
Nothing was broken. The league-wide Throwback Week era pool shipped on the fast lane because of a deadline: TheLeague's Week 4 kicks off 2026-10-01 at 17:15 PT.

## What the hotfix did
Owners can pick any era in their league except one worn by an owner who is still here (`throwback-era-owner.ts`). Departed owners' eras go first come, first served, one franchise per era (`resolveThrowbackAssignments`, ordered by `claimedAt`). Picks lock from kickoff until the week is over. The API returns 409 when the era is held and 423 while picks are locked. The picker groups the pool under "Up for grabs".

## Deferred items
- [x] **F1: claiming isn't atomic.** Read, check and write are now serialized under a league-wide `SET NX EX 5` lock (`withThrowbackClaimLock`). The owner chose that over the brief's per-era claim key: the claim key would be a second record to keep in step with the picks, a failed release leaves it stale, and existing picks have no key to backfill. Copilot's two late findings on the same lines are folded in. A failed `mget` now returns 503 instead of reading as an empty league, and the API resolves against every saved pick (the caller's included), so the winner of an old tie can re-save its own era. Pinned in `tests/throwback-preference-api.test.ts`, which fails with the lock bypassed.
- [x] **F2: a team whose every own era is claimed wears its current look.** Re-validation showed this was one click away, not unreachable. 23 of the 40 seeded defaults were in the open pool, and TheLeague's 0010 and 0012 each have exactly one eligible era. Owner-directed rule: a team's default is reserved to it until its owner saves a pick for a different era. Only then does it join the pool, and once released it stays released. Pinned in `tests/throwback-claims.test.ts`. Review of this PR caught one knock-on: the commissioner panel read every reserved default as a pick; fixed and pinned.
- [ ] **F3: the claimed, outbid and locked picker states haven't been seen against real Redis.** This container has no Redis credentials and no preview JWT secret. The owner will run the two-session check on the follow-up PR's preview, in light and dark mode. The check now covers the new "X's default" chip too.

## Late findings on the hotfix PR (Copilot)
- Atomic claim: same as F1, fixed.
- `mget` failure read as an empty league: fixed with F1.
- The winner of an old tie got a 409 when re-saving: fixed with F1.
- The claimed chip didn't wrap, so a long franchise name widened the card: fixed. The chip now wraps inside the card (`max-width: 100%`, `overflow-wrap: anywhere`).
- "Up for grabs" listed an owner's own reserved era: **overtaken**, already fixed in the hotfix's own b094e6c before the merge.
