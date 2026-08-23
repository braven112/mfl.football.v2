# CLAUDE.md

Guidance for Claude Code sessions working in this repo.

**This file is a router, not an encyclopedia.** It carries only rules that
apply to work *anywhere* in the repo — the ones you can't know to go look up.
Everything domain-specific lives in `docs/claude/rules/<domain>.md`, indexed
below. Those docs are the authority; each rule in them is a bug that shipped.

**Read the matching rules doc BEFORE editing in that territory** — not after a
test fails. Adding a gotcha? Put it in the domain doc and, only if it's
cross-cutting, add a line here. Keep this file short.

## Project basics

- **Framework:** Astro (SSR + SSG). React for client-hydrated islands.
- **Package manager:** pnpm (not npm). Scripts: see `package.json`.
- **Unit tests:** vitest. Run one file: `pnpm vitest run path/to/foo.test.ts`.
- **Prebuild:** `scripts/prebuild.mjs` runs build steps + network fetches in
  parallel. Add new build-time fetches there.
- **Guard tests are the real memory.** ~228 suites in `tests/` mechanically
  enforce most rules in this repo. When a rule below names a test, that test
  is what stops the regression — read it before working around it.

## Read before you touch

| Working on… | Read first | The trap, in one line |
|---|---|---|
| Schefter (tips, rumor mill, redaction, tipster context, article links) | `docs/claude/rules/schefter.md` | Redaction must cover retired names + aliases, or a post names a team it may not; every article type must declare `relatedLinks` or it publishes prose with nothing to click; and a post's LINK must obey the same naming scopes its prose does. |
| Roger (rules Q&A, GroupMe reminders, evals, draft dates) | `docs/claude/rules/roger.md` | Two independent "Roger" code paths; both have hallucinated dates. Fixing one doesn't fix the other. |
| Standings, playoffs, brackets, draft order | `docs/claude/rules/standings-brackets-draft-order.md` | Never re-sort MFL's standings rows — its order already applies the constitution's tiebreakers, including h2h we can't reproduce. |
| Live scoring / ESPN data | `docs/claude/rules/live-scoring.md` | A college athlete id and an NFL one are both plain digits, so a bad join resolves the wrong person instead of failing. |
| Set Lineup pages | `docs/claude/rules/lineups.md` | `res.ok` is not "the call worked" — MFL returns errors as HTTP 200, and "no lineup" vs "couldn't read it" must never merge. |
| Colors, tokens, logos, headshots, service worker | `docs/claude/rules/theming-and-assets.md` | A `var(--x)` with no definition renders its fallback in *both* themes — light looks perfect, dark ships white-on-black. |
| Feed writers, globs, `.git` size, Astro 7 compiler | `docs/claude/rules/storage-and-build.md` | MFL returns arrays in nondeterministic order — a plain `writeFileSync` + byte diff regrows a 7 GB `.git`. |
| Absolute URLs, GroupMe message text | `docs/claude/rules/league-urls.md` | Never concatenate origin + path; and GroupMe autolinks the period after a URL, 404ing it for every owner. |
| Best-ball leagues | `docs/claude/rules/best-ball.md` | Draft-only: nav is opt-in, ADP is redraft, no live MFL syncing. |
| Schedules, doubleheaders, NFL byes, division-game placement | `docs/claude/rules/schedule-optimization.md` | The late doubleheader week is not a constant — it is whichever of Week 12/13 is bye-free that year, and copying last year's week numbers has shipped a doubleheader onto a bye twice. |

Deeper history (dated journals, one file per feature/domain) lives in
`docs/claude/insights/`. Reference docs (auth, testing, build, league rules)
live in `docs/claude/`.

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

**Building an absolute URL, or writing GroupMe text? Read
`docs/claude/rules/league-urls.md` first.** `leagueUrl(league, path)` is THE
builder and is total in both directions — never concatenate an origin with a
path. Chat clients autolink trailing punctuation, so
`stripLinkAdjacentPunctuation` guards the send path and
`resolvePunctuationRedirect` guards the inbound one; that sanitizer's call
sites are pinned by test and it must never touch JSON or config text.

## Year rollover — two independent clocks

Two dates drive year transitions and they are **not the same clock**:

| Date | Event | Function |
|------|-------|----------|
| Feb 14 @ 8:45 PT | New MFL league created | `getCurrentLeagueYear()` |
| Labor Day | NFL season starts | `getCurrentSeasonYear()` |

