# MFL Football v2

## Development Principle

ALL features, utilities, and data structures should be designed with the **Auction Price Predictor** in mind. Every function must be **reusable** and **composable**.

---

## Year Rollover System

Two critical dates drive year transitions:

| Date | Event | What Changes |
|------|-------|--------------|
| **Feb 14th @ 8:45 PT** | New MFL league created | `getCurrentLeagueYear()` updates |
| **Labor Day** | NFL season starts | `getCurrentSeasonYear()` updates |

### Decision Framework

**Use `getCurrentLeagueYear()`** for:
- Rosters, contracts, salary cap, auctions, trade analysis
- Key question: *"Does this page help manage my roster?"*

**Use `getCurrentSeasonYear()`** for:
- Standings, playoffs, MVP tracking, draft order
- Key question: *"Does this page show results from games played?"*

```typescript
import { getCurrentLeagueYear, getCurrentSeasonYear, getNextDraftYear, getNextAuctionYear } from '../utils/league-year';
```

Test date-dependent features with `?testDate=YYYY-MM-DD` URL parameter.

---

## Team Name Display

**CRITICAL:** Always use `chooseTeamName()` to prevent UI overflow:

```typescript
import { chooseTeamName } from '../utils/team-names';

const displayName = chooseTeamName({
  fullName: team.name,
  nameMedium: assets?.nameMedium,  // ≤15 chars (default)
  nameShort: assets?.nameShort,    // ≤10 chars
  abbrev: assets?.abbrev,          // 2-6 chars
}, 'default'); // Context: 'default' | 'short' | 'abbrev'
```

Config locations:
- TheLeague: `src/data/theleague.config.json`
- AFL Fantasy: `data/afl-fantasy/afl.config.json`

---

## Editorial Design Standard

**CRITICAL:** All new pages and components must follow the **editorial design language** derived from the PlayerDetailsModal system. This is the visual standard for the entire site.

**Canonical reference:** `src/components/theleague/PlayerDetailsModal.astro`
**Full pattern catalog:** [design-system.md](docs/claude/insights/domains/design-system.md) (search "Editorial Design Standard")
**Component guide:** [components.md](docs/claude/components.md) (Editorial Design Standard section)

### Signature Patterns

**Section titles** — Uppercase, left-border accent:
```css
font-size: 0.75rem; /* AFL: 0.9rem — UFC Sans Condensed compensation */
font-weight: 700;
text-transform: uppercase;
letter-spacing: 0.06em;
padding-left: 0.625rem;
border-left: 2px solid var(--color-primary, #1c497c);
```

**Section titles with subtitles** — When a section title needs a description, wrap both in `.section-header` so the left-border spans both lines:
```html
<div class="section-header">
  <h3 class="section-header__title">NFL Analysis</h3>
  <p class="section-header__sub">Players on the same NFL team</p>
</div>
```
The subtitle is `0.8125rem`, `gray-400`, with `0.25rem` gap. Use standalone section title (above) when there's no subtitle.

**Detail rows** — Flex rows with fixed-width uppercase labels (gray-400) + flexible values, separated by gray-50 borders

**Key metrics** — 3-column grid, gray-50 bg cards, large tabular-nums values + micro uppercase labels

**Tables** — Sticky uppercase headers (0.625rem, gray-400), hover rows, tabular-nums for numbers

**Numbers** — Always `font-variant-numeric: tabular-nums`

**Defensive CSS** — Always include token fallbacks: `var(--color-gray-700, #374151)`

**Modal/overlay backdrop** — **CRITICAL:** Every modal and overlay MUST use the frosted-glass backdrop blur. Never use a plain dark overlay without blur:
```css
background: rgba(15, 23, 42, 0.45);
backdrop-filter: blur(2px);
```

### Dark Mode

