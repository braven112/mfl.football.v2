# Handoff: Schefter Explicit-Pick Direct Naming + Engagement Boosters

**Branch:** `claude/investigate-rumor-source-Q3NuN`
**Status:** implementation complete (10 of 12 todos), tests + verification pending
**Latest commit:** `196a3ea` — full backend + API + UI + styles

This doc is a handoff for whoever picks up the remaining work. The /feature
pipeline got stuck mid-Phase-2 because of a stream timeout while writing
tests; everything before that is on the remote branch and reviewable.

---

## What's already done

### Behavior shift (commits prior in same branch)
- `b38a603` — hostile-tip philosophy moved from "softer output / muted
  dispassion" to **drama amplification**. Hostile / off-topic tips never
  drop; they file as PG dad-joke-clean drama. Football puns allowed
  sparingly. Test suite repinned to the new direction.
- `0ddb656` — `templateBody()` fallback templates rewritten so the
  LLM-unavailable path produces drama-amplification voice instead of
  "Hearing the Southwest division is buzzing about something."

### Direct-naming feature (commit `196a3ea`)
- `scripts/lib/schefter-naming-rate-limit.mjs` — per-(tipster, target)
  cap = 2 in 30d. `incrementNamingTarget()` + `isOverNamingRateLimit()`.
  Redis key: `schefter:tipster_target_count:{tipsterHash}:{franchiseId}`.
- `scripts/lib/schefter-team-naming.mjs` — per-franchise rolling 30-day
  name count. `recordTeamNaming()` / `getTeamNameCount30d()` /
  `getTopNamedTeams()`. ZSET key:
  `schefter:team_name_count:{franchiseId}` (score = postTimestamp_ms,
  member = postId).
- `scripts/schefter-rumor-scan.mjs`:
  - `anonymizeTips()` is now async; new `franchise-explicit-pick` scope
    kind with `franchise`, `division`, `nameCount30d` fields.
  - `redactFranchiseNamesInText` `keepFranchise` passthrough now covers
    both `franchise-multi-source` and `franchise-explicit-pick` scopes.
  - HARD RULE 4b in the system prompt: naming UNLOCKED, single-pointer
    framing (NOT "multiple sources"), drama escalation by `nameCount30d`
    (1 / 2-3 / 4+ tiers), REQUIRED whisper-back close.
  - IRON RULES list `franchise-explicit-pick` as the third
    naming-allowed scope alongside `franchise-multi-source` and
    `trade-bait`.
  - `templateBody()` fallback variant matches the ladder.
  - `buildDirectedCta()` overrides `cta.link` / `cta.linkLabel` /
    `cta.groupMePrefix` / `cta.groupMeUrl` for explicit-pick beats.
  - Post-commit hook calls `recordTeamNaming()` for any post that named
    a franchise.
  - Both call sites of `anonymizeTips()` updated to `await` and pass
    `redis`.
- `src/pages/api/schefter/tip.ts` — `incrementNamingTarget()` hook fires
  on real-franchise dropdown picks, best-effort (failure does not block
  tip submission).
- `src/pages/api/schefter/most-named.ts` — new GET endpoint with `?days`
  and `?limit` clamps; reads via `getTopNamedTeams`; empty-state response
  on missing Redis.
- `src/components/theleague/HottestDesksWidget.astro` — pure SSR sidebar
  widget. No client JS. Empty-state, ARIA-labelled, keyboard-friendly.
- `src/pages/theleague/news.astro` — frontmatter Redis fetch + widget
  mounted between the existing promo card and the articles list inside
  `<aside class="sf-news-rail">`.
- `src/pages/theleague/schefter/tip.astro` — `?target=<id>` pre-selects
  the franchise dropdown, banner above the form sets response context,
  always-visible help text under the dropdown explains the consequence
  of picking a team. `aria-describedby` wires the help to the select.
- `src/components/shared/SchefterPostCard.astro` and
  `SchefterPostCardCompact.astro` — auto-detect directed CTAs by
  `?target=` substring on `post.link`, render with the
  `--directed` modifier class + leading megaphone SVG.
- `src/styles/schefter-feed.css` and `schefter-feed-compact.css` — new
  `.sf-post__link--directed` / `.sfc-post__link--directed` +
  `.sf-post__link-icon` / `.sfc-post__link-icon` styles. 600 weight,
  same accent color, no pill. Stays in the typographic flow.

---

## What's left

### 1. Tests (the immediate blocker)

Use the existing repo pattern: source-string contract assertions
(see `tests/schefter-rumor-topic-focus.test.ts` and
`tests/schefter-meanness-philosophy.test.ts` for the style — read source
files, regex-match the expected language). This avoids the cost of
mocking Redis / the LLM and matches what the rest of the schefter test
suite already does.

#### `tests/schefter-explicit-pick.test.ts` (new file)

