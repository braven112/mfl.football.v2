---
slug: render-function-size-archies
status: open
severity: P1
opened: 2026-10-07
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1343
hotfix_sha: 6c51060
followup_issue: 1344
followup_pr:
followup_session:
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

- [ ] **F1 — Function headroom is only ~12–19 MB; raw `data/` still rides along**
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
