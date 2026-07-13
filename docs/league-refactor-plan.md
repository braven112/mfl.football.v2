# League Refactor Plan — Deduplication & Add-a-League Readiness

**Status:** approved 2026-07-13. One PR per phase, in order. Each phase is
independently shippable; run `pnpm test:unit` + targeted verification before
each PR.

**Origin:** four parallel codebase audits (pages, API/utils, scripts/workflows,
components/styles). Decisions made by Brandon: third league is "maybe someday"
(sweep for correctness, don't over-invest in page parameterization); delete all
five orphan pages; include the standings-table unification as the final phase;
deliver one PR per phase.

## Audit summary (what's wrong)

- `getRedis()` + `RedisClient` copy-pasted 26× in `src/` + 7 more flavors in
  `scripts/`. `JSON_HEADERS` ×29, ad-hoc JSON responses ×86, auth+401
  boilerplate ×~40 in three competing shapes. MFL export URL hand-built ~15×
  in app code; `mflFetch`+`loginToMFL` byte-identical in two scripts.
- `scripts/lib/` has only Schefter domain logic — no shared infra modules.
- The league registry (`src/config/leagues-data.mjs`) is bypassed by ~70 files
  (`'13522'`, `'19621'`, `www49`, `www44`, `data/theleague` literals; only 4 of
  ~50 scripts import it). Latent bugs: `src/constants/roster-constants.ts:35,44`
  hardcodes www49 photo URLs for all leagues; `afl-fantasy/playoffs.astro:53`
  falls back to TheLeague's host; 4 scripts reimplement the id→slug ternary.
- No `[league]` dynamic route exists; AFL pages are physical copies. Only some
  pairs are true copies: `whats-new/index` + `whats-new/[id]` 98%, `assets` 79%,
  API `lineup.ts` pair 92%, `cr.ts`/`ri.ts` 85%. Most others (rosters, players,
  standings, trade-builder…) are genuinely divergent — leave them alone.
- Root `Header.astro`/`Footer.astro`/`Layout.astro` (~1,000 LOC) serve only 3
  pages vs `TheLeagueLayout`'s 85. AFL `hp-sections/` mirror TheLeague's
  (~1,500 LOC). Six overlapping standings tables (~4,200 LOC).
- All 20 workflows duplicate the checkout/pnpm/node/install preamble; no matrix
  strategy anywhere; commit-and-push block copy-pasted per workflow.
- Orphans: `contracts-backup.astro`, `old-hp.astro`, `loading-prototype.astro`,
  `test-cookie.astro`, `matchup-preview-example.astro` (~3,200 LOC, zero
  inbound links). `fix-2020-salaries.mjs` / `fix-2021-salaries.mjs` are
  identical twins. (Design galleries — design-system, showcase,
  css-customization, templates — stay.)

What's already right (don't rebuild): the registry itself, CSS-variable
theming via `data-league`, `nav-config.json` `leagueOnly` flags, shared
loading components, `formatters.ts` (77% adopted).

---

## Phase 0 — Dead code removal (PR 1, tiny)

1. Delete the five orphan pages listed above. Check
   `src/data/page-directory.json` and nav config for stale references.
2. Merge `fix-2020-salaries.mjs` + `fix-2021-salaries.mjs` into one
   `fix-season-salaries.mjs --year=YYYY`.

*Agent:* main session or one general-purpose agent, **Sonnet**.
*Verify:* `pnpm build` succeeds; grep for links to deleted routes.

## Phase 1 — Shared infrastructure extraction (PR 2)

Three parallel workstreams, then one review pass:

1. **`src/utils/redis-client.ts`** — canonical `getRedis()` + `RedisClient`
   type (union of the drifted variants: include the `STORAGE_REST_API_URL`
   third fallback + memoization). Migrate all 26 call sites.
2. **`src/utils/api-response.ts`** — `JSON_HEADERS` (plain + no-store
   variants), `json(body, status, headers?)`, `unauthorized()`, and
   `requireAuth(request): AuthUser | Response`. Migrate the 29
   `JSON_HEADERS` files and ~40 401 sites; convert raw
   `new Response(JSON.stringify(...))` opportunistically in touched files.
