# CLAUDE.md

Guidance for Claude Code sessions working in this repo. Keep this short; add
entries for gotchas that have bitten us and would bite a future session too.

## Project basics

- **Framework:** Astro (SSR + SSG). React for client-hydrated islands.
- **Package manager:** pnpm (not npm). Scripts: see `package.json`.
- **Unit tests:** vitest. Run one file: `pnpm vitest run path/to/foo.test.ts`.
- **Prebuild:** `scripts/prebuild.mjs` runs build steps + network fetches in
  parallel. Add new build-time fetches there.

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
- **The schefter feeds are bounded, not append-forever.** Active window =
  `SCHEFTER_ACTIVE_MAX` (300) posts; a weekly workflow rotates the tail
  into `schefter-archive/<year>.json` beside each feed, and `mergeFeed`'s
  `archivedThroughTimestamp` watermark stops the 15-minute scans from
  resurrecting archived posts. Article permalinks and the OG renderer
  fall back to the archives — new single-post surfaces must too.
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

### Absolute URLs — always `leagueUrl()`, never origin + path

Internal routes are stored PREFIXED (`/theleague/calendar`) because that's the
real Astro route and the only form that resolves on the shared host. A league's
own apex domain serves the BARE path (middleware rewrite), and vercel.json 301s
the prefixed form back to it. So concatenating an origin with a prefixed path —
`` `${leagueOrigin(reg)}${post.link}` `` — ships owner-facing links that read
`theleague.us/theleague/calendar` and burn a redirect hop. That was live in
Roger's reminders, Schefter's Trade Builder CTAs, both article GroupMe promos,
the August-cut touches, and the AFL announcement deep link (fixed Aug 2026).

`leagueUrl(league, path)` in the registry is THE builder, and it is total in
both directions so callers don't have to know which kind of league they hold:
on a league's own apex domain the prefix is redundant and gets STRIPPED; on the
shared host (path-only leagues like best-ball, which have no apex domain) it is
required and gets ADDED via `ensureLeaguePrefix`. Pass either form, get a URL
that resolves. It never touches a CROSS-league prefix (`/afl-fantasy/*` in a
TheLeague post must keep its prefix), and it pins the canonical cookie-safe
`www.` host from `leagueOrigin` — that host rule and the prefix rule travel
together, since a file that hand-built one usually hand-built the other
(`schefter-leagues.mjs` and `ANNOUNCE_TARGETS` each had both).

The Schefter league table exposes it
per-league as `league.url(path)`; `scripts/schefter-rumor-scan.mjs` wraps it in
`publicUrl()` so a `SCHEFTER_PUBLIC_BASE_URL` override (preview deploys,
mfl.football) still keeps the prefix — stripping is only correct on the apex.
`tests/league-url-prefix.test.ts` runs the real builders and fails on any
doubled prefix.

Note the feed's `post.link` must ALWAYS keep the prefix — it's the internal
route, it gets persisted, and the Schefter cards render it raw, so an
unprefixed path bakes a permanent 404 on mfl.football. Only the absolute
(GroupMe / deep-link) form gets stripped. The rumor scanner's tip CTA had this
backwards until Aug 2026 (`TIP_PAGE_PATH = '/schefter/tip'`).

### GroupMe autolinks the punctuation after a URL

A chat message that ends a sentence right after a link — `Review your plan at
https://www.theleague.us/rosters.` — ships a link whose href includes the
period, and it 404s for every owner who taps it. Roger's roster-cutdown touch
did exactly that (owner report, 2026-08-16). Bare hosts autolink too, so
`…log in at www.theleague.us.` breaks the same way.

`src/utils/link-punctuation.mjs` fixes it from BOTH ends, and both halves are
load-bearing:

- **Outgoing** — `stripLinkAdjacentPunctuation` trims the `.,;:!` run glued
  to the end of a URL, inside all three bot-post primitives:
  `scripts/lib/groupme.mjs` (the choke point for all nine node lanes),
  `scripts/lib/speculation-groupme.mjs`, and
  `src/utils/groupme-client.ts#postAsBot`. It is deliberately on the SEND
  path, not a template guard test — a large share of GroupMe text is composed
  at runtime and Schefter's LLM-written bodies routinely end a sentence on a
  link, so nothing static can catch those.
- **Inbound** — `resolvePunctuationRedirect` powers a 302 in
  `src/middleware.ts`, because the outgoing fix cannot reach a message
  already sent: those links are still in the chat and still dead. It also
  covers iMessage/Slack/email, which autolink the same way. No URL we serve
  ends in punctuation, so trimming can only turn a 404 into the right page.

Three things the regex has to get right, each one a bug that was in it:
`?` is NOT in the punctuation set (a URL autolinked as `…/rosters?` still
resolves, so stripping it only costs a question mark the sentence needed);
the URL may not END on `"'()[]<>`, or `(see <url>), then act` loses its comma
to a link that never included it; and the trailing run must not be followed
by a URL-continuation character, or `…/x.y` collapses to `…/xy`. It is for
CHAT PROSE only — on JSON or config text it will corrupt a quoted value, so
don't reuse it on a data file.

Three things about the inbound redirect that are guards, not style:

