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


## A job that PUSHES must check out with the deploy key

GitHub will not start a workflow from a push made with the default
`GITHUB_TOKEN`. That is deliberate loop-prevention on their side, and it is
**silent**: the push succeeds, the branch moves, and nothing runs.

`staging-merge-down.yml` checked out without `ssh-key`, so every commit it put
on `staging` arrived under that token. `ci.yml` declares
`push: branches: [staging]` and had never once fired for them — measured
2026-09-16: **zero** workflow runs on staging's tip, and zero on the three
merge-down commits before it. Two things broke, neither of which announced
itself:

- `staging` is not a scratch branch. Real owners browse it at
  `staging.theleague.us` and it writes to production's Upstash, and it had been
  serving merge-down commits no test ever ran against.
- `/promote` step 4 refuses a tip with no check runs — the right call — and the
  tip is a merge-down commit on almost every release, because `main` takes ~30
  bot data commits a week. The release gate would have blocked essentially every
  promotion, for a reason that reads like a broken check rather than a real
  finding, which is the fastest way to teach someone to wave a gate through.

So: **if a job pushes commits or tags, that job's checkout carries
`ssh-key: ${{ secrets.DEPLOY_KEY }}`.** This is not about permission — the
default token can push fine — it is about whether anything downstream notices.

Pushing is **three** mechanisms, not one, and a guard that knows only the first
passes the rest by never looking at them: `git push` in a `run:` step, the
shared `./.github/actions/commit-push`, and `scripts/commit-feed-and-push.mjs`
(the concurrent-safe commit+push helper ten workflows invoke).

Guard: `tests/workflow-push-triggers-ci.test.ts` — parses each workflow and
checks per JOB, not per file, because `mfl-integration-test.yml` has two
checkouts and a file-level match lets the key on the non-pushing one vouch for
the pushing one. It also refuses to mistake prose for a push:
`roger-date-audit.yml` names `git push` in a header comment and in an `echo`
telling a human what to run locally, and pushes nothing. Routed by the
`github-workflows` domain.


## GitHub's `schedule` is not a cadence — the Vercel cron is the primary trigger

GitHub Actions may drop a scheduled event, and on this repo it does, in bulk.
Measured over 300 `roster-sync.yml` runs: until 2026-08-26 the delivered cadence
held a 21-47 min median; **from 2026-08-27 it collapsed to a 2-5 HOUR median and
5-8 runs a day, against the 288 that `*/5` asks for.** No workflow file changed
on that date, no run was cancelled, every conclusion was `success`, and every
other scheduled job in the repo degraded identically the same day — the repo-wide
run count went 589 → 135. Push-triggered runs were never affected. This is
GitHub declining to dispatch, which its docs reserve the right to do, and it is
not a delay you can wait out.

Why it is not merely late data: **the committed MFL feeds are baked into the
build** (`import.meta.glob(..., { eager: true })`), and a sync commit to `main`
is what redeploys production. No sync run means no commit, which means no
redeploy, which means the site cannot move — however correct the page code is.
On 2026-09-16 TheLeague sat a full hour past the Wed 19:00 PT waiver run still
serving pre-waiver rosters: the last sync had landed at 18:20 PT and the next
was hours out. `resolveWaiverWindow` had already flipped to "PROCESSED" on
schedule; there was simply no deploy carrying the new rosters.

So the schedule lives in **`vercel.json` → `crons`**, which fires
`/api/cron/roster-sync`, which `workflow_dispatch`es the workflow. The
workflow's own `schedule:` is a fallback for a Vercel outage, at `*/30`.

- **This bridge already existed and was dead for six months.** It shipped
  2026-03-21 with its `crons` entry and the entry was removed eleven hours
  later (`4179e14`, "unreliable on Hobby plan") with the route left behind.
  That reason expired when the account moved to **Vercel Pro**, which supports
  minute-granularity crons; Hobby is daily-only, which is what made it look
  broken. Two other files cite the route in their comments as the bridge shape
  to copy, so it read as live infrastructure the whole time.
- **Do not "restore" the workflow to `*/5`.** That number was never being
  delivered, and alongside the Vercel cron it only multiplies production builds
  — 91% of the Vercel bill (see `scripts/vercel-ignore-build.mjs`). Every sync
  commit to `main` is a production build, so the cron's cadence IS a spend
  decision. `*/15` is the deliberate balance.
