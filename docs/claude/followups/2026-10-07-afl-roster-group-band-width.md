---
slug: afl-roster-group-band-width
status: open
severity: P1
opened: 2026-10-07
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1346
hotfix_sha: 4a3dcb6
followup_issue: 1347
followup_pr:
followup_session: session_01LPzMj7fS5DU3VcoScp3Egn
---

# Follow-up: AFL phone roster headers and sort chips lost their styles

## What broke
On AFL Rosters on a phone, the position-group headers shrank to their label
instead of spanning the card. The sort chips ran off the card's right edge, and
the active chip spelled out ", sorted descending" (user report, 2026-10-07).

## What the hotfix did
- `src/components/shared/rosters/RostersPage.astro`: set
  `data-controller="afl-family"` on the `.roster-page` section. Every AFL rule
  in `roster-position-groups.css` is scoped to it, and nothing had been
  setting it.
- `src/styles/roster-position-groups.css`: the band's `display: block` is
  scoped to `[data-league='afl-fantasy']`, because Keeper and Archies keep a
  phone table.
- Guard test in `tests/roster-position-groups.test.ts`; marker updated in
  `tests/cross-league-init-gate.test.ts`.
- Removed two dead `/players` and `/guides` links from the 2026-10-05 Archies
  rollup in `src/data/whats-new.json`; they had main's Tests job red.

## Deferred items

- [ ] **F1 — AFL-family CSS hangs on an attribute nothing else needs**
  - Source: deferred at implementation
  - Where: `src/styles/roster-position-groups.css`, the
    `[data-controller='afl-family']` rules (from "AFL-family: sortable headers"
    to the end of that media block)
  - Why deferred: a refactor of a dozen selectors on a P1 layout fix. Key them
    off `data-league` or one shared marker, so they can't go silently dead.

- [ ] **F2 — Keeper and Archies phone rosters**
  - Source: cross-cutting lens, step 5
  - Where: `src/styles/rosters-mobile.css` (only cards `afl-fantasy` and
    `theleague`)
  - Why deferred: product decision. Both show the chip row over a plain table.

- [ ] **F3 — Weekly rollup writes links to routes a league lacks**
  - Source: deferred at implementation
  - Where: the rollup generator behind bot commit `0c248dc`, which wrote the
    dead links into `src/data/whats-new.json`; caught by
    `tests/whats-new-links.test.ts`
  - Why deferred: out of scope; only the data was patched.

- [ ] **F4 — Pre-push full-suite gate didn't run in the cloud session**
  - Source: deferred at implementation
  - Where: `.claude/hooks/pre-push-check.sh` and how it's wired
  - Why deferred: tooling. The first push landed with 4 failing tests even
    though `node_modules` was installed.

## Context to start cold
- Measured at 412px: the band went from 227px to 348px (equal to the player
  rows), and the chip row's right edge went from 740px to 380px inside a
  396px card.
- The production check of `afl-fantasy.com/rosters` couldn't be fetched from
  the hotfix session; the user was asked to check it on a phone.
