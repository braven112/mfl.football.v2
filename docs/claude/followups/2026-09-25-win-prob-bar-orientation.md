---
slug: win-prob-bar-orientation
status: open
severity: P1
opened: 2026-09-25
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1213
hotfix_sha: 42d8b90
followup_issue: 1214
followup_pr:
followup_session:
---

# Follow-up: the win-probability bar was mirrored against the score header

## What broke
On Live Scoring's matchup view, the win-probability bar showed the left team's
share on the RIGHT: Smokane FC (left, 23.4) was drawn at 58% on the right, with
Fullybaked's 42% on the left, under Smokane's name. This affected every league's
live board and MFL Live, since the kit shipped.

## What the hotfix did
It was a forward fix in `src/components/shared/live/LvWinProbBar.tsx` and
`src/styles/live.css`:
- Side 0 (the team the caller renders on the LEFT) is now drawn on the left.
- Fills and labels take their colour from `lv-wp__fill{0,1}` / `lv-wp__ink{0,1}`,
  chosen by a new `side0Tone` prop. Before, they took it from their position,
  so MFL Live's viewer-first `renderOrder` swap painted each team in the other
  team's colour.
- `LvMatchupDetail.tsx` and `LvMatchupCard.tsx` now pass `side0Tone={first}`.
- The guards in `tests/live-scoring-accent-theming.test.ts` were rewritten,
  since they had pinned the mirrored layout. Render tests were added in
  `tests/live-kit-leaves.test.ts`.

## Deferred items

- [ ] **F1 — Review Chromatic build 490's 26 visual changes after the fact**
  - Source: Visual tests check (Chromatic), red on the PR by design
  - Where: https://www.chromatic.com/build?appId=6a90f0aee53d61217880fe96&number=490 ;
    `stories/live/LvMatchupCard.stories.ts`, `LvMatchupDetail.stories.ts`,
    `LiveKit.stories.ts`
  - Why deferred: a human has to accept the changes in the Chromatic UI. The
    user chose to merge instead, and main's `--auto-accept-changes` blessed them
    unreviewed. Confirm every diff is ONLY the bar flipping or recolouring.

- [ ] **F2 — Eyeball the bar on production during live games**
  - Source: deferred at verification
  - Where: `/theleague/live-scoring`, `/afl-fantasy/live-scoring`, `/live`
    (MFL Live, with a viewer whose team is matchup side 1)
  - Why deferred: the board renders in the browser, so the server HTML has no
    bar and it cannot be checked by fetch. Render tests pin the orientation, but
    an in-game look (Sun 9/27) is still owed, including the MFL Live reorder case.

- [ ] **F3 — Record the insight**
  - Source: `/hotfix` skips `/update-insights`
  - Where: `docs/claude/rules/live-scoring.md` (or
    `docs/claude/insights/features/live-broadcast.md`)
  - Why deferred: needs time to write properly. Lesson: a split bar's props
    arrive in the caller's RENDER order, and colour is keyed to the matchup
    side (`--t0`/`--t1`), never to position, because `renderOrder` can swap
    the pair.

## Context to start cold
- `renderOrder(matchup, viewerFirst)` (`src/utils/live/model.ts:70`) swaps the
  pair only on MFL Live when the viewer is side 1. League boards keep MFL order.
- `p0` passed to the bar is `winProbabilityFor(matchup, first)`, i.e. the LEFT
  team's probability, not matchup side 0's.
- The old guard tests pinned the mirrored layout as correct ("left → side 1").
  They were rewritten, not deleted. Keep them pointing at the corrected layout.
