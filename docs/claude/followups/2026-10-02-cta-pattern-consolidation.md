---
slug: cta-pattern-consolidation
status: open
severity: n/a
opened: 2026-10-02
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1306
hotfix_sha:
followup_issue:
followup_pr:
followup_session:
---

# Follow-up: consolidate the repeated `--cta-*` recipes

PR #1306 introduced `src/styles/cta.css` and moved ~110 CTAs onto it. Its
`/live` quality pass found four refactors that are real but each has its own
blast radius, so they were deferred rather than grown into that PR. None is a
bug; each removes repetition the migration left behind.

## 1. A named shade helper for custom fills

17 rules set `--cta-bg-hover: color-mix(in srgb, <same as --cta-bg> N%, black)`
(12 at 88%, 5 at 85% — the MFL Live pages and AflEventHero). A base helper,
`--cta-bg-shade: color-mix(in srgb, var(--cta-bg) 88%, black)`, would let each
site write `--cta-bg-hover: var(--cta-bg-shade)`.

Do NOT make the shade the base `--cta-bg-hover` default: the default primary
must keep `--btn-primary-bg-hover`, which `tokens-dark.css` deliberately
BRIGHTENS on hover. And the Storybook gallery's simulated-hover tile sets
`--cta-bg: var(--cta-bg-hover)`, which becomes a cycle once the hover is
derived from the fill — switch that tile to `background: var(--cta-bg-hover)`
first. Pick one percentage; 85 vs 88 is not a decision anyone made.

## 2. Route MFL Live's accent through the button tokens

`src/styles/mfl-live.css`, `src/pages/live/index.astro`,
`src/pages/live/standings.astro` and `src/pages/live/league/[id].astro` carry
the same five-declaration block pinning the CTA to `--league-accent`, because
the MFL palette does not remap `--btn-primary-*` in dark mode. Setting
`--btn-primary-bg` / `-bg-hover` / `-text` on the MFL Live layout root would
let a bare `cta cta--primary` do it — but it also changes every other
`--btn-primary-*` consumer on those pages, so audit them first.

## 3. A `cta--on-color` modifier for the white pill

`MatchupSplitHero.astro`, `AflEventHero.astro` (franchise variant) and
`best-ball-1/index.astro` each spell out white fill + white border + darkened
white hover + a dark ink, and the design-system page documents that as the
canonical custom-ground example. A modifier setting the first three, leaving
`--cta-ink` per site, turns the recipe into a class.

## 4. ~22 rules that restate "border = fill"

Since #1306's tidy commit the base `--cta-border` follows `--cta-bg`, so every
component rule writing `--cta-border` equal to its own `--cta-bg` (5 literal
`var(--cta-bg)`, 4 `var(--league-accent)`, 3 `#ffffff`, the rest their own
`--x-cta-bg`) is now dead and can be deleted. Mechanical, but it touches ~20
files, so it wants its own diff and a Chromatic pass.

## Also

`tests/cta-pattern.test.ts`'s allowlist staleness check only asserts the file
still contains the class string; recording which `ALLOWED` keys actually
suppressed a hit during the scan (as `tests/helpers/scan-guard.ts` does for
its own allowlists) would catch an entry that no longer suppresses anything.
