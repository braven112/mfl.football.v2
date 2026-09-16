# Storage, bundle discipline, and the Astro 7 compiler

> Deep reference extracted from `CLAUDE.md` (Aug 2026 slim-down). `CLAUDE.md`
> carries the one-line rule and points here; this file is the authority on the
> reasoning. Every rule below is load-bearing — each one is a bug that shipped.

## Storage & bundle discipline (Aug 2026 perf overhaul)

Four invariants from the storage/perf work — breaking any of them quietly
regrows a 7 GB `.git` or a 30 MB server chunk:

- **MFL returns arrays in nondeterministic order, so never write a feed
  with a plain `writeFileSync` + byte diff.** All feed/data writers go
  through `writeJsonIfChanged` (`scripts/lib/canonical-json.mjs`): order-
  blind semantic compare (volatile keys like `fetchedAt`/`lastFetched`
  excluded), skip the write when nothing real changed. Files are NEVER
  re-sorted on disk (MFL standings row order is official). Before this,
  ~95% of all commits were byte-shuffles of identical data — that's how
  `.git` hit 7 GB on a 249 MB tree. Roster-sync runs `--refresh-live`,
  not `--force`: rosters/transactions/standings stay on the 5-minute
  cadence; players.json + the 17-call weeklyResults loop fetch once/day.
- **No all-years eager globs over megafiles.** `players.json` /
  `weekly-results-raw.json` globs must carry the current-era year filter
  (`20{2[5-9],[3-9][0-9]}`, floor-bump reminder built into
  `tests/current-era-feed-globs.test.ts`). Pages that genuinely render
  every season read a prebuild-derived snapshot instead — TheLeague
  rosters uses `data/theleague/derived/roster-season-payloads.json`
  (`compute-roster-season-payloads.mjs`; the payload builder is shared
  with the page via `scripts/lib/roster-season-payload.mjs`).
- **A cron-generated data file must be read with `import.meta.glob`, not a
  static import.** A static `import x from '../../../data/<league>/foo.json'`
  is resolved at BUILD time, so the build hard-fails until the workflow that
  generates it has run at least once — and it fails for every league that will
  never have the file, not just the one you are waiting on. An eager glob over
  the exact path returns `{}` instead, which the page treats as "no data yet"
  and falls back. `owner-last-visit.json` (commissioner-only, so leagues we
  only own a team in never get one) is the worked example in both
  `activity.astro` routes.
- **The schefter feeds are bounded, not append-forever.** Active window =
  `SCHEFTER_ACTIVE_MAX` (300) posts; a weekly workflow rotates the tail
  into `schefter-archive/<year>.json` beside each feed, and `mergeFeed`'s
  `archivedThroughTimestamp` watermark stops the 15-minute scans from
  resurrecting archived posts. Article permalinks and the OG renderer
  fall back to the archives — new single-post surfaces must too.
- **The build never writes a committed feed.** Only a run that COMMITS
  `schefter-feed.json` may add posts to it. `prebuild` recomputes
  `franchise-history.json` on every production deploy, and until Sept 2026
  that run also prepended milestone posts to the DEPLOYED feed: three week-1
  "season honor" posts were live on theleague.us and in no commit, so git
  and production disagreed and a bad post could only be removed by
  redeploying. Milestone emission is opt-in (`--emit-milestone-posts`),
  passed only by the lanes that commit the franchise-history chain through
  `scripts/recompute-derived-chain.mjs` (`derived-history-chain.yml`,
  `backfill-historical-feeds.yml`, `fetch-owner-names.yml`), which commit the
  snapshot, everything derived from it, and the feed together.
  `tests/milestone-emission-lane.test.ts` and
  `tests/derived-chain-lane.test.ts` pin that. A new prebuild step that writes
  a feed needs the same split: compute in the build, post from the committing
  workflow.
- **Retention rules live in `scripts/lib/retention-policy.mjs`** (What's
  New active cap + archive, roster-history keeper window / weekly
  keyframes). The July 16-31 roster snapshots are the official AFL keeper
  record: never prune them, and never skip writing them.

Per-page HTML caching (s-maxage) was evaluated and rejected: the layout
personalizes nav/footer from the session on every page, so shared caching
would leak one owner's nav to everyone. Requires client-side nav
personalization first.

`scripts/measure-baseline.mjs` prints the storage/churn health snapshot
(git sizes, commit rates, feed sizes, `--ttfb` for prod timings); baseline
from 2026-08-16 is committed under `data/perf-baseline/`.