3. **`src/utils/mfl-url.ts`** — `buildMflExportUrl({ type, leagueId, year,
   params })`, host/id resolved via the registry. Migrate ~15 hand-built
   export URLs (`lineup*.ts`, `trades/*`, `move-to-practice.ts`,
   `contracts/verify.ts`, `draft/status.ts`, `live-scoring.ts`,
   `mfl-roster-cache.ts`, `mfl-contract-writer.ts`, `live-auctions.ts`,
   `mfl-login.ts`; reuse in `utils/playoffs.ts`).
4. **`scripts/lib/` infra modules** — `mfl-api.mjs` (the byte-identical
   `mflFetch`+`loginToMFL` from `apply-pending-contracts.mjs` /
   `sync-draft-pick-contracts.mjs`, plus `fetchExport` with 429 backoff from
   the three AFL compute scripts), `redis.mjs` (raw-REST + `@upstash/redis`
   flavors, one credential resolver), `fetch-retry.mjs` (6 hand-rolled
   variants), `groupme.mjs` (3 inline POST copies, dry-run aware),
   `pt-date.mjs` (PT date/hour helpers; **do not move**
   `roger-reminder-window.mjs` — it's already shared and hook-protected),
   `env.mjs` (`getNonEmpty` ×4). Migrate call sites.

*Agents:* 3 parallel **general-purpose (Sonnet)** — (a) utils 1–3 + app call
sites, (b) API-route call-site migration, (c) scripts/lib. Then
**code-reviewer (Opus)** over the full diff.
*Verify:* `pnpm test:unit` baseline unchanged; `node --check` every touched
`.mjs`; dry-run one schefter script and one fetch script.
*Caution:* edits to Roger-related files trigger the reminder-window test hook —
run `pnpm install` first.

## Phase 2 — Registry adoption sweep + route merges (PR 3)

1. **App sweep (~40 sites):** replace id/host/dataPath literals in
   `src/pages`, `src/pages/api`, `src/utils`, `src/constants`,
   `src/layouts` with `getLeagueBySlug`/`getLeagueById`. Kill the
   `'19621' ? 'afl-fantasy' : 'theleague'` ternary (`api/trade-bait.ts:84`),
   the `cut-player.ts:103` www44 fallback, `league-event-resolver.ts` (6
   sites), and the 10× `user.leagueId || '13522'` default (derive from
   `DEFAULT_LEAGUE_SLUG`).
2. **Scripts sweep (~60 sites / ~30 files):** same treatment; the 4
   slug-ternary copies; AFL compute scripts' hosts/ids; `data/<league>`
   paths from `dataPath`. TheLeague-only feature scripts may keep their
   league fixed but must *look it up* from the registry.
3. **Bug fixes (verify before fixing):** `roster-constants.ts` photo host —
   first confirm with a live check whether MFL player photos are
   host-agnostic (www49 vs www44); then either derive from `mflHost` or
   document why one host serves all. Fix `afl-fantasy/playoffs.astro`
   www49 fallback.
4. **Route merges:** collapse `api/lineup.ts` + `api/afl-fantasy/lineup.ts`
   (92% identical) into one route that resolves league + year-function from
   `user.leagueId` via the registry — add a
   `getLeagueYearForSlug(slug)` helper in `src/utils/league-year.ts` driven
   by the registry's `leagueYearRollover`. Collapse `cr.ts`/`ri.ts` (85%)
   behind a `createKvFranchiseStore(prefix, { requireAdmin })` factory.

*Agents:* 2 parallel **general-purpose (Sonnet)** for sweeps;
**qa-api-debugger (Sonnet)** for the photo-host live check;
**qa-principal-engineer (Opus)** for the lineup-route merge (touches MFL
auth writes); **code-reviewer (Opus)** review.
*Verify:* `pnpm test:unit`; exercise lineup GET for both leagues (test
accounts / `?testDate=`); schefter dry-run.

## Phase 3 — Guardrail test (PR 4, small)

A vitest suite that scans `src/` + `scripts/` + `.github/workflows/` for
forbidden literals (`13522`, `19621`, `www49.myfantasyleague`,
`www44.myfantasyleague`, `data/theleague`, `data/afl-fantasy`) outside the
registry, with an explicit allowlist for legitimate sites (generated data
dirs, this doc, historical scripts). This is what makes
"add a league = one registry entry" durable. Add a CLAUDE.md pointer.

*Agent:* one **general-purpose (Sonnet)**.
*Verify:* test passes post-Phase-2, fails on a seeded violation.

## Phase 4 — Page & component consolidation (PR 5)

1. **whats-new pair** (98%+98%): extract one shared implementation
   (component under `src/components/shared/whats-new/`), keep both physical
   routes as thin wrappers passing the league slug. No `[league]` route
   architecture (per the "maybe someday" decision).
2. **assets.astro** (79%): same thin-wrapper treatment.
3. **Root layout stack:** migrate the 3 pages on `Layout.astro` to
   `TheLeagueLayout`, delete root `Header.astro` (800) + `Footer.astro`
   (173) + `Layout.astro`.
4. **AFL hp-sections** (~1,500 LOC): parameterize
   `AflQuickLinks`/`HpQuickLinks` and siblings into shared components
   (league prop + config-driven filter/labels), following the nav-config
   pattern.
5. **Small items:** migrate 6 inline `toLocaleString` + 11 inline date
   sites to `formatters.ts` / `event-date-formatter.ts`; collapse the four
   `mfl-season-state*.json` variants into one registry-slug-keyed file;
   extract the duplicated team-lookup block in `TheLeagueLayout.astro`
   (~lines 108–186); unify `league-events` format (.ts vs .json) behind the
   shared type.

*Agents:* **frontend-ux-architect (Opus)** for items 3–4;
**general-purpose (Sonnet)** for 1–2 and 5;
**astro-performance-expert (default model)** reviews rendering/hydration;
**code-reviewer (Opus)** review.
*Verify:* Vercel preview (`/test`) — screenshot whats-new, assets, homepage
for BOTH leagues; `pnpm test:unit`.
*Deferred (stretch, not in this PR):* AFL heroes → theme into shared
`EventHeroShell` (medium-high effort; revisit after Phase 6).

## Phase 5 — Workflow consolidation (PR 6)

1. Composite action `.github/actions/setup/action.yml` for the
   checkout/pnpm/node/install preamble (86 occurrences / 20 files).
2. `roster-sync.yml`: per-league fetch steps → `strategy.matrix` over
   registry slugs (or a `workflow_call` reusable taking league inputs).
3. Shared commit-and-push (composite action or standardize on
   `commit-feed-and-push.mjs`).
4. League env blocks read id/host from one place per league, so a new
   league touches only the matrix list.

*Agent:* one **general-purpose (Sonnet)**. CI can't run locally — lint with
`actionlint` if available, review diffs carefully, watch the first
scheduled runs after merge.
*Note:* per CLAUDE.md, no new `vars.*` feature gates.

## Phase 6 — Standings-table unification (PR 7, riskiest)

Collapse the six standings tables (`StandingsTable`, `LeagueSummaryTable`,
`TierAllPlayStandingsTable`, `ConferenceLeagueStandingsTable`,
`LeagueStandingsTable`, `ConferenceStandingsTable`, ~4,200 LOC) plus the two
compact homepage variants into one config-driven component family
(column-config + variant props). Keep it server-rendered `.astro` — zero JS.

Sequence: design doc first (props/column schema, which call sites map to
which variant), review with Brandon, then implement call-site by call-site
with per-page visual verification (screenshots of standings, playoffs,
league-summary, homepage for both leagues on a Vercel preview).

*Agents:* **frontend-ux-architect (Opus)** designs + leads;
**general-purpose (Opus)** implements; **astro-performance-expert** +
**code-reviewer (Opus)** review.

---

## Estimated impact

~10,000+ LOC removed (dead pages ~3,200; infra boilerplate ~1,500; root
layout stack ~1,000; whats-new/assets ~1,500; hp-sections ~1,500; standings
~2,000), three latent cross-league bugs fixed, and a regression test that
keeps league constants in the registry. After Phases 2/3/5, adding a league
is: one `leagues-data.mjs` entry + one `tokens.css` block + page tree +
workflow-matrix entry.