Source-contract assertions covering every code path of the new feature:

- **Anonymizer scope branch** (`scripts/schefter-rumor-scan.mjs`):
  - The new `franchise-explicit-pick` scope literal appears.
  - The branch is gated on `tip.source === 'web'`,
    `tip.hashedOwnerId`, AND `!(await safeIsOverNamingRateLimit(...))`.
  - Scope payload includes `franchise`, `division`, and `nameCount30d`
    fields.
- **Rate limit fail-open**:
  - `safeIsOverNamingRateLimit` and `safeGetTeamNameCount30d` exist as
    defensive wrappers around the lib functions.
  - Both swallow Redis errors and return safe defaults (false / 0).
- **Redaction passthrough**:
  - `keepFranchise` resolution includes both
    `franchise-multi-source` AND `franchise-explicit-pick`.
- **HARD RULE 4b** (in the inline system prompt):
  - Mentions `franchise-explicit-pick`.
  - Phrases "specific heat from a single corner" or equivalent
    single-pointer framing.
  - Calls out `nameCount30d` ladder breakpoints (1, 2-3, 4+).
  - Requires a whisper-back close ("desk — your move", or rotation
    list).
  - Forbids "multiple sources" framing on this scope.
- **IRON RULES naming list**:
  - Must enumerate `franchise-multi-source`, `franchise-explicit-pick`,
    `trade-bait` as the only naming-allowed scopes.
- **templateBody variant**:
  - Branch on `one.scope?.kind === 'franchise-explicit-pick'`.
  - Three tiers keyed on `nameCount30d` (1 / 2-3 / 4+).
  - Each variant names the franchise AND closes with a whisper-back
    invitation (rotates: "your move", "Curious what the X have to
    say", "Floor's open", "the line is yours").
- **CTA override**:
  - `buildDirectedCta()` exists and gates on
    `safe?.scope?.kind === 'franchise-explicit-pick'`.
  - Returns `{Team} desk — your move →` link to
    `/schefter/tip?target=<id>`.
- **Post-commit team-naming hook**:
  - Loop covers `franchise-explicit-pick`,
    `franchise-multi-source`, `trade-bait` scopes.
  - Calls `recordTeamNaming(franchiseId, post.id, ts, redis)`.
  - Wrapped in try/catch — non-blocking.
- **Tip API increment**:
  - `src/pages/api/schefter/tip.ts` imports `incrementNamingTarget`.
  - Calls it when `normalizedHint !== LEAGUE_WIDE_HINT &&
    normalizedHint !== COMMISH_HINT`.
  - Wrapped in try/catch — non-blocking.
- **Lib surface**:
  - `MAX_EXPLICIT_PICKS_PER_TARGET === 2`.
  - 30-day TTL on rate-limit key.
  - `incrementNamingTarget` sets EXPIRE only on first observation
    (`next === 1`).
  - `isOverNamingRateLimit` returns `true` only when `count > cap`
    (strict greater-than, not equal).
  - `getTopNamedTeams` returns a sorted-desc list.
  - `recordTeamNaming` refreshes TTL on every write (key extends with
    activity).

#### `tests/schefter-most-named-api.test.ts` (new file)

- Endpoint exists at `src/pages/api/schefter/most-named.ts`.
- Exports `GET` and `prerender = false`.
- Reads `?days` (clamped 1–30, default 7) and `?limit` (clamped 1–16,
  default 5).
- Returns `{ teams, windowDays, limit }` with `teams` resolving each
  row through `chooseTeamName` short form.
- Empty array when Redis is unavailable.

#### `tests/schefter-meanness-philosophy.test.ts` (update)

Add to existing file (don't replace):
- Assertion: HARD RULE 4b text mentions
  `franchise-explicit-pick`.
- Assertion: prompt mentions whisper-back close as REQUIRED.
- Assertion: drama escalation ladder language present (1 / 2-3 / 4+).
- Assertion: IRON RULES list includes the three naming-allowed scopes.

### 2. Verification

```bash
pnpm test:unit          # expect ~395+ passing (current schefter baseline 383)
pnpm build              # full Astro build
node --check scripts/lib/schefter-naming-rate-limit.mjs scripts/lib/schefter-team-naming.mjs scripts/schefter-rumor-scan.mjs
```

Pre-existing failures in `tests/nav-drawer-links.test.ts` and
`tests/offseason-hero-data.test.ts` are unrelated and can stay broken
(see CLAUDE.md merge-conflict guidance — pre-existing failures don't
block).

### 3. Phase 3 — QA agents

Per the /feature pipeline, launch in parallel:

- **`qa-investigator`** — trace the explicit-pick flow end-to-end:
  user picks team in tip form → `POST /api/schefter/tip` with
  `franchiseHint=<id>` → Redis counter increments → tip queued →
  scanner consumes → `anonymizeTips` routes to
  `franchise-explicit-pick` scope → LLM/template produces named post
  → scanner's post-commit hook records team naming → news feed shows
  post with whisper-back CTA → user clicks CTA → tip form pre-selects
  target → banner visible.
- **`qa-api-debugger`** — test endpoints:
  - `POST /api/schefter/tip` with `franchiseHint=<real-id>` (should
    increment Redis counter, response remains 200 OK regardless of
    rate-limit state).
  - `GET /api/schefter/most-named?days=7&limit=5` (should return
    `{ teams, windowDays: 7, limit: 5 }`).
  - Both endpoints' error handling (missing auth, invalid params,
    Redis outage).

### 4. Phase 4 — Reviews (parallel)

- **`code-reviewer`** — token compliance on widget + banner; DRY across
  the two new lib modules; CLAUDE.md adherence (`chooseTeamName`,
  no hardcoded colors). Files: scripts/lib/schefter-naming-rate-limit.mjs,
  scripts/lib/schefter-team-naming.mjs, src/components/theleague/
  HottestDesksWidget.astro, src/pages/api/schefter/most-named.ts,
  src/pages/theleague/schefter/tip.astro (additions only).
- **`astro-performance-expert`** — verify the new SSR Redis call in
  `news.astro` frontmatter doesn't add unacceptable latency, that the
  widget has no client JS, that the directed-CTA detection adds no
  bundle weight.
- **`frontend-ux-architect`** — final a11y on widget (rank announces
  correctly, icons have alt text, links keyboard-reachable), banner
  contrast in light + dark mode, focus management when banner appears,
  megaphone icon doesn't leak into screen-reader output.

### 5. Phase 6 — Ship

- `pnpm test:unit` clean
- `pnpm build` clean
- **What's New entry: SKIP** (PO instruction earlier in this thread —
  don't advertise the rate limit publicly, keeps abuse vectors
  unprobed).
