# "Which leagues are full-management" is derived in three places

**Filed:** 2026-09-19, by `/live` step 5c for PR #1171.
**Source:** adding a third copy — the splash's league list — made the pattern visible.
**Bucket:** follow-up. All three are correct today and agree; this is a
coherence problem, not a defect. Do not fold it into #1171.

## What happened

`ALL_LEAGUES` carries a `bestBall` flag, and "the leagues that are NOT
best-ball" is now computed independently in three layers, each returning a
different shape:

| Where | Name | Shape |
|---|---|---|
| `src/utils/nav-utils.ts:38` | `BEST_BALL_NAV_SLUGS` | `Set<LeagueSlug>` — the complement |
| `scripts/lib/weekly-changelog-format.mjs:58` | `BOTH_LEAGUES` | `navSlug[]` |
| `src/pages/index.astro` | `splashLeagues` | `LeagueDefinition[]` |

Each is a one-line filter, so none is *wrong*, and they agree because they read
the same flag. The risk is the one `CLAUDE.md` names for `buildAttributor` and
`leaguesForStagedChange`: a rule with several implementations is a rule that
can be changed in one of them. The day "full-management" stops meaning exactly
`!bestBall` — a draft-only league that does run lineups, a best-ball league
given an apex — the three diverge silently, and two of the three are invisible
from the third.

`tests/weekly-changelog-format.test.ts` already fails on an inline `=== 'both'`
copy of the changelog's fan-out rule, which is the same instinct applied one
level up. Nothing covers the filter itself.

## Why it was not done in #1171

The fix crosses a layer boundary. A shared export belongs in
`src/config/leagues-data.mjs` (node scripts import it directly; app code goes
through `src/config/leagues`), so it would edit the changelog formatter and the
nav utils — both with their own guards — for a PR whose subject is the splash.
That is the "real refactor with its own blast radius" bucket.

## What to do

1. Export one derivation from `leagues-data.mjs` — `fullManagementLeagues()`
   returning `LeagueDefinition[]`, with the `bestBall` rationale in its
   docblock, since the name is the part that carries the meaning.
2. Rewrite all three call sites against it, keeping each one's local shape
   (`.map(l => l.navSlug)`, `new Set(...)`) at the call site rather than
   exporting three variants.
3. Guard it the way the `leagueHasOwnFrontDoor` rule is guarded in
   `tests/shared-host-league-hiding.test.ts`: assert the helper agrees with the
   registry DATA (`bestBall`), never with itself, and that no call site
   re-grows its own filter.

status: open