- **A cron path is an ordinary public route.** These bridges start workflows
  that commit to `main` with Actions secrets, so the `CRON_SECRET` bearer check
  is load-bearing, as is `outboundAllowed()` — staging and previews carry
  production's credentials and must never dispatch.
- Requires `CRON_SECRET` and a `GH_PAT` with `actions:write` in Vercel's
  **production** environment. Vercel only sends the bearer token when
  `CRON_SECRET` is set, and only production deployments run crons.
- Trigger one by hand with `pnpm dlx vercel crons run /api/cron/roster-sync`.
- **Never quote a cron STEP expression inside a `/** … *\/` block comment.** It
  contains the two characters that close one, so the comment ends mid-sentence
  and the remaining prose is handed to the compiler as code. Writing one into
  this route's JSDoc cost 39 type errors in a single file, and **nothing but
  `astro check` can see it**: `pnpm test:unit` does not type-check and no unit
  test imports an API route, so the whole suite stays green. Spell the cadence
  out in words, or use a line comment.

Guard: `tests/vercel-cron-targets.test.ts` — checks both directions, because
each failure is silent in its own way. An orphaned bridge (a route with no cron)
is dead code wearing the costume of a live path; a dangling cron (a cron with no
route) is a 404 on a schedule nobody reads. It also pins the `CRON_SECRET` gate
on every cron target and fails a sub-30-minute `schedule:` in `roster-sync.yml`.
Routed by the `github-workflows` domain.


## A merged feed needs a FLOOR, not just an empty check

`data/<league>/mfl-feeds/<year>/playerScores-by-week.json` is written by
accumulation: every daily pass refetches weeks 1-18 and merges each one in, so
the committed file is the only record of a finished week. **MFL serves degraded
bodies at HTTP 200** — that is the whole reason `writeOut` carries its own
error-payload guard — so "the response parsed" is not "the response is
complete".

The first version of that merge refused only `count === 0`, while its own doc
comment promised that a transient bad response would leave a good week alone.
Those are different claims. An empty answer is MFL saying "not played yet"; a
truncated answer is MFL answering wrongly, and any non-zero row count was
enough to overwrite 484 committed scores with a handful — deleting every other
player's week from the player modal, with nothing left to re-derive it from.

The rule: **a finished week's pool does not shrink.** `weekMergeDecision`
(`src/utils/player-week-scores.mjs`) refuses an incoming week that carries less
than `WEEK_SHRINK_FLOOR` (0.9) of the rows already committed for that week, and
logs `::warning::` when it does. The floor is not 1.0 because a genuine MFL stat
correction can void a handful of rows and refusing those would strand the week
on stale data forever. This is the same shape as the `wouldDowngrade` check the
current-week `weeklyResults` merge above it already applies.

Keep the policy in `weekMergeDecision` rather than inline in the fetch script:
inline, it is only reachable behind a live MFL fetch, which is exactly what CI
and every agent session cannot do. Guard:
`tests/weekly-player-results-full-pool.test.ts`.

## A daily-gated feed does not backfill on the day it ships

`fetch-mfl-feeds.mjs` runs under `--refresh-live` ~96x a day, and the expensive
daily-only work — `players.json`, the weeklyResults loop, the 18-week
`playerScores` loop — is skipped when `isFreshToday()` says the daily set
already ran (`skipDailyFeeds`). `isFreshToday` reads the committed
`fetch.meta.json` stamp and compares Y/M/D in the runner's clock, which on
GitHub is UTC.

So **a new daily feed added mid-morning UTC does not start filling until the
first run after the next UTC midnight** — up to 24 hours of the feature
shipping with only whatever was committed by hand. `playerScores-by-week.json`
shipped at 07:38 UTC on 2026-09-17 against a stamp of 01:21 UTC that same day,
so both leagues sat on a week-1-only seed for the rest of the day and the newly
visible free agents, taxi-squad and IR players showed one scored week instead of
all of them.

Nothing is broken by this and nothing should be "fixed" to bypass it — the gate
is what keeps 18 requests per league from running 96 times a day. Just know the
latency is real when you ship one, say so in the PR, and either seed the file
honestly or wait for the next UTC day before verifying.


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

