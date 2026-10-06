---
slug: throwback-current-name
status: shipped
severity: P1
opened: 2026-10-02
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1302
hotfix_sha: a726dcb
followup_issue: 1303
followup_pr: https://github.com/braven112/mfl.football.v2/pull/1304
shipped: 2026-10-02
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

- [x] **F1 — Matchup-card rows are uneven when only one side has the extra name line**
  - Source: deferred at implementation (seen in screenshots)
  - Where: `src/styles/live.css` (`.lv-side`, `.lv-side__current`),
    `src/components/shared/live/LvMatchupCard.tsx` (`sideRow`)
  - Why deferred: purely cosmetic. A fixed row height or an empty placeholder
    line are both design calls, not hotfix material.
  - Reproduce: `/theleague/live-scoring?week=4` during Throwback Week,
    The Executioners vs Da Dangsters.
  - **Worked (2026-10-02):** per-card rule, chosen by the user over a
    board-wide or always-on fixed row height. If either side of a card has
    `currentName`, the other row renders an empty, `aria-hidden`
    `.lv-side__current--empty` placeholder line; a card with no renamed side
    is unchanged. The detail header was already bottom-aligned by the hotfix,
    so it needed nothing. Guard: `tests/live-matchup-card-current-line.test.ts`
    (fails with the fix reverted), wired into path-guard's live domain.
  - No late reviewer findings landed on #1302 after merge.
  - **Later the same day:** the owner asked for the detail header's names to be
    TOP-aligned, because bottom alignment pushed the un-renamed side's name
    down. The header is now `align-items: start` and uses the same per-matchup
    empty placeholder line, so the scores still line up. Covered by the same
    guard file.

## Context to start cold
- Only `readLeagueLive` sets `currentName`, from the throwback
  `identityOverrides` that `src/utils/live/league-board.ts` builds. Boards that
  pass no overrides (broadcast, MFL Live) never show it.
- Copilot's one finding (the aria-label) was fixed in the PR before merge.
