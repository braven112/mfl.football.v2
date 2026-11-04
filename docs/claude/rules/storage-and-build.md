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
  `archivedThroughTimestamp` watermark stops the recurring scans from
  resurrecting archived posts. Article permalinks and the OG renderer
  fall back to the archives — new single-post surfaces must too.
- **The build never writes a committed feed.** Only a workflow run may add
  posts to `schefter-feed.json` — since Oct 2026 by publishing it to Redis
  through `commit-feed-and-push.mjs` (see "The Schefter feed lives in Redis"
  below), or by committing it. `prebuild` recomputes
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

### The function size budget

The whole site deploys as ONE Vercel function (`_render`) — Astro 7's adapter
has no per-route split — and Vercel rejects it above 250 MB uncompressed. It
has failed a deploy three times (the raw `data/` tracer fallback at 263 MB, the
Archie's feed archive, the logo tracer's native vectorizer at 250.69 MB on
2026-10-29), each time with no signal before the deploy.

`scripts/check-function-size.mjs` measures `.vercel/output/functions/` and
prints the biggest contributors, grouped so the list names a cause (`dist chunk:
players ×27`, a pnpm package, `data/<league>/mfl-feeds/*/<file>`). It runs
report-only in `postbuild` on every build, and with `--enforce` in CI's
`Function size` job, which fails above `BUDGET_MB` (240). The 10 MB of headroom
is for data growth: feeds grow weekly in season and bot sync commits to `main`
open no PR, so the staging push run is the first to see it.

When it goes red, do not just trim the nearest file. About three quarters of the
function (231 MB measured 2026-10-29) is league data — compiled feed globs in
`dist/`, raw feed copies the tracer pulls in for `fs` readers, `src/data/` —
and native modules exclude only their musl twins. Move data a request does not
need out of the function (a derived snapshot, as TheLeague rosters did with
`roster-season-payloads.json`) before reaching for Vercel's large-functions
beta, which raises the limit without stopping the growth. Guard:
`tests/function-size-budget.test.ts`.

### League data lives in Blob — read it with `loadLeagueData`

Since Oct 2026 the site reads league data (`data/**`, `src/data/**` JSON)
through `src/utils/league-data.ts`, which fetches it from Vercel Blob in
production and off disk locally. The files stay committed in git; after
prebuild, `scripts/publish-league-data.mjs` uploads the changed ones (named
by content hash) and writes a manifest the function bundles. Before this, every
`import.meta.glob` and JSON import of league data was compiled into the one
function, so each new league cost 10-30 MB and the number of leagues was
capped.

- **New code reads with `await loadLeagueData(path)`**, or `await
  preloadLeagueData([...])` once per request and `getLeagueData(path)` in a
  sync helper. A sync read nobody preloaded throws, locally too. Paths are
  repo-relative (`data/afl-fantasy/mfl-feeds/2019/players.json`);
  `listLeagueData('data/<league>/mfl-feeds/*/x.json')` replaces a glob's keys.
- **Never in client code.** A React island or `<script>` that imports a JSON
  ships it to the browser, not the function; the loader is server-only.
- **A real deploy without `BLOB_READ_WRITE_TOKEN` fails at publish**, on
  purpose: the pages would have nothing to read. CI measures with
  `LEAGUE_DATA_STORE=measure`, which writes the manifest without uploading.
- **`FUNCTION_EXCLUDED`** (`scripts/lib/league-data-store.mjs`) lists files
  left out of the function. Add a pattern only once the loader is its last
  reader; a raw `fs` read of an excluded file ENOENTs in production only.
- Guard: `tests/league-data-store.test.ts` — a shrink-only per-file count of
  bundled data reads (`tests/fixtures/league-data-import-baseline.json`), and
  no raw reader of an excluded file.

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

