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
- **Type errors are ratcheted, not clean.** `pnpm test:unit` does NOT
  type-check. The repo carries a four-figure `astro check` error count (over
  half of it in the 12k-line `rosters.astro`); the current figure lives in
  `tests/fixtures/typecheck-baseline.json` and nowhere else, so a clean run is
  not the bar — `pnpm test:types`
  is, and it fails if the total moves in EITHER direction: up is a regression,
  down means retighten `tests/fixtures/typecheck-baseline.json`. It shells out
  to `astro check` (~2.5 min, needs `--max-old-space-size`), which is why it
  is not in the default suite — CI runs it as its own parallel `Type baseline`
  job so it never delays the unit-test signal. Treat `ts(2307) Cannot find
  module` as urgent: an `import type` from a missing module is erased at build,
  so it has no runtime symptom while voiding every type in the file. Before
  attacking the count, read
  `docs/claude/insights/features/type-error-remediation.md` — it records which
  phases are done and which two are deliberately NOT scheduled, with the
  reasoning.
- **Prebuild:** `scripts/prebuild.mjs` runs build steps + network fetches in
  parallel. Add new build-time fetches there.
- **Guard tests are the real memory.** ~228 suites in `tests/` mechanically
  enforce most rules in this repo. When a rule below names a test, that test
  is what stops the regression — read it before working around it.
- **Prefer the mechanical path.** Several procedures here are scripts, not
  memory: `/guard-test` (turn a rule into a scan guard), `/ratchet`
  (re-measure every baseline), `/rebase` (conflicts by class, correct
  ours/theirs), `/new-page` and `/new-cron` (scaffolds with the rules baked
  in), `/rollover-check` (render a page at both clock boundaries). Agents
  `sibling-drift-checker`, `guard-gap-auditor`,
  `clientrouter-lifecycle-auditor` and `mfl-fixture-recorder` each run a
  script first and judge second. `docs/claude/insights/features/deterministic-tooling.md`
  records why each exists.

## Read before you touch

