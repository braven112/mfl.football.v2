---
slug: maverick-throwback-era
status: shipped
shipped: 2026-10-01
severity: P1
opened: 2026-10-01
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1282
hotfix_sha: 5f996db
followup_issue: 1286
followup_pr:
followup_session:
---

# Follow-up: Maverick's 2016–2024 era art, and the Throwback default

## What broke
Franchise 0003's (Maverick) 2016–2024 era pointed at the 2025 rebrand art,
because the original files on `theleague.us/images/team_banners/` 404. The
franchise and owner pages showed a logo those seasons never wore, and the era
was filtered out of Throwback Week as "same as current". TheLeague's Throwback
Week is week 4, which was live when this shipped, and the commissioner wanted
Maverick in the original Mel Gibson look. P1: cosmetic, but tied to a deadline.

## What the hotfix did
- Recovered `maverick.png` from `https://mfl.football/images/team_banners/`
  (a rehost of the old theleague.us folder; it needs a browser User-Agent,
  curl's default gets a 406). Saved as
  `public/assets/theleague/history/maverick_2016_banner.png`. The circle icon
  `maverick_2016_icon_circle.png` is the owner's 200px copy, masked to a circle.
- `src/data/theleague.config.json`: the 0003 2016–2024 era now points at those
  files, labelled "The gunslinger", with colours `#b80d1a` / `#e8a848`
  hand-sampled from the banner.
- `src/data/theleague/throwback-config.ts`: `DEFAULT_THROWBACK_ERA['0003']`
  changes from 2012 to 2016.
- Derived chain recomputed with `scripts/recompute-derived-chain.mjs`.
- Tests: `KNOWN_INVISIBLE_ERAS` drops Maverick (its comment records the rehost);
  the throwback claim tests' "reserved default" example moved from Poker
  2012 to Drunk Indians 2019 (0004).

## Deferred items

- [x] **F1 — `derive-era-palettes.mjs` only reads the AFL config**
  - Source: deferred at implementation
  - Where: `scripts/derive-era-palettes.mjs:43` (`const CONFIG = 'data/afl-fantasy/afl.config.json'`)
  - Why deferred: making it league-aware widens a P1 data fix; the Maverick
    palette was hand-sampled instead (red wordmark, gold edging). Either take a
    `--league` flag through the registry, or record that TheLeague palettes are
    hand-set. Then re-derive 0003 2016 and compare with the hand-picked pair.

- [x] **F2 — Two insight docs still say theleague.us art is only on the Wayback Machine or gone**
  - Source: deferred at implementation
  - Where: `docs/claude/insights/features/throwback-week.md:39`,
    `docs/claude/insights/domains/frontend.md:2252`
  - Why deferred: docs-only, no deadline. Add that
    `https://mfl.football/images/team_banners/<file>` still serves the same
    files (browser UA required), checked Oct 2026 for maverick,
    computer_jocks and cowboy_up. Computer Jocks 2016 and Cowboy Up 2018 were
    checked and deliberately left: their old art matches today's (Cowboy Up
    pixel-identical, Computer Jocks only a darker green).
  - Done: both docs updated.

## Context to start cold
- The 2016–2024 banner was in every 2016–2024 `data/theleague/mfl-feeds/<y>/league.json`
  franchise `logo` field; `icon` was `maverick_icon.png`, a 300×50 strip, which
  is why the circle icon came from the owner instead.
- Poker in the Rear 2012 (0003) was the previous default; it is now an open
  departed-owner era any owner may claim.
- Nothing here touched the AFL; `sibling-drift.mjs` found no twin.