Use `getCurrentLeagueYear()` (from `src/utils/league-year.ts`) for anything
roster-management-shaped: rosters, contracts, salary cap, auctions, trade
analysis. Use `getCurrentSeasonYear()` for anything results-shaped: standings,
playoffs, MVP tracking, draft order. Picking the wrong one for a new page
silently shows last/next year's data for ~6 months of the calendar. Test
date-dependent features with `?testDate=YYYY-MM-DD`, not the system clock.

- The auto-calculated base (pivot) year is ALWAYS `calendarYear - 1`; the
  Feb 14 / Labor Day cutoff checks are what advance it. A base year that
  itself advances at Labor Day gets +1'd twice (that bug shipped in five
  files). Copy the formula from `league-year.ts`, or don't re-port it.
- `PUBLIC_BASE_YEAR` / `PUBLIC_MFL_YEAR` pins are floor-only: the code clamps
  to `max(pin, calendarYear - 1)`, so a stale pin self-heals and no manual bump
  is needed at rollover — **never bump a pin at Labor Day** (a pin equal to the
  current calendar year during the season double-advances the math).
  `tests/league-year-rollover.test.ts` locks the timeline.
- **"The feeds have a completed week" is NOT an offseason guard.** Because
  `getCurrentSeasonYear()` / `currentSeasonYear()` roll at Labor Day, Feb →
  Labor Day resolves to LAST season, whose feeds are complete by definition,
  so a year-round weekly job fires all preseason. Gate on the season actually
  being played: `isSeasonWindowOpen`
  (`src/utils/pecking-order-season-window.mjs`). Dedup-on-output-file is not a
  schedule guard.

## Auth — session JWT only

`getAuthUser()` (`src/utils/auth.ts`) trusts only the signed session cookie.
The old `X-User-Context` / `X-Auth-User` header fallbacks were removed in
June 2026 — they allowed full auth bypass. Never re-add unsigned identity
sources. Rate-limit any new LLM-backed endpoint with
`src/utils/rate-limit.ts`, and run any server-side fetch of a user-supplied
URL through `src/utils/url-guard.ts#validatePublicUrl`.

## Feature flags — code, not GitHub Actions variables

Do not introduce new `vars.*` references in workflows as feature gates.
Editing a GitHub variable is never easier than editing code here, and the
indirection splits the source of truth across two places. To disable a
scheduled job, comment out its `cron:` line. To gate behavior, use a `const`
in the script itself. A few legacy vars predate this rule
(`SCHEFTER_RUMOR_MILL_ENABLED`, `SCHEFTER_TRADE_OFFER_RUMORS_ENABLED`) — don't
add more, and prefer moving them into code if you're already in the file.

## Local env — `vercel env pull`, and worktrees don't inherit it

Server code reads `process.env` (auth JWT, every Upstash storage util), but
Vite only exposes `.env` files to `import.meta.env` — `astro.config.ts`
bridges the gap by hydrating `process.env` from `.env` / `.env.local` at
startup (real env always wins). Without a valid `.env.local`, local dev gets
a random JWT secret per restart and KV-backed writes fail (drafts POST →
503/500). Refresh with `pnpm dlx vercel env pull` in the repo root, and
**copy `.env` + `.env.local` into each worktree** — they're untracked, so
worktrees start without them. If a Redis error names a host that's NXDOMAIN,
re-pull the env (a stale pre-migration `.env.local` pointed at a deleted KV
host in July 2026).

## Bulk-context questions — offload to `gemini-ask`

`scripts/gemini-ask.mjs` answers questions that require reading a lot to say a
little: reading a corpus in-session costs context proportional to the CORPUS,
asking through this costs context proportional to the ANSWER. `docs/claude/`
is ~1 MB and `data/` is ~161 MB, so the difference is not marginal.

Reach for it when the question is "across all of X, which/where/how many".
Do NOT reach for it when you already know the file — a single Read is cheaper
and exact.

```bash
# EXPLORE (preferred) — Gemini greps the repo itself; no glob guessing
node scripts/gemini-ask.mjs -p "every caller of stripLinkAdjacentPunctuation?"
# CORPUS — pin an exact file set
node scripts/gemini-ask.mjs -p "which mention leagueUrl?" 'docs/claude/**/*.md'
# STDIN — content not on disk
git diff | node scripts/gemini-ask.mjs -p "summarize the risk here"
# --list previews what CORPUS mode would send, without spending quota
```

- **It is a different model with no CLAUDE.md priors.** Treat answers as
  leads, not facts; it cites `path:line` so you can verify the one thing
  you're about to act on. Do that before editing anything.