| Working on… | Read first | The trap, in one line |
|---|---|---|
| Schefter (tips, rumor mill, redaction, tipster context, article links) | `docs/claude/rules/schefter.md` | Redaction must cover retired names + aliases, or a post names a team it may not; and every article type must declare `relatedLinks` or it publishes prose with nothing to click. |
| Roger (rules Q&A, GroupMe reminders, evals, draft dates) | `docs/claude/rules/roger.md` | Two independent "Roger" code paths; both have hallucinated dates. Fixing one doesn't fix the other. And deadline reminders are PUSH-FIRST now — the chat only carries the owners the fan-out could not reach, so any new reminder lane must ask `undelivered` before it posts, and must treat a push that could not run as reaching nobody. |
| Standings, playoffs, brackets, draft order | `docs/claude/rules/standings-brackets-draft-order.md` | Never re-sort MFL's standings rows — its order already applies the constitution's tiebreakers, including h2h we can't reproduce. |
| Live scoring / ESPN data | `docs/claude/rules/live-scoring.md` | A college athlete id and an NFL one are both plain digits, so a bad join resolves the wrong person instead of failing. |
| Set Lineup pages, the Sunday lineup warning | `docs/claude/rules/lineups.md` | `res.ok` is not "the call worked" — MFL returns errors as HTTP 200, and "no lineup" vs "couldn't read it" must never merge. And "in season" is Labor Day + 3, never `month >= 9`: the Sunday before the opener once named 17 of 24 AFL teams for not setting a lineup nobody could set yet. |
| Franchise history, owner attribution, `ownerHistory`, owner pages | `docs/claude/insights/features/franchise-history.md` + `docs/plans/owners-feature.md` | Owner-scoping drops a third of all franchise-seasons off franchise pages; `/owners` is now where they live, so every such season must land on exactly one HOLDING — one owner, or a declared set of co-owners — or it vanishes again. `tests/owner-tenures-data.test.ts` pins that over sets, plus a separate check that only declared co-owners share a season. The ownership boundary has ONE implementation — `buildAttributor` in `src/utils/owner-tenures.mjs` — and `tests/owner-boundary-parity.test.ts` fails on any file that re-grows its own walk-back; five copies once existed and two silently disagreed, so never inline one "just for this page". |
| Colors, tokens, logos, headshots, service worker | `docs/claude/rules/theming-and-assets.md` | A `var(--x)` with no definition renders its fallback in *both* themes — light looks perfect, dark ships white-on-black. |
| Feed writers, globs, `.git` size, Astro 7 compiler | `docs/claude/rules/storage-and-build.md` | MFL returns arrays in nondeterministic order — a plain `writeFileSync` + byte diff regrows a 7 GB `.git`. |
| Absolute URLs, GroupMe message text | `docs/claude/rules/league-urls.md` | Never concatenate origin + path; and GroupMe autolinks the period after a URL, 404ing it for every owner. |
| Best-ball leagues | `docs/claude/rules/best-ball.md` | Draft-only: nav is opt-in, ADP is redraft, no live MFL syncing. |
| AFL waiver order (`waiverSortOrder`, `import?TYPE=franchises`) | `docs/claude/afl-rules.md` § Setting the waiver order | MFL drops waiver priority at every league-year rollover and the AFL is rolling-priority, so the default reverse-franchise-id order IS a live wrong waiver order — but NO import type can set it back: the franchises import answers `<status>OK</status>` and ignores the field. |
| Schedules, doubleheaders, NFL byes, division-game placement | `docs/claude/rules/schedule-optimization.md` | The late doubleheader week is not a constant — it is whichever of Week 12/13 is bye-free that year, and copying last year's week numbers has shipped a doubleheader onto a bye twice. |
| Storybook, stories, component workbench | `docs/claude/rules/storybook.md` | An unguarded `document` in `preview.ts` makes the static build DROP every `.astro` story and still exit 0; and a component's own frontmatter CSS import never reaches the canvas, so stories render correct-but-unstyled. |
| League accounting, dues, prize payouts, year rollover | `docs/claude/rules/accounting.md` | MFL credits on POSITIVE and its import has no delete — a prize written negative doubles the owner's bill; and MFL's new league year starts with EMPTY books, so a rollover that flips the carried sign turns every debt in the league into a credit. |
| Draft pages (hub, results, order, broadcast, room, mock) | `docs/plans/draft-hub-and-results.md` | Draft rounds are NOT uniform — TheLeague's three rounds are 16/17/18 picks — so any overall pick number must sum each round's real size; and `draftUnit` is an object for TheLeague but an array for the AFL, whose 2003/2004 feeds carry an EMPTY second conference; and the AFL's two conferences draft DIFFERENTLY (AL live, NL email) in a way MFL's league-wide `draft_kind` cannot express, so anything conference-scoped must scope its POLL URL too or `/api/draft/status` serves everyone the AL's picks. | And the AFL's mock drafts from the pool its KEEPERS left: availability is per-CONFERENCE (60 of the AL's 84 keepers are kept in the NL too), its draft is a straight repeat rather than a snake, and it stays shut until the rosters — not the calendar — say the cuts have landed.
| `rosters.astro` — anything at all | `docs/plans/rosters-page-split.md` | Run `scripts/roster-parity-check.mjs` before AND after; it is the only test of a 12k-line page whose output 7k lines of imperative script produce after hydration. Never pre-resolve into the client config anything already keyed under `seasons`. |
| The Owners' Poll (ballot, tally, voters page, Pecking Order poll section) | `docs/plans/owners-poll.md` | Both leagues run it now, so a test that names one of them as "the league with no poll" is testing nothing — use Best Ball, which is disabled by design. And the AFL runs ONE 24-team ballot: the conference split that governs everything else here deliberately does not apply, because the column the poll publishes inside ranks all 24 in a single list. |
| Homepage heroes — which player models one (composite casting) | `docs/claude/insights/features/player-composites.md` | The starter slots (kickoff, game day, live) cast the signed-in owner's OWN roster and never widen back to the league; "prefer your team, else the league" is the exact shape that put a rival's player on your own homepage. And ownership is a LIST — an AFL player is routinely rostered in both conferences, so `getOwnersByPlayer`/`castsFor`, never a `franchiseId ===` compare. |
| Viewer preferences (country, clocks, `/preferences`, anything printing a time or naming a TV channel) | `docs/claude/rules/viewer-preferences.md` | RESOLVING the preference writes a cookie, so it belongs to the ROUTE — `Astro.cookies.set()` from a component throws after the headers are committed and blanks the page (READING via `readViewerClock` is side-effect free and fine anywhere); the league's PT is APPENDED to the viewer's one chosen clock, never picked, so it must not print twice to someone already on Pacific; and there are TWO floors — Sunday Ticket defaults to the country's pair, every league surface to PT alone, because a viewer who has chosen nothing must see exactly what that surface showed before the preference existed. |
| My Watch List (watch toggles, `/api/watch-list`, Schefter Watching tab, `watch-list-news` push) | `docs/claude/insights/features/watch-list.md` | MFL's `myWatchList` is owner-cookie-only and INCREMENTAL, so a click writes straight through — never copy the draft list's pull/push buttons; and the Redis mirror is the ONLY server-side view of the list, keyed by registry slug because both leagues have a franchise 0001. |
| Throwback Week, era art, era crests | `docs/claude/insights/features/throwback-week.md` | An era edit is never config-only: `franchise-history.json` copies every era `icon`/`banner` and the franchise + owner pages read THAT, so recompute it or half the site keeps the old art. And an era crest may be a live franchise's own icon — rewriting the file changes that club's present-day mark everywhere. |

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

## Preview builds require an open PR

`vercel.json`'s `ignoreCommand` runs `scripts/vercel-ignore-build.mjs`, which
**cancels a preview build for any branch with no open PR**. Build CPU Minutes
were 91% of the Vercel bill ($22.36 of $24.70, +291%) while bandwidth was $0.46,
and preview builds from work-in-progress pushes were the bulk of the count — one
branch built four times in 19 minutes. Production is never gated.

- A skipped build shows as **`CANCELED`**, not as its own status. The build log
  is the only place it says why (`[ignore-build] SKIP — no open PR for …`).
- Need a preview without a PR? Open the PR, or set `FORCE_PREVIEW_BUILD=1`.
- The script **fails open** — any network error, non-200 or missing env proceeds
  with the build. Keep it that way; a cost optimization that can block a deploy
  is worse than the cost. `tests/vercel-ignore-build.test.ts` pins that, and
  pins Vercel's inverted exit codes (**0 ignores, 1 proceeds**) as literals,
  because inverting them silently stops every deployment.

Preview builds also run a **slim `prebuild`** (`VERCEL_ENV=preview`): 19 of 21
steps are skipped and the committed data artifacts are read instead, which is
what `pnpm dev` does locally. A diff touching the pipeline — the step scripts,
`scripts/lib/`, or any `.mjs` under `src/` — forces the full run automatically,
as does `PREBUILD_FULL=1`. If you add a prebuild step, its script is picked up
from the step list with no extra wiring; `tests/prebuild-slim.test.ts` fails if
that derivation breaks.

## Feature flags — code, not GitHub Actions variables

Do not introduce new `vars.*` references in workflows as feature gates.
Editing a GitHub variable is never easier than editing code here, and the
indirection splits the source of truth across two places. To disable a
scheduled job, comment out its `cron:` line. To gate behavior, use a `const`
in the script itself. A few legacy vars predate this rule
(`SCHEFTER_RUMOR_MILL_ENABLED`, `SCHEFTER_TRADE_OFFER_RUMORS_ENABLED`,
`SCHEFTER_TRADE_OFFER_RUMORS_DETECTION_ONLY`) — don't add more, and prefer
moving them into code if you're already in the file.
Guard: `tests/workflow-feature-flag-guard.test.ts` pins those three to the
two workflow files that carry them.

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
- **Quota is shared with CI** (`.github/workflows/pr-external-review.yml`). A
  heavy sweep can 429 a PR review — it degrades to "did not run". That reviewer
  is opt-in as of Aug 2026 precisely because the free tier could not carry it
  per-push (three straight PRs came back `503 high demand`), so when one IS
  requested it is because someone judged the diff needed it. Don't spend the
  day's quota on a sweep you could answer with a Read.
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

The same boundary holds for **`Astro.cookies.set()`**: called from an imported
component it runs after the response headers are committed and throws
`ResponseSentError`, blanking the page (the Sunday Ticket board's country and
league-toggle cookies shipped this way on the first click). Read cookies
anywhere; WRITE them only in the route's frontmatter — the shared component
takes a helper the route calls (`rememberSundayTicketChoices`).

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

## Second league's copy of a page — build a component, not a second page

A route that exists under two league directories in `src/pages/` is a
**sibling**. Copying one league's page file into the next league and editing it
is how this repo accumulated ~57,800 lines across 24 forked siblings —
`rosters.astro` is 12,521 + 2,465 + 245, `lineup.astro` is 2,574 next to an
almost line-identical 2,580.

`tests/page-fork-ratchet.test.ts` now stops the next one. It classifies every
sibling route by the size of its largest copy (>80 lines = forked) and pins the
forked set in `tests/fixtures/page-fork-baseline.json`. That list may only
SHRINK: a new forked sibling fails the build, and so does a route that got
unified (retighten the baseline rather than leave slack — same idiom as
`typecheck-baseline.json`).

The shape to copy is `src/pages/theleague/division-strength.astro`: a thin route
wrapper holding the auth gate, the league's data import, and one shared page
component. Note **why** the redirect and the data import stay in the route — a
static import specifier can't be a runtime variable, and `Astro.redirect()` only
redirects from a page (see the `/cr` note above).

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
- **Those same three categories require INLINE LINKS in the prose**, not just
  the CTA button underneath — the launch article for Strength of Division named
  the standings, the franchise pages and the division page itself and the reader
  could not click one of them. `description` blocks render through `set:html`,
  so they take real anchors. Write every href LEAGUE-NEUTRAL (`/standings`, not
  `/theleague/standings`): one body is rendered to every league the entry is
  tagged for, and `rewriteDescriptionLinks`
  (`src/utils/whats-new-links.ts`) prefixes it per reader — a prefixed href
  sends half the audience to the other league's site. Only link a page every
  tagged league HAS (`/contracts` and `/salary` are TheLeague-only, `/keepers`
  and `/records` AFL-only); name the rest without a link.
  `tests/whats-new-links.test.ts` enforces all of it.
- **Hero eligibility is for marquee launches only.** Set
  `excludeFromHero: true` on every `enhancement`; for `new-page` /
  `new-feature`, **ask the user** whether it's major enough for the homepage
  hero. The gate is the `excludeFromHero: true` flag, honored by
  `resolveHeroState` (`src/utils/hero-resolver.ts`). `/update-whats-new` (and
  therefore `/live`) prompts for this — don't decide silently.
- Smaller fixes go to the **`changes`** array of
  `src/data/weekly-changelog-staging.json` (`date`, `type`: `bug-fix |
  style-tweak`, user-facing `summary`, `impact`: `user | admin`, `area`,
  `league`: `theleague | afl | both`). `league` is mandatory — the rollup
  builds one entry per league from it and exits 1 on an untagged change; and
  `changes` is the only array it reads, so an entry parked under any other key
  is silently dropped when staging resets.
  `scripts/weekly-changelog-rollup.mjs` compiles them Mondays 8pm PT and needs
  a top-level `featuredImage`/`featuredImageAlt` set before it runs. It has no
  dry-run mode — it always publishes and empties the queue.

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
   `*-feed.json` or `*.lock` — take MAIN's copy whole. Under a rebase that is
   `git checkout --ours` (HEAD is main's tip; `--theirs` is YOUR commit being
   replayed — the reverse of a merge). Cron writes these; the branch's
   snapshot is stale by definition. Never merge row-by-row.
   `node scripts/resolve-rebase-conflicts.mjs` does classes 2, 3 and 6 with
   the right side; `/rebase` is the full procedure.
4. **Source code (`scripts/`, `src/`, `tests/`)** — integrate the intent. New imports/helpers stack
   additively. If the same function body changed on both sides, keep main's
   structural change and re-apply the branch's behavioral change on top.
5. **CLAUDE.md / docs** — additive. Both sides' new sections survive. Never
   drop a section.
6. **`tests/fixtures/typecheck-baseline.json`** — **neither side is right.**
   Both numbers were measured against a tree that no longer exists: main's
   counts main's code without your changes, yours counts a base main has since
   moved past. Picking either fails the ratchet on the very next run. Resolve
   the markers with anything, then **re-run `pnpm test:types`** — it reports the
   real post-rebase figure — and commit that. Same for a rebase that touches no
   types at all: main's number still moved, so it is still a re-measure, not a
   `--theirs`.

Before pushing: `pnpm test:unit` at the same baseline as pre-rebase (new
failures block; pre-existing are OK), `node --check` every `.mjs` you touched,
and `git push --force-with-lease` — never plain `--force`. `git rerere` is
enabled (see `.git/config`); identical conflicts on re-rebase replay
automatically. Do not turn it off.

## Edit-time safety net — `path-guard`

`.claude/settings.json` runs `.claude/hooks/path-guard.mjs` on every
Write/Edit/MultiEdit. It maps the edited path through
`.claude/hooks/path-guard.json` (domain → file globs → guard suites → rules
doc), runs that domain's guard suites, and fails the tool call with the vitest
output if one breaks. The first edit in a domain per session also injects the
governing rules doc and its trap line from the table above, so the router
fires mechanically instead of from memory.

- **Adding a rule?** Add its guard test to the domain's `tests` list (or a
  new domain) — `tests/path-guard-map.test.ts` fails on a test or doc path
  that does not exist, on a glob that matches nothing, and on any
  `docs/claude/rules/*.md` no domain routes to. `/guard-test` writes the
  test AND the map entry.
- Keep a domain's suites fast (each set runs in 1–4 s today); a slow suite
  belongs in CI, not on every edit.
- The hook needs Node >= 22.5 on PATH (`path.matchesGlob`). If it cannot
  run — wrong Node, a malformed map — it fails the edit with one line rather
  than skipping silently; a missing `node_modules` is the one silent case
  (run `pnpm install`).
