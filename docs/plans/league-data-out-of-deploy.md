# League data out of the deploy

**Status:** proposed, awaiting review · **Opened:** 2026-10-07 ·
**Decisions so far:** history → Vercel Blob, live → Upstash Redis (already in
use), data syncs stop triggering production builds in scope.

## Why

Every league's data ships inside the single `_render` serverless function,
which has a hard 250 MB limit. Staging measures ~238 MB locally (~231 MB on
Vercel) after hotfix #1343, and the limit has been hit three times in three
months (2026-07-08, 2026-08-16, 2026-10-07). Each new league adds 30–60 MB, so
growth in clients is capped by the bundle, not by traffic.

The same design drives cost: build CPU is ~91% of the Vercel bill, and every
data sync is a commit to `main`, which means a production build. More leagues
means more syncs, so more builds.

**Goal:** adding a league is a registry entry plus a backfill job. No new page
code, no new bundle bytes, and no build per data change.

## How data reaches the function today

| Path in | Scale (staging) | Why it's in the bundle |
|---|---|---|
| `import.meta.glob` over `data/<league>/mfl-feeds/*/<type>.json` | 227 glob calls in 64 files; ~30 per league (AFL 36, TheLeague 32, Archies 30, Keeper 28) | Vite compiles every matched JSON into `dist/server/chunks/`. "ALL years" globs ship 20+ seasons. |
| Static `import x from '…/derived/*.json'` | 230 imports; largest are `roster-season-payloads.json` 11.5 MB, three `franchise-history.json` (2.6–5.4 MB), `division-strength.json` 1.6 MB, `owner-tenures.json` 0.7 MB | Same: compiled into chunks. |
| Runtime `fs` reads with `process.cwd()` paths | ~40 call sites; no shared reader (`feedPath`, `readFeed` and `loadFeedJson` are each re-implemented privately) | nft can't resolve the path, so it copies whole `data/` folders (~100 MB). `excludeFiles` trims old seasons only. |
| Redis live overlay | `mfl-roster-cache`, `mfl-transactions-cache`, `mfl-trade-bait-cache`, `live-standings` | Not in the bundle. **This is the pattern to generalize.** |

Data is **written** by about 25 workflows that commit to git (`roster-sync`,
`schefter-scan`, rumor scan, articles, the derived chain, owner-last-visit,
ranking sources and others) through `.github/actions/commit-push` or
`scripts/commit-feed-and-push.mjs`. `writeJsonIfChanged` keeps no-op runs from
committing. Separately, prebuild derives about 12 artifacts from committed data
on every production build.

## Target architecture

```
          writers (cron jobs, prebuild-derivations moved to cron)
                 │ writeLeagueData(slug, key, json)  — hash-compare, skip if equal
                 ▼
   ┌──────────────────────────┐        ┌───────────────────────────┐
   │ Vercel Blob (history)     │        │ Upstash Redis (live/hot)   │
   │ leagues/<slug>/…/<hash>   │        │ mfl:rosters:* etc. (today) │
   │ + manifest.json per league│        └─────────────┬─────────────┘
   └────────────┬─────────────┘                       │
                │  readers go through ONE module       │
                ▼                                      ▼
        src/utils/league-data-store.ts   →  getFeed / getDerived / getLive
                │  per-instance memo + CDN-cacheable immutable URLs
                ▼
          pages / API routes (no data globs, no data fs reads)
```

### Storage layout

- **Blob**
  - `leagues/<slug>/feeds/<year>/<type>.<hash>.json`, holding raw MFL feeds.
  - `leagues/<slug>/derived/<name>.<hash>.json`, holding franchise history, owner tenures, division strength and roster payloads.
  - **Hash in the filename**: every object is immutable and can be cached forever at the edge and in memory. A changed file gets a new name, so no cache ever goes stale.
- **`leagues/<slug>/manifest.json`**: maps each `(year, type)` or `name` to its current hashed URL. It's the only mutable object, and it's small. Readers fetch the pointer from Redis on every request (see "Freshness"); only past-season objects are cached long.
- **Redis**: unchanged role. It stays the live overlay for the current season, and it also stores the manifest pointer, so manifest reads cost one Redis GET instead of a Blob fetch.

### The read module: `src/utils/league-data-store.ts`

```ts
getFeed(slug, year, type)         // raw MFL feed for one season
getFeeds(slug, type, { years })   // several seasons, fetched in parallel
getDerived(slug, name)            // derived artifact
listSeasons(slug)                 // from the manifest, replaces seasonsFromGlob / readdirSync
```

- **Backends**, chosen by environment:
  - `blob` in production, staging and preview.
  - `fs` in dev and tests: it reads `data/` when present, so local work and the guard suites keep working offline.
