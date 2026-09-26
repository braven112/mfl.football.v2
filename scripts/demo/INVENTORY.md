# Demo data inventory — TheLeague (`theleague`)

Checklist for the fictional-league generator (docs/plans/custom-site-demo.md). Built by a
scripted scan of `src/**` (static/dynamic imports, every `import.meta.glob` literal, every
string literal in files that call `fs.*Sync`), cross-checked by basename grep. Measured 2026-09-25.

Legend: **How** = `S` static import (missing file = BUILD BREAK), `G` import.meta.glob
(missing = empty map, build OK; E = eager), `F` fs read at SSR/build (all TheLeague fs reads
are wrapped in try/existsSync, so missing = degrade), `U` public URL. **ID** = carries
real-league identity (franchise names, owner names, owner words, league name/domain).
`20{25+}` = glob `20{2[5-9],[3-9][0-9]}` (only 2025+ is bundled).

## 0. Input table

### 0a. RAW_MFL feeds — `data/theleague/mfl-feeds/<leagueYear>/<feed>.json` (560 files, 79 MB, years 2007–2026)

| Feed | Years on disk | How + example consumer | Class | Missing | ID |
|---|---|---|---|---|---|
| league.json | 2007–26 | G `*/league.json` src/pages/theleague/standings.astro:36; G 20{25+} rosters.astro:178; F utils/nfl-club-rosters.ts:56 (95 refs) | RAW_MFL | degrade | yes (`name`,franchise names/abbrev/icon URLs, `baseURL`, history urls w/ id 13522) |
| rosters.json | 2007,2010–26 | G 20{25+} rosters.astro:193; G `*` players.astro:108; F utils/offseason-hero-data.ts:280 (60 refs) | RAW_MFL | degrade | no (ids/salaries) — league-specific contracts |
| players.json | 2011–26 (24 MB) | G 20{25+} rosters.astro:190 (+9 pages); F utils/player-map.ts:201 | NFL_FACT (MFL export) | degrade | no |
| standings.json | 2007–26 | G `*` standings.astro:27, draft/order.astro:23; F index.astro:813 | RAW_MFL | degrade | yes (`fname`) |
| schedule.json | 2007–26 | G `*` schedule.astro:25; G 20{25+} rosters.astro:186; F api/schedule-plan.ts:30 | RAW_MFL | degrade | no |
| weekly-results-raw.json | 2007–26 (27 MB) | G 20{25+} players.astro:121; F utils/weekly-player-results-feed.ts:60, data/live-scoring-sample.ts:212 | RAW_MFL | degrade | no |
| weekly-results.json | 2007–26 | G `*` playoffs.astro:43 (written by compute-franchise-history / schedule-strength too) | DERIVED-ish (flattened weeklyResults) | degrade | no |
| transactions.json | 2007–26 | G `*` transactions.astro:26, activity.astro:188; G 20{25+} index.astro:370; F offseason-hero-data.ts:923 | RAW_MFL | degrade | yes (trade `comments`) |
| draftResults.json | 2007–26 | G `*` draft/results.astro:26 (+5), api/mock-draft/create.ts:203; F draft/broadcast.astro:87 | RAW_MFL | degrade | yes (`comments`) |
| auctionResults.json | 2009–26 | G `*` players.astro:166 | RAW_MFL | degrade | no |
| futureDraftPicks.json | 2020–23,25,26 | G `*` draft/order.astro:40; G 20{25+} trade-builder.astro:63 | RAW_MFL | degrade | no |
| salaryAdjustments.json | 2007,2010–26 | G 20{25+} index.astro:367, rosters.astro:173; G `*` front-office/league-comparison.astro:25 | RAW_MFL | degrade | yes (`description` free text) |
| playoff-brackets.json | 2007–26 | G `*` playoffs.astro:40, utils/footer-champions.ts:194, draft/order.astro:26; F index.astro:805 | RAW_MFL (merged: `playoffBrackets`+`brackets{id}`) | degrade | no |
| projectedScores.json | 2019–26 | G `*` players.astro:104; G 20{25+} trade-builder.astro:79; F utils/draft-broadcast-server.ts:91 | NFL_FACT | degrade | no |
| playerScores.json / -ytd / -by-week | 25–26 / 25–26 / 26 | F offseason-hero-data.ts:487; G 20{25+} players.astro:128, :136 | NFL_FACT | degrade | no |
| player-scores-weekly.json | 2026 | scripts only (compute-top-players input) | NFL_FACT | n/a | no |
| nflSchedule.json / nflSchedule-full.json | 25–26 / 26 | G `*` players.astro:146, :154; G `data/*/…` api/cron/roster-sync.ts:58 | NFL_FACT | degrade | no |
| fantasyPointsAllowed.json | 2025–26 | G `*` players.astro:158; F utils/nfl-matchups.ts:199 | NFL_FACT | degrade | no |
| adp-dynasty.json / adp-redraft.json | 2025–26 | G `*` players.astro:113/:117; F utils/draft-player-enrichment.ts:109 (written by `fetch:adp`) | NFL_FACT | degrade | no |
| injuries.json | 2026 | G(E) `*` utils/mfl-injuries.ts:37 | NFL_FACT | degrade | no |
| calendar.json | 2026 | G(E) 20{25+} index.astro:244, utils/claim-context.ts:81, api/cron/roster-sync.ts:54; G `*` draft/index.astro:32 | RAW_MFL (event types+timestamps) | degrade | no |
| tradeBait.json / tradeBait-by-franchise.json | 2007–26 / 26 | G 20{25+} trade-builder.astro:71; F rosters.astro:271 | RAW_MFL | degrade | yes (owners' own comments) |
| fetch.meta.json | 2007–26 | G(E) `*` standings.astro:30 | BUILD_ARTIFACT | degrade | leagueId 13522 |
| option07, tradePage, assets.json, playoffBracket.json, roster-history/ (16 MB) | various | not read by src (roster-history: scripts/schefter-article.mjs; AFL-only glob) | RAW_MFL | none | option07 = scraped HTML "The League Rosters" |

Also RAW_MFL-shaped but orphaned: `src/data/mfl-feeds/theleague/2025/standings.json` (no src/scripts reader; has team names) and `src/data/13522/*` (no reader) — delete, do not regenerate.

### 0b. DERIVED — `data/theleague/derived/`, salary files, schedule strength

| Path | How + consumer | Writer script (npm) ← inputs | Missing | ID |
|---|---|---|---|---|
| derived/franchise-history.json | S franchises/[id].astro:5, franchises/index.astro:5, rivalries/[pair].astro:5, rivalries/index.astro:5 | compute-franchise-history.mjs (`compute:franchise-history`) ← feeds league/standings/schedule/weekly-results(-raw)/playoff-brackets/draftResults/auctionResults/transactions/players, `championship-history.json`, `src/data/theleague.config.json`, `data/theleague/mfl-player-salaries-*`, schefter-feed (milestone posts) | BREAK | yes |
| derived/season-ledger.json | not read by src; input of owner-tenures/division-strength | same script | n/a | yes |
| derived/owner-tenures.json | S franchises/[id].astro:12, franchises/index.astro:8, owners/[slug].astro:11, owners/index.astro:10 | compute-owner-tenures.mjs (`compute:owner-tenures`) ← season-ledger + `src/data/owners-registry.json` | BREAK | yes (owner names) |
| derived/division-strength.json | S division-strength.astro:17 | compute-division-strength.mjs (`compute:division-strength`) ← ledger + tenures + league/schedule feeds | BREAK | yes |
| derived/playoff-performance.json | S playoff-performance.astro:18 | compute-playoff-performance.mjs (`compute:playoff-performance`) ← league/standings/schedule/weekly-results/playoff-brackets + championship-history | BREAK | yes |
| derived/roster-season-payloads.json (≈9 MB) | S rosters.astro:132; G(E) `data/*/derived/…` api/roster-season/[league]/[year].ts:36 | compute-roster-season-payloads.mjs (`compute:roster-payloads`) ← feeds league/players/rosters/salaryAdjustments/standings, `src/data/mfl-player-salaries-*`, espn-college-ids, college-logos | BREAK | yes (team names) |
| derived/top-players.json | S top-players.astro:12 | compute-top-players.mjs (`compute:top-players`) ← player-scores-weekly/players/rosters/league + espn-college-ids | BREAK | yes (`owners[{name,icon}]`) |
| derived/schedule-strength-<yr>-w<wk>.json (5) | G `derived/schedule-strength-*.json` schedule-strength.astro:17, news/[id].astro:27 | compute-schedule-strength.mjs (`compute:schedule-strength`) ← schedule/standings/weekly-results(-raw) + config teams | degrade | yes (`name`) |
| derived/player-identity-union.json | F utils/player-map.ts:276 | compute-player-identity-union.mjs (`compute:player-identity-union`) ← every players.json | degrade | no (NFL) |
| derived/espn-nfl-id-backfill.json | F utils/player-map.ts:103 | fetch-espn-athlete-ids.mjs (`fetch:espn-ids`, ESPN net) | degrade | no (NFL) |
| derived/speculation-history.json, auction-price-predictions-{min,avg,max}.json | not read by src | schefter-trade-speculation.mjs / (none found) | n/a | ids only / player+franchiseId |
| src/data/mfl-player-salaries-<yr>.json (2007–26) | G(E) `src/data/mfl-player-salaries-*.json` dead-money.astro:21, index.astro:362, players.astro:178, mvp.astro:11 (+2) | committed by roster-sync (same shape as update-salary's `src/data/theleague/` copy; no dedicated writer found in scripts/) | degrade | no (franchiseId+salary) |
| src/data/mfl-salary-averages-<yr>.json (2007–26) | G(E) salary-analytics.astro:9, salary-history.astro:6, rosters.astro:169, players.astro:174 | update-salary-averages.mjs (`update:salary`) | degrade | no |
| src/data/salary-history/theleague/<yr>/summary-week-*.json (45) | G(E) front-office/salary-analytics.astro:14 | update-salary-averages.mjs | degrade | no |
| src/data/theleague/mfl-{player-salaries,salary-averages}-2021–26, data/theleague/mfl-{…}-2007–25 | not read by src; data/theleague copies are compute-franchise-history input | update-salary-averages.mjs / legacy | n/a | no |
| src/data/mfl-season-state.json | not read by src | update-salary-averages.mjs | n/a | no |
| src/data/theleague/historical-salary-curves.json | S utils/surplus-value.ts:15 | generate-historical-salary-curves.mjs (no npm) | BREAK | no |
| data/theleague/pecking-order/<yr>-<wk>.json (4) | G(E) index.astro:211, pecking-order/[year]/[week].astro:29, ballot.astro:31, index.astro:18, voters.astro:16 | generate-pecking-order.mjs (`generate:pecking-order`, ANTHROPIC_API_KEY) | degrade | yes (blurbs) |
| src/data/theleague/schefter-feed.json (≈1 MB) | S index.astro:74, news.astro:23, news/[id].astro:16, whats-new/[id].astro:12, season-heroes/ArticleHero.astro:37, RecapHero.astro:18, api/schefter-replies/[postId]/ai-reply.ts:64, utils/schefter-league-data.ts:20; F utils/schefter-og.ts:45 | schefter-scan.mjs + article-utils/feed-writer.mjs (cron, LLM) | BREAK | yes (heaviest) |
| src/data/theleague/schefter-archive/<yr>.json | G news/[id].astro:36; F schefter-og.ts:96 | lib/schefter-archive.mjs | degrade | yes (326 name lines) |
| data/schefter/theleague/topic-recurrence.json | S api/admin/schefter-stats.ts:87 | lib/schefter-recurrence-ledger.mjs | BREAK | franchise ids |
| data/schefter/theleague/{post-history.json, league-lore.md, personality.md, running-bits.md} | not read by src (Schefter scripts) | GroupMe/Schefter scripts | n/a | yes |
| data/theleague/owner-last-visit.json | G(E) activity.astro:225 | sync-owner-last-visit.ts (workflow, MFL commish cookie) | degrade | no (ids+timestamps) |
| data/theleague/schedule-release/<yr>.json | F utils/schedule-release-store.ts:103 | lock-schedule-release.mjs | degrade | yes (`awayName/homeName`) |
| data/theleague/schedule-plan/2026-schedule.{json,txt} | F api/schedule-plan.ts (via plan util) | generate-schedule / stage-schedule-plan.mjs | degrade | yes (`leagueName`) |
| data/theleague/august-cuts/<yr>-report.json | F admin/cutdown-report.astro:90 | apply-august-cuts.mjs (MFL write, GROUPME) | degrade | yes (`franchiseName`) |
| src/data/theleague/resolved-events.json | not read by src for theleague (schefter-season-mode reads AFL's) | compute-league-events.mjs | n/a | no |
| src/data/theleague/nfl-draft-dates-fetched.json | S (via league-year-config.ts:2) | fetch-nfl-draft-date.mjs (`fetch:nfl-draft-date`, ESPN) | BREAK | no — NFL_FACT |
| src/data/theleague/def-spotlight-players.json (+.ts) | S components/theleague/PlayerDetailsModal.astro:1092 (+5 via .ts) | fetch-def-spotlight-players.mjs (`fetch:def-spotlight`) | BREAK | no — NFL_FACT |
| data/theleague/espn-college-ids.json | S CustomRankingsPage.astro:32, players.astro:34, rosters.astro:33, trade-builder.astro:33, DraftMockResultsPage.astro:20, rookies-2026.astro:25, utils/front-office-planner-data.ts:37 | fetch-espn-college-ids.mjs | BREAK | no — NFL_FACT |
| data/theleague/rsp-player-ids.json | S rookies-2026.astro:30; F utils/draft-player-enrichment.ts:75 | none (hand) | BREAK | no — NFL_FACT |
| data/theleague/broadcast-mappings.json | S utils/broadcast-channels.ts:17 | hand (TV channels) | BREAK | no — NFL_FACT |
| src/data/crest-dark-stroke-manifest.json | S utils/crest-dark-stroke-css.ts:47, franchise-marks.ts:47 | measure-crest-contrast.mjs (`measure:crest-contrast`) ← franchise icon PNGs | BREAK | yes (name+icon path) |
| src/data/theleague.assets.json | S DraftCapitalTable.astro:2, brand/files.astro:20, franchises/index.astro:7, league-comparison.astro:4, salary-analytics.astro:5, rosters.astro:15, footer-champions.ts:46, front-office-planner-data.ts:35, team-preferences.ts:7 | sync-theleague-assets.mjs (`sync:theleague`) ← scans public/assets/theleague | BREAK | yes (names, aliases, file names) |

### 0c. HAND (hand-authored league content)

| Path | How + consumer | Missing | ID |
|---|---|---|---|
| src/data/theleague.config.json (34 KB) | S — 63 importers: layouts/TheLeagueLayout.astro:47, nav/NavFooter.astro:19, utils/franchise-brand.ts:21, league-team-brands.ts:20, owner-trade-reports.ts:22, franchise-band-brand.ts:53 …; F offseason-hero-data.ts:1218; also scripts input (registry `configPath`) | BREAK | yes — THE identity root: `teams[16]{franchiseId,name,nameMedium,nameShort,abbrev,aliases,division,colors*,icon,iconDark,banner,groupMe*,history[] eras,ownerHistory,loaderQuips}`, `divisions`, `divisionAliases`, `loaderLines`, `assetDomain`,`blobDomain` |
| data/theleague/championship-history.json | F api/schedule-release.ts:50; input of compute-franchise-history & playoff-performance | degrade | yes (`championName`) |
| src/data/owners-registry.json | not read by src; input of compute-owner-tenures (both leagues, 124 people / 38 TheLeague) | n/a (chain) | yes (owner real names) |
| src/data/theleague/league-events.ts | S utils/league-event-resolver.ts:16, planner-phase.ts:23 | BREAK | mild (16 league deadlines, theleague.us forum URLs) |
| src/data/theleague/league-year-config.ts | S league-event-resolver.ts:17 | BREAK | no (NFL draft dates) |
| src/data/theleague/throwback-config.ts / throwback-weeks.mjs | S api/schedule-release.ts:26, lineup.astro:32, utils/throwback-scope.ts:28 | BREAK | yes (reads config `history[]`; 20 name lines) |
| src/data/hero-showcase/theleague.ts | S theleague/showcase.astro:20 | BREAK | yes (franchiseIds + copy) |
| src/data/league-constitution.ts | S rules-qa-system-prompt.ts:12 | BREAK | yes ("Brandon Shields is the League Commissioner", names) |
| src/data/rules-qa-system-prompt.ts / rules-qa-seeds.json | S api/rules-qa.ts:9,13 (seeds also via config/rules-qa-keys.mjs) | BREAK | yes (league history, 2007, fees) |
| src/pages/theleague/rules.astro (1341 lines, inline constitution) | page | — | yes (commissioner name) |
| src/data/whats-new.json (40 entries, 27 TheLeague) + whats-new-archive/{2025,2026}.json | S components/schefter/AdminDashboard.astro:16, utils/whats-new-entries.ts:15; G(E) utils/whats-new-all-entries.ts:19 | BREAK (json) / degrade (archive) | yes (team + owner names, screenshots) |
| src/data/weekly-changelog-staging.json | scripts only (rollup) | n/a | maybe |
| src/data/page-directory.json, guides.json | S SearchPage.astro:19 etc.; utils/guides.ts:8 | BREAK | no (neutral) — keep |
| src/data/theleague/salary-archive-links.json / salary-archive-urls.json | S front-office/salary-archive.astro:5, salary-analytics.astro:6 | BREAK | links to real league spreadsheets / `{}` |
| data/theleague/pigskins-roster-2026.json, rsp-league-ownership.json | S rookies-2026.astro:28,29 | BREAK | yes (commissioner's roster; `franchiseName` per player) |
| src/data/theleague/power-rankings/2025-w1{3,4}.json | not read by src (legacy) | n/a | yes — delete |
| src/data/live-scoring-sample.ts | S utils/live/league-board.ts:30; F reads feeds league/weekly-results-raw/rosters/schedule/nflSchedule/adp + src/data/mfl-player-salaries | BREAK (module) | no (reads feeds) |
| data/theleague/config.json, assets.json (root) | not read by src (legacy dupes of src/data copies) | n/a | yes — delete |
| data/theleague/{live-injury-data,live-starting-lineups}-week-*.json, high-total-matchups.json, test-matchup-story.json, nfl-cache/, mocks/ | not read by src | n/a | high-total-matchups/test-story: yes |

### 0d. NFL_FACT / shared, league-neutral (keep)
`data/ranking-sources/*.json` (G), `data/nfl/snap-counts-*.json` (G), `data/nfl/bye-weeks.json` (F), `data/fantasy-expert/**` (S rookies-2026.astro:21–27), `data/adp/*-rookies-*.json` (F mock-draft/create.ts:426), `src/data/college-logos.json`, `nfl-*` manifests, `tv-logo-stroke-manifest.json`, `src/data/nfl/{live-odds.json,week-starts.mjs}`, `bookmarklet-manifest.json`.

## 1. Derived chain (scripts/prebuild.mjs order)

`run()` is NON-FATAL: a failed step logs ✗ and the build continues against whatever is on disk.
`previewSkip` steps are skipped on `VERCEL_ENV=preview` UNLESS the branch diff vs origin/main
touches a step script, `scripts/lib/**`, `package.json`, `prebuild.mjs`, or ANY `src/**/*.mjs`
(`isPipelineFile`) — a demo branch editing e.g. `src/config/leagues-data.mjs` flips to FULL.

SEQUENTIAL
1. `build:styles` — local. 2. `build:bookmarklets` — local.
3. `update:salary:all` (**NOT previewSkip — always runs**) = `update-salary-averages.mjs` for theleague then AFL.
   NET: api.myfantasyleague.com (live `rosters`/`players`/`weeklyResults` for MFL_LEAGUE_ID, default
   13522), api.sleeper.app, github.com (nflverse). Env: MFL_SEASON, MFL_YEAR, MFL_LEAGUE_ID,
   MFL_LEAGUE_SLUG, MFL_API_BASE, MFL_WEEK, MFL_USERNAME, MFL_PASSWORD, MFL_API_KEY,
   MFL_FREEZE_WEEK, SLEEPER_PLAYERS_URL, NFLVERSE_SNAP_URL, **SKIP_SALARY_FETCH** (1 = no-op).
   Writes src/data/theleague/mfl-player-salaries-Y, src/data/{theleague/,}mfl-salary-averages-Y,
   src/data/salary-history/theleague/Y/*, src/data/mfl-season-state.json. Falls back to cached
   data/theleague/mfl-feeds/Y/rosters.json only if the live fetch FAILS.
4. `compute:franchise-history` → franchise-history.json + season-ledger.json (local; reads config, championship-history, salaries, schefter-feed).
5. `compute:afl-free-agents`, `compute:afl-franchise-history`, `compute:afl-record-book` — AFL only.
6. `compute:player-identity-union` (+`:afl`) — local.
7. `compute:roster-payloads` — local (espncdn URL strings only).
8. `compute:top-players` (+`:afl`) — local.

PARALLEL (after sequential)
- `compute:schedule-strength`, `compute:playoff-performance` — local.
- `compute:owner-tenures && compute:division-strength` — local (owners-registry → tenures → division).
- `fetch:live:lineups` — NET MFL (MFL_LEAGUE_ID default 13522, MFL_YEAR, CURRENT_WEEK); writes data/theleague/live-*-week-N.json (unused by src).
- `fetch:trade-bait` — NET MFL; **package.json hardcodes `MFL_LEAGUE_ID=13522`**; env MFL_API_KEY/APIKEY, MFL_HOST, MFL_SEASON/YEAR; writes mfl-feeds/Y/tradeBait*.json (real owner comments).
- `fetch:adp` — NET MFL ADP → mfl-feeds/Y/adp-*.json (NFL fact).
- `fetch:ranking-sources` — NET MFL, Sleeper, FantasyCalc, ESPN → data/ranking-sources (NFL fact; reads theleague players.json).
- `fetch:nfl-draft-date` (ESPN), `fetch:nfl-week-starts` (MFL nflSchedule → src/data/nfl/week-starts.mjs), `fetch:espn-ids` (ESPN), `fetch:nfl-news-digest` (ESPN → data/schefter/nfl-context.json), `fetch:nfl-dark-logos`, `fetch:college-dark-logos` — NFL facts.

`scripts/recompute-derived-chain.mjs` (the only COMMITTING path) = compute-franchise-history
(`--league=<each>`) → compute-owner-tenures → compute-division-strength; CHAIN_FILES =
franchise-history, season-ledger, owner-tenures, division-strength; guard suites season-ledger,
owner-tenures-data, division-strength-data, owner-boundary-parity, owners-registry,
franchise-history-season-complete must pass on the generated set.

Outside prebuild (cron/workflow producers of league files): `fetch-mfl-feeds.mjs` (all RAW_MFL,
env MFL_* incl. MFL_USER_ID/PUBLIC_BASE_YEAR), `schefter-scan.mjs` (ANTHROPIC_API_KEY, GROUPME_*,
MFL_*), `generate-pecking-order.mjs` (ANTHROPIC_API_KEY), `sync-owner-last-visit.ts`,
`fetch-owner-names.mjs` (MFL_COOKIE/USERNAME/PASSWORD), `lock-schedule-release.mjs`,
`apply-august-cuts.mjs`, `sync-theleague-assets.mjs`, `measure-crest-contrast.mjs`,
`weekly-changelog-rollup.mjs`.

## 2. Hand-authored content to replace

| File | Real identity carried |
|---|---|
| src/data/theleague.config.json | 16 franchise names/eras (31 distinct names), abbrevs, aliases, colours, icon/banner/groupMe paths, ownerHistory, loader quips about owners, division names |
| src/data/theleague.assets.json + data/theleague/assets.json | every era name + alias + asset filename (regenerate via sync:theleague after replacing art) |
| src/data/owners-registry.json | 38 TheLeague owners' real names + claims (AFL people share file) |
| data/theleague/championship-history.json | champion/runner-up names per year |
| src/data/league-constitution.ts, src/pages/theleague/rules.astro | commissioner name, dues, history; rules.astro is inline copy |
| src/data/rules-qa-system-prompt.ts, rules-qa-seeds.json | "The League, est. 2007", seeded Q&A |
| src/data/theleague/league-events.ts | deadlines + theleague.us forum links |
| src/data/hero-showcase/theleague.ts | franchise cards/copy |
| src/data/whats-new.json, whats-new-archive/*.json, weekly-changelog-staging.json | team + owner names in prose, screenshots in public/assets/whats-new (351 files, 31 MB) |
| src/data/theleague/schefter-feed.json, schefter-archive/2026.json, data/schefter/theleague/* | all posts (names, owner quotes, GroupMe lore, personality/lore md) |
| data/theleague/pecking-order/*.json, src/data/theleague/power-rankings/* | columns about real teams |
| data/theleague/pigskins-roster-2026.json, rsp-league-ownership.json | commissioner's roster; franchiseName per player |
| data/theleague/schedule-release/2026.json, schedule-plan/*, august-cuts/2026-report.json | team names, marquee copy |
| src/data/theleague/salary-archive-links.json | links to the real league's archived salary sheets |
| src/config/leagues-data.mjs (registry) | name "The League", mflId 13522, mflHost www49, domains theleague.us, canonical/staging hosts |
| public/assets/logos/theleague-logo{,-dark}.svg, public/assets/theleague/** | league + franchise art (section 5) |

## 3. Code with hardcoded real-league identity

Script: scan of `src/**/*.{ts,tsx,astro,mjs,js,json,css,scss,md}` for the 31 distinctive team/era
names from config (`name`,`nameMedium`,`history[].name`, ≥6 chars, generic ones like
"Maverick", "The Dream", "Cowboy Up" excluded) + 36 two-word owner display names from
owners-registry.json/owner-tenures.json.

- Non-data code: **60 files, 147 team-name lines, 3 owner lines** — 104 of those lines are
  comments; **45 live lines in 15 files**.
- Data under src/: 17 files, 757 team lines, 61 owner lines (schefter-archive 326,
  schefter-feed 81, whats-new-archive/2026 66+3, config 60, assets 54, owners-registry 51 owner,
  power-rankings 48+47, whats-new 20+5, throwback-config 20, mfl-feeds/theleague/2025/standings 12,
  league-constitution 4+1, hero-showcase 2).

Live-code offenders (lines): `src/utils/groupme-storage.ts` 13 (hardcoded **GroupMe user id →
franchise map with owner first names**, 16 entries ~l.300), `src/scripts/transaction-hub.ts` 12
(mock trade offers "Computer Jocks" etc. ~l.1313, also 14 icon-slug hits), `src/pages/api/suggestions/seed.ts` 6
(seed authors with team names), `src/assets/css/src/_afl.scss` 2,
`components/theleague/DraftPredictorGrid.astro` 2, and 1 each: schefter/TipPage.astro,
brand/FranchiseBrandPage.astro, division-strength/DivisionStrengthPage.astro,
draft-broadcast/OnTheClock.tsx, schedule/SchedulePage.astro, theleague/insights.astro,
theleague/rosters.astro, theleague/rules.astro, styles/hero-franchise-backdrop.css, utils/schedule-plan.mjs.
Comment-heavy (names only in docs): franchise-band-brand.ts 11, viewer-preferences.ts 9
(franchise-id→country map is live, names in comments), team-names.ts 8, league-context.ts 7
(cross-league owner pairing ids), owner-tenures.mjs 5, franchise-marks.ts 4.
Icon-slug literals (`pigskins`, `dark_magicians`…) in code: transaction-hub.ts 14,
rookies-2026.astro 3, owner-tenures.mjs 2, league-assets.ts 2, 1 each team-icon-dark-css.ts,
franchise-marks.ts, franchise-brand.ts, DraftPredictorGrid.astro.
Commissioner name / `theleague.us`: leagues-data.mjs 7, TheLeagueLayout.astro 4,
css-customization.astro 4, middleware.ts 3, login-redirect.ts 3, league-events.ts 3,
NavHeader.astro 3, BroadcastRevealCard.tsx 3, leagues.ts 3 (100 `theleague.us` hits total).
Top terms: Pacific Pigskins 103, Da Dangsters 99, Vitside Mafia 95, Computer Jocks 91,
Midwestside Connection 82, Gridiron Geeks 80.

## 4. RAW_MFL shapes (from mfl-feeds/2025; 2026-only noted). Seasons: 2007–2026

Every export is wrapped `{<root>, version, encoding}`; single-element arrays may be objects (MFL quirk, e.g. projectedScores.playerScore).
- league: `{league:{id,name,baseURL,startWeek,endWeek,lastRegularSeasonWeek,salaryCapAmount,rosterSize,starters:{count,position:[{name,limit}]},divisions:{count,division:[{id,name}]},franchises:{franchise:[{id,name,abbrev,icon,logo,division,waiverSortOrder,bbidAvailableBalance,salaryCapAmount,stadium}]},history:{league:[{year,url}]},…~50 settings}}`
- rosters: `{rosters:{franchise:[{id,week,player:[{id,status,salary,contractYear,contractInfo}]}]}}`
- players: `{players:{timestamp,player:[{id,name,position,team,draft_year,draft_team,stats_id,…}]}}`
- standings: `{leagueStandings:{franchise:[{id,fname,h2hw,h2hl,h2ht,h2hwlt,pf,pa,pp,divw,divl,all_play_wlt,strk,bbidbalance,…44}]}}`
- schedule: `{schedule:{weeklySchedule:[{week,matchup:[{franchise:[{id,isHome,score,result}]}]}]}}`
- weekly-results-raw: `[ {weeklyResults:{week,matchup:[{regularSeason,franchise:[{id,score,result,isHome,starters,nonstarters,optimal,opt_pts,player:[{id,score,status,shouldStart}]}]}]}} ×weeks ]`
- weekly-results (flattened): `{weeks:[{week,scores:{<fid>:pts}}]}`
- transactions: `{transactions:{transaction:[{type,franchise,timestamp,transaction,by_commish,franchise2,franchise1_gave_up,franchise2_gave_up,comments,expires,activated,deactivated,promoted,demoted}]}}`; types FREE_AGENT,TAXI,IR,LOAD_ROSTERS,LOCK_ALL_PLAYERS,BBID_WAIVER,BBID_AUTO_PROCESS_WAIVERS,TRADE,AUCTION_INIT,AUCTION_WON,AUCTION_BID
- draftResults: `{draftResults:{draftUnit:{unit,draftType,round1DraftOrder,static_url,draftPick:[{round,pick,franchise,player,timestamp,comments}]}}}` (object for TheLeague)
- auctionResults: `{auctionResults:{auctionUnit:{unit,auction:[{player,franchise,winningBid,timeStarted,lastBidTime}]}}}`
- futureDraftPicks: `{futureDraftPicks:{franchise:[{id,futureDraftPick:[{year,round,originalPickFor}]}]}}`
- salaryAdjustments: `{salaryAdjustments:{salaryAdjustment:[{id,franchise_id,amount,description,timestamp}]}}`
- playoff-brackets (merged): `{playoffBrackets:{playoffBracket:[{id,name,startWeek,teamsInvolved,bracketWinnerTitle,startWeekGames}]},brackets:{<id>:{playoffBracket:{bracket_id,playoffRound:[{week,playoffGame:[{game_id,home:{franchise_id,seed,points},away:{…}}]}]}}},lastFetched}`
- projectedScores: `{projectedScores:{week,playerScore:[{id,score}]}}`; playerScores / -ytd: `{playerScores:{week,playerScore:[{id,week,score,isAvailable}]}}`; playerScores-by-week (26): `{weeks:{<wk>:{<pid>:pts}}}`; player-scores-weekly (26): `[playerScores export ×weeks]`
- nflSchedule / -full: `{fullNflSchedule:{nflSchedule:[{week,matchup:[{kickoff,gameSecondsRemaining,team:[{id,isHome,score,spread,hasPossession,inRedZone,passOffenseRank,…}]}]}]}}`
- fantasyPointsAllowed: `{fantasyPointsAllowed:{<NFL>:{QB|RB|WR|TE|PK:{avg,rank}}}}`
- adp-dynasty / adp-redraft: `{adp:{timestamp,totalDrafts,totalPicks,player:[{id,rank,averagePick,minPick,maxPick,draftSelPct,draftsSelectedIn}]}}`
- calendar (26): `[{id,type,title,happens,start_time,end_time}]` (types AUCTION_START, DRAFT_START, …)
- injuries (26): `{generatedAt,year,injuredPlayers,injuries:{<pid>:{injuryStatus,injuryBodyPart,expectedReturn}}}`
- tradeBait: `[]` or MFL tradeBaits export; tradeBait-by-franchise (26): `{fetchedAt,franchises:{<fid>:{playerIds:[],willGiveUpComment,willTakeComment}}}`
- fetch.meta: `{lastFetched,leagueId,year,week}`
- roster-history/rosters-YYYY-MM-DD.json: rosters export snapshots (src does not read TheLeague's).

Coverage gaps a generator must mirror or pages go blank: players.json from 2011 only; rosters/salaryAdjustments missing 2008–09; auctionResults from 2009; projectedScores from 2019; futureDraftPicks 2020–23,25,26; 2026-only feeds above. Globs keyed `20{25+}` mean **2025 and 2026 need the full set**; `*/` globs (standings, league, draftResults, playoff-brackets, transactions, schedule) walk every year back to 2007. `scripts/lib/archived-feed-files.mjs` ships the newest three seasons into the serverless bundle for fs reads.

## 5. Public assets — `public/assets/theleague/` (224 files, 15 MB)

| Dir | Files | Size | Code refs to dir |
|---|---|---|---|
| history/ (retired era crests, banners) | 89 (86 png, 2 svg, 1 jpg) | 4.4 MB | 168 |
| icons/ (current crests + `_dark`) | 48 png | 1.3 MB | 91 |
| group-me/ (chat avatars + `_dark`) | 48 png | 5.8 MB | 67 |
| banners/ | 33 png | 3.3 MB | 43 |
| division-badges/ | 4 svg | 20 KB | 8 |
| awards/ | 2 jpg | 28 KB | 7 |

Referenced almost entirely via data (config `icon/iconDark/banner/groupMe/history[]`,
theleague.assets.json `relativePath`, league.json `icon/logo` absolute URLs on
mflfootballv2.vercel.app), plus literal paths in 14 code files: utils/league-assets.ts,
franchise-brand.ts, team-icon-dark-css.ts, team-icon-dark-styles.ts, identity-normalize.mjs,
offseason-hero-data.ts:1325, broadcast-live-source.ts, whats-new-links.ts,
standings-table-config.ts, scripts/transaction-hub.ts, pages franchises/[id].astro,
news/[id].astro, front-office/dead-money.astro, types/whats-new.ts.
Other identity-bearing public files: `public/assets/logos/theleague-logo{,-dark}.svg`,
`public/assets/whats-new/` (351 screenshots, 31 MB), `public/assets/guides/` (1),
`src/data/crest-dark-stroke-manifest.json` (derived from icons).

## Risks (read first)

1. **update:salary:all always runs and live-fetches league 13522 from MFL** (public export, no key
   needed) and overwrites the salary files with REAL rosters. Demo must set `SKIP_SALARY_FETCH=1`
   (or point MFL_LEAGUE_ID/MFL_API_BASE away). The demo-isolation env scrub runs at SSR boot, not in prebuild.
2. A demo branch touching any `src/**/*.mjs` makes the preview prebuild FULL → `fetch:trade-bait`
   (hardcoded 13522) writes real owner trade-bait comments into mfl-feeds; `fetch:live:lineups`
   hits 13522 too. Generated derived files are also recomputed, so the fictional config,
   owners-registry and championship-history must exist before prebuild.
3. Prebuild failures are swallowed; a compute step erroring on synthetic feeds silently leaves
   the generator's (or a stale) derived file in place.
4. owners-registry.json is shared with the AFL; guard tests (`owners-registry`, `owner-tenures-data`,
   `season-ledger`, `division-strength-data`) demand row-for-row agreement of the chain.
5. Runtime MFL reads (lineup, rosters/transactions caches, live standings, 95 src files build MFL
   URLs from the registry id) are handled by the demo MFL stand-in in src/utils/demo-isolation.ts.
