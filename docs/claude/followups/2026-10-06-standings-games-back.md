---
slug: standings-games-back
status: shipped
shipped: 2026-10-06
severity: P1
opened: 2026-10-06
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1338
hotfix_sha: 5e7691f
followup_issue: 1339
followup_pr: https://github.com/braven112/mfl.football.v2/pull/1341
followup_session:
---

# Follow-up: standings GB measured on the division record

## What broke
The division standings cards (TheLeague and the AFL, one shared
`StandingsTable`) printed a GB column beside the OVERALL record but computed it
from the division-only record (`divw`/`divl`), with the leader picked by most
division wins. An AFL owner posted 5-1 / 4-2 / 4-2 reading "—" / 2.0 / 2.0 in
chat. In the 2026 feeds, 21 rows across both leagues disagreed with their own
records, including leaders shown as 1.0 back. It was never a regression: the
function was a faithful port of the legacy division-view math.

## What the hotfix did
`calculateGamesBack` in `src/components/theleague/standings/standings-cells.ts`
now reads `h2hwlt` and measures from the group's FIRST row, which is MFL's
official leader because both division views pass `preserveFeedOrder: true`. The
first push picked the leader by W-L margin; Copilot flagged that this re-derives
MFL's order (the standings rules doc forbids it), and the second commit fixed it.
Tests: `tests/standings-cells.test.ts` (overall-not-division, first-row leader,
tiebreak pair). The preview and production both show 5-1 → —, 4-2 → 1.0 on
`/standings` in the AFL.

## Deferred items

- [x] **F1 — Design doc still describes GB as division-only**
  - Source: deferred at implementation
  - Where: `docs/standings-table-design.md:180` (and the `division` column
    description around `:77`)
  - Why deferred: doc-only; the code comment and config comment are already
    correct, so this has no effect on owners

- [ ] ~~**F2 — Decide how a NEGATIVE GB renders**
  - Source: deferred at implementation, following Copilot's review on #1338
  - Where: `src/components/theleague/standings/standings-cells.ts`
    (`formatGamesBack`)
  - Why deferred: it can only happen if teams in one division have played
    unequal games AND MFL ranks the team with the smaller W-L margin first. No
    2026 division has that. Today it would print e.g. `-0.5`; decide whether
    that is right or should read `+0.5` / `—`, and pin it with a test~~
  - **Dropped (owner's call, 2026-10-06):** a census of every committed
    `standings.json` in both leagues (196 division-seasons, 2003-2026) found
    ZERO rows with a negative GB measured from MFL's first row. Fantasy H2H
    divisions play equal games, so the case is theoretical; not worth a
    rendering rule.

## Resolution
- F1 shipped: `docs/standings-table-design.md` now says GB reads `h2hwlt` from
  the group's first row. The trap also went into
  `docs/claude/rules/standings-brackets-draft-order.md` § rule 1, since a
  derived column re-deriving the leader is the same bug as re-sorting.
- F2 dropped (see above).
- No reviewer findings landed on #1338 after merge.

## Context to start cold
- GB is only rendered on the division view (`COLUMNS.division` in
  `standings-table-config.ts`). League and conference views do not show it.
- Never re-sort or re-derive the leader: MFL's row order already applies the
  constitution's tiebreakers (`docs/claude/rules/standings-brackets-draft-order.md`).
- Ruled out: no other GB calculation exists in `src/` or `scripts/` (grep for
  gamesBack/gamesBehind/games_back); the AFL has no forked standings page.