- **GET/HEAD only.** A 3xx on a POST/PATCH makes clients re-issue as GET and
  drop the body — a write would look fine and land nowhere.
- **It refuses protocol-relative paths.** `//evil.com.` trims to
  `//evil.com`, and that in a `Location` header walks the user off our
  origin. The helper returns `null` for any path whose second character is
  `/` or `\`, and for control characters. That guard is why this is a
  function rather than an inline `.replace()`.
- **302 + `Cache-Control: no-store`.** A 301 is cached indefinitely by
  browsers, and this normalization is defensive rather than canonical. Note
  the status code alone is NOT what makes it revocable — Cloudflare fronts
  the apex domains and has stamped its own max-age on responses regardless
  of status before (the NFL-logo saga), which is why the middleware builds
  the `Response` by hand with `no-store` instead of calling
  `context.redirect()`.

It runs before the league-host rewrite (so the trimmed path resolves
normally) and redirects rather than rewrites (so the URL bar stops showing a
broken, re-shareable link).

**Test the behavior, not the source text.** This one bit twice, in the same
PR, and both rounds are worth knowing about. First: `middleware.ts` was
checked with `toContain('302')` and friends, and every grep still passed when
the method gate was deleted, the status flipped to 308, and the query string
was dropped — the doc comment alone satisfied them. Same on the outgoing
side, where `toContain('stripLinkAdjacentPunctuation')` was satisfied by the
import line, so `postAsBot` could post raw text and stay green. Second: after
moving the *decision* into a pure `resolvePunctuationRedirect` and testing it
hard, the *wiring* was still grep-only — neutering the redirect branch and
dropping the `Location` header both left the suite green.

`astro:middleware` is now aliased to `tests/stubs/astro-middleware.ts` in
`vitest.config.ts` (the real `defineMiddleware` is a typing helper that
returns its handler unchanged, so the stub is faithful), which lets the test
import `onRequest` and assert the actual `Response` — status, `Location`,
`Cache-Control`, and that `next()` is not called. Reach for that alias rather
than a grep the next time middleware behavior needs a test.

**The sanitizer's call sites are pinned.** It corrupts structured text — a
separator between two quoted URLs gets eaten (`…x.xml"},{"u"…` → `}{`,
invalid JSON) — so `tests/link-punctuation.test.ts` fails the build if
`stripLinkAdjacentPunctuation` is called from anywhere outside the three
GroupMe send primitives. Same pattern as the league-literal and
design-token guards: the comment asks, the test enforces.

**Known limitation, deliberate: the redirect is PATH-only.** A stray
character that lands in the query (`/schefter/tip?target=0001.`) is not
rescued. Do not "finish the job" by trimming the query too —
`/api/suggestions/gif-search?q=` carries free-form user text, and trimming
would silently turn a search for `cat.` into a search for `cat` on every
request. The outgoing half is what keeps us from emitting those links, and
the one deep link we build with a query (`/news?post=<id>`) ends in a
`#post-<id>` fragment that browsers never send, so it absorbs the character.

Detecting "is this base URL my own apex host" must go through
`buildHostToSlugMap()`, never a string compare against the canonical origin —
`https://theleague.us`, `https://WWW.THELEAGUE.US`, `http://...` and
`...:443` are all the same host and must all strip.

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

## Franchise colors as foreground — use the accent token, never the raw hex

A team color used as FOREGROUND (text, a rank numeral, a border, a chart line,
a legend swatch) must come from the site-wide token `--team-accent-<franchiseId>`,
via `teamAccentVar(fid)` (`src/utils/team-accent-css.ts`). The token carries a
light value and an `html.dark` override, both forced to clear 3:1 against that
theme's card surface by `getTeamAccentPair` (`src/utils/team-colors.ts`).

Raw config colors cannot do this: several franchises wear a near-black or navy
primary that lands ~1.1:1 on a dark card (Bring The Pain, Cowboy Up), and the
yellows/golds do the same on a white one (Midwestside at 1.5:1). That's how the
Pecking Order shipped invisible rank numbers in dark mode (August 2026).

- **Never pick a theme's color in frontmatter.** With theme preference 'auto'
  the server doesn't know the resolved theme; a CSS custom property keyed on
  `html.dark` does. Same reasoning as the NFL logo / league icon dark swaps.
