# Release review — 2026-10-13

**Verdict: GO.** The one fix-before-promotion item was fixed in #1381.

**Range:** `origin/main..origin/staging`. 24 feature commits plus the merge-downs. Code only: 185 files, +9.8k/−1.3k.

**On the train:**
- Icon sets per league (#1371, #1374, #1375, #1376).
- Standings board in Editorial and Primetime themes.
- Free Agents in Primetime.
- Front-page homepage, with Archie's first (#1362).
- 60-second live roster and transaction refresh (#1355).
- Analytics: moved pages folded, record pages named (#1356).
- Rosters player sheet (#1352).
- Usability pass, including the My Team card (#1350).
- Archie's franchise history through renumbering (#1351).
- One-line GroupMe Pecking Order and Gauntlet posts (#1348).

## Blocks promotion

None remaining. One blocker found and cleared:

- **Merge-down was broken from 2026-10-10.** There were seven source conflicts: Owner Activity's
  shared component, the Schefter post lookup moving to Redis, and changelog staging. Fixed in #1379.
  Main's cron then re-conflicted on Archie's derived chain, which was recomputed whole in #1380.
  #1379 also fixed two things:
  - An unterminated `ARGS="` in `fetch-owner-names.yml`.
  - Main's Redis feed pull, which was added to the new `derive-owner-history` job.
- **Expect one more conflict before promotion.** Main's cron will keep re-conflicting on
  `data/archies/derived/*` until this promotion lands `ownerHistory` on main.

## Stored-shape compatibility

Every write is additive or unchanged:

- New `insights:d:<date>:links` / `:userlinks` hashes (`site-insights.ts`). Main never reads them.
- `mfl:rosters*` and transactions cache: only the freshness threshold moved, from 2 min to 60 s. The shape is unchanged.
- `page-usage.ts`: read-only, through existing readers.
- The theme-preview cookie and the via-key in `sessionStorage` are per browser.

## Build rehearsal

`PREBUILD_FULL=1 pnpm prebuild` exited 0 in 43 s. The only failures were network:
- 2 NFL dark logos (CHI, NYG) fell back to the ESPN CDN.
- The 2027 MFL ADP and FantasySharks feeds returned 404, which already happens on main.

Derived output changed only in stamps and live data.

## Fix before promotion

- **Archie's rivalry record counted reused franchise ids.** Fixed in #1381.
  - Cause: `PackageFrontPage` read `matchupHistory[opp]`, which is keyed by the id the opponent played under that season.
  - Effect: about half of Archie's team pairs showed a wrong all-time record. Pirates vs Jackalopes read 2–1; it is 0–1.

## Follow-up

- **Key `matchupHistory` / `headToHead` by the attributed team in a renumbering league.**
  - Do it in the derived chain, through `recompute-derived-chain.mjs`, with a guard.
  - This is the root of the item above, and it also skews Archie's franchise-page top rivals (`FranchisePage.astro:168`).
- **`tallyMarketMoves` is a fourth parser of MFL's transaction string** (`free-agent-market.ts:47-70`).
  - It is not in the `tests/contract-eligibility.test.ts` parity corpus (schefter.md, "A parity test is only as strong as its corpus").
  - Legacy `N|N|Z` shapes would count `0000` as a drop.
- **Two "your team this week" cards were built the same week.**
  - #1350's `loadMyTeamWeek` uses `findNextGame`; #1362's front-page TeamBand uses `stripWeek`.
  - Point the front page at `loadMyTeamWeek`.
- **TheLeague's homepage awaits three live MFL reads in sequence** (`index.astro` `loadMyTeamWeek`, transactions, rosters).
  - #1355 halved the cache life, so misses are more likely. Run them with `Promise.all`.
- **Story-coverage backlog −8 without new stories.**
  - `spriteUrlFor(Astro.url)` matches `ASTRO_DATA_RE` (`scripts/lib/story-coverage.mjs:40`), reclassifying presentational components.
  - Exempt that read.

## Ratchets

| Baseline | Before | After | Why |
|---|---|---|---|
| typecheck | 1316 | 1316 | Re-measured on the merge-down and on #1381 |
| page-fork, clientrouter-init | — | — | Unchanged |
| design-literal fontSize | 2068 | 2059 | Standings CSS moved into tokenized `standings-board.css` |
| story-coverage backlog | — | −8 | Reclassified (see follow-up) |

## Checked, nothing found

- **Sibling drift:** the TheLeague-only edits are icon wiring or reach the twins through shared components.
- **Icon ids:** present in both sprites.
- **Client bundle:** no new `client:*` islands.
- **Duplication:** no new duplicates beyond the follow-ups.
- **GroupMe change:** scripts only, with no storage.
- **Chromatic:** new stories come from #1350, #1362, the Standings commits and Free Agents in Primetime. Icon changes only added glyphs.
