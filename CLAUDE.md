# CLAUDE.md

Guidance for Claude Code sessions working in this repo. Keep this short; add
entries for gotchas that have bitten us and would bite a future session too.

## Project basics

- **Framework:** Astro (SSR + SSG). React for client-hydrated islands.
- **Package manager:** pnpm (not npm). Scripts: see `package.json`.
- **Unit tests:** vitest. Run one file: `pnpm vitest run path/to/foo.test.ts`.
- **Prebuild:** `scripts/prebuild.mjs` runs build steps + network fetches in
  parallel. Add new build-time fetches there.

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

## Local env — `vercel env pull`, and worktrees don't inherit it

Server code reads `process.env` (auth JWT, every Upstash storage util), but
Vite only exposes `.env` files to `import.meta.env` — `astro.config.ts`
bridges the gap by hydrating `process.env` from `.env` / `.env.local` at
startup (real env always wins). Without a valid `.env.local`, local dev gets
a random JWT secret per restart and KV-backed writes fail (drafts POST →
503/500). Refresh with `pnpm dlx vercel env pull` in the repo root, and
**copy `.env` + `.env.local` into each worktree** — they're untracked, so
worktrees start without them. Gotcha from July 2026: a stale pre-migration
`.env.local` pointed at a deleted KV host (`ENOTFOUND …upstash.io`) — if a
Redis error names a host that's NXDOMAIN, re-pull the env.

## Feature flags — code, not GitHub Actions variables

Do not introduce new `vars.*` references in workflows as feature gates
(`SCHEFTER_FOO_ENABLED`, etc.). Editing a GitHub variable is never easier
than editing code in this repo, and the indirection just splits the
source of truth across two places. To disable a scheduled job, comment
out (or delete) its `cron:` line. To gate behavior, use a `const` in the
script itself.

A few legacy vars predate this rule (`SCHEFTER_RUMOR_MILL_ENABLED`,
`SCHEFTER_TRADE_OFFER_RUMORS_ENABLED`). Don't add more, and prefer
moving the existing ones into code if you're already touching the file.

## League registry — never hardcode league constants

`src/config/leagues-data.mjs` (data) + `src/config/leagues.ts` (types/helpers)
are the single source of truth for per-league constants: MFL id, slug, name,
MFL host, data path, apex domains, and feature flags. Do not write `'13522'`,
`'19621'`, `'data/theleague'`, etc. inline — import from the registry.
App code imports `../config/leagues`; node scripts import
`src/config/leagues-data.mjs` directly. Gate league-specific UI with
`leagueHasFeature(slug, 'contracts' | 'keepers' | ...)`. Adding a league or
domain is a one-entry change in `leagues-data.mjs`.
`tests/league-literal-guard.test.ts` enforces this — it scans src/, scripts/,
and .github/workflows/ for the forbidden literals and fails the build if one
creeps back in outside its small, documented allowlist.

## Design tokens — every var(--x) must reference a token that exists

The theme system is `src/styles/tokens.css` (light) + `tokens-dark.css`
(html.dark overrides). Styling against a token name that is defined nowhere
(`var(--color-text, #0f172a)`, `--color-surface`, …) renders the hardcoded
fallback in BOTH themes — light mode looks perfect, dark mode ships white
cards on a black page. That's how the Admin Hub broke in July 2026, and a
repo-wide sweep found the same pattern in ~40 files.
`tests/design-token-guard.test.ts` now enforces this: it scans src/ and
fails if any `var(--x)` references a custom property with no definition
anywhere (global token files, local declarations, `define:vars`,
`setProperty`, JSX `['--x' as any]` keys all count). Use the real tokens —
`--page-text`, `--content-text-muted`, `--card-bg`/`--card-surface`,
`--content-bg`/`--content-bg-muted`, `--content-border`, badge pairs — and
check `tokens-dark.css` before hand-rolling a `:global(html.dark)` override.
One more gotcha from the sweep: a token's light and dark values differ, so
when swapping a hardcoded color to a token, verify the token's LIGHT value
matches what was rendering — otherwise keep the light literal and override
only under `html.dark` (see the admin-hub gate pills for the pattern).

## Player headshots on team colors — use the shared avatar helpers