- **Client-drawn marks must set colors via `style`, not `setAttribute`** —
  `var()` resolves in a style declaration, never in an SVG presentation
  attribute (see `OwnerActivityReport.astro`'s polylines). Done that way, charts
  follow the theme with no redraw.
- Blocks are scoped `html[data-league="…"]` because franchise ids collide
  across leagues (both TheLeague and the AFL have an 0001).
- The exception is a team color used as a BACKGROUND FILL with white text on
  top (deep-ink composite heroes, pick-reveal, dead-money) — different contrast
  question, different rule; see the player-headshot section below.
- `tests/team-accent-css.test.ts` fails the build if any franchise in any league
  falls under 3:1 in either theme, or if the layout drops `TeamAccentStyles`.

## NFL team logos — committed files, guard-tested, must never 404

Every player cell renders self-hosted `/assets/nfl-logos/{CODE}.svg`. Two
hard-won facts (Aug 2026 "missing team images" saga):

- **The files are committed** in `public/assets/nfl-logos/` — one SVG per
  canonical ESPN code AND per MFL/legacy alias (`TBB`, `NOS`, `OAK`, `RAM`,
  `SDC`, `STL`, …), because several pages render the raw feed code without
  normalizing. They were originally never committed (only existed in local
  working trees), so production 404'd every light-mode logo for weeks.
  `tests/nfl-logo-assets.test.ts` now fails CI if any code emitted by
  `TEAM_CODE_MAP`/`getAllNFLTeamCodes` — or any `team` value appearing in any
  committed players feed — lacks a valid SVG. Add a logo file + map entry
  together, and never gitignore this directory.
- **A logo 404 is cache-poisonous, not cosmetic.** The apex domains sit
  behind Cloudflare, which stamps `cache-control: max-age=14400` on
  responses *including 404s* — so one broken window keeps rendering broken
  icons on owners' phones for up to 4 hours after the origin is fixed
  (that's why past fixes "didn't take"). Defense in depth: player-cell logo
  `<img>`s carry the `NFL_LOGO_ONERROR` fallback (roster-constants) — hide
  the img on failure. No substitute crest (owner decision: a wrong logo is
  worse than none). Dark mode is separate: the
  `content: url()` swap fires no error event, which is why the dark logos
  are prebuild-mirrored (see `nfl-logo-dark-css.ts`). If you're in the
  Cloudflare dashboard anyway: Browser Cache TTL → "Respect Existing
  Headers" would fix the 404 caching at the source.

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

   - Roger's reminders honor **quiet hours** (23:00–06:59 PT) like every
     other GroupMe lane. The gate wraps all of `scanEventReminders`, not
     just the send: the feed post id is the dedup key, so writing the post
     during quiet hours and skipping only the webhook would swallow the
     notification permanently. Skipping outright is safe because
     `shouldFireReminder` accepts the target day OR one day late.

   - **The reminder event list is not a place to write a date.** The AFL
     events in `compute-league-events.mjs` must resolve from the same rules
     as `src/data/afl-fantasy/league-events.json` (which drives
     `/afl-fantasy/calendar`), because Roger's post links to that calendar
     and any drift is visible to owners in one click. The AFL drafts are
     Labor-Day-anchored — `saturday-before-labor-day-weekend` (AL, Labor
     Day − 9) and `sunday-before-labor-day-weekend` (NL, Labor Day − 8) —
     never fixed calendar dates. The bad Aug 20 came from an "Annual draft
     window: August 20 – August 25" line that three rulebook surfaces
     carried (`src/data/afl-constitution.ts` ×2, `docs/claude/afl-rules.md`,
     `src/pages/afl-fantasy/docs/rules.html`) describing a window the league
     has never drafted in. All now state the Labor Day rule in words
     (commissioner, 2026-08-13). Not audited: stored answers under the
     `afl-rules-qa:all` Redis key, which needs Upstash creds.

Historical note: the first two bugs fired together in April 2026 — Roger
posted "TODAY: NFL Draft" on Wednesday when the draft was Thursday. The
post-mortem is the reason this section exists. The other two fired together
in August 2026: Roger woke the AFL at 1:00am PT to announce the draft was
one week away, when it was sixteen days out.
`tests/roger-afl-draft-reminder.test.ts` locks both in.

## Ask Roger eval — run before prompt/model/constitution changes

`pnpm eval:roger` grades the live TheLeague Q&A pipeline against
`tests/fixtures/roger-eval-cases.json` (49 cases: facts, multi-rule,
date-sensitivity, strategy/calc refusals, not-in-constitution honesty,
injection). Costs ~$1 of API calls (needs `ANTHROPIC_API_KEY`, so
`vercel env pull` first) — deliberately NOT part of `pnpm test:unit`.
Run it before merging any change to the Roger system prompt, the
constitution, or the answering model, and compare per-category pass rates.

- The production system prompt lives in
  `src/data/rules-qa-system-prompt.ts` (imported by the endpoint AND the
  eval) so the eval always tests the real prompt — don't re-inline it into
  the endpoint. The exported `RULEBOOK_ANCHORS` whitelist must match the
  prompt's section list; `tests/roger-eval-cases.test.ts` (normal CI, no
  API) enforces the sync and validates the fixture.
- The LLM call is `generateRulesAnswer` in `src/utils/rules-qa-handlers.ts`
  with an injectable `now` for date-sensitive cases.
- New Roger bug report → add a fixture case reproducing it, then fix.
  Details + methodology write-up: `docs/evals-explained.md`.

**Fixing the constitution does NOT fix answers already on the page.**
Roger generates each answer once and the POST handler persists it to Redis
(`rules-qa:all`); nothing ever regenerates a stored answer. So a wrong
ruling keeps getting served to every owner who scrolls past it long after
the rulebook is corrected, and the UI's only lever is deletion — which
discards the owner's question along with the bad answer. Repairing one
means rewriting the `answer` field of that entry in place, preserving
`id`/`askedBy`/`createdAt` so the card keeps its position and attribution.
The Upstash creds are repo secrets, so this runs from CI or from a checkout
with `vercel env pull`, not from a bare clone. (A scripted repair path is
in flight — check for `scripts/fix-rules-qa-answer.mjs` before hand-rolling
one.)
Owners can now say so themselves: every card carries a "This answer looks
wrong" button (`PATCH` on the rules-qa endpoint, storage in
`src/utils/rules-qa-flags.ts`). It is the non-destructive counterpart to
delete — the Q&A keeps its id, position and attribution. Load-bearing bits:
flags live in their OWN keys (`<prefix>:<qaId>` hash keyed by franchiseId,
plus a `<prefix>:index` set) so the Q&A array the improvement loop and repair
scripts read is untouched, one owner can't inflate a count, and two owners
flagging at once can't clobber each other. Flags work on **pre-seeded cards
too** — the 5th-year option bug was in a seed. Flagger names and reasons are
admin-only; everyone else sees the count.

