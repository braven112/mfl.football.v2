# Front Office hub: four spellings of the same money, and an unpinned mirror

**Filed:** 2026-09-18, by `/release-review` for the 2026-09-18 promotion.
**Source:** #1151 (Front Office hub), all four sites in one commit.
**Bucket:** follow-up. Nothing here is a defect on the current head — it is
duplication plus one missing guard, and unifying it changes rendering.

## What is there now

Four compact-money implementations, all reachable from one page
(`FrontOfficePanel.astro` renders all three components):

| Site | Precision | Sub-million | Sign |
|---|---|---|---|
| `src/components/shared/front-office-hub/CapProjectionTable.astro:65` `moneyShort` | `.toFixed(1)` | `$250K` | `−` (U+2212) |
| `src/components/shared/front-office-hub/ScenarioBar.astro:115` `short` | `.toFixed(1)` | `$250K` | `−` |
| `src/components/shared/front-office-hub/RosterAnalyticsPanel.astro:90` `money` | `.toFixed(1)` | `$250,000` | native `-` |
| `src/utils/contract-actions-client.ts:128` `formatSalaryCompact` | `.toFixed(2)` | `$250K` | none |

And `src/utils/formatters.ts:102` already exports `formatCompactNumber`, which
is the same idea without the `$`.

## The two separate problems

**1. The server/client mirror is pinned by a comment, not a test.**
`ScenarioBar`'s `short` lives in a client `<script>` and repaints cells that
`CapProjectionTable` server-rendered with `moneyShort`. The bodies are
byte-identical, and ScenarioBar's own comment says so deliberately — the
component ships both an exact and a short spelling per cell and lets CSS pick,
so a repaint that disagreed with the server render would be wrong the moment
the viewport changed. That invariant is real and currently enforced by nothing.

`tests/cap-scenario-boundary.test.ts` already reads BOTH files and is the
natural home: assert the two function bodies produce identical output across a
range of values (0, 999, 1_000, 250_000, 999_999, 1_000_000, 1_500_000, and the
negatives). This is the cheap half and could land on its own.

**2. Precision and tiers disagree across one page.**
`$1,500,000` reads `$1.5M` in three places and `$1.50M` in the fourth;
`$250,000` reads `$250K` in three and `$250,000` in `RosterAnalyticsPanel`.
The RosterAnalyticsPanel difference may well be deliberate — its donut labels
have more room than a projection table cell — so this needs a decision, not a
blind unification.

## Why it was deferred

Unifying changes rendered output, which means Chromatic diffs on promotion
week for a feature that just shipped. The right order is: land the guard test
first (no visual change), then make the precision call deliberately and review
the diffs.

## Done looks like

- One exported helper the hub components share, or an explicit note per site
  saying why its spelling differs.
- A test that fails if the server and client spellings drift apart.
