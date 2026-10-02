---
slug: live-throwback-colours
status: shipped
severity: P1
opened: 2026-10-02
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1298
hotfix_sha: f1e008e
followup_issue: 1299
followup_pr: n/a (nothing deferred)
followup_session:
---

# Follow-up: Live Scoring drew the viewer grey against a throwback opponent

## What broke
Throwback Week 2026 (week 4), Live Scoring board. Cowboy Up (0014) wore the
green "Degenerates" era but the board kept Cowboy Up's present-day dark-mode
red (`#d8384b`). As side 0 it won the colour clash with the Pacific Pigskins'
red (`#e23b46`), so the Pigskins — the viewer — rendered grey (`#cfcfcf`) on the
card, the score and the win-probability bar.

## What the hotfix did
Forward fix, two parts:
- `src/utils/live/league-board.ts` — the throwback identity overrides now carry
  the era palette (`colors`) when `applyThrowbackOverrides` swapped a team's
  `colorPrimary`. `src/utils/live/read.ts` lays `over.colors` over the registry
  claim (new exported type `LiveIdentityOverride`).
- `src/utils/live/model.ts` — `resolveMatchupColorVars(side0, side1, surface,
  prioritySide = 0)`; `buildLiveMatchup` passes `viewerSide ?? 0`, so the
  viewer's franchise keeps its colour when two clash. Vars stay side-indexed.
- Era detection compares the whole colour claim against today's config
  (`CLAIM_KEYS`), because an era may share today's primary.
- Tests: `tests/live-model.test.ts` (viewer priority, two cases),
  `tests/live-league-board-throwback-colors.test.ts` (which eras pass colours),
  `tests/live-read-league.test.ts` (era palette; replaced the test that pinned
  "Throwback swaps art, not colour").

## Deferred items

None outstanding — recorded for the audit:

- [x] **F1 — Era detection missed a palette that shares today's primary**
  - Source: Claude review (`/code-review`) and Copilot (PR #1298, r4162819358)
  - Where: `src/utils/live/league-board.ts` (the era-colour compare)
  - Fixed inside the hotfix (d815ddd) rather than deferred: Da Dangsters'
    2015 era is a real case. Now compares every claim key;
    `tests/live-league-board-throwback-colors.test.ts` pins it.

## Context to start cold
- The old rationale for excluding colours ("an era's palette has not been
  through the ground check") was wrong: `resolveMatchupColorVars` runs every
  claim through `resolveTeamColorPair` (ΔE vs ground) and `ensureContrastOn`
  (AA ink) regardless of source.
- `applyThrowbackOverrides` (`src/utils/live-scoring-data.ts`) clears the
  `*Dark` variants when an era supplies colours — the era claim deliberately
  has no dark variants, and the resolver nudges for legibility instead.
- MFL Live (`src/utils/mfl-live-board.ts`) was already viewer-first (`mine`
  is always side 0), so it needed no change. `franchise-marks.ts` calls with
  the default priority on purpose (a single claim vs a neutral opponent).
- Repro without a browser: call `resolveMatchupColorVars` with the config
  colours of 0014 (`#153366`/`#d32a3e`, dark `#d8384b`) vs 0001 (`#bd1f2b`,
  dark `#e23b46`), surface `theleague`.