Reports feed the SAME weekly delivery as the judge's findings
(`roger-improvement-notify.mjs` reads the flag store directly, so the notify
workflow step needs the Upstash secrets). A reported answer opens its own
GitHub issue and joins the league post. **Clearing the flags — the admin
"Mark reports handled" button — is what stops the nag; closing the issue does
not**, because the notifier reads Redis, not GitHub. Redis key prefixes and
seed filenames for both leagues live in `src/config/rules-qa-keys.mjs` so the
TS endpoints and the plain-node notifier can't drift apart; note `seedFile`
is a bare basename joined with `SEED_DIR`, because the full AFL path contains
`data/afl` and the league-literal guard forbids it.

Three surfaces can each hold the same wrong rule independently — the
constitution, the seeded cards in `rules-qa-seeds.json`, and stored Redis
answers — so check all three. The August 2026 taxi-squad ruling needed
edits in all three; a fourth (`.claude/agents/fantasy-expert.md`) carried
its own copy of the rule.

**A gap in the constitution reads as a wrong answer.** The prompt tells
Roger to answer ONLY from the constitution and to say "I don't see that in
the constitution" otherwise — but when the rulebook is merely *ambiguous*
rather than silent, he infers instead, confidently. Both August 2026
rules bugs were this: the 20-player minimum never said whether taxi/IR
players counted, so he reasoned from the adjacent 22-man roster limit and
got it backwards. When a bug report turns out to be an inference, fix the
ambiguity in the constitution — patching only the answer leaves the trap
armed for the next phrasing of the question.

**Improvement loop** (`pnpm improve:roger`, weekly via
`roger-improvement-loop.yml`): rubric-audits real owner questions from
Redis with an Opus judge, ledgers results in `data/roger-improvement/`,
and drafts failures as eval cases in `proposed-cases.json`. Ground truth
is human-gated on purpose: review a proposal, edit its `reference`, set
`"reviewed": true`, then `pnpm improve:roger --promote <id,...>` to grow
the golden dataset — promotion mechanically refuses unreviewed cases.
Never auto-promote or let the judge author ground truth. Prompt
suggestions land in `latest-report.md`; after applying one, run
`pnpm eval:roger`.

**Detection without delivery is not a loop.** The audit caught the August
2026 taxi-squad ruling correctly on 2026-07-27 and the proposal sat at
`"reviewed": false` for 17 days, because committing a report to the repo
notifies nobody. `scripts/roger-improvement-notify.mjs` (`pnpm notify:roger`,
last step of the workflow) closes that: it reads **state** — whatever is
unreviewed right now, not what this run found — and files one GitHub issue
per pending proposal (deduped on the exact title, weekly aging comment after
that) plus a **GroupMe post to the league** via `GROUPME_ROGER_BOT_ID`. The
two channels have different audiences and must not be collapsed:

- **The issue is for whoever closes it out** — ids, judge verdict, review
  steps, nagged weekly until `"reviewed": true`.
- **The post is for owners**, and says only what they can act on: a stored
  answer they may have read is suspect, don't rely on it yet. No proposal
  ids, no GitHub links. It fires **only for findings new that run** — the
  weekly nag stays on the issue rather than buzzing 12 phones — and never
  for operational errors (a wedged `ANTHROPIC_API_KEY` is not league news;
  it goes to the log and a `::warning::`). "New" is derived from whether the
  issue had to be *created* vs merely commented, so there's no extra state
  file; if `gh` is down nothing counts as new and the post is skipped rather
  than re-announced.
- **Silence when clean.** A weekly "all good" ping trains people to ignore
  the channel. Zero pending + zero judge errors = no issue, no DM, exit 0.
- **Closing an issue does not dismiss a proposal** — the notifier reads
  `proposed-cases.json`, so it re-files next week. `"reviewed": true` (or
  deleting the entry) is the only real off switch.
- Body-building is pure and tested in `tests/roger-improvement-notify.test.ts`;
  keep it that way rather than growing the inline `node -e` pattern some of
  the older workflows use. Preview any change with `pnpm notify:roger --dry-run`.

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

### Franchise-name redaction — a team answers to every name it ever had