**Not every Vercel cron is a bridge.** `/api/cron/push-watch` (the app's
one-minute alert checker, every minute) does its work in the function: it
dispatches no workflow and commits nothing, so it costs no build and cannot
collide with a job that pushes. It is listed in `IN_PROCESS_CRONS`
(`tests/vercel-cron-targets.test.ts`) and must stay that way — a cron that
starts committing is a bridge, with every rule below.

GitHub Actions may drop a scheduled event, and on this repo it does, in bulk.
Measured over 300 `roster-sync.yml` runs: until 2026-08-26 the delivered cadence
held a 21-47 min median; **from 2026-08-27 it collapsed to a 2-5 HOUR median and
5-8 runs a day, against the 288 that `*/5` asks for.** No workflow file changed
on that date, no run was cancelled, every conclusion was `success`, and every
other scheduled job in the repo degraded identically the same day — the repo-wide
run count went 589 → 135. Push-triggered runs were never affected. This is
GitHub declining to dispatch, which its docs reserve the right to do, and it is
not a delay you can wait out.

Why it is not merely late data: **a committed MFL feed is baked into the build**
(`import.meta.glob(..., { eager: true })`), and a sync commit to `main` is what
redeploys production. No sync run means no commit, which means no redeploy,
which means a surface reading that feed cannot move — however correct the page
code is. On 2026-09-16 TheLeague sat a full hour past the Wed 19:00 PT waiver
run: the last sync had landed at 18:20 PT and the next was hours out.
`resolveWaiverWindow` had already flipped to "PROCESSED" on schedule; there was
simply no deploy carrying the new data.

**But check WHICH surface before blaming the cron — not everything is baked.**
Two of the most-read surfaces already read MFL live, server-side per request,
through a ~2-minute Redis cache that falls back to the static feed when Redis is
unavailable:

| Surface | Overlay | Covers |
|---|---|---|
| Rosters, homepage, league summary, Front Office | `mfl-roster-cache.ts` | membership, salary, contract year/info, status |
| Transactions (the shared `TransactionsPage.astro`) | `mfl-transactions-cache.ts` | the last 3 days of moves |
| Trade bait | `mfl-trade-bait-cache.ts` | — |

`rosters.astro` prefers the cache for the CURRENT league year and only reads the
committed feed for historical seasons or when Redis is empty — its own comment
says "reflected within ~2 minutes without needing a manual data sync". So **a
stale roster page is usually Redis, not the cron**, and triage that starts at
the sync will chase the wrong thing.

What is genuinely build-baked, and therefore what the cadence actually protects:
`activity.astro` (eager glob, no overlay), standings,
weekly results, `players.json`, draft results and the derived payloads. Note
that `schefter-scan` rides the same dropped scheduler, so after the 08-27 cliff
the news feed was doubly behind. The Schefter feed itself is no longer on this
list: it has been live from Redis since Oct 2026 (next section but one).

Nothing polls for rosters client-side. Every client `fetch` on `rosters.astro`
is a write action (declare, cut, trade bait, auth); the only real client polling
is live scoring and the broadcast/draft boards, which read ESPN rather than this
sync.

So the schedule lives in **`vercel.json` → `crons`**, which fires
`/api/cron/roster-sync`, which `workflow_dispatch`es the workflow. That cron is
now the sync's ONLY scheduled trigger — the workflow has no `schedule:` at all.