- **Caching**: a per-instance LRU memo. Past seasons are immutable, so they're cached indefinitely. The current season uses a TTL.
- **Takes the registry slug, never a path.** Callers can't hardcode `data/<league>`, which fits the "league registry" rule in CLAUDE.md.
- **Existing helpers become thin wrappers** over it: `mfl-feed-glob.ts`, `roster-page-feeds.ts`, `draft-results-feeds.ts`, `transactions-feeds.ts`, `weekly-player-results-feed.ts`, `afl-player-scoring.ts`, `offseason-hero-data.ts` and the private `feedPath`/`readFeed` copies. Pages mostly call those helpers, so many pages change little.

### The write module: `scripts/lib/league-data-writer.mjs`

`writeLeagueData(slug, key, json)` works like this:
1. Canonicalize the JSON, using the same canonical compare as `writeJsonIfChanged` (sorted arrays, `ignoreKeys`).
2. Hash it.
3. If the manifest already points at that hash, stop: nothing changed.
4. Otherwise, upload the new hashed object and update the manifest.

That keeps the repo's existing "a run that found nothing writes nothing" rule.

Concurrent writers to one manifest take a Redis lock per league. Today the
Schefter feed lanes rely on `commit-feed-and-push.mjs` unioning posts by id
when two runs race. That union moves into the writer, done under the lock.

### Freshness: nothing current gets staler

Owners make roster moves all day, and the app must reflect them as close to
instantly as possible. Data falls into three freshness tiers, and the caching
rules differ per tier:

| Tier | Data | Target | How |
|---|---|---|---|
| **Live** | Rosters, recent transactions, trade bait, live standings | ≤60 s after a change on MFL (trade bait ≤2 min); **instant** after a change made through our app | Existing: `mfl-roster-cache` / `mfl-transactions-cache` (Redis, 60 s stale TTL, trade bait 2 min, synchronous refresh). Our write routes (`cut-player`, `waiver-claim`, `contracts/approve`) call `bustRosterCaches`. Any new write route must too. |
| **Current season, synced** | Schefter feed, activity, current standings, derived artifacts | Visible on the **next request** after a sync writes | Readers fetch the manifest pointer from **Redis on every request** (one GET), so the hashed Blob URL changes the moment the writer flips it. **No `s-maxage`** on pages that render current-season data. Faster than today, because the build wait (~2 min) and the commit cadence lag are gone. |
| **History** | Past seasons, archives | Changes rarely | Long edge cache and in-memory memo. Safe because hashed objects are immutable. |

Rule: **edge caching is allowed only on pages that render history-tier data
alone.** A ratchet and guard test should pin this, so a history-page cache
header can't get copied onto a live page.

Owner decisions on the live tier (2026-10-09):
- **Live stale TTL drops from 2 min to 60 s for rosters and transactions**
  (`mfl-roster-cache`, `mfl-transactions-cache`). Trade bait stays at 2 min.
  - MFL is only called when a request finds the cached copy older than the
    window, so extra calls happen only while people are on the site: at most
    2× today's per key. 30 s (4×) was rejected because the refresh blocks the
    request, so nearly every busy-hour page load would wait on MFL.
  - MFL publishes no hard limit. It throttles by answering 200 with a
    degraded body, which the existing guards already treat as a failed read
    (falling back to the stale copy).
  - This only shortens the lag for moves made on MFL's own site. Moves made
    through our app are already instant via `bustRosterCaches`.
- **Client-side refresh of open roster pages: skipped (2026-10-10).** The
  proposal was to poll a light endpoint every 60 s while the tab is visible
  and show a "Rosters changed, tap to refresh" banner (never swapping data in
  place, since `rosters.astro` cannot safely re-render under an owner
  mid-task). The owner judged it a nice-to-have and passed; an open page
  shows fresh data on the next load or reload.

## Phases

Each phase ships on its own, leaves the site working, and is measured with
`du -sh .vercel/output/functions/_render.func`.

### Phase 0: foundations (no user-visible change)
- `league-data-store.ts` (fs and blob backends), `league-data-writer.mjs`, and the manifest format.
- `scripts/seed-league-data-blob.mjs`: uploads today's `data/` to Blob and builds the manifests. Re-runnable.
- **Ratchet guard** `tests/league-data-bundle-ratchet.test.ts`. It counts data globs, data static imports and `process.cwd()` data reads in `src/`, and pins the counts in a baseline that may only go down, the same idiom as `page-fork-baseline.json`. It's what stops page 65 from adding a new glob while we migrate the first 64.
- Wire the guard into `path-guard.json`.

### Phase 1: biggest bytes first (~25–40 MB)
- `roster-season-payloads.json` (11.5 MB, TheLeague rosters plus `api/roster-season`).
- All three `franchise-history.json` files, both `division-strength.json` files and `owner-tenures.json`. They're read by the franchises, rivalries, owners, records and division-strength pages, plus `afl-team-spotlight`.
- These are already single derived files behind a handful of imports, which makes them the cheapest wins and a good proof of the read path, caching and latency.