A player headshot on a team-color backdrop must go through
`getPlayerAvatarBackground` / `getPlayerAvatarBorder`
(`src/utils/nfl-team-colors.ts`) — usually via `<PlayerCell>` or
`buildPlayerCellHTML`, which set the `--player-avatar-bg`/`--player-avatar-border`
properties consumed by `player-cell.css`. Don't hand-roll gradients from
`getNflTeamColors`: a third of the NFL wears near-black primaries, and a raw
primary behind a dark-jerseyed headshot is invisible in dark mode (July 2026,
Cam Ward on Titans navy). The helpers pick a readable anchor (lighter
secondary for near-black primaries), floor its luminance, and add the radial
head-spotlight. The one sanctioned exception is the deep-ink composite family
(hero panels, player modal band, OG images, pick-reveal, dead-money) — dark
full-bleed surfaces with white text on the colored area, allowlisted in
`tests/team-color-backdrop-guard.test.ts`, which fails the build for any new
direct `getNflTeamColors` consumer.

## Auth — session JWT only

`getAuthUser()` (src/utils/auth.ts) trusts only the signed session cookie.
The old `X-User-Context` / `X-Auth-User` header fallbacks were removed in
June 2026 — they allowed full auth bypass. Never re-add unsigned identity
sources. Rate-limit any new LLM-backed endpoint with
`src/utils/rate-limit.ts`, and run any server-side fetch of a user-supplied
URL through `src/utils/url-guard.ts#validatePublicUrl`.

## Roger date-handling gotchas

There are **two** independent code paths named "Roger". Both have hallucinated
event dates in the past. Fixing one does not fix the other.

1. **Ask Roger (rules Q&A chatbot)** — `src/pages/api/rules-qa.ts`. LLM-backed.
   The system prompt is split into two blocks: a static cached block with the
   constitution, and a per-request block that injects today's Pacific-Time
   date. **Never remove the date block**, and keep it in a separate system
   array entry so the constitution block stays cache-eligible.

2. **GroupMe reminder poster** — `scripts/schefter-scan.mjs`. Template-based,
   not LLM. Fires at 14d / 7d / 2d / day-of touches before major events. Two
   rules that MUST hold:

   - The reminder window is asymmetric: fire on the target day or one day
     late, **never early**. The shared helper is
     `scripts/lib/roger-reminder-window.mjs#shouldFireReminder`. Don't
     reinvent it inline — `tests/roger-reminder-window.test.ts` locks it in.

   - `event.daysUntil` must be a calendar-day diff (midnight-to-midnight),
     not `Math.ceil` of a timestamp delta. Use
     `scripts/lib/roger-reminder-window.mjs#calendarDaysUntil`. `Math.ceil`
     on a sub-day delta rounds "tomorrow evening" up to 1 and combines with
     a permissive window to post "TODAY" a day early.

Historical note: both bugs fired together in April 2026 — Roger posted
"TODAY: NFL Draft" on Wednesday when the draft was Thursday. The post-mortem
is the reason this section exists.

## NFL Draft date source of truth

- **Authoritative:** `src/data/theleague/nfl-draft-dates-fetched.json` —
  populated by `scripts/fetch-nfl-draft-date.mjs` (ESPN core API) during
  prebuild. This file wins.
- **Fallback:** hand-maintained `HARDCODED_OVERRIDES` in
  `src/data/theleague/league-year-config.ts`. Used when the fetched JSON has
  no entry for a year (offline builds, new year not yet announced).
- **Consumers:** `league-year-config.ts` merges both. `compute-league-events.mjs`
  reads the dates to produce `resolved-events.json`, which the schefter-scan
  reads to decide which reminders to fire.

Never hardcode a draft date in a third place — update the fetched JSON or the
fallback config.

## Edit-time safety net

`.claude/settings.json` runs `.claude/hooks/roger-reminder-test.sh` on every
Write/Edit/MultiEdit to any Roger-related file. The hook runs the
reminder-window vitest suite and blocks the tool call if it fails. If you
edit one of those files and don't see a test run, `node_modules` probably
isn't installed — run `pnpm install`.

## Daily audit

`.github/workflows/roger-date-audit.yml` runs daily. It runs the reminder-
window tests and fetches the ESPN draft date; if ESPN disagrees with the
committed `nfl-draft-dates-fetched.json`, the workflow fails so the drift
surfaces in the Actions tab. To accept a new date, run
`pnpm fetch:nfl-draft-date` locally and commit the change.

