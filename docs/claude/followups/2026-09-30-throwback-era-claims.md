---
slug: throwback-era-claims
status: open
severity: P1
opened: 2026-09-30
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1275
hotfix_sha: 0a354c2
followup_issue: 1276
followup_pr:
followup_session:
---

# Follow-up: the league-wide Throwback Week era pool

## What broke
Nothing was broken. This was a feature shipped on the fast lane because of a
deadline: TheLeague's Throwback Week (Week 4) kicks off 2026-10-01 at 17:15 PT.
The PR also fixed the era picker's "Your Week N default" chip wrapping onto two
lines.

## What the hotfix did
Owners can pick any era in their league except one worn by an owner who is
still in it.

- `src/utils/throwback-era-owner.ts` decides who owns an era: the owners
  registry first, then `buildAttributor`.
- `getPickableThrowbackEras` and `resolveThrowbackAssignments` in
  `src/utils/throwback-identity.ts`: an open era goes to one franchise,
  ordered by `claimedAt` (a pick saved before this change has none and ranks
  first). Defaults skip claimed eras.
- `isThrowbackPickLocked` in `src/utils/throwback-scope.ts` locks picks from
  kickoff until the week is over.
- The API returns 409 when another team holds the era and 423 while picks are
  locked.
- The picker has an "Up for grabs" section.
- Every render surface resolves using the whole league's picks.

## Deferred items

- [ ] **F1: claiming isn't atomic**
  - Source: Claude review (`/code-review`, PR #1275)
  - Where: `src/pages/api/throwback-preference.ts`, in POST between the
    `resolveThrowbackAssignments(...).claims.get(...)` check and
    `setThrowbackPreference`
  - Two owners saving the same open era at the same moment both get "Saved.".
    Render settles it by `claimedAt`, so the scoreboard is right, but the
    loser's save response was wrong until the page reloads with the outbid
    notice. Fix: a Redis `SET NX` claim key
    (`throwback:claim:<scope>:<slot>:<year>` → franchiseId), deleted when the
    holder swaps away. Keep the `claimedAt` ordering as the render-time
    tiebreak.
  - Why deferred: the window is milliseconds and the rendered outcome is
    already correct.

- [ ] **F2: a team whose every own era is claimed wears its current look**
  - Source: Claude review
  - Where: `src/utils/throwback-identity.ts`, the default step (step 3) of
    `resolveThrowbackAssignments`
  - If other teams claim every era in a team's own pool, its default is null
    and it renders its CURRENT identity for the week. That can't happen with
    today's data (defaults are unique and own pools hold 1–11 eras).
    Product decision: fall back to an unclaimed open-pool era, or accept the
    current look. Ask the owner.
  - Why deferred: needs a decision, not a fix.

- [ ] **F3: the claimed, outbid and locked picker states haven't been seen
      against real Redis**
  - Source: deferred at implementation
  - Where: `src/components/shared/ThrowbackEraPicker.astro`
    (`.tbw-card--claimed`, `.tbw-card__claimed-chip`, `.tbw-notice`)
  - Local dev has no Redis, so these render only in unit tests. On a preview,
    use two sessions in one league: claim an open era with one, check the
    other sees the "Claimed by" chip and that a save returns the 409 message
    and reverts the radio. Check dark mode, and the lock (`?testDate` does NOT
    drive `isThrowbackPickLocked`, which reads the real clock, so the lock
    needs a unit-level look or a real throwback week).
  - Why deferred: no Redis locally.

## Context to start cold
- The rules came from the owner, verbatim: "no one else can take Pigskins old
  era but me. But old owners who are no longer in the league can have their
  banner taken." Choices made with them: defaults skip claimed eras; both
  leagues; the AFL pool spans all 24 teams; swapping frees an era at once;
  picks lock at kickoff.
- `getEligibleThrowbackEras` is still the team's OWN list (the default
  pool). `getPickableThrowbackEras` is what the picker offers and what the
  API validates against. Keep the two separate.
- Guard: `tests/throwback-claims.test.ts`. The history is in
  `docs/claude/insights/features/throwback-week.md` under "The league-wide era
  pool".