- **Explore mode is agentic** — the file set you pass is a floor, not a
  ceiling, so `--max-bytes` does not bound what it reads.
- **Quota is shared with CI** (`.github/workflows/pr-external-review.yml`). A heavy sweep can
  429 that day's PR reviews — they degrade to "did not run".
- **Two CLIs are installed** (node 20's is broken). Always go through the
  script, never `gemini` directly.

## Rankings are per-league — `rankings-scope.ts` owns the keys

Import Rankings (→ composite "My Rank") and the Custom Rankings board (`/cr`)
run in TheLeague and the AFL, and the two must never share storage.
`src/utils/rankings-scope.ts` is the only place that decides which bucket a
league reads, for both layers:

- **localStorage** — `scopedLocalKey(base, scope)`. TheLeague returns the base
  string unchanged (`rankings.imports`, `cr.localCache`, …) so no owner loses a
  board they already built; the AFL gets `<base>.afl`.
- **Redis** — `scopedKvKey(prefix, scope, franchiseId)`, applied inside
  `createKvFranchiseStore` (the shared body of `/api/ri` + `/api/cr`).
  TheLeague keeps the legacy `ri:0001`; the AFL gets `ri:afl:0001`. The scope
  is NOT decoration here — **both leagues have a franchise 0001**, so the bare
  key was genuinely ambiguous the moment a second league wrote to it.

Four things that are load-bearing, not style:

- **The scope is re-read per call, never captured at module load.** With the
  ClientRouter a single JS module instance survives a navigation from one
  league's page to another's, so a captured value writes the previous league's
  bucket. Same reason `rankings-storage.ts`'s in-memory cache is a
  `Map<scope, …>` rather than one array.
- **The client sends `?league=` and the server REJECTS a mismatch.** An owner
  logged into TheLeague can browse the AFL's rankings pages, where localStorage
  is already writing the AFL bucket — without the check, that AFL board syncs
  into their TheLeague KV key. The KV scope always comes from the session
  (`user.leagueId`), so the param is a check, never an input. A mismatch 401s
  and both sync helpers degrade to local-only, which is the correct outcome.
- **The `auctionPredictor.*` legacy keys are unscoped and TheLeague's alone.**
  `writeLegacyKeys` and `migrateFromLegacyKeys` both bail on any other scope —
  otherwise an AFL import overwrites TheLeague's auction-predictor rankings,
  and the migration *deletes* the originals on its way out.
- **Every league has its own bucket, best-ball included.** bb1 shared
  TheLeague's until Aug 2026; the objection to splitting was that best-ball
  owners would be left with an empty queue, and the built-in sources (below)
  removed that objection by seeding a working composite on first load.

**Built-in ranking sources.** `data/ranking-sources/<year>.json`
(`scripts/fetch-ranking-sources.mjs`, prebuild + daily cron) supplies six
sources every owner gets without importing: MFL ADP, FantasySharks,
FantasyCalc, Sleeper, ESPN, ESPN Superflex. They are stored alongside a user's
own imports and marked `provided`, so the composite / Free Agents columns /
draft queue / `/cr` seed all read one list. Rules: refreshed in place on
`generatedAt`; auto-ticked ONCE on first sight (re-ticking would undo a
deliberate untick); never synced to Redis (regenerated per device); not
deletable — **Hide** is the opt-out, filtered on READ, which is why
`syncBuiltinImports` reads the raw store rather than `getAllImports()`. The
owner's OWN imports always sort ABOVE the built-ins (`sortUserImportsFirst`,
applied inside `getAllImports()` so the rule holds for a legacy store, a server
merge, or a drag that dropped one below); order within each group is untouched.

Which sources are ticked BY DEFAULT is per-league (`defaultRankingSources` in
the registry) because the right opening board depends on how the league drafts
— dynasty trade values are wrong for a league that re-drafts, redraft ADP is
wrong for a contract dynasty league. Every source stays available everywhere.

Composite weights are arbitrary positive numbers normalized by their total
(`weight / Σweight`), which is what lets the UI present them as percentages and
makes a deliberately small source (superflex at 5) behave as expected. Only the
RATIO matters — `tests/rankings-lookup.test.ts` pins that.

`tests/rankings-scope.test.ts` pins the legacy strings, the AFL separation, and
fails if a league is added to the registry without a scope entry.

### `Astro.redirect()` only redirects from a PAGE