- Open PR / merge per branch policy.

### 6. Phase 7 — Retro / insights

Write to `docs/claude/insights/features/schefter-rumor-mill.md`:
- Direct-naming consent pattern (dropdown pick = naming consent;
  free-text mention still fuzzes).
- Per-team rolling-window counter for drama escalation.
- Whisper-back CTA pattern (`?target=<id>` pre-selects form,
  creates two-sided thread).
- Rate-limit fail-open philosophy on engagement features (Redis
  outage shouldn't suppress everything; only suppress what would
  actively cause harm).

Update `docs/claude/insights/domains/frontend.md` if any reusable
patterns from `HottestDesksWidget` (token usage, no card chrome
typographic leaderboard) are worth promoting.

---

## Open considerations / risks for the next session

1. **Cap = 2 is a guess.** First few weeks of real use will tell us if
   it's too tight (legitimate follow-up tips on the same team get
   silently demoted) or too loose (one petty owner gets four named-team
   posts on the same rival in a week before the cap kicks in). Watch
   for both patterns; tune `MAX_EXPLICIT_PICKS_PER_TARGET`.

2. **Most-named API uses SCAN.** Fine for 16 franchises, but if the
   league grows or the endpoint gets called more than once per
   page-render, materialize a top-N ZSET on each `recordTeamNaming`
   call instead of fanning out per-team ZCOUNTs.

3. **Directed-CTA detection is `?target=` substring.** Works but is
   stringly-typed. If we ever add another query param to the tip-page
   link that contains `target=` for an unrelated reason, both feed
   cards will incorrectly upgrade to directed visuals. Consider an
   explicit `post.cta = 'directed'` field on the post JSON if this
   becomes ambiguous.

4. **`anonymizeTips()` is now async.** Both call sites in the scanner
   are updated, but if anything else (admin dashboard, tests) imports
   and calls it directly, it now returns a Promise. Search:
   `grep -rn "anonymizeTips" .` to be sure.

5. **Counter increments on submission, not on shipped post.** A tipster
   who submits 3 tips against one target uses 3 cap slots even if only
   1 of those tips ever ships (dropped by the LLM, expired in queue,
   dedup'd). Acceptable for the first cut — the cap is about
   submission-side intent, not shipping success — but worth noting if
   tipsters complain that their tips "don't count" anymore.

6. **`nameCount30d` is computed at scope-time, not post-time.** When a
   tip sits in the marinate window, the count it carries reflects
   when the anonymizer ran, not when the post finally ships. With a
   1-hour marinate window this is rarely a meaningful skew, but for
   slow-news days where a tip sits 6+ hours, the count could be
   stale by the time the post lands. Acceptable for now — the
   ladder thresholds are coarse enough that off-by-one doesn't
   matter.

7. **Existing posts in `schefter-feed.json` won't have directed CTAs**
   even if the tipster originally picked a team — the scope wasn't
   resolved that way at write time. Going forward only.