## Merge conflicts — always rebase, resolve autonomously

Only Brandon and Claude commit to this repo, and conflicts are almost
always one of three patterns. **Default to `git rebase origin/main` (never
merge).** Do not stop and ask before resolving — fix it, run the relevant
tests, push, and report what you did.

Resolution rules by file pattern:

1. **`package.json`** — union both sides. New deps from main + new deps
   from the branch should both end up in the file. `.gitattributes`
   declares `merge=union` so this happens automatically; if union picks
   up duplicate entries (same key on both sides), drop the older version
   spec and keep the newer.
2. **`pnpm-lock.yaml`** — never hand-resolve. After `package.json` settles,
   run `pnpm install` to regenerate the lock; commit the regenerated file
   as part of the resolution.
3. **Auto-generated data files** (`src/data/theleague/schefter-feed.json`,
   `data/<league>/mfl-feeds/**`, `src/data/theleague/post-history.json`,
   any `*-feed.json` or `*.lock`) — prefer `--theirs` (incoming main).
   These are written by cron jobs; the branch's snapshot is stale by
   definition. Do not try to merge content row-by-row.
4. **Source code (`scripts/`, `src/`, `tests/`)** — read both sides,
   integrate the intent. New imports / new helpers stack additively. If
   the same function body changed on both sides, keep main's structural
   change and re-apply the branch's behavioral change on top. Run
   `pnpm test:unit` (or the targeted test file) after every non-trivial
   resolution.
5. **CLAUDE.md / docs** — additive. Both sides' new sections survive,
   reordered if needed. Never drop a section.

After every resolution, before pushing:
- `pnpm test:unit` must pass at the same baseline as pre-rebase (compare
  failure count — pre-existing failures are OK; new failures block).
- `node --check` every `.mjs` you touched.
- Force-push with lease: `git push --force-with-lease`. Never plain
  `--force` on a shared branch.

`git rerere` is enabled (see `.git/config`); identical conflicts on
re-rebase replay automatically. Do not turn it off.

## Schefter multi-league (tips + rumor mill run for BOTH leagues)

The tips → rumor-mill system is multi-tenant since July 2026. Load-bearing
rules — breaking any of these cross-contaminates the leagues:

- **Redis keys** go through `scripts/lib/schefter-keys.mjs#schefterKey(
  navSlug, suffix)` — TheLeague keeps its legacy unprefixed keys
  byte-identical, every other league gets `schefter:<navSlug>:*`.
  `tests/schefter-keys.test.ts` freezes the legacy strings and forbids raw
  `'schefter:'` literals outside the helper. Id-keyed namespaces
  (reactions/replies/threads/impressions/tipster_hash_for_tip) are global
  by design via `globalSchefterKey`.
- **API routes**: authed routes resolve the league from the session JWT
  (`src/utils/schefter-league.ts#resolveSchefterLeague`); public routes take
  `?league=<slug|navSlug>` defaulting to TheLeague. Never import a league's
  config/feed directly in a schefter route — use the helpers.
- **Season years** for tipster counters use each league's own rollover
  clock (`schefterSeasonYear`) — AFL rolls June 1, TheLeague Feb 14.
- **Scanner**: `schefter-rumor-scan.mjs --league <slug>`, one league per
  invocation, sequential workflow steps (parallel would race the feed
  commit). Per-league enablement = registry `features.schefterTips`; the
  `SCHEFTER_RUMOR_MILL_ENABLED` env var is only the global kill switch.
  The trade-offer lane and GroupMe mention ingestion are TheLeague-only
  (`scripts/lib/schefter-leagues.mjs` toggles) — AFL needs its own design
  for duplicate players before that lane can open.
- **Lore/persona** is per-league under `data/schefter/<navSlug>/`
  (personality, league-lore, running-bits, post-history, topic-recurrence).
  No legacy-path fallback on purpose — a missing file fails loudly rather
  than silently reading the other league's voice.
- **Pages** are thin per-league wrappers over shared components
  (`src/components/schefter/{TipPage,StyleBookPage,RumorThread,
  AdminDashboard}.astro`) — build tip-page improvements in the component
  once and both leagues inherit them.
