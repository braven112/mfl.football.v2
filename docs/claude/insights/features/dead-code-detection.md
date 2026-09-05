# Detecting dead code in this repo (reachability, not grep)

Written 2026-09-04, after pruning the `dynamic-matchup-previews` cluster:
36 files, 10,487 lines, none of it reachable from any entry point
(PR #764; the single-component precursor was PR #757).

## Why grep cannot find a dead cluster

`MatchupSelector.astro` was found by grep because it happened to have no
importer. The other 17 files in the same subtree did have importers —
**each other** — so every one of them looked referenced.

The cluster died all at once when its only entry point, the
`matchup-preview-example` prototype page, was deleted in July 2026
(recorded in `docs/features/player-status-integration-summary.md`).
Removing the root orphaned the whole tree while leaving every internal
edge intact.

**So "has importers" is not evidence of life.** The question is whether a
file is reachable from an entry point, and that is a graph traversal, not
a text search. The failure mode is quiet: a cluster can sit for over a
year, get maintained (this one received a ClientRouter fix in PR #755),
and still render nothing.

## Building the graph — the two mistakes that matter

Walk `src/`, `packages/`, `scripts/` **and the root config files**, then
traverse from every entry point: `src/pages/**`, `src/middleware*`,
`src/layouts/`, `scripts/`, `astro.config.ts` (~459 entries here).

**1. Match side-effect imports, or you will report live files as dead.**
A specifier regex built around `from '...'` misses `import 'x';`, which
has no `from`. That single gap made a first pass report
`src/utils/ensure-pt-timezone.ts` dead — a file pinned into production
(PR #358) by exactly that form, from both `src/middleware.ts` and
`astro.config.ts`. Cover all four shapes:

```js
/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g
```

Fixing this moved the reachable count 1052 -> 1102. **Sanity-check any
graph against files you know are live before trusting a "DEAD" verdict** —
if it flags something in `CLAUDE.md` or a known prod pin, the graph is
wrong, not the file.

**2. Bare specifiers are real edges.** `@mfl/shared-types` and the other
workspace packages are imported by name, not path. A resolver that returns
`null` for anything not starting with `.` will call a live package dead.

## Verdicts the graph gets right that name-matching gets wrong

Both directions burned in this prune, so check both:

- **Live things with cluster-sounding names.** `src/utils/mfl-matchup-api.ts`
  is imported by six API routes (`cut-player`, `move-to-ir`,
  `move-to-practice`, `trade-bait`, `trades/submit`, `waiver-claim`) and is
  the single edge keeping `src/types/matchup-previews.ts` alive.
  `PlayerInjuryModal.astro` is live next to a deleted `InjuryManager.astro`.
- **Test-only survivors.** `src/utils/lineup-data-builder.ts` has no `src/`
  importer but is imported by `tests/projections.test.ts`, which tests a
  different feature. Deleting it breaks a real test. Treat "no src importer,
  one test importer" as its own category needing a judgment call, not a
  sweep.

## Green tests are how dead code stays invisible

4,465 lines of passing property-based tests covered this cluster. Ten
imported the dead modules directly. The other four imported **only types**,
built `fast-check` generators for those shapes, and asserted against
objects they constructed themselves — so they would have kept passing after
every line of production code was deleted.

A test that imports only types from the module it claims to cover is
testing nothing. When auditing, check what a test actually imports from
`src/`, not what its filename or its `Property N:` tag says it covers.

## Docs are the other stale layer

`docs/claude/loading-inventory.md` cited `InjuryManager.astro` twice as
"the model" for the button-loading pattern. Both rows were already wrong
before this prune: the component had stopped carrying that inline CSS and
was importing `src/styles/loading.css`, where the pattern now lives as
`.loading-btn.is-loading::after` with eleven live importers. Deleting a
file is a prompt to check what documented it — the doc may be describing a
state that ended long ago.

## Known remaining candidates (2026-09-04, untraced)

Flagged by the corrected graph, not yet investigated:
`src/utils/projections.ts`, `rankings-parser.ts`, `rankings-merge.ts`,
`espn-feed.ts`, `loading-html.ts`, `weekly-scores.ts`, and
`RankingsImporter.astro` — the last referenced only from
`docs/features/auction-predictor-*.md`, which has the same shape as this
cluster (an unbuilt spec with docs but no entry point).

## Expect the type baseline to move

Deleting ~7k lines removed 36 type errors (1805 -> 1769). `pnpm test:types`
fails on a DROP as well as a rise, so a prune always includes a retighten of
`tests/fixtures/typecheck-baseline.json` in the same PR.