`redactFranchiseNamesInText` in `schefter-rumor-scan.mjs` is the mechanical
backstop for every "Schefter may not name that team" rule — the prompt asks
the LLM not to, this makes it unable to. It scrubs franchise mentions out of
the tipster's raw `text` before the text reaches the prompt, so the token
harvest it runs on is load-bearing, not bookkeeping:

- **Harvest `history[]` (all four name fields per entry) AND `aliases[]`, not
  just the four current name fields.** A retired name identifies a franchise as
  well as the current one and *better* in the AFL, where the last-place
  punitive rebrands are recent and memorable. That gap shipped "Hearing Balls
  Deep and a former Cock Gobbler front office…" (Aug 2026) — a second team
  named in a post allowed to name exactly one, because "Cock Gobbler" is The
  Show's 2025 rebrand and lived only in `history[]`. Both configs are deep
  here: ~250 retired name forms and ~90 aliases across the two leagues.
  `loadTeams` has to carry both fields through or the harvest can't see them.
- **Redact the RESULT, never inside the scope classifier.** `resolveTipScope`
  returns from a dozen branches; a scrub at its tail only protects whichever
  paths fall through, and `league-wide` and `commish` returned raw text for
  months for exactly that reason. `redactSafePayload` runs on whatever the
  classifier hands back, so a new branch is safe by default. It also covers
  **every** free-text field, not just `text` —
  `threadFollowup.parentHeadlineSnippet` is lifted from a published post that
  may legitimately have named a franchise and pinned onto a tip that's fully
  anonymous, and it reaches the prompt through the same `JSON.stringify`.
- **Match with `(?<!\w) … (?!\w)`, never `\b … \b`.** A word boundary can't
  exist after a token ending in punctuation, so `\bBe Rough!\b` matches
  nothing — eight real AFL names (`The Blunt Bros.`, `Lucky Buck$`,
  `Be Rough!`, …) survived redaction verbatim. And run ONE alternation pass,
  not a `replace()` per token: sequential passes re-scan their own output, so
  normalizing "Smokane" → "Smokane FC" then matching "Smokane" again yields
  "Smokane FC FC". Guard tests must not rebuild the same regex to detect
  leaks — ours did, and was blind to precisely the bug it guarded.
- **`keepFranchise` is one display name but a franchise owns many.** Resolve
  it to the franchise and normalize that team's other forms (alias, retired
  name) to the canonical name; redact everything else. Comparing the one
  string fuzzes the kept team's own nicknames and lets Schefter print
  last-season's punishment name for a team he's allowed to name.