**Four workflows ride the bridge now**, all four with no `schedule:` of their
own, all three dispatching through `src/utils/workflow-dispatch.ts` (the single
door that holds the `outboundAllowed()` check, because staging and every PR
preview carry production's `GH_PAT`):

| Cron path | Workflow | Cadence | Why |
|---|---|---|---|
| `/api/cron/roster-sync` | `roster-sync.yml` | tiered | rosters, standings, the feeds |
| `/api/cron/schefter-scan` | `schefter-scan.yml` | tiered | Roger's deadline reminders + the news feed |
| `/api/cron/groupme-sync` | `groupme-sync.yml` | every tick | the chat mirror — commits nothing |
| `/api/cron/lineup-check` | `lineup-reminders.yml` | ahead of each kickoff | the pre-kickoff lineup warning (`lineupCheckDecision`) — see `lineups.md` |

`schefter-scan` is the one with owner-facing lateness: Roger's deadline
reminders are push-first and held through quiet hours, so the first tick after
07:00 PT is the one that fires them, and a tick delivered at noon is a reminder
at noon. It shares the roster sync's tiers on purpose — news breaks when
rosters churn. `groupme-sync` is the exception that proves the rule about
spend: it reads GroupMe and writes Redis, commits nothing, costs no build, and
therefore has nothing to ration, so it dispatches on every tick. Its concurrency
still queues rather than cancels, for the watermark reason below rather than the
push one.

**The cadence is a function, not a cron expression.** Vercel fires every five
minutes and `src/utils/sync-cadence.ts` decides which ticks become dispatches:

| Tier | When | Cadence |
|---|---|---|
| `waiver` | a waiver run → +2h | 5 min |
| `game` | a kickoff → +3.5h | 15 min |
| `idle` | everything else | 60 min |

It has to be a function because the windows come from MFL's real waiver calendar
and the real per-game `kickoff` times in `nflSchedule.json`. A day-of-week cron
(`Sunday, Monday, Thursday`) would be the derivation this repo bans — 2026 alone
opened on a Wednesday, moved week 12 to Wednesday for Thanksgiving, and ends
week 18 all-Sunday. The windows are a UNION over both leagues, because one run
syncs every league and their waiver runs are an hour apart.

- **This bridge already existed and was dead for six months.** It shipped
  2026-03-21 with its `crons` entry and the entry was removed eleven hours
  later (`4179e14`, "unreliable on Hobby plan") with the route left behind.
  That reason expired when the account moved to **Vercel Pro**, which supports
  minute-granularity crons; Hobby is daily-only, which is what made it look
  broken. Two other files cite the route in their comments as the bridge shape
  to copy, so it read as live infrastructure the whole time.
- **A second scheduled trigger cannot be offset out of the way — do not add
  one back.** A `*/30` GitHub fallback was tried for one night. Offsetting it
  to `7,37` to interleave with the primary does not work, because the premise
  of this entire mechanism is that GitHub delivers whenever it likes: the `:07`
  firing was delivered at `:16`, cancelled a dispatch that had already pushed,
  and then failed its own rebase against six single-line feed JSONs git cannot
  merge. One sync lost, for two unpredictable runs a day and no freshness the
  primary did not already provide.
- **`cancel-in-progress: false` on any job that pushes — or that advances a
  WATERMARK.** A cancel cannot un-push. Cancelling mid-flight is what left the
  surviving roster-sync run rebasing onto a main that had moved under it, and
  `schefter-scan` is worse: it posts to GroupMe and pushes to real devices
  *before* committing the watermark recording that it did, so a cancel in
  between re-sends rather than merely losing a run. The watermark half catches
  a job with no commit at all — `groupme-sync` reads GroupMe since
  `getLastMessageId` and advances that id only after storing what it fetched,
  so a cancelled run leaves the mirror where it was. That was unreachable at
  5-8 delivered runs a day and is not at one dispatch per tick: a run slower
  than the tick gets killed by its successor, and a persistent slowdown kills
  every successor too, freezing the mirror behind nothing but `cancelled` runs
  — which the failure watcher does not look at, because it queries
  `?status=failure`. GitHub keeps a single pending run per group, so queueing
  cannot pile up in exchange.
- **Absence is watched separately, and NOT from Vercel.**
  `scripts/check-sync-freshness.mjs` alerts (`ops-job-failure`, admin-only) when
  the newest SUCCESSFUL `roster-sync.yml` run on `main` ages past two hours.
  It measures RUNS, never commits: a run that found nothing commits nothing,
  so a quiet night (00:00-04:00 PT on 2026-10-21, every run green) aged the
  newest sync commit past the threshold and paged an admin for a healthy
  chain. It runs from
  `job-failure-watch.yml` on GitHub deliberately: a watchdog sharing a substrate
  with its subject goes dark in the one outage it exists to report. GitHub's
  delivery is unreliable, so detection may be hours late — late still beats
  never, and the two schedulers now cover each other.
- **The cadence is a SPEND decision.** Every changed sync commits to `main`, and
  every commit to `main` is a production build — 91% of the Vercel bill. A flat
  15-minute cadence measured 43 sync commits in 10.4 hours (~122 builds/day
  against ~37 before); the tiers bring that to ~35/day while being *faster* at
  the waiver moment.
- **A run that found nothing must commit nothing** — otherwise the tiers ration
  a cost the job pays anyway. `schefter-scan` committed on EVERY run, because
  two of the six files it commits are rewritten from scratch each time and carry
  a top-level run clock: `resolved-events.json` (`computedAt`) and
  `groupme-suppressions.json` (`generatedAt`). Both writers now go through
  `writeJsonIfChanged` with that key in `ignoreKeys`, so an unchanged payload
  keeps its old timestamp and produces no diff. It hid for months behind the
  dropped scheduler: 5-8 deliveries a day and 5-8 commits a day reads as "every
  run had news" rather than "every run commits regardless". Guard:
  `tests/cron-commit-churn.test.ts`.
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
  `astro check` sees it** when it lands in an API route: `pnpm test:unit` does
  not type-check and no unit test imports a route, so the whole suite stays
  green. It happened three times in one session, twice in files about cron
  cadence. Spell the cadence out in words, or use a line comment.

Guards: `tests/vercel-cron-targets.test.ts` checks the cron table and the routes
it fires in BOTH directions, because each failure is silent in its own way — an
orphaned bridge is dead code wearing the costume of a live path; a dangling cron
is a 404 on a schedule nobody reads. It also pins the `CRON_SECRET` gate, and
then works from each route's own `dispatchWorkflow('<file>.yml')` call: that
workflow must exist, must carry no `schedule:`, must set
`cancel-in-progress: false` if it pushes, and — if it commits — its route must
read `sync-cadence.ts`, since every commit is a build. The tick check applies to
whichever crons read the cadence module, so a new tiered bridge is covered the
day it is written, and one assertion pins how each bridge is CLASSIFIED, because
both of those checks skip a workflow they read as non-committing and would
therefore pass by enforcing nothing.

**"Does this workflow push?" has one implementation**,
`tests/helpers/workflow-push.ts`, shared with
`tests/workflow-push-triggers-ci.test.ts`. Pushing is three mechanisms here —
a bare `git push` in a `run:` step, `./.github/actions/commit-push`, and
`scripts/commit-feed-and-push.mjs` — and the cron guard's first cut knew only
the last two, so a bridged workflow written the first way would have skipped
both assertions above in silence. It also has to tell code from prose:
`roger-date-audit.yml` names `git push` in a header comment and in an `echo`
telling a human what to run, and pushes nothing. `tests/sync-cadence.test.ts` pins the tiers, the
both-leagues union and the DST wall-clock recurrence.
`tests/block-comment-terminators.test.ts` catches the comment trap at edit time
rather than 2.5 minutes into CI. All three are routed by the `github-workflows`
domain.

## The Schefter feed lives in Redis; git keeps a daily snapshot

Until Oct 2026 every feed write was a commit to `main`, and every commit to
`main` is a production build: the scan, rumor, article and lineup lanes were
about half of all bot commits. Now each league's feed lives under one Redis key
(`schefterFeedKey`, `scripts/lib/schefter-keys.mjs`), the site reads it per
request, and the committed file is the backup and the fallback.

- **Writers did not change shape.** A job checks out, runs
  `node scripts/schefter-feed-sync.mjs pull` (Redis → the working-tree file),
  lets its scripts edit the file as they always have, and ends in
  `commit-feed-and-push.mjs`, which merges each changed feed into Redis under a
  lock with the same `mergeFeed` the git path used, then leaves it OUT of the
  commit. A job with nothing else changed commits nothing.
- **Every feed-writing job needs the pull right after checkout and Redis env
  on the pull and the commit step.** Skip the pull and the job writes on top
  of a day-old snapshot (no post is lost, but its dedup watermarks are a day
  stale, so it re-posts). Skip the env and the feed silently falls back to a
  git commit — a build per write. `tests/schefter-feed-redis-workflows.test.ts`
  pins both for every workflow whose `--files` names or builds a feed path.
- **It fails open to git, never closed.** No credentials, or a Redis write
  that throws, and the feed is committed exactly as before.
- **Only a run committing to `main` publishes.** The derived-chain and
  backfill lanes take `github.ref_name`, so a branch run keeps its posts on
  its branch instead of putting them on the live site.
- **The archive lane is `--git-only`, on purpose.** Its pruned feed's
  `archivedThroughTimestamp` hides the rotated posts, and the archive files
  now holding them only reach the site with a deploy; published to Redis
  first, every just-archived permalink and share card 404s until then. The
  next writer's pull folds the watermark into Redis. It is the only opt-out
  the workflow guard allows.
- **The daily snapshot rides `schefter-scan.yml`** (`--snapshot`, when the
  newest feed commit is 24h old), because the Vercel cron dispatches that job
  at least hourly and a `schedule:` of its own would be dropped. One build a
  day. Exactly one job may take it (same test).
- **Readers go through `getSchefterFeed` / `getSchefterFeedIfAny`**
  (`src/utils/schefter-league-data.ts`): Redis merged with the bundled
  snapshot, memoized 30s per instance, the snapshot alone if Redis is down.
  A new page must never import `schefter-feed.json` directly — it would show
  this morning's feed all day. Archives (`schefter-archive/*.json`) are still
  committed and read from the bundle.
- **Lanes that still commit a feed to git** (`backfill-historical-feeds.yml`
  through the commit-push action) are folded into Redis by the next job's
  pull, because the pull merges file and Redis rather than overwriting.

## Roster sync holds live-read files out of its commit

Since Oct 2026 the roster sync commits only real league changes. The outputs
that moved on most runs, but that no page reads from the bundle when it can
help it, no longer ride every commit (every commit to `main` is a production
build):

- **`live-odds.json` is not written in season.** The site fetches odds from
  ESPN per request (`loadLiveOdds`, `coach-data.ts`) and reads this file only
  off-season (Feb 14 → Labor Day), so `fetch-live-odds.mjs` returns early in
  season unless given `--week`.
- **Injuries and TheLeague's salary copy are held.**
  `scripts/hold-sync-files.mjs` runs as the step right before the commit: it
  publishes each league's CURRENT `injuries.json` to `mfl:injuries:<slug>` on
  every run, changed or not (publishing only git-modified files left Redis
  stale when a report reverted to the committed copy), and puts the committed
  copies back, letting each group through once a day so git keeps a
  snapshot (the timer lives in Redis, because the job's checkout is shallow).
  No credentials, or any Redis error, and the files commit exactly as before.
  The groups live in `HELD_GROUPS` (`scripts/lib/held-sync-files.mjs`).
- **Every injury reader goes through `src/utils/mfl-injuries-live.ts`**
  (server-only): pages via `loadLiveInjuryMap` (`mfl-injuries-live-map.ts`,
  split off so the story graph never imports the globbed feeds), the disk readers (lineup
  warnings in `my-team-week.ts`, `/api/app-badge`) via `loadLiveInjuryFeed`.
  Redis wins only when it is at least as FRESH as the copy on disk — same
  year AND a `generatedAt` no older — because a run whose publish failed
  commits a report newer than the one Redis still holds. `loadInjuryMap` or a
  raw `injuries.json` read alone now shows a report up to a day old. The salary copy has no page reader; its one reader,
  `schefter-trade-speculation.mjs`, reads the daily snapshot from disk.
- **The current league year's rosters and transactions are held** (the
  `rosters` group, with `derived/top-players.json`, which the sync recomputes
  from them; one group so the committed leaderboard always matches the
  committed rosters). "Current" is each league's own registry rollover, so an
  archive year — and the AFL's new year before its June 1 — commits as before.
  They get no Redis copy: the roster cache (`getCachedRosterFranchises` /
  `getCachedRosters`) fetches MFL itself, and the recent-transactions cache
  overlays the last 3 days on the file, which a day-old snapshot stays inside.
  **So a page that shows who holds whom must read live**: `liveRostersFeed`
  (`src/utils/rosters/live-rosters-feed.ts`) for a rosters feed, and
  `mergeTransactionRows` over `getCachedRecentTransactions` (or
  `loadTransactionsSeason`) for transactions, falling back to the committed
  file on any error. A raw `rosters.json` / `transactions.json` read alone
  now shows a copy up to a day old. Scripts that must be current
  (`schefter-rumor-scan.mjs`) ask MFL first. The list of readers, live and
  day's-lag-is-fine, is in the plan's Phase 4a.
- **Nothing may run between the hold step and the commit**, or it could
  rewrite a file the hold just restored. `tests/sync-noise-commit-guard.test.ts`
  pins the order, the Redis env, the in-season odds skip, every injury reader,
  and every reader of the held rosters and transactions — it classifies each
  `src/` file that reads one, so a new page reading the committed copy alone
  fails.

Two other lanes hold the same way (Oct 2026):

- **Owner last-visit.** `scripts/hold-owner-last-visit.mjs` runs right before
  `sync-owner-last-visit.yml`'s commit, publishing each league's
  `owner-last-visit.json` to `mfl:owner-last-visit:<slug>` (`LAST_VISIT_GROUPS`)
  with the same daily snapshot. The Activity pages read it through
  `loadLiveLastVisit` (`src/utils/owner-last-visit-live.ts`), freshest
  `generatedAt` wins. It was 3-4 production builds a day for "last seen" times.
- **The Schefter event calendar.** `scripts/restore-countdown-only-events.mjs`
  runs right before schefter-scan's commit and puts `resolved-events.json`
  back when only `computedAt` / `daysUntil` / `isPast` moved. The working copy
  stays fresh for the scan that just read it; the site reads only
  `startDate`, so a reader that wants the countdown must recompute the file in
  its own job, never trust the committed one. `tests/league-events-countdown.test.ts`.

Holding a file is right only when every reader can take a day-old copy or reads
it live. Scores, weekly results and standings feed the derived chain and about
30 pages from disk, so they are not held; they belong to
`docs/plans/league-data-out-of-deploy.md`.

## A job's league list comes from the registry, never the workflow

Every recurring job that runs once per league asks
`scripts/lib/league-jobs.mjs` which leagues — `node scripts/league-jobs.mjs
<job> [--format '{navSlug}:{id}'] [--join ,]` in a workflow, `leaguesFor(job)`
in a script or prebuild. A hand-kept `for SLUG in theleague afl` leaves a
launched league with no data sync and nothing failing to say so — Archie's
was missing from the fantasy-points-allowed loop until this module existed.

- **Data jobs run for every league that syncs; AI/column jobs only by
  checkbox** (the owner's rule, Oct 2026). Ticking Power rankings IS the
  opt-in to the Pecking Order's Claude cost. A new column that would widen to
  more leagues is a predicate change in that module, made on purpose — the
  other weekly columns stay default-league-only (`article:weekly`) for exactly
  that reason.
- **Read the list into a variable, then loop it.** `for x in $(…)` and
  `< <(…)` both lose the command's exit code under `bash -e`, so a broken
  lookup syncs nothing and the step still passes.
- **Not covered:** the Schefter GroupMe scanners. Each league posts through
  its own bot secret, and a step can only receive secrets it names, so a new
  GroupMe league there is a secrets edit regardless.

`tests/league-jobs.test.ts` pins each job's leagues and fails a converted
workflow that grows a literal league loop again.

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