**CRITICAL:** Every component styles through tokens with defensive fallbacks and MUST render correctly under `html.dark` (and `html.dark[data-league="afl"]`'s navy ramp, not neutral gray). Verify both themes before shipping.

The resolved theme is just the `dark` class on `<html>`, set pre-paint by `ThemeScript` from the `theme_pref` cookie (`light` / `dark` / `auto`). Never pick a theme server-side (SSR can't resolve `'auto'`), and never use `prefers-color-scheme` media queries in components — the class is the single resolver.

**Known traps:**

| Trap | Fix |
|------|-----|
| `--color-white` / literal `white` never invert | Surfaces must use `--card-bg` / `--input-bg`; `color-mix(..., white)` must mix against `var(--content-bg, white)` |
| `:root{}` inside a scoped Astro `<style>` is NOT scoped | Never declare tokens there |
| Dead vars silently fall back to light | Check the token actually exists in `tokens.css` before using it |
| Sprite icon `<use>` wrappers stay the wrong color | Add `fill: currentColor` |
| `:global(...)` is INERT in `<style is:global>` blocks and React template-literal styles — the rule ships as unmatchable text | Use plain `html.dark .x` there; `:global()` only works inside scoped Astro `<style>` |
| A light-mode `:hover { box-shadow: ... }` REPLACES the dark raised-card ring on hover | Add a dark hover rule that re-asserts the ring: `html.dark .x:hover { box-shadow: 0 0 0 1px var(--content-border, #555), <hover shadow>; }` |

**Recipes:**
```css
/* Dark raised-card */
:global(html.dark) .card { box-shadow: 0 0 0 1px var(--content-border, #555), var(--shadow-lg); }

/* Tint */
color-mix(in srgb, <hue> 7-12%, var(--card-bg))
```

QA harness: `/theleague/design-system` has a Light/Dark preview switcher — use it before shipping.

### Typography Scale

| Role | Size | Weight | Notes |
|------|------|--------|-------|
| Hero/page title | 1.35rem | 700 | line-height: 1.2 |
| Section title | 0.75rem (AFL: 0.9rem) | 700 | UPPERCASE + left border |
| Body/values | 0.875rem | 400–500 | |
| Detail label | 0.75rem | 600 | UPPERCASE, gray-400 |
| Table header | 0.625rem | 600 | UPPERCASE, gray-400 |

---

## Player Display (Player Lockup)

**CRITICAL:** Whenever displaying players in a list, card, or table, use the standard **Player Lockup** pattern for consistency:

### Layout
| Left | Right (Row 1) | Right (Row 2) |
|------|---------------|---------------|
| Circular headshot (spans 2 rows) | **Player name** (bold) | NFL team logo (16px) + Position |

### Astro Component
Use `PlayerCell.astro` — it handles DEF position, team code normalization, and optional modal support automatically:

```astro
import PlayerCell from '../components/theleague/PlayerCell.astro';

<!-- Basic usage (DEF handling is automatic) -->
<PlayerCell name={player.name} headshot={player.headshot} position={player.position} nflTeam={player.nflTeam} />

<!-- Compact size -->
<PlayerCell name={player.name} headshot={player.headshot} position={player.position} nflTeam={player.nflTeam} size="compact" />

<!-- With modal support + badges -->
<PlayerCell name={player.name} headshot={player.headshot} position={player.position} nflTeam={player.nflTeam} playerData={playerObj}>
  <span slot="after-name" class="injury-badge">Q</span>
</PlayerCell>
```

### JS Utility (for client-side rendering)
Use `buildPlayerCellHTML()` when building HTML strings in `<script>` tags:

```typescript
import { buildPlayerCellHTML } from '../utils/player-cell-html';
import { initPlayerModalTrigger } from '../utils/player-modal-trigger';

const html = buildPlayerCellHTML({ name, headshot, position, nflTeam, playerData });
// Attach delegated click handler once on the parent container:
initPlayerModalTrigger(tableBody);
```

### DEF Handling
Team defenses (position=DEF) are handled automatically by `PlayerCell` and `buildPlayerCellHTML` — the avatar swaps to the NFL team logo and the meta row hides the duplicate logo. Callers just pass the raw `position` and `nflTeam`.

### Size Variants
- `default`: 40px avatar (36px mobile)
- `compact`: 32px avatar (28px mobile)
- Parents can also override via CSS: `.my-table .player-cell { --player-avatar-size: 2rem; }`

### Key Files
- Component: `src/components/theleague/PlayerCell.astro`
- Shared CSS: `src/styles/player-cell.css`
- JS utility: `src/utils/player-cell-html.ts`
- Modal trigger: `src/utils/player-modal-trigger.ts`
- Code normalization: `src/utils/nfl-logo.ts` → `normalizeTeamCode()`
- Logo assets: `public/assets/nfl-logos/{CODE}.svg`
- Player modal: `src/components/theleague/PlayerDetailsModal.astro`

---

## Loading State Standard

**CRITICAL:** All loading feedback follows one shared standard — a duration-keyed ladder, not per-screen improvisation. Choose the indicator by **how long the user actually waits**, never by which page it is.

| Elapsed | Indicator |
|---------|-----------|
| < 0.3s | Nothing (a loader that flashes reads as a glitch) |
| 0.3–1s | Optimistic — show the result, reconcile in background |
| 1–10s, content | Skeleton mirroring the final layout |
| 1–10s, action | Inline button spinner (+ disabled) |
| 10s+ (AI endpoints) | Branded "on the wire" moment with narration |

**Structure vs. skin:** behavior, placement, and ARIA are identical across both leagues; only the accent color differs via `var(--league-accent)` (already resolves blue/AFL-red by `html[data-league]`). Never branch on league in loader code.

**Non-negotiables:** zero hex literals (token everything), full ARIA (`role="status"`/`aria-busy`/`aria-live`/`aria-label`), and an explicit `@media (prefers-reduced-motion: reduce)` guard on **every** loading animation. Build new loaders with the dual Astro + JS pattern (mirror `PlayerCell`).

**Status:** Phase 1 — primitives + clickable prototype built (`/theleague/loading-prototype`); migration not yet started. See:
- [loading-prd.md](docs/claude/loading-prd.md) — the full PRD (this repo is the reference implementation)
- [loading-standards.md](docs/claude/loading-standards.md) — the contract
- [loading-inventory.md](docs/claude/loading-inventory.md) — every current usage + migration map
- [loading-roadmap.md](docs/claude/loading-roadmap.md) — the phased build plan

---

## League Context

Two leagues share this codebase:

| League | Slug | MFL ID | Data Path |
|--------|------|--------|-----------|
| TheLeague | `theleague` | 13522 | `src/data/theleague/` |
| AFL Fantasy | `afl` | 19621 | `data/afl-fantasy/` |

---

## Key Utilities

| Utility | Purpose |
|---------|---------|
| `src/utils/league-year.ts` | Year rollover logic |
| `src/utils/team-names.ts` | Team name display |
| `src/utils/salary-calculations.ts` | Cap math (10% escalation) |
| `src/utils/auth.ts` | Authentication |
| `src/utils/team-preferences.ts` | Cookie-based preferences |
| `src/utils/league-context.ts` | Dual-league support |

---

## AI Insights System

**IMPORTANT:** Before starting any task, read relevant insight files. After completing work, record learnings.

```
docs/claude/insights/
├── domains/           # Cross-cutting knowledge
│   ├── frontend.md        # UI patterns, components
│   ├── design-system.md   # Tokens, CSS variables
│   ├── mfl-api.md         # MFL API quirks
│   └── accessibility.md   # A11y patterns
└── features/          # Feature-specific learnings
    ├── nav-redesign.md    # Navigation drawer
    └── {feature}.md       # New features
```

**Workflow:**
1. **Before task:** Read `domains/` files for relevant domains + `features/{feature}.md` if exists
2. **After task:** Add new insights using the format in `docs/claude/insights/README.md`

---

## Page Directory Registry

**IMPORTANT:** When adding a new page to the site, you MUST also add an entry to `src/data/page-directory.json`.

Each entry requires: `id`, `title`, `description`, `path`, `icon`, `category` (popular | my-team | reports | tools | info), `tags` (10+ synonyms), `visibility` (all | admin), and `popularity` (0-100).

**Write tags generously** — include every word a user might type to find this page:
- Primary function words (what the page does)
- Synonyms (alternative words users might search)
- Data types shown (chart, table, graph, list)
- Actions available (edit, filter, sort, compare)
- Related concepts and slang/casual terms

The test `tests/page-directory-data.test.ts` enforces minimum 10 tags per entry and validates all fields.

---

## What's New Changelog

**IMPORTANT:** When completing a feature that adds a new page, new user-facing feature, or significant enhancement, you MUST update `src/data/whats-new.json`.

### When to Add a New Entry
- New page added to the site (screenshot required)
- New user-facing feature (e.g., a new tool, mode, or interactive element) (screenshot required)
- Major enhancement that changes how an existing feature works (screenshot required)
- Any guest-facing change that affects user behavior (e.g., URL changes, navigation changes)

### When NOT to Add an Entry
- Style tweaks, data syncs, refactors
- Internal tooling or build changes
- Documentation-only changes
- Admin-only features (visibility: "admin" in nav-config.json)
- Unreleased or in-progress features not yet available to all users

### Writing Style (MANDATORY)

Every What's New entry MUST be written in the league's established editorial voice. This is not optional — it applies to every new-page, new-feature, and enhancement entry.

**Voice:** Conversational, witty, self-aware humor. Slightly sarcastic but never mean-spirited. Written like a sports columnist who actually understands the product.

**Structure (2-3 paragraphs in `description`):**
1. **Opening hook** — A humorous problem statement or analogy about the old way / the pain point. Draw from real-world comparisons or fantasy football culture. Examples: "used to require twelve browser tabs, three spreadsheets, and the quiet resignation that you'd never have all the data in one place", "had all the navigability of a phone book".
2. **Feature details** — What it does, explained with specific capabilities in user terms. Technical details wrapped in accessible language. Be concrete about what the user can do.
3. **Closing** — A callback to the opening joke, a wry practical observation, or a nudge to try it. Examples: "Use it before the auction, or don't — and then use it after the auction to figure out where things went wrong", "Trust, but verify."

**Hallmarks to include:**
- Real-world comparisons ("the difference between a folding map and a GPS")
- Fantasy football / sports metaphors ("all the reliability of a rookie quarterback in a snow game")
- League member shoutouts when a feature was built for or inspired by someone ("This one's for Wabbit", "This one started with a simple request from The Dream")
- Light ribbing of league culture and habits
- Personality in the `summary` field too — not just a dry feature description

**Tone calibration:**
- Bug fixes can be shorter and drier, with one good joke
- New pages and features get the full 2-3 paragraph treatment
- Enhancements land somewhere in between
- `excludeFromHero` entries (minor polish) can be more concise

**Anti-patterns (DO NOT):**
- Write dry, corporate-sounding release notes
- Use generic language like "We're excited to announce..."
- Skip the humor — every entry needs personality
- Write the `summary` as a plain feature description without voice

### League Scoping (MANDATORY)

**Every entry MUST include a `leagues` field** — `["theleague"]`, `["afl"]`, or both. There is no default: display code **fails closed**, so an untagged entry is shown NOWHERE (never cross-league), and `tests/whats-new-data.test.ts` fails the build on untagged or misspelled values (the only valid slugs are `theleague` and `afl` — NOT `afl-fantasy`).

Rules enforced by the tests:
- `leagues` is required and non-empty on every entry
- An entry visible in one league must not `link` into the other league's pages (`/theleague/...` vs `/afl-fantasy/...`). Both-league entries must use a league-neutral link or omit `link`.
- If an entry's `title`/`summary` (the hero/card copy) names a league, the entry must be tagged for EXACTLY that league. This includes both-league entries — copy naming "AFL" can't ship tagged `["theleague", "afl"]` (that would put an AFL headline in The League's hero). Split league-specific announcements into per-league entries with league-neutral copy, or reword.

### Entry Format
Add the new entry at the **top** of the array (newest first):
```json
{
  "id": "kebab-case-id",
  "date": "YYYY-MM-DD",
  "title": "Short Title",
  "summary": "One sentence shown in hero banner and cards.",
  "description": ["Full paragraph(s) for the What's New page."],
  "category": "new-page | new-feature | enhancement | bug-fix",
  "link": "/theleague/page-path",
  "linkLabel": "CTA text (e.g., 'Try it now')",
  "icon": "sprite-icon-id",
  "image": "feature-name.webp",
  "imageAlt": "Descriptive alt text for the screenshot",
  "leagues": ["theleague"]
}
```

### Screenshot Requirement (MANDATORY)

**Every `new-page`, `new-feature`, and `enhancement` entry MUST include a screenshot.** This is enforced by `tests/whats-new-data.test.ts` and the build will fail without it.

**Required fields:**
- `"image"`: Filename relative to `public/assets/whats-new/` (e.g., `"trade-builder.webp"`)
- `"imageAlt"`: Descriptive alt text explaining what the screenshot shows

**How to add a screenshot:**
1. Take a screenshot of the feature at a standard desktop viewport (1280px+ wide)
2. Save as `.webp` format to `public/assets/whats-new/{feature-id}.webp`
3. Use a 16:9 aspect ratio crop when possible
4. Add `"image"` and `"imageAlt"` fields to the JSON entry

**Where screenshots appear:**
- What's New listing page (card thumbnails with browser-frame chrome)
- What's New detail page (hero image)
- Homepage hero banner (when featured)

**Exempt:** `bug-fix` and `league-event` categories do not require screenshots.

### Hero Banner Behavior
- New entries automatically appear in the homepage hero for **7 days**
- If multiple features are within the 7-day window, one is **randomly selected** per page load
- Set `"excludeFromHero": true` for minor enhancements that shouldn't get hero treatment
- After 7 days, the hero falls back to upcoming league events or the default "What's New" promo
- Priority rules are defined in `src/utils/hero-resolver.ts`

### Weekly Bug Fix & Style Tweak Changelog

Bug fixes and style tweaks are tracked throughout the week and compiled into **one What's New rollup entry per league** every Monday at 8pm PT via GitHub Actions (`scripts/weekly-changelog-rollup.mjs`).

**After completing any bug fix or style tweak** that does NOT qualify for its own What's New entry, append an entry to `src/data/weekly-changelog-staging.json`:

```json
{
  "date": "YYYY-MM-DD",
  "type": "bug-fix | style-tweak",
  "summary": "User-facing description of what changed and why it matters",
  "impact": "user | admin",
  "area": "free-agents | rosters | navigation | design-system | homepage | rankings | trade-builder | salary | league-summary | calendar | standings | playoffs | mvp | import-rankings | whats-new | other",
  "league": "theleague | afl | both"
}
```

**Guidelines:**
- Write `summary` as a user-facing improvement, not a code change (e.g., "Defense player avatars are now circular with properly centered logos" NOT "use flex centering with container padding")
- `impact` is `"user"` for anything league members see; `"admin"` for commissioner-only changes
- **`league` is REQUIRED** — the rollup routes each change to the matching league's What's New entry, and the rollup script exits with an error if any change is untagged. `tests/whats-new-data.test.ts` validates this at PR time so the Monday cron never hits it.
- Do NOT log: data syncs, refactors with no visible effect, test-only changes, or changes that already got their own What's New entry
- The staging file resets automatically every Monday after the rollup runs

### Weekly Rollup Screenshot (MANDATORY)

Each weekly rollup MUST include **one screenshot** of the most noteworthy fix or enhancement from that week.

**How to choose:** Pick the most visually interesting or impactful change from the staging entries. Take a screenshot of the affected page showing the improvement in action. For example, if the best change fixed player headshots, screenshot the player modal showing a working headshot.

**How to add:**
1. Take a screenshot of the affected page at a standard desktop viewport (1280px+ wide) using Playwright CLI:
   ```bash
   # Use Playwright to capture with any needed interactions (click modals, filters, etc.)
   node -e "const {chromium}=require('playwright'); ..."
   # Convert to webp
   cwebp -q 85 /tmp/screenshot.png -o public/assets/whats-new/weekly-rollup-YYYY-MM-DD.webp
   ```
2. Save as `.webp` to `public/assets/whats-new/weekly-rollup-YYYY-MM-DD.webp` (use the Monday date)
3. Set the `featuredImage` field in `src/data/weekly-changelog-staging.json`:
   ```json
   {
     "weekOf": "2026-03-03",
     "featuredImage": "weekly-rollup-2026-03-03.webp",
     "featuredImageAlt": "Descriptive alt text for the screenshot",
     "featuredImageLeague": "theleague",
     "changes": [...]
   }
   ```

**`featuredImageLeague` is REQUIRED whenever `featuredImage` is set** (`theleague` or `afl` — whichever league's page the screenshot depicts). The rollup generates one entry per league, and the screenshot is attached ONLY to the matching league's entry — without the field, a screenshot of one league's page could ship on the other league's What's New entry. `tests/whats-new-data.test.ts` enforces this.

---

## Documentation Index

For detailed documentation, see `docs/claude/`:

| Document | Contents |
|----------|----------|
| [build-dev.md](docs/claude/build-dev.md) | Build commands, npm scripts, dev workflow |
| [data-flow.md](docs/claude/data-flow.md) | MFL API, data sources, cache layer |
| [components.md](docs/claude/components.md) | Astro/React patterns, layouts, styling |
| [testing.md](docs/claude/testing.md) | Vitest, test patterns, coverage |
| [auth.md](docs/claude/auth.md) | Authentication, sessions, cookies |
| [code-standards.md](docs/claude/code-standards.md) | TypeScript, imports, naming conventions |
| [troubleshooting.md](docs/claude/troubleshooting.md) | Common issues, debug techniques |
| [critical-assumptions.md](docs/claude/critical-assumptions.md) | Hardcoded values ($45M cap, 10% escalation) |
| [league-rules.md](docs/claude/league-rules.md) | TheLeague rules, scoring, roster config |
| [afl-rules.md](docs/claude/afl-rules.md) | AFL Fantasy rules, scoring, roster config |
| [insights/](docs/claude/insights/) | AI learnings by domain and feature |

### Feature Documentation

Feature docs live in `docs/features/`:

| Document | Contents |
|----------|----------|
| [auction-predictor-design.md](docs/features/auction-predictor-design.md) | System architecture, algorithms |
| [auction-predictor-tasks.md](docs/features/auction-predictor-tasks.md) | Implementation tasks |
| [custom-rankings.md](docs/features/custom-rankings.md) | Custom rankings & tier system |
| [mfl-api.md](docs/features/mfl-api.md) | MFL API reference |
| [personalization.md](docs/features/personalization.md) | Team preference cookie system |

---

## Communication Rules

- **Always make links clickable** — when providing URLs, GitHub links, PR links, or any other references, format them as markdown hyperlinks (e.g., `[link text](url)`) so they are clickable in the terminal.

---

## Quick Reference

### Critical Constants
```typescript
SALARY_CAP = 45_000_000       // $45M
ROSTER_LIMIT = 28             // 28 players
ESCALATION_RATE = 1.10        // 10% annual
```

### Common Commands
```bash
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm test         # Run all tests
pnpm vitest run path/to/foo.test.ts   # Run one unit-test file
pnpm sync:all     # Sync data from MFL
```

### Project basics

- **Framework:** Astro (SSR + SSG). React for client-hydrated islands.
- **Package manager:** pnpm (not npm). Scripts: see `package.json`.
- **Prebuild:** `scripts/prebuild.mjs` runs build steps + network fetches in
  parallel. Add new build-time fetches there.

---

## Team Strategy (Fantasy Football)

This section describes the dynasty fantasy football strategy that informs feature priorities and analysis tools.

**Primary Goal:** Sign as many long-term contracts as possible by targeting **young, inexpensive players** to build sustained dynasty dominance.

**Secondary Goal:** Acquire good short-term contracts (1-2 years) that provide trade asset value, roster depth, and plug-and-play starters.

---

## Runtime Gotchas

The following sections document gotchas that have bitten past sessions and would bite a future session too. Keep them.

### Feature flags — code, not GitHub Actions variables

Do not introduce new `vars.*` references in workflows as feature gates
(`SCHEFTER_FOO_ENABLED`, etc.). Editing a GitHub variable is never easier
than editing code in this repo, and the indirection just splits the
source of truth across two places. To disable a scheduled job, comment
out (or delete) its `cron:` line. To gate behavior, use a `const` in the
script itself.

A few legacy vars predate this rule (`SCHEFTER_RUMOR_MILL_ENABLED`,
`SCHEFTER_TRADE_OFFER_RUMORS_ENABLED`). Don't add more, and prefer
moving the existing ones into code if you're already touching the file.

### League registry — never hardcode league constants

`src/config/leagues-data.mjs` (data) + `src/config/leagues.ts` (types/helpers)
are the single source of truth for per-league constants: MFL id, slug, name,
MFL host, data path, apex domains, and feature flags. Do not write `'13522'`,
`'19621'`, `'data/theleague'`, etc. inline — import from the registry.
App code imports `../config/leagues`; node scripts import
`src/config/leagues-data.mjs` directly. Gate league-specific UI with
`leagueHasFeature(slug, 'contracts' | 'keepers' | ...)`. Adding a league or
domain is a one-entry change in `leagues-data.mjs`.

### Auth — session JWT only

`getAuthUser()` (src/utils/auth.ts) trusts only the signed session cookie.
The old `X-User-Context` / `X-Auth-User` header fallbacks were removed in
June 2026 — they allowed full auth bypass. Never re-add unsigned identity
sources. Rate-limit any new LLM-backed endpoint with
`src/utils/rate-limit.ts`, and run any server-side fetch of a user-supplied
URL through `src/utils/url-guard.ts#validatePublicUrl`.

### Roger date-handling gotchas

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

### NFL Draft date source of truth

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

### Edit-time safety net

`.claude/settings.json` runs `.claude/hooks/roger-reminder-test.sh` on every
Write/Edit/MultiEdit to any Roger-related file. The hook runs the
reminder-window vitest suite and blocks the tool call if it fails. If you
edit one of those files and don't see a test run, `node_modules` probably
isn't installed — run `pnpm install`.

### Daily audit

`.github/workflows/roger-date-audit.yml` runs daily. It runs the reminder-
window tests and fetches the ESPN draft date; if ESPN disagrees with the
committed `nfl-draft-dates-fetched.json`, the workflow fails so the drift
surfaces in the Actions tab. To accept a new date, run
`pnpm fetch:nfl-draft-date` locally and commit the change.

### Merge conflicts — always rebase, resolve autonomously

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

### Schefter tipster context (Phase 8 — bot intelligence)

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

### Schefter quiet-day post (Phase 8 — feature 7)

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

### Schefter recurrence ledger v2 (Phase 8 — feature 10)

`data/schefter/topic-recurrence.json` bumped to v2. Each fingerprint
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
