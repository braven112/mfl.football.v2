---
slug: throwback-current-name
status: open
severity: P1
opened: 2026-10-02
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1302
hotfix_sha: a726dcb
followup_issue: 1303
followup_pr:
followup_session:
---

# Follow-up: show today's name under a renamed Throwback era on Live Scoring

## What broke
During Throwback Week, Live Scoring shows each club under its era name, so
owners couldn't tell which present-day team was which. This was a deadline
exception, not an outage: the normal Tuesday release would have landed after
the Week 4 Throwback games.

## What the hotfix did
`src/utils/live/read.ts` sets `LiveTeam.currentName` (today's name), but only
when the era name differs from today's name (case-insensitive). It renders as
small muted text under the era name in `LvMatchupCard.tsx` and
`LvMatchupDetail.tsx`, and it's included in the card button's `aria-label`.
The detail score header is bottom-aligned in `src/styles/live.css`, so both
scores stay on one line. Guard test: `tests/live-read-league.test.ts`.

## Deferred items

- [ ] **F1 — Matchup-card rows are uneven when only one side has the extra name line**
  - Source: deferred at implementation (seen in screenshots)
  - Where: `src/styles/live.css` (`.lv-side`, `.lv-side__current`),
    `src/components/shared/live/LvMatchupCard.tsx` (`sideRow`)
  - Why deferred: purely cosmetic. A fixed row height or an empty placeholder
    line are both design calls, not hotfix material.
  - Reproduce: `/theleague/live-scoring?week=4` during Throwback Week,
    The Executioners vs Da Dangsters.

## Context to start cold
- Only `readLeagueLive` sets `currentName`, from the throwback
  `identityOverrides` that `src/utils/live/league-board.ts` builds. Boards that
  pass no overrides (broadcast, MFL Live) never show it.
- Copilot's one finding (the aria-label) was fixed in the PR before merge.
