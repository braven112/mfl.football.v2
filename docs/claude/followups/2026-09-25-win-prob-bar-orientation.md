---
slug: win-prob-bar-orientation
status: in-progress          # F3 + F4 shipped; F1 needs a human in Chromatic, F2 waits on Sun 9/27 games
severity: P1
opened: 2026-09-25
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1213
hotfix_sha: 42d8b90
followup_issue: 1214
followup_pr: TBD
worked: 2026-09-25
---

# Follow-up: the win-probability bar was mirrored against the score header

Recreated from issue #1214 by `/followup`: the hotfix's brief file never landed
on `main`.

## What broke
On Live Scoring's matchup view, the win-probability bar was mirrored against
the score header. Smokane FC (left, 23.4) was drawn on the RIGHT at 58%, and
Fullybaked's 42% sat on the left, under Smokane's name. It hit every league's
live board and MFL Live. `LvWinProbBar` drew side 1 on the left, but both
callers pass the left-rendered team as side 0.

## What the hotfix did
A forward fix in `src/components/shared/live/LvWinProbBar.tsx` +
`src/styles/live.css`. Side 0 is now drawn on the left. Fills and labels take
their colour from `lv-wp__fill{0,1}` / `lv-wp__ink{0,1}`, chosen by a new
`side0Tone` prop, not from their position. That also fixed MFL Live's
viewer-first reorder, which had painted each team in the other team's colour.
Callers pass `side0Tone={first}`. Tests: `tests/live-scoring-accent-theming.test.ts`
(updated) and `tests/live-kit-leaves.test.ts` (render tests for the bar alone).

## Re-validation (2026-09-25)
The hotfix PR had no late reviewer findings: no review threads, and only the
Vercel bot and the Chromatic note in its comments. The code is unchanged on
`main` since `42d8b90`.

## Deferred items

- [ ] **F1 — Review Chromatic build 490's 26 visual changes after the fact.**
  Still true. It needs a human in the Chromatic UI, and a cloud session can't
  sign in there. Where:
  https://www.chromatic.com/build?appId=6a90f0aee53d61217880fe96&number=490 ;
  stories `stories/live/LvMatchupCard.stories.ts`, `LvMatchupDetail.stories.ts`,
  `LiveKit.stories.ts`. Main's `--auto-accept-changes` blessed them unreviewed.
  Check that each diff is ONLY the bar flipping or recolouring. The stories'
  fixture (`LIVE_MATCHUP`) has the viewer on side 0 at p0 0.68, so the expected
  diff is the left fill growing from 32% to 68% and the two fills swapping
  colour. Anything else is collateral. **Left open.**
- [ ] **F2 — Eyeball the bar on production during live games.** Still true, and
  it can't be done before Sun 9/27. Where: `/theleague/live-scoring`,
  `/afl-fantasy/live-scoring`, and `/live` (MFL Live, with a viewer whose team
  is matchup side 1). F4 now pins the MFL Live reorder case in a render test.
  The visual look is still owed. **Left open.**
- [x] **F3 — Record the insight.** Shipped: a new rule in
  `docs/claude/rules/live-scoring.md`. A split bar takes its props in the
  caller's render order, and its colour from the matchup side
  (`side0Tone={first}`), never from its position.
- [x] **F4 (added at re-validation) — Caller-level guard test.** The hotfix's
  render tests pin the bar on its own, but `side0Tone` defaults to 0. A caller
  that drops it still renders a plausible bar that is wrong only for a side-1
  viewer on MFL Live, and no test saw that. Shipped:
  `tests/live-win-prob-caller-order.test.ts` renders `LvMatchupDetail` and
  `LvMatchupCard` in all four viewer-side × `viewerFirst` cases. It asserts that
  the bar's fills (tone and width) and labels match the score header's inks,
  left to right. Wired into path-guard's live-scoring domain. Mutation-checked:
  dropping `side0Tone` from either caller fails the swapped case, and reverting
  the hotfix's bar fails all 8.
