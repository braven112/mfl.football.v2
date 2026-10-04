---
slug: trade-ledger-era-names
status: shipped
severity: P1
opened: 2026-10-04
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1324
hotfix_sha: 3a38a5f
followup_issue:
followup_pr:
shipped: 2026-10-04
followup_session:
---

# Follow-up: trade ledgers showed "Player #id" and today's team names

## What broke
Franchise and rivalry trade ledgers (both leagues) rendered every pre-2011
player as `Player #<id>` (e.g. #6955 = Larry Johnson) and labelled trade
partners, "sent" columns and future-pick origins with each slot's CURRENT
name — a Jun 2, 2007 AFL trade with 420 All-Stars read "Computer Jocks".

## What the hotfix did
- `scripts/fetch-historical-players.mjs` (prebuild step
  `fetch:historical-players`) backfills `players.json` for every season
  directory without one; the 12 files (TheLeague 2007-2010, AFL 2003-2010)
  are committed, so the step makes no request on later builds.
- `franchiseEraInYear()` in `src/utils/franchise-trade-asset.ts` resolves a
  slot's name/icon for a season from config `history`; used by both leagues'
  `franchises/[id].astro` and `rivalries/[pair].astro` for partner names,
  icons, tooltips, side labels and `FP_` "via" labels.
- Guard: `tests/franchise-trade-asset.test.ts`.

## Deferred items

None. Two items deferred at review (FP_ pick labels, the partner tooltip)
were fixed inside the hotfix PR before merge, so no issue or follow-up
session was opened.

## Context to start cold
The raw MFL slot matters: pass `partnerSourceId ?? partnerId` (or
`sourceFranchiseId ?? <own id>`), because config `history` is keyed by MFL
franchise slot while ownerHistory attribution can file a trade under a
different franchise id.
