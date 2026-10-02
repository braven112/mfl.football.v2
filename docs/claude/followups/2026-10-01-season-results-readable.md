---
slug: season-results-readable
status: shipped
severity: P1
opened: 2026-10-01
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1285
hotfix_sha: 6d88aed
followup_issue: 1289
followup_pr: https://github.com/braven112/mfl.football.v2/pull/1292
shipped: 2026-10-01
followup_session: session_01QzWpYen2jPUDGHwuAbeyQd
---

# Follow-up: the player card's Season Results table was unreadable in dark mode

## What broke
In dark mode, the player card's Season Results table (shared by both leagues)
was unreadable. Unplayed weeks used `--color-gray-300`, which dark themes map to
a navy one shade off the card, and byes were faded to `opacity: 0.4`, so the
upcoming schedule vanished. On a phone the table also scrolled sideways,
cutting off "Rank vs QB". An owner reported it from a phone screenshot during
the season.

## What the hotfix did
Forward fix in `src/components/theleague/PlayerDetailsModal.astro`:
- All muted text in the table now uses `--content-text-muted`. That covers
  headers, week, status, non-starter, bye and empty rows.
- At ≤640px the long half of each header is visually hidden but still read by
  screen readers, and the opponent column drops its `min-width`.

Guard: `tests/player-modal-season-results-contrast.test.ts` (in the
`theming-and-assets` path-guard domain). Rule:
`docs/claude/rules/theming-and-assets.md` § "Muted text in the player card's
Season Results table". All four Copilot findings were fixed in the PR before
merge.

## Deferred items

- [x] **F1 — The rest of the player card still uses raw `--color-gray-400` for muted text**
  - Source: deferred at implementation (Claude, hotfix adjudication)
  - Where: `src/components/theleague/PlayerDetailsModal.astro`:
    `.pdm-owner__label` ~L680, `.pdm-metric__label` ~L851,
    `.pdm-metric--fa .pdm-metric__value` ~L856, `.pdm-section__title` ~L877,
    `.pdm-detail__label` ~L1093
  - Why deferred: outside the reported table, and widening the hotfix. Dark
    gray-400 is `#6b6b6b` / `#64788c` / `#767b85` depending on theme, all
    likely below AA on the dark card. Measure each against its real surface,
    move the failing ones to `--content-text-muted`, and widen the guard (or
    add a sibling) to cover the whole modal.
  - **Worked (2026-10-01).** Re-validated: still true, and worse than stated.
    gray-400 fails AA in EVERY theme, light included (2.54:1 on white; dark
    2.84 / 3.28 / 3.80). Four more declarations used gray-500, which fails only
    TheLeague's default dark card (4.38:1): `.pdm-watch__desc`,
    `.pdm-claim__desc`, `#pdm-week-body dt`, `.pdm-saltile__label`. All nine
    now use `--content-text-muted` (4.83 light, 5.38 / 5.59 / 6.13 dark). The
    guard gained a modal-wide scan (no raw gray-300/400/500 text colour
    anywhere in the file), mutation-checked. Verified in Chromium at 375px in
    both themes. No reviewer comments landed on #1285 after the merge.

## Context to start cold
- `--content-text-muted` is `var(--color-gray-500)` in light (`tokens.css`) and
  `#9a9a9a` / `#8fa0b3` / `#9aa0a9` in the three dark variants
  (`tokens-dark.css` ~L120/551/659).
- Ruled out: raw gray steps for muted text. Even gray-500 is about 4.4:1 on
  the default dark card `#262626`.
- No AFL twin of this component exists. The `afl-family` pages import this
  same file.
- Verify with the `verify` skill. Rendering from the page is easiest via
  `window.openPlayerDetailsModal({id, position, name, team})` on
  `/theleague/rosters` at 375px, with the `theme_pref=dark` cookie.