### Phase 2: kill the raw `data/` copy (~70–100 MB)
- Move every `fs` reader, about 40 sites (table in "How data reaches the function today"), to `getFeed`.
- Then switch `excludeFiles` to exclude **all** of `data/**/mfl-feeds` and `derived`, which removes the nft fallback copy entirely.
- This supersedes the trim in #1344. That work is still useful as a stopgap until this lands.

### Phase 3: "ALL years" globs → store (bulk of what remains)
- Start with history pages that glob every season: standings, playoffs, schedule and transactions in every league, `afl-fantasy/rosters.astro` players (about 1.6 MB × 10 years), activity, draft results, `footer-champions`, `afl-career-stats`, `mfl-injuries` and `waiver-system`.
- Then the RECENT (2025+) globs.
- Many pages read through the helpers listed in "The read module", so most of this is changing a helper's body and making callers `await` it.

### Phase 4: syncs write to Blob/Redis, not git
- `roster-sync`, `schefter-scan`, the rumor scan, articles, the derived chain, owner-last-visit, ranking sources and the weekly stat syncs call `writeLeagueData` instead of `commit-push`.
- Prebuild's derived steps become cron steps that run after the sync that changes their inputs, the way the 2026-09-18 insight already recommends. Examples: franchise history, owner tenures, division strength, schedule strength, playoff performance, player identity union and roster payloads.
- Build-baked surfaces (the Schefter feed, `activity`, standings) now read at request time. They are current-season data, so they get NO edge cache (see "Freshness"). The per-request cost is one Redis GET plus a memoized Blob read.
- **Result:** a data change no longer builds. Production builds happen only for code changes.

### Phase 5: new-league onboarding
- `scripts/onboard-league.mjs <slug>`: backfills feeds into Blob, runs derivations and verifies the manifest.
- Write a runbook in `docs/claude/rules/storage-and-build.md`.
- Use it to move the Archies and Keeper onto this path end-to-end and prove that "registry entry plus job" holds.

## Risks and how each is handled

| Risk | Mitigation |
|---|---|
| **Latency.** A page now awaits Blob reads instead of having data in memory. | Hashed objects are immutable, so they're memoized per instance and edge-cached. Only history-tier pages get `s-maxage`; current-season pages never do. Measure p95 on the Phase 1 pages before going wider. |
| **The page component gets heavier.** Async reads in `.astro` frontmatter are fine, but some helpers are synchronous today. | Migrate helper by helper. The ratchet stops any new synchronous data import. |
| **Tests read `data/` directly.** Many of the ~228 guards (derived-chain agreement, owner tenures and others) assert over committed data. | The `fs` backend keeps `data/` readable for tests. Whether `data/` stays in git is open question 1. |
| **Writer races.** Today git push retry plus the feed union protect concurrent writers. | A Redis lock per league manifest, and the feed union moves into the writer. Port `merge-schefter-feed.mjs` unchanged. |
| **Rollback.** A bad write is no longer `git revert`. | Hashed objects are never deleted, so rolling back means pointing the manifest at the previous hash. The manifest keeps a short history. |
| **Environments.** Preview and staging must not write production data. | Writers run only from the production cron. Previews and staging read production Blob, read-only. A `BLOB_PREFIX` env var allows a sandbox prefix when needed. |
| **Demo build** (`__DEMO_BUILD__`, `demo-mfl-standin.ts`) | Keep its globs behind the flag. They're dropped from non-demo builds already. Migrate it last. |
| **Cost.** | Storage is small (about 300 MB today). Reads are mostly edge or memo hits. Check current Vercel Blob pricing for operations and transfer before Phase 4. Expect it to be small next to the build CPU it removes. |

## Open questions for review

1. **Does `data/` stay in git after Phase 4?**
   - (a) **Keep it as an archive and test fixture, but skip builds for data-only commits.** `scripts/vercel-ignore-build.mjs` would ignore a `main` push whose diff is only under `data/`. It's simple, keeps `git log` as the audit trail and keeps the guards untouched, but `.git` keeps growing.
   - (b) **Stop committing.** Blob is the source of truth, and tests use recorded fixtures (`mfl-fixture-recorder`). Cleaner and scales further, but every data-reading guard has to be reworked.
   - My recommendation: **(a) first, then (b) later** if `.git` size becomes the problem.
2. **Order of Phase 1 vs Phase 2.** Phase 2 gives the most room (about 100 MB), but its ~40 sites are scattered. Phase 1 proves the read path on a few files.
   - My recommendation: Phase 0 → 1 → 2. If another league is about to land, swap 1 and 2.
3. **Staging tree.** Staging carries about 2 million lines of unreleased work, including the Archies and Keeper. Should this work branch from `staging`, so it migrates those leagues' pages too, or from `main`?
   - My recommendation: branch from `staging`, since that's where the new leagues and most globs live.

## Not in scope

- Moving to a SQL database. Blob plus Redis covers read-by-key access. Revisit only if cross-league queries become a feature.
- Splitting `_render` into several functions.
- Unforking sibling pages. The page-fork ratchet does that separately, and this plan makes it cheaper because pages stop naming league paths.