- **Topics** come from `src/config/schefter-topics.mjs` — single source of
  truth for ids, labels, placeholders, per-league availability (AFL has no
  `motive`; hotseat is "Relegation watch" there), and scanner naming
  policies (tampering = explicit-pick-only + mandatory hedge; hotseat =
  never-name + scope floor + 14d per-team cooldown). Legacy `commish`
  normalizes to `frontoffice`. Adding a topic requires a scanner
  TOPIC_NOUNS entry — the scanner asserts coverage at startup.
- **Admin** is league-scoped end to end: `adminFranchiseIds` in
  nav-config.json is a per-league map, `isCommissionerOrAdmin` checks the
  session's own league, and both admin pages gate on
  `isAuthorizedForLeague`. AFL franchise 0001 must never pass TheLeague's
  admin gate (different teams, same id).

## Schefter tipster context (Phase 8 — bot intelligence)

The rumor-mill scanner weights bucket priority and surfaces voice cues
based on per-tipster signals. The whole flow lives in three files:

- **`scripts/lib/schefter-tipster-context.mjs`** — `buildTipsterContext`
  reads two Redis keys per queued web tipster and returns a
  `Map<hashedOwnerId, { isFirstTime, isProlific, tipsInQueue, beat }>`:
  - `schefter:tipster:rumors_total:{hash}` (STRING, lifetime post count)
  - `schefter:tipster:topic_counts:{hash}` (HASH, topic → lifetime count)
- **`scripts/lib/schefter-bucket-logic.mjs`** — `bucketPriorityScore`
  accepts the context as an optional third arg and adds a tipster delta
  (first-time voice +5, burst regular −3, prolific −1). Without the
  context, falls back to the pre-Phase-8 size+age math — both the
  scanner and the admin preview pass the context now.
- **`scripts/schefter-rumor-scan.mjs`** — `anonymizeTips` surfaces the
  voice flags on every web-tip scope: `firstTimeTipster`,
  `prolificTipster`, `tipsterBeat: { topic }`. HARD RULES 22 / 23 / 24
  drive the phrasing. Post-commit increments live in
  `schefter-tipster-counters.mjs` (`incrementTipsterCounters` plus
  `incrementTipsterTopicCounters`).