## CI installs with pnpm, never npm — and a no-install job stays dependency-free

Every workflow that needs `node_modules` installs through the one shared
preamble, `uses: ./.github/actions/setup` (checkout first — `actions/checkout`
cannot run inside a composite action). Three separate failure modes sit behind
that one line, and all three have shipped:

- **`npm ci` / `npm install` ignores `pnpm-lock.yaml`.** It re-resolves the
  whole tree from the registry and enforces peer ranges strictly, so a publish
  upstream breaks us with no code change here. On 2026-09-11 a new vite release
  pulled a `vitest` peer that clashed with `@storybook-astro/framework`, npm
  answered `ERESOLVE`, and every npm-installing workflow — Schefter scan, the
  rumor mill, trade speculation (and with it the franchise-history milestone
  scan), and Roger's Sunday lineup reminders — died at the install step. Four
  days, silently, because a cron that fails is a red run nobody is watching.
  This is also why the peer set is fragile at all: vitest 1.x + root `vite@^5`
  are intentionally separate from Astro's vite 8 (see above), which npm reads
  as a conflict and pnpm does not.
- **A bare `pnpm/action-setup` installs nothing and may not even start.** With
  no version resolvable it fails `No pnpm version is specified` — that is how
  `schedule-release` failed daily from at least 09-10. Use the shared action;
  it runs `pnpm install --frozen-lockfile`.
- **A job with NO install does not fail — it goes green having done nothing.**
  Nearly every package here is reached through a dynamic `import()` inside a
  try/catch, so an empty `node_modules` surfaces as `schefter-scan`'s own
  comment records it: "Redis import failed", exit 0, no posts, green check.
  Eight workflows deliberately skip the install because their scripts are
  dependency-free ESM (node built-ins + `fetch`). That is a claim about the
  transitive import graph, not about the entrypoint, and it decays the moment
  someone adds an import three modules deep.

The last point is why **`scripts/lib/redis.mjs` is REST-only and the SDK client
factory lives in `scripts/lib/redis-client.mjs`.** While both halves shared one
file, eleven REST-only scripts declared an `@upstash/redis` dependency they
never used, and five no-install workflows inherited it — so the question "does
this job need an install?" could not be answered from the import graph at all.
Keep `redis-client.mjs` as the only file in `scripts/lib` that names the
package.

The pnpm **version** has one home: `packageManager` in `package.json`. CI
(`pnpm/action-setup` reads it when given no `version:`), Vercel and local
corepack all read that field, and `action-setup` throws `Multiple versions of
pnpm specified` if the composite action carries a second copy that disagrees.
Bump it there and nowhere else.

Guard: `tests/workflow-install-guard.test.ts` — forbids `npm ci|install|i` and
a raw `uses: pnpm/action-setup@` anywhere under `.github/`, requires the
`packageManager` pin and the absence of a `version:` in the shared action, and
walks each no-install workflow's `node …` entrypoints transitively
(`tests/helpers/module-graph.ts`) to fail with the exact
`workflow → script → package` chain. Routed by the `github-workflows` domain in
`.claude/hooks/path-guard.json`, which also covers `.github/actions/**` and
`package.json`.


## Astro 7 — strict Rust compiler, pinned compressHTML

Upgraded to Astro 7 (Vite 8/Rolldown, @astrojs/vercel 11) in July 2026.
Gotchas the new compiler enforces that the old Go compiler silently fixed:

- **No HTML comments directly inside template expressions** — `{cond && (
  <!-- x --> <div>...` is a hard CompilerError. Put the comment above the
  expression or inside the element/fragment.
- **Tags must balance exactly** (no auto-closing at EOF, no tolerating a
  mismatched closer). Errors surface one file per build; to see them all at
  once, run `@astrojs/compiler-rs#transform` over `src/**/*.astro` and
  collect `diagnostics` where `severity === 'error'`.
- `compressHTML: true` is pinned in `astro.config.ts` because v7's new
  default `'jsx'` strips whitespace between inline elements site-wide.
  Don't remove it without a visual audit.
- Known dead CSS (predates v7, now warned on by lightningcss at build):
  `:global()` inside `<style is:global>` blocks (both lineup pages +
  cr-list) ships literally and browsers drop those rules. Fixing it will
  *activate* previously-dead rules — do it deliberately, with screenshots.
- vitest 1.x + root `vite@^5` are intentionally separate from Astro's
  vite 8 (pnpm isolates them; vitest.config doesn't use astro/config).