- Over-matching is the safe direction — a miss leaks an identity — but it is
  **not free, and the old "a stray hit just fuzzes a word" framing was wrong**.
  `[a team]` is a SEMANTIC INSERTION: it asserts a franchise reference where
  none existed, and HARD RULES 2/3 then order the LLM to make the tip's content
  survive the fuzz, so the model invents a team's involvement out of "put out
  feelers". A leak names the wrong team; this fabricates one on a tip nobody
  scoped to a franchise. Because the harvest floor is two characters and
  matching is case-insensitive, ~40 real name forms are ordinary words, and
  every one of these was live (Aug 2026): "Deal is dead." → "Deal is [a team]."
  (`DEAD`), "a heavy favorite" (`Heavy`), "put out feelers" (AFL `Feelers`),
  "headed to the Saints" (AFL `Saints` — an NFL club), "Swift is being shopped"
  (AFL `Swift` — an NFL player).
  The relaxation is **two gates, and both must pass**, because two different
  questions are involved and only one is answerable by hand:
  - `AMBIGUOUS_NAME_TOKENS` (curated) — "is this an ordinary English word?"
    Judgment; not derivable. Team-flavored forms that merely happen to be
    words ("Mafia", "Generals", "Pigs") stay out.
  - `computeRelaxableTokens` (derived from the configs) — "is this a name
    people currently CALL the team?" A token relaxes only if EVERY appearance
    across both leagues is an MFL `abbrev` or a RETIRED `history[]` form. The
    moment any franchise wears it as a live `name`/`nameMedium`/`nameShort`/
    alias it is blocked everywhere. Currently 21 relax, 12 are blocked
    (`saints`, `balls`, `feelers`, `herd`, `chat`, `swift`, `fire`, `pain`,
    `indians`, `cowboy`, `dream`, `baked`). This half **self-maintains**:
    rename a team to "Fire" and `fire` drops out on its own.

  Then `readsAsOrdinaryProse` relaxes on **case alone** — lowercase passes,
  any capital redacts. Two relaxations were tried and reverted, both because
  they leaked real franchises: relaxing sentence-initial capitals (destroys
  the only signal there is, and that position is where a tipster names a team
  as the subject — five AFL franchises leaked), and relaxing every ambiguous
  token regardless of whether it is a live nickname ("hearing saints is
  shopping a tight end" reached the prompt intact). Don't re-litigate either
  without re-running the sweep.

  Two more things hold it together: multi-word tokens match with
  `withFlexibleSeparators`, because "dead-cap" otherwise misses "Dead Cap"
  entirely and falls apart into `dead`, letting the FULL name through — every
  Set lookup therefore goes through `canonicalizeNameKey` or the kept team's
  own hyphenated name gets demoted to `[a team]`. The separator set is
  space/hyphen/underscore/slash **plus a period only when not followed by
  whitespace**: a period is also a full stop, so widening it naively welds
  "The deal is dead. Cap space is tight." into one phantom team. And the prose check runs
  **before** the keep-franchise branches, or an ordinary word that is one of
  the kept team's own forms gets rewritten to that team's display name ("the
  deal is Dead Cap Walking"), the same fabrication wearing a real name.
  `tests/schefter-franchise-name-redaction.test.ts` runs the real configs
  through the anonymizer and fails on any surviving alias or retired name —
  one tip per token, each placed mid-sentence in its config casing, because a
  bare `tokens.join(' / ')` cannot express position and position is now
  load-bearing.

### Former-name callbacks — the bit is the pairing, and it expires

Schefter nodding to a name a franchise just retired ("Dead Cap Walking, the
former Heavy Chevy…") is a wanted bit, not a bug — but only under three
constraints, all enforced in `scripts/lib/schefter-former-name.mjs` +
HARD RULE 30 (commissioner, 2026-08-15):

- **The current name always rides along.** A bare old name is the failure
  mode — a reader who joined this season doesn't know who that is, and the
  joke needs both halves. The redactor normalizes any old name in the tip
  text to the canonical one, so `formerName` on the scope is the ONLY channel
  the old name reaches the prompt through. No payload, no callback.
- **Last season's name, and only last season's.** `pickFormerName` requires
  an explicit `lastSeason` and matches `yearEnd === lastSeason` — never "the
  most recent rename", which is a different question with the same answer
  most of the time and a wrong answer the rest. A franchise that rebranded in
  2017 has no callback available at all, even though that name is genuinely
  its most recent former one. The bit is a nod to something the league just
  lived through; two seasons back it's trivia.
- **It decays and then stops.** Eligible only for the season AFTER the
  rename: occasional in the offseason, ~2× as often in preseason (Aug 1 →
  Labor Day) and regular-season weeks 1–3, then **nothing** from week 4 on,
  permanently. `resolveCallbackPhase` owns the window; the dice roll per post
  so the bit stays a callback rather than a tic.
- **Naming-allowed scopes only.** The payload attaches to
  `franchise-multi-source`, `franchise-explicit-pick`, and `trade-bait` — the
  same three the IRON RULES let Schefter name. An old name identifies a team
  as well as the current one, so a callback on a fuzzed scope would be the
  redaction bug wearing a costume.

Applies to EVERY rename, not just the AFL's last-place punishments —
`punitive` is a voice flag (lean into the sentence lore) not a gate.
**Name collisions need an OWNERSHIP map, not a set of taken names.** A
franchise keeps its own retired name in `aliases` so people can still search
by it (the documented convention), so a flat "these names are in use" set
can't tell "another team has this" from "this team kept its own nickname" —
and it silently zeroed out AFL 0014's callback, the league's current punitive
rename, while two quieter renames worked fine.
Two `history[]` rows look like renames and aren't: **re-skins** that repeat
the current name under a new icon (nearly every TheLeague franchise has one —
"the Pigskins, formerly the Pigskins") and **names that moved between
franchises** ("Midwestside Connection" is 0010's old name and 0011's current
one, so the callback would point at a live team that isn't the subject).
`pickFormerName` excludes both.

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

Year math gotchas fixed July 2026 — don't reintroduce them:

- The auto-calculated base (pivot) year is ALWAYS `calendarYear - 1`; the
  Feb 14 / Labor Day cutoff checks are what advance it. A base year that
  itself advances at Labor Day gets +1'd twice from Labor Day through
  Dec 31 (that bug shipped in five files). Copy the formula from
  `league-year.ts`, or better, don't re-port it into new scripts.
- `PUBLIC_BASE_YEAR` / `PUBLIC_MFL_YEAR` env pins are floor-only: the code
  clamps to `max(pin, calendarYear - 1)`, so a stale pin self-heals and NO
  manual bump is needed at rollover — never bump the pin at Labor Day (a
  pin equal to the current calendar year during the season double-advances
  the math). `tests/league-year-rollover.test.ts` locks the timeline.

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

## Standings order — MFL is the source of truth; "most PA" is decoupled

Two related rules, both from commissioner rulings in August 2026.

**1. Never re-sort MFL's standings rows.** MFL's `leagueStandings` export
returns rows in the league's OFFICIAL final order, with each league's
constitution tiebreaker chain already applied — including head-to-head, which
we cannot reproduce (the feed's `h2h*` columns only echo the overall record).
The first row of each division IS that division's winner. Every standings,
playoffs and homepage surface in BOTH leagues passes
`{ preserveFeedOrder: true }` to `src/utils/standings.ts`; the awards scripts
take `group[0]` in feed order. Homebrew tiebreakers miscredited 22 AFL and 10
TheLeague division titles before this rule existed. The proof that MFL is
applying the rulebook and we cannot is TheLeague's 2015 Central: two 15-3-0
teams with identical 4-2-0 division records, where MFL credited the team with
LOWER all-play and LOWER points because it swept the season series.
`divisionTiebreaker` in standings.ts now has no production callers.

**2. "Most Points Allowed" benefits the team — in BOTH directions.** The team
that gave up more points wins that tiebreaker step, meaning it gets both the
better standing and the better (earlier) draft pick. Those are opposite ends of
one ranking, so the step is deliberately **decoupled**: see
`PointsAllowedFavors` in `src/utils/afl-draft-utils.ts`
(`rankDivisionBlockWorstFirst` takes `'draft'` vs `'standings'`). Do not
"simplify" the two directions back into one — `tests/points-allowed-tiebreaker.test.ts`
has a guard for exactly that. The step has never actually decided a real
division title, so a regression here is invisible in the data.

Caveat worth remembering: because standings order now comes from MFL, rule 2
only governs OUR draft-order math. The live standings apply whatever MFL's
`OPP_PTS` setting does, which is a league-settings question, not a code one.

**3. Division alignment is per-season too — `resolveConfigForYear` is not
enough.** It resolves a franchise's historical name/icon/banner/conference but
NOT its `division`, and every standings surface groups on
`getTeamConfig().division`. Compose `applyHistoricalDivisions`
(`src/utils/historical-divisions.ts`) after it, passing that season's
`league.json`, or an archived year gets grouped by TODAY's map — which had 21 of
76 TheLeague division-seasons (every year 2007-2015) showing a different winner
than `franchise-history.json`, and invented divisions for 2007-2010 (the league
actually ran Pacific/Midwest/Central/Atlantic). The helper is fail-safe: a
missing or malformed feed leaves the config untouched.

**Division display names go through `divisionAliases`** (in
`theleague.config.json`, applied by both `applyHistoricalDivisions` and
`compute-franchise-history.mjs`). MFL's archives call the fourth division
"Eastern" from 2012 on; the league displays it as "East" (commissioner,
2026-08-11). Committed archive feeds keep saying "Eastern" even after MFL is
renamed, so this alias is permanent, not transitional. Anything keyed on a
division name — notably `DIVISION_BADGES` — keys the DISPLAY name only; retired
divisions (Pacific/Midwest/Atlantic) are intentionally unbadged so
`StandingsTable` falls back to a plain header.

**The AFL already had its own version of this** — do NOT port
`applyHistoricalDivisions` there. `src/utils/afl-structure.ts`
(`extractSeasonStructure` + `applySeasonStructure`) has resolved the AFL's
per-season divisions AND conferences from `league.json` for a while, which it
must: the AFL re-parented divisions, not just renamed them (2003-2012 ran SIX,
three per conference — North/Central/South American, East/West/Pacific
National). Every AFL surface that groups by division or conference has to
compose it after `resolveConfigForYear`, and
`tests/afl-structure.test.ts` greps both AFL pages to enforce that — a helper
existing is not the same as a page calling it, which is exactly how
`/afl-fantasy/playoffs` ended up seeding 12 conference-seasons differently than
`/afl-fantasy/standings` for the same year.

Two leagues, two helpers, on purpose: TheLeague has no conferences and needs
`divisionAliases`; the AFL has conferences and doesn't. Merging them would drag
each league's special case into the other.

Two traps this work surfaced, written up in full under `docs/claude/insights/`:
a missing `h2hwlt` column parses to `0-0-0` instead of erroring and silently
erased TheLeague's entire 2022 season (`domains/mfl-api.md`), and owner-scoped
attribution drops awards won under a slot's previous owner — which reads
exactly like "defunct franchise" and leads to the wrong fix
(`features/franchise-history.md`).

## AFL playoff brackets — reconstructed games, and ids that lie

MFL's `playoffBracket` export carries seeds only for 2003-2023 — no franchise
ids, no points — so `/afl-fantasy/playoffs` rendered "Bracket data not
available" for every season before 2024. The GAMES were never missing:
`schedule.json` has every playoff week fully scored.

- **`scripts/reconstruct-afl-playoff-brackets.mjs`** walks those weeks as a
  single-elimination tournament and writes
  `data/afl-fantasy/derived/reconstructed-playoff-brackets.json` in MFL's own
  `brackets` shape. The page consults it **only** when the committed feed has
  no games for a bracket — real MFL data always wins. 20 seasons recovered,
  every declared postseason bracket in each.
- **The standings do not always describe the field.** `championshipField` takes
  the top N of each conference in standings order, which is right for 17 of the
  19 seasons — but 2004 and 2011 ran six divisions into an eight-team bracket,
  so division winners took most of the slots and teams outside the top eight
  qualified ahead of better records. Seeded wrong, the walk finds two of its
  four opening games and bails. `searchChampionshipField` recovers the field by
  fingerprinting the bracket's shape against the schedule (pick `teams/2`
  opening games whose winners pair off into real games the next week, down to
  one) and accepting a candidate **only** if its final matches the champion AND
  runner-up on record. 2011 and 2004 are both recovered this way and verified
  game-for-game against MFL's own bracket pages — 2004 without ever seeing its
  championship bracket, because the NIT's 16 teams are the exact complement of
  the championship field.
  **2003 is permanently unrecoverable** — the league played that season on
  Yahoo and only standings were entered into MFL, so no game in any week has a
  score. Don't spend time on it, and don't ask for a screenshot: there is
  nothing behind it.
- **The bracket shape is era-dependent.** 2003-2017 bracket "1" IS the 8-team
  field; 2018+ it is only the 2-team final fed by separate AL/NL brackets.
  Seeding the modern shape with the old assumption produced the wrong 2019
  champion during development. `describePlayoffShape` handles this.
- **Archived schedules contain rounds that aren't valid rounds.** 2012 week 14
  has an outright `0023 vs 0023` bye row; 2014 and 2015 NIT week 14 each carry
  a stray matchup pairing two teams already scheduled that week. `pruneRound`
  drops them — without it, 2012 rendered five quarterfinals, one of them a team
  playing itself.
- **Bracket ids do not mean the same thing across seasons.** The NIT is bracket
  3 in 2005, 4 in 2006, 5 in 2007-2017 and 6 from 2018 on; ids 2/3 are the
  AL/NL brackets only in the modern era (in 2005 they're the AFL Losers Bracket
  and the NIT). Classify with `src/utils/afl-bracket-kind.mjs`, never with an id
  range — the page's old hardcoded `winners = 1-5 / NIT = 6-9` split filed every
  pre-2018 NIT under the Championship tab and left the NIT tab empty.
  `tests/afl-bracket-kind.test.ts` runs the classifier over every committed feed
  and greps the page to stop an id list creeping back in.
- **The consolation/placement brackets are solved, not seeded.** Their fields
  are made of losers, so `reconstructConsolation` walks forward consuming the
  games the championship and NIT walks left behind: an open bracket first claims
  any game involving a team it still has alive (this is how late entrants join —
  the AFL Consolation Bracket is 4 quarterfinal losers in week 15 plus the 2
  semifinal losers in week 16), then whatever remains is grouped by how deep its
  teams got in the primary bracket and handed to the brackets starting that
  week, deepest run to the lowest bracket id. That last rule is load-bearing:
  2005 week 17 starts three different 1-game brackets at once and only
  elimination depth tells them apart, and they award different draft picks.
  The correctness proof is that **every scored game in the playoff weeks lands
  in exactly one bracket** — `tests/afl-reconstructed-brackets.test.ts` asserts
  it, so a mis-assignment surfaces as a leftover rather than as a plausible
  wrong bracket.

**Never read a finishing position out of `bracketWinnerTitle`.** The AFL wrote
custom bracket titles for years ("#1 Pick in 2nd Round", "*NIT 3rd Place or 6th
Place"), and MFL renders a custom title as a placement it does not mean — which
is why the league's own results page shows 2005's Da Dangsters in 2nd when they
finished 3rd (they won the AFL Losers Bracket; 2nd is the title-game loser).
Only the games are trustworthy. A guard test greps the reconstruction script for
`bracketWinnerTitle` to keep it out.

Champions are pinned in `tests/afl-reconstructed-brackets.test.ts` against
three independent sources that agree: `championship-history.json`, the awards
ledger, and the commissioner's own confirmation of the 2005-2008 results. A
reconstruction that looks plausible and is wrong is the failure mode here, so
add fixture pins rather than loosening assertions.

## Bulk-context questions — offload to `gemini-ask`, don't read the corpus

`scripts/gemini-ask.mjs` answers questions that require reading a lot to say a
little. Reading a corpus in-session costs context proportional to the CORPUS;
asking through this costs context proportional to the ANSWER. `docs/claude/`
alone is ~1MB across 60 files and `data/` is ~161MB, so the difference is not
marginal.

Reach for it when the question is "across all of X, which/where/how many" —
call-site sweeps, doc surveys, shape audits over committed feeds, "does any
league config still do Y". Do NOT reach for it when you already know the file:
a single Read is cheaper and exact.

```bash
# EXPLORE (preferred) — Gemini greps the repo itself; no glob guessing
node scripts/gemini-ask.mjs -p "every caller of stripLinkAdjacentPunctuation?"

# CORPUS — pin an exact file set
node scripts/gemini-ask.mjs -p "which mention leagueUrl?" 'docs/claude/**/*.md'

# STDIN — content not on disk
git diff | node scripts/gemini-ask.mjs -p "summarize the risk here"

# --list previews what CORPUS mode would send, without spending quota
```

Four things that will bite:

- **It is a different model with no CLAUDE.md priors.** Treat answers as
  leads, not facts. It cites `path:line` precisely so you can verify the one
  thing you're about to act on — do that before editing anything. It has
  already been caught confidently asserting a version of `actions/checkout`
  doesn't exist while running on it.
- **Explore mode is agentic** — it greps and reads on its own, so the file set
  you pass is a floor, not a ceiling. That's usually good, but it means
  `--max-bytes` does not bound what it actually reads.
- **Quota is shared with CI.** The same free-tier key backs
  `.github/workflows/pr-external-review.yml`. A heavy sweep can make that day's
  PR reviews 429 — they degrade to "did not run" rather than failing, but
  that's the cause if you see it.
- **Two CLIs are installed.** node 20 has a broken v0.23.0; node 22 has the
  working one. The script resolves the newest nvm binary itself, so always go
  through the script rather than calling `gemini` directly.

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