Returning it from a **component's** frontmatter just stops rendering that
component — the response is still a 200, now with a blank body. Extracting
TheLeague's `/cr` page into a shared component moved its auth gate into a
component and shipped exactly that: unauthorized visitors got an empty page
instead of a bounce. The gate now lives in each thin route wrapper
(`resolveCustomRankingsAccess` in `src/utils/custom-rankings-access.ts` holds
the shared decision; the pages own the redirect). Any auth gate being moved into
a shared `.astro` component needs the same split.

Related: an admin link into a league-scoped page must be gated on
`isAuthorizedForLeague` too, not just `isCommissionerOrAdmin` — a TheLeague
admin browsing the AFL's Import Rankings page was otherwise shown a Custom
Rankings link that dead-ends on the redirect.

## Page directory registry — required for every new page

Adding a page without adding it to `src/data/page-directory.json` makes it
invisible to site search. Each entry needs `id`, `title`, `description`,
`path`, `icon`, `category` (`popular | my-team | reports | tools | info`),
`visibility` (`all | admin`), `popularity` (0-100), and **10+ tags** — write
tags generously (synonyms, data types, actions, slang a user might type).
`tests/page-directory-data.test.ts` enforces the tag minimum, but nothing
tells you to add the entry in the first place — you have to remember.

## What's New changelog — required after user-facing work

A new page, new user-facing feature, or an enhancement that changes how
something works requires an entry at the **top** of `src/data/whats-new.json`.
Skip it for style tweaks, data syncs, refactors, docs-only changes, and
admin-only/unreleased features.

- Write in the league's editorial voice — conversational, witty sports
  columnist, never dry corporate release notes.
- `new-page`, `new-feature`, and `enhancement` require a screenshot
  (`image`/`imageAlt`, webp in `public/assets/whats-new/`);
  `tests/whats-new-data.test.ts` fails the build without one. `bug-fix` and
  `league-event` are exempt.
- **Hero eligibility is for marquee launches only.** Set
  `excludeFromHero: true` on every `enhancement`; for `new-page` /
  `new-feature`, **ask the user** whether it's major enough for the homepage
  hero. The gate is the `excludeFromHero: true` flag, honored by
  `resolveHeroState` (`src/utils/hero-resolver.ts`). `/update-whats-new` (and
  therefore `/live`) prompts for this — don't decide silently.
- Smaller fixes go to `src/data/weekly-changelog-staging.json` (`date`,
  `type`: `bug-fix | style-tweak`, user-facing `summary`, `impact`: `user |
  admin`, `area`).
  `scripts/weekly-changelog-rollup.mjs` compiles them Mondays 8pm PT and needs
  a top-level `featuredImage`/`featuredImageAlt` set before it runs.

## Merge conflicts — always rebase, resolve autonomously

Only Brandon and Claude commit here. **Default to `git rebase origin/main`
(never merge).** Do not stop and ask — fix it, run the relevant tests, push,
and report what you did.

1. **`package.json`** — union both sides. `.gitattributes` declares
   `merge=union`; if union duplicates a key, keep the newer version spec.
2. **`pnpm-lock.yaml`** — never hand-resolve. After `package.json` settles,
   run `pnpm install` and commit the regenerated lock.
3. **Auto-generated data files** — `src/data/theleague/schefter-feed.json`,
   `data/<league>/mfl-feeds/**`, `src/data/theleague/post-history.json`, any
   `*-feed.json` or `*.lock` — prefer `--theirs` (incoming main). Cron writes
   these; the branch's snapshot is stale by definition. Never merge row-by-row.
4. **Source code (`scripts/`, `src/`, `tests/`)** — integrate the intent. New imports/helpers stack
   additively. If the same function body changed on both sides, keep main's
   structural change and re-apply the branch's behavioral change on top.
5. **CLAUDE.md / docs** — additive. Both sides' new sections survive. Never
   drop a section.

Before pushing: `pnpm test:unit` at the same baseline as pre-rebase (new
failures block; pre-existing are OK), `node --check` every `.mjs` you touched,
and `git push --force-with-lease` — never plain `--force`. `git rerere` is
enabled (see `.git/config`); identical conflicts on re-rebase replay
automatically. Do not turn it off.

## Edit-time safety net

`.claude/settings.json` runs `.claude/hooks/roger-reminder-test.sh` on every
Write/Edit/MultiEdit to a Roger-related file, and blocks the tool call if the
reminder-window suite fails. If you edit one of those files and don't see a
test run, `node_modules` probably isn't installed — run `pnpm install`.
