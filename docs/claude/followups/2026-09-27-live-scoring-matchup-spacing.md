---
slug: live-scoring-matchup-spacing
status: shipped              # nothing was deferred — see "Deferred items"
severity: P2                 # visual only; fast path taken at the owner's explicit request
opened: 2026-09-27
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1240
hotfix_sha: a964b8e
followup_issue:              # none opened — zero deferred items
followup_pr:
followup_session:            # none started — zero deferred items
---

# Follow-up: live scoring matchup view spacing and duplicate status pill

## What broke
Live Scoring, both leagues, phone width, with a matchup open: the matchup card's
top border sat flush against the Week dropdown, and "Tracking · updated Ns ago"
printed twice, one line apart (board header + the matchup's back-button row).

## Triage note
Triaged P2 (cosmetic, workaround = ignore it) and routed to `/live`; the owner
overrode and asked for `/hotfix`. Recorded here so the fast-lane audit counts it
as an override rather than a P0/P1.

## What the hotfix did
- `src/styles/live.css`: removed the phone-only `margin-top: calc(var(--spacing-lg) * -1)`
  on `.lv-page .lv-detail`. It assumed the card was the first thing in `.lv-page`;
  the board header renders above it, so it cancelled `.lv`'s flex gap instead.
- `LvMatchupDetail.tsx` / `LiveBoard.tsx` / `LvFeedStatus.tsx`: removed the second
  freshness pill from the drill-in, plus the `status` prop and `compact` mode only
  it used.
- Guards: `tests/live-scoring-layout-css.test.ts` (no negative margin-top on
  `.lv-detail`), `tests/live-kit-leaves.test.ts` (exactly one `<LvFeedStatus>`).

## Deferred items
None. Claude review: 0 findings. Copilot's one finding (stale header comment in
`LvMatchupDetail.tsx`) was fixed in the PR itself (34fa656). CodeQL green.

## Verification
Production deployment `dpl_AvX8YXqMAfFxdmKXjL2iTtLA6GZU` READY; theleague.us and
afl-fantasy.com `/live-scoring` both serve `live.oltXvSon.css`, whose phone block
carries no `margin-top` on `.lv-page .lv-detail`. No runtime errors on the
live-scoring routes in the 15 minutes after deploy.
