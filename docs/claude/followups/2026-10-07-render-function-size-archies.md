---
slug: render-function-size-archies
status: shipped
shipped: 2026-10-07
severity: P1
opened: 2026-10-07
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1343
hotfix_sha: 6c51060
followup_issue: 1344
followup_pr:
followup_session: https://claude.ai/code/session_019qL7gfPnKNQVz24jpC4uw7
---

# Follow-up: _render over 250 MB once the Archies landed on staging

## What broke
Every `staging` deploy failed at "Deploying outputs" from 2026-10-07: `_render`
was 254.55 MB against Vercel's 250 MB limit. Staging added the Archies league
(~59 MB of `data/archies/mfl-feeds`), and `scripts/lib/archived-feed-files.mjs`
hardcoded `['theleague', 'afl-fantasy']`, so every Archies season went into the
function.

## What the hotfix did
`LEAGUE_DIRS` in `scripts/lib/archived-feed-files.mjs` is now derived from the
registry's `dataPath`, and a guard test in `tests/archived-feed-files.test.ts`
fails if a registry league is missing. A local `astro build` of staging with the
fix measured `_render.func` at 238 MB.

## Deferred items

- [x] **F1 — Function headroom is only ~12–19 MB; raw `data/` still rides along**
  - Source: deferred at implementation
  - Where: `astro.config.ts` (`includeFiles` / `excludeFiles`), and the `fs`
    readers using `join(process.cwd(), dataPath, 'mfl-feeds', year)`, e.g.
    `src/components/shared/keepers/KeeperPlanner.astro:174`,
    `src/pages/afl-fantasy/draft/order.astro:30`,
    `src/pages/theleague/index.astro:807`
  - Local measure of staging + fix: `_render.func/data/theleague` 45 MB,
    `archies` 29 MB, `afl-fantasy` 26 MB. That is ~100 MB of raw feeds copied
    by @vercel/nft's unresolvable-path fallback, on top of the globbed copies
    already compiled into `dist/`.
  - Why deferred: shrinking it means auditing every `fs` reader and moving to
    an explicit include list (or nft ignore). That's a multi-file change, not
    something to do in a hotfix. Third time the limit has been hit
    (2026-07-08, 2026-08-16, now).

## Context to start cold
- Measure: `pnpm exec astro build && du -sh .vercel/output/functions/_render.func/data/*`.
  Local numbers have run about 7 MB above Vercel's.
- History: `docs/claude/insights/domains/deployment.md` § "The function bundle
  is bigger than you think", and the 2026-07-08 / 2026-08 entries.
- `excludeFiles` takes explicit paths only, no globs.
- Keep `SEASONS_KEPT = 3` (rollover stub reasoning is in the module header).

## Outcome (2026-10-07)

F1 was **still true** and was worked as a scoped `excludeFiles` trim. Moving
league data out of the deploy entirely (Vercel Blob + Redis) is a separate plan.

- An audit of every runtime `fs` read under `src/` found two classes that
  ship but are never read off disk:
  - `mfl-feeds/<year>/roster-history/`: glob-only.
  - every `derived/` file except `player-identity-union.json` and
    `espn-nfl-id-backfill.json`, both read by `player-map.ts`.
- Both are now excluded in `scripts/lib/archived-feed-files.mjs`
  (`GLOB_ONLY_FEED_DIRS`, `FS_READ_DERIVED`).
- Staging measured locally: `_render.func` went from 225 MB to 183 MB, and
  `data/` inside it from 99 MB to 57 MB.
- Guard: `tests/archived-feed-files.test.ts` scans every fs-importing file in
  src/ and fails if one names an excluded file. A planted read of
  `derived/franchise-history.json` was confirmed to fail it.
- Left in place: the 25 feed basenames read through `fs` in the 3 kept seasons
  (incl. the Archies' ~9 MB `weekly-results-raw.json` per season). Generic
  readers (`lineup-sources`, `weekly-player-results-feed`) take any registry
  league and year, so trimming those means changing the readers. That belongs
  to the Blob plan.