**Privacy contract — DO NOT WEAKEN.** The codename↔topic binding stays
server-side. That's option B from the design discussion in
`#enhance-bot-intelligence-tAh6t` — public codenames (Style Book bit)
are fine, but pairing a codename with a beat (e.g. "Burner Phone keeps
feeding me trade chatter") correlates over time and starts narrowing
source identity. HARD RULE 24 enforces "never name the codename"; the
`tipsterBeat` payload deliberately carries only the topic name, never
the codename or hash. The admin route keeps a server-only
`pendingTipsWithHashes` array for the priority preview math but strips
`hashedOwnerId` from everything that crosses the response boundary.

## Schefter quiet-day post (Phase 8 — feature 7)

When the scanner's normal lane finds no qualifying bucket AND the queue
meets one of three honest-quiet conditions (`queue-empty`,
`single-prolific-tipster`, `all-stale`), Schefter ships ONE candid
"slow news day" post instead of going silent. Lives entirely inside
`scripts/schefter-rumor-scan.mjs` (no separate module — the logic is
specific to the scanner flow):

- **Cooldown:** `schefter:rumor:quiet_day_last_date` (PT-date string),
  guarded by `QUIET_DAY_COOLDOWN_DAYS` (default 3).
- **Distribution:** writes the feed entry and consumes one of
  `MAX_POSTS_PER_DAY`, but **deliberately skips the GroupMe webhook** —
  a slow-news-day post buzzing every owner's phone is the opposite of
  slow. This invariant is locked by a sentinel comment that the
  regression test (`tests/schefter-quiet-day.test.ts`) greps for; do not
  delete the comment without also adding GroupMe-skip coverage another way.
- **Voice:** `generateQuietDayBody` uses its own tiny system prompt (not
  the main HARD-RULES block) with a 4-template fallback when
  `ANTHROPIC_API_KEY` is unset, so dry-runs still produce recognizable
  output.

## Best-ball leagues (draft-only) — opt-in nav, official draft, export-when-done

`best-ball-1` (MFL 37610) is the template for a family of draft-only best-ball
leagues. Rules that keep them cheap to add and impossible to break:

- **Registry flag:** `bestBall: true` marks a league as draft-only. Any UI
  offering lineups/add-drops/trades must be skipped for these leagues.
- **Nav is OPT-IN:** for best-ball navSlugs, only links tagged
  `leagueOnly: <navSlug>` render (`linkMatchesLeague` in nav-utils) — the
  untagged default link set is management UI they don't have. Adding a page
  to a best-ball league = page file + tagged nav link.
- **Official draft = promoted mock engine.** One deterministic PartyKit
  session per league-year (`mock-{navSlug}-official-{year}`), created
  commissioner-only via `/api/best-ball-draft/create` with `official: true`,
  full veteran player pool, 25 rounds, human pick clocks. Zero party-server
  changes — don't fork `party/draft-room.ts` for it.
- **Redraft ADP, not dynasty.** Best-ball leagues re-form every season, so
  every ADP surface (player-pool sort/badges via `adpSource: 'redraft'`,
  auto-pick lists via the `mfl-redraft` ranking source) uses
  `adp-redraft.json`. Dynasty ADP is only a fallback source — it overrates
  youth for a one-season roster.
- **No live MFL syncing by design.** The draft runs entirely on-site; after
  completion `pnpm export:bb-draft --commit` snapshots the results to
  `data/best-ball-1/draft/` and imports them to MFL through the
  `mfl-api.mjs` commissioner-write plumbing. The export refuses sessions
  without the `official` flag.
- **MFL host:** best-ball-1 lives on `www45.myfantasyleague.com`. If a
  future best-ball league's host isn't known yet, `api.myfantasyleague.com`
  works as a reads-only placeholder — commissioner writes fail on the
  gateway (the export script errors loudly and honors `MFL_WRITE_HOST`).
- Sister leagues (#2, …) = new registry entry + copies of the five thin
  pages in `src/pages/best-ball-1/` + a `tokens.css` accent block + tagged
  nav links + guard-test literals.

## Year rollover — two independent clocks

Two dates drive year transitions and they are **not the same clock**:

| Date | Event | Function |
|------|-------|----------|
| Feb 14 @ 8:45 PT | New MFL league created | `getCurrentLeagueYear()` |
| Labor Day | NFL season starts | `getCurrentSeasonYear()` |

Use `getCurrentLeagueYear()` (from `src/utils/league-year.ts`) for anything
roster-management-shaped: rosters, contracts, salary cap, auctions, trade
analysis. Use `getCurrentSeasonYear()` for anything results-shaped:
standings, playoffs, MVP tracking, draft order. Picking the wrong one for a
new page silently shows last/next year's data for ~6 months of the calendar
(the gap between the two rollover dates). Test date-dependent features with
the `?testDate=YYYY-MM-DD` URL param rather than changing the system clock.

## Draft order framing — "predictor" in-season, "official" after playoffs

Both leagues' draft order stops being a prediction the moment its deciding
games finish, and every surface that names or links the order must match
the phase — "Draft Predictor / projected" during the regular season,
"Draft Order / official" once it's locked. The phase is always data-driven
from the parsed playoff brackets (falls back to "projected" if any bracket
result can't be resolved):

- **AFL:** projected (season underway) → official once the NIT wraps (both
  conference champions + all 5 NIT bonus positions; `isDraftOrderFinal` in
  `src/utils/afl-draft-utils.ts`) → drafted once the late-August conference
  drafts are conducted (shared `isDraftConducted`, which handles the AFL's
  two-element `draftUnit` array). `afl-fantasy/draft-predictor.astro`
  switches its title/subtitle/badge on the phase.
- **TheLeague:** three phases, because the rookie draft happens mid-spring:
  projected (season underway) → official (champion + all 3 toilet bowl comp
  slots settled, draft not yet held) → drafted (picks made; back to
  predictor framing for the next cycle at Labor Day). Sources of truth:
  `isLeagueDraftOrderFinal` + `isDraftConducted` in `src/utils/draft-utils.ts`;
  `theleague/draft-predictor.astro` switches on them. In the drafted phase
  the "final" view must render the as-drafted results, never the
  `futureDraftPicks` merge — that snapshot freezes pre-draft and misses
  later pick trades.

Surfaces that only ever render in one phase can hardcode that phase's
framing: the AL/NL draft heroes (`afl-hero-resolver.ts`) and the NFL-draft /
rookie-draft heroes (`league-event-hero-view.ts`) only appear in offseason
windows where the order is official, so they say "View Draft Order", never
"predictor". Static copy (nav, page directory, Roger's prompt/seeds) should
stay phase-neutral or state both phases.

## Page directory registry — required for every new page

Adding a page to the site without adding it to
`src/data/page-directory.json` makes it invisible to site search. Each
entry needs `id`, `title`, `description`, `path`, `icon`, `category`
(`popular | my-team | reports | tools | info`), `visibility`
(`all | admin`), `popularity` (0-100), and **10+ tags** — write tags
generously (synonyms, data types shown, actions available, casual/slang
terms a user might type). `tests/page-directory-data.test.ts` enforces the
10-tag minimum and validates the other fields, but nothing tells you to add
the entry in the first place — you have to remember.

## What's New changelog — required after user-facing work

Completing a new page, new user-facing feature, or an enhancement that
changes how something works requires an entry in `src/data/whats-new.json`
(new entry at the **top** of the array). Skip it for style tweaks, data
syncs, refactors, docs-only changes, and admin-only/unreleased features.

Every entry MUST be written in the league's editorial voice — conversational,
witty sports-columnist tone, never dry corporate release notes. `new-page`,
`new-feature`, and `enhancement` entries require a screenshot
(`image`/`imageAlt` fields, webp in `public/assets/whats-new/`) —
`tests/whats-new-data.test.ts` fails the build without one. `bug-fix` and
`league-event` categories are exempt from the screenshot requirement.

**Hero eligibility — the homepage hero is for marquee launches only.** Only
*major* new pages and features should headline the homepage hero; enhancements
and smaller updates that still earn a What's New article should NOT. The gate
is the existing `excludeFromHero: true` flag, which `resolveHeroState`
(`src/utils/hero-resolver.ts`) honors. When authoring an entry: set
`excludeFromHero: true` for every `enhancement`, and for `new-page` /
`new-feature` **ask the user** whether it's a major launch worth the hero —
if not, set the flag. `/update-whats-new` (and therefore `/live`) prompts for
this; don't decide silently. (Related: after July 1 the resolver already gives
the roster-deadline Cut Watch hero ~50% of visits even when a fresh feature is
eligible, so the hero leans toward the deadline as the season nears.)

Smaller fixes that don't earn their own entry still get logged: append to
`src/data/weekly-changelog-staging.json` (`date`, `type`: `bug-fix |
style-tweak`, user-facing `summary`, `impact`: `user | admin`, `area`).
`scripts/weekly-changelog-rollup.mjs` compiles staging entries into one
What's New rollup every Monday 8pm PT via GitHub Actions, and that rollup
also needs one `featuredImage` picked from the week's most visually
interesting change — set it on the staging file's top-level
`featuredImage`/`featuredImageAlt` before the rollup runs.

## Schefter recurrence ledger v2 (Phase 8 — feature 10)

`data/schefter/<navSlug>/topic-recurrence.json` (per-league since the AFL launch) bumped to v2. Each fingerprint
entry now carries `tipsterHashes` (sorted-unique, capped at 64) in
addition to the existing `weeksSeen`. The bump powers cross-week memory
recall (HARD RULE 25): when a bucket reappears with at least one voice
that wasn't on its prior roster, `getMemoryRecall` returns a
counts-only payload (`weeksSinceFirstSeen`, `totalWeeksSeen`,
`distinctVoicesAcrossTime`) that the anonymizer attaches to each tip
in the bucket.

`loadLedger` migrates v1 files in place by backfilling empty
`tipsterHashes` arrays. The migration is transparent — no manual
intervention needed when a deployed branch first hits the v2 code.
Unknown future versions (>2) are discarded and replaced with an empty
ledger (safer than trusting a schema we don't understand).

**Privacy contract:** the ledger stores raw hashes for set-membership
checks (so we can detect "fresh voice"), but `getMemoryRecall`'s return
value contains only counts. The hashes never reach the LLM prompt or
the response payload. Don't change that without re-litigating the
correlation argument from option B above.
