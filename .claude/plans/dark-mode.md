# Dark Mode — Transition Plan

**Goal:** Full dark mode for both TheLeague and AFL Fantasy. Defaults to the user's
system preference (`prefers-color-scheme`), with an explicit per-user override
(Light / Auto / Dark) that persists.

**Status (2026-07-03):** Phase 1 COMPLETE. Phase 2 largely complete ahead of schedule (user-driven): Schefter feed ✅, rosters (all 3 views, both leagues) ✅, standings/playoffs/MVP ✅, players/projected-FA ✅, PlayerDetailsModal canon ✅ (its decisions — deepened scrim keeping blur, box-shadow border ring for raised dark cards, `--league-accent` section-title bars — are the recipe for remaining work). AFL dark is a **navy ramp** from `--afl-navy` (page #0f1e2e → cards #16283c → elevated #1d3349, blue-tinted borders/text-grays) via `html.dark[data-league="afl"]`. Dark primary is now #3b82f6; secondary #10b981; breadcrumb near-black w/ 2px league-accent bottom edge; elevation = borders #3a3a3a + pure-black ~2.5x shadows; logos CSS-swap on html.dark (both header + drawer). CRITICAL DEV GOTCHA solved: public/sw.js (PWA) uses cache-first for CSS — it was serving stale styles across all dev servers/tabs; SW now registers PROD-only, dev actively unregisters + clears caches (TheLeagueLayout). Also: Vite file-watching in this worktree is unreliable — restart the dev server after batch edits rather than trusting HMR. Phase 3 long tail LARGELY DONE (2026-07-04, committed `1d8b48d840` + follow-ups): owner-activity, franchises (index+detail), rivalries (index+pair), rules, rules-chat, suggestions + AnchorNav, about, TradeAlertModal, stats hub, chart components (Donut/Bar/AgeDistribution labels), standings tier bands (whisper color-mix tints), 45-consumer sprite icon audit (fill: currentColor — 4 fixes), ::selection styles, per-team dark icons merged (9 teams + revised art), AFL dark logo + conference/tier badges (ThemeImage dual-img), navy AFL ramp, secondary buttons = logo emerald w/ near-black text. NEW dead-var families discovered along the way: `--surface/--text/--border`, `--text-color`, `--color-red-*`, plus two systemic traps: `color-mix(..., white)` literal base and `--color-white` used as a surface (both never re-theme). PAGE MIGRATION COMPLETE (commit `7a768e2101`, 2026-07-04): trade/salary/contracts, draft suite (draft-room.css --dr-* dark ramp), reports (rookies/power-rankings/league-comparison), calendar/search/whats-new/insights/assets/lineup (both leagues), AFL secondary pages, design-system.astro now has a Light/Dark PREVIEW switcher (QA harness, doesn't touch cookie). New gotchas recorded: `:root{}` inside scoped Astro styles is NOT scoped (assets pages were globally pinning --gallery-content-bg light); `--afl-navy` used as text = invisible on AFL dark. Spawned follow-up task chips: matchup-data 500 (stale data), asset-header light-mode contrast, 4 draft modals missing backdrop blur, AFL `--color-primary`-means-red misuse audit, AFL icons.astro 500. REMAINING FOR PHASE 4: full Playwright QA sweep (pages × themes × leagues × viewports), authenticated-page eyeball pass (lineup, mock-draft, franchise-tags, The Board composer), `--color-franchise-tag` dark values in tokens-dark.css, docs (CLAUDE.md editorial standard + DARK_MODE_COLOR_SPEC refresh), What's New entry (both leagues, screenshot, editorial voice), release/soak decision. — D1 decided: league-colored (TheLeague dark blue `#5a90cf`, AFL dark red `#ef5350`, gold removed). All 1.x tasks done + verified (2668 unit tests pass; live browser checks: auto/OS-default, overrides, SSR class, soft-nav survival in auto mode, meta theme-color, instance sync, mobile). Note: theleague/Header.astro had NO user dropdown (dead CSS only) — toggle lives in the breadcrumb actions row + NavDrawer footer instead. Known Phase-2 debt visible: Schefter feed white cards on dark. Next: Phase 2 (codemod 2.1 first).

---

## Where we already are (audit findings, 2026-07-03)

The groundwork is better than expected:

1. **A complete dark palette already exists** — `src/styles/tokens-dark.css` (415 lines,
   every component token group covered: surfaces, tables, nav drawer, buttons, badges,
   forms, shadows, alerts). It was built from `docs/DARK_MODE_COLOR_SPEC.md` alongside the
   MFL dark skin (`src/assets/css/src/_variables-dark.scss` → `public/assets/css/dist/dark_main.css`)
   and refined in commit `27afccbff3` ("pure grays, no blue tones"). **It is imported
   nowhere** — it's an orphan waiting to be wired in. It is scoped to bare `:root`, so it
   must be rescoped before use.
2. **The token system is the switch.** `src/styles/tokens.css` is the single source of
   truth, imported by `TheLeagueLayout.astro` and `Layout.astro`. Everything styled through
   tokens flips for free when the dark values activate.
3. **Nav components already anticipate dark mode.** `NavHeader.astro`, `NavDrawer.astro`
   (and friends) carry `:global(.dark)` selectors today — the repo's existing convention is
   an `html.dark` class.
4. **The cookie preference pattern exists** — `src/utils/team-preferences.ts` (1-year,
   `sameSite: lax`, `httpOnly: false`, validated on read) is the template for a theme cookie.
5. **NFL logos already support dark variants** — `nfl-logo.ts` has a `variant: 'dark'`
   parameter (ESPN `500-dark/` CDN path), currently unused.

The debt: **~7,700 hardcoded hex/rgb literals** in `src/` that bypass tokens
(`src/pages` ≈ 3,900, `src/components` ≈ 2,900). Worst offenders:
`draft-room.css` (300), `suggestions.astro` (295), `rosters.astro` (233),
`ContractDeclarationModal.astro` (196), `players.astro` (173), `design-system.astro` (150),
`rookies-2026.astro` (124), `schefter/tip.astro` (123), `about.astro` (118).

---

## Decision points (recommendations inline)

### D1 — Dark palette identity: gold or league colors? **← the one real design decision**
`tokens-dark.css` as written swaps `--color-primary` from league blue to **gold `#c9a94e`**
(the MFL dark-skin aesthetic). Because `--league-accent` derives from `--color-primary`,
that would turn every section-title border, CTA, and active-nav state gold **in both
leagues**, erasing the blue-vs-red league identity.

**Recommendation: keep league identity.** Use the neutral/surface/table/nav scales from
`tokens-dark.css` verbatim (they're well-tuned), but keep `--color-primary` a
brightened TheLeague blue (e.g. `#4a7fb5`-range for contrast on `#121212`) and let
`html[data-league="afl"]` keep red `#c41e3a` (slightly brightened, e.g. `#e0314f`) with
navy adjusted for dark surfaces. Gold stays available as `--afl-trophy-gold` etc.
The alternative (gold everywhere) matches the MFL-hosted dark skin exactly — if
consistency with the MFL site matters more than league branding, flip this decision;
the plan is otherwise unchanged.

### D2 — Selector convention
Options: `html.dark` (already used by nav components + the insights guidance) vs
`html[data-theme="dark"]`. **Recommendation: keep `html.dark`** — zero churn in existing
components, and the inline script sets one class. The theme *preference* (light/auto/dark)
is stored in the cookie; the *resolved* theme (light/dark) is the class.

### D3 — Toggle placement
**Recommendation: both** a 3-state control (Light / Auto / Dark) in the Header user
dropdown (`src/components/Header.astro` ~line 577) and a compact toggle in the NavDrawer
footer. Cheap to do both; discoverable everywhere.

---

## Architecture

### Preference storage & resolution
- **Cookie `theme_pref`** = `light | dark | auto` (absent ⇒ `auto`). Mirrors the
  `team-preferences.ts` config (1yr, path `/`, lax, not httpOnly). Cookie — not
  localStorage — so SSR can render the right class with zero flash for explicit choices.
  One cookie per domain covers both leagues on the shared host; per-league apex domains
  each keep their own (acceptable).
- **SSR:** `TheLeagueLayout.astro` (and `Layout.astro`, `LoginLayout.astro`) read the
  cookie and render `<html class="dark">` when pref is `dark`. For `auto`/absent the
  server can't know the OS setting — the inline script resolves it pre-paint.
- **Inline head script (`is:inline`, before stylesheets):** read cookie → if `auto`,
  resolve via `matchMedia('(prefers-color-scheme: dark)')` → set/remove `.dark` on
  `document.documentElement`. Also:
  - `matchMedia(...).addEventListener('change', ...)` — live OS-flip support while pref is `auto`.
  - `astro:after-swap` listener — **ClientRouter replaces `<html>` attributes on soft
    navigation**, so the class must be re-applied after every swap or dark mode reverts
    mid-session. This is the classic Astro dark-mode bug; test it explicitly.
- **`color-scheme` CSS:** `:root { color-scheme: light }`, `html.dark { color-scheme: dark }`
  so native form controls, scrollbars, and UA defaults follow.
- **`<meta name="theme-color">`:** layouts currently hardcode `#1c497c` / `#002244`;
  script updates it on theme change (dark: `#121212`).

### Token activation
- Rescope `tokens-dark.css` from `:root` to `html.dark` (find/replace + palette edits per D1).
- Import it in the layouts right after `tokens.css`.
- No `@media (prefers-color-scheme)` duplication of token blocks — the inline script is
  the single resolver, so dark CSS lives in exactly one place.

### API endpoint — none needed
The toggle writes the cookie client-side (`document.cookie`) and flips the class
immediately; next SSR request reads it. No server round-trip.

---

## Model-assignment philosophy

Every task below carries the **cheapest model that can safely do it**:

| Model | Cost tier | Use for |
|-------|-----------|---------|
| **Haiku** | cheapest | Mechanical work with a crisp spec and an existing template to copy: find/replace rescoping, wiring imports, running a pre-built codemod, doc refreshes from established facts, screenshots |
| **Sonnet** | mid | Standard feature code: new components, per-page token migration with judgment calls, QA scripts, mounting UI into existing components |
| **Opus** | high | Subtle-correctness and judgment work: the pre-paint resolver (FOUC/ClientRouter), palette derivation with contrast math, the codemod's ambiguity classifier, visual QA review, editorial voice |
| **Fable** (main session) | highest | Orchestration only: decisions, dispatching, reviewing agent output, final sign-off. No line-level work. |

Ground rules:
- Haiku never gets a task where a wrong-but-plausible output would ship silently (no
  unsupervised color-semantics decisions). Its tasks are verifiable by diff inspection or tests.
- Opus is bought exactly where a bug would be expensive to find later (theme flashing,
  soft-nav reverts, contrast failures) or where quality is the product (voice, palette).
- Tasks marked ∥ can run as parallel agents in one dispatch.

---

## Execution plan — every step

### Phase 0 — Decisions (no agents)

| # | Task | Model | Notes |
|---|------|-------|-------|
| 0.1 | Confirm D1 (league-accent vs gold), D2 (`html.dark` — recommended, treat as settled), D3 (both placements — settled) | **Brandon + Fable** | Blocks 1.3 only; everything else in Phase 1 can start now |

### Phase 1 — Theme engine + toggle

| # | Task | Deliverable | Model | Why this model |
|---|------|-------------|-------|----------------|
| 1.1 ∥ | `src/utils/theme-preference.ts`: typed `'light'\|'dark'\|'auto'`, server read via AstroCookies + client read/write via `document.cookie`, validation, 1-yr expiry | new util + unit test | **Haiku** | Direct clone of `team-preferences.ts` pattern; spec is complete; test verifies it |
| 1.2 ∥ | Rescope `tokens-dark.css`: every `:root` → `html.dark`, ditto the `:focus-visible` block; add `color-scheme: light` to tokens.css `:root` and `color-scheme: dark` to `html.dark` | edited CSS | **Haiku** | Pure mechanical rescope, diff-verifiable |
| 1.3 | Repalette `tokens-dark.css` per D1: derive dark-mode `--color-primary` (brightened blue), dark AFL block (`html.dark[data-league="afl"]` — red + navy adjusted), verify ≥4.5:1 contrast for text tokens and ≥3:1 for accents against `#121212`/`#1e1e1e` | edited CSS + contrast table in PR notes | **Opus** | Color judgment + WCAG math; the palette IS the feature. Blocked on 0.1 |
| 1.4 | Import `tokens-dark.css` in `TheLeagueLayout`, `Layout`, `LoginLayout` (after tokens.css); migrate LoginLayout's inline `:root` block onto tokens or explicitly exempt it | edited layouts | **Haiku** | Wiring; build failure catches mistakes |
| 1.5 | Inline pre-paint resolver (`is:inline` in `<head>` of all layouts): cookie → resolve `auto` via matchMedia → set/remove `.dark`; matchMedia `change` listener (only while auto); `astro:after-swap` re-apply; `<meta name="theme-color">` sync (dark `#121212`, else per-league value) | script + manual FOUC/soft-nav test notes | **Opus** | The #1 silent-failure zone: FOUC, ClientRouter attr wipe, listener leaks across swaps. Worth the premium |
| 1.6 | `ThemeToggle.astro` + tiny client util: 3-state segmented control (Light/Auto/Dark), radiogroup ARIA, tokens only, `--league-accent` active state, reduced-motion guard | new component | **Sonnet** | Standard component build against the editorial standard |
| 1.7 | Mount toggle: Header user dropdown (`Header.astro` ~L577) + NavDrawer footer; both leagues | edited components | **Sonnet** | Touches live nav components; needs care but no novel logic |
| 1.8 ∥ | Dark-fix the shell: `src/components/theleague/Header.astro` (hardcoded `#1c497c` breadcrumb, white bg), league SVG logo classes (`.st0–.st7`, `.afl0–.afl6`) if contrast fails, verify NavHeader/NavDrawer existing `.dark` rules against final palette | edited components | **Sonnet** | Judgment on which hexes map to which tokens |
| 1.9 | Phase-1 verification: preview both leagues — first-visit OS default, explicit override, persistence across reload + 5-page soft nav, OS flip while `auto`, zero FOUC (throttled), form controls/scrollbars via color-scheme | pass/fail report | **Sonnet** (run) + **Fable** (review) | Scripted checklist; cheap to run, sign-off stays with main session |

**Exit gate (Fable):** shell fully dark in both leagues, all 1.9 checks pass.

### Phase 2 — Codemod + high-traffic pages

| # | Task | Deliverable | Model | Why |
|---|------|-------------|-------|-----|
| 2.1 | Build `scripts/dark-mode-codemod.mjs`: hex/rgba → token map (gray scale, `#fff`/`#ffffff`, `#1c497c`, `#e2e8f0`, `#f9fafb`, …), context classifier (property-aware: `color:` vs `background:` vs `border:`), three output lanes — auto-apply (unambiguous), flagged (needs eyes), skip (intentional, e.g. brand art) — plus dry-run report mode | script + dry-run report over src/ | **Opus** | The classifier's false-positives would ship invisible bugs on light mode too; one-time cost, reused ~25× |
| 2.2 | Add missing semantic tokens to both token files as the dry-run reveals them: `--backdrop-bg` (modal `rgba(15,23,42,.45)` standard), scrim/overlay tokens, any repeated one-offs | edited token files | **Sonnet** | Naming + placement judgment, small scope |
| 2.3 ∥ | Migrate: homepage (both leagues) + hero components (AflEventHero, EventHeroShell — already navy-dark; verify they read correctly on dark page bg) | migrated pages | **Sonnet** | Codemod does the bulk; agent reviews flagged lane + visually verifies |
| 2.4 ∥ | Migrate: `rosters.astro` (233 literals) + RosterLoader | migrated page | **Sonnet** | Same recipe |
| 2.5 ∥ | Migrate: standings, playoffs, MVP (both leagues where applicable) | migrated pages | **Sonnet** | Same recipe |
| 2.6 | Migrate: `PlayerDetailsModal.astro` + PlayerCell + player-cell.css | migrated canon | **Opus** | This is the design canon every page clones — its dark treatment sets the sitewide pattern; get it right once |
| 2.7 ∥ | Migrate: players, free agents (uses 2.6 as reference) | migrated pages | **Sonnet** | Follows the canon |
| 2.8 ∥ | Migrate: Schefter feed CSS + `tip.astro` (convert its existing `prefers-color-scheme` blocks → `.dark`) | migrated pages | **Sonnet** | Includes a small refactor of existing dark blocks |
| 2.9 ∥ | Migrate: trade builder (incl. TradeBaitMarketplace.tsx), salary pages | migrated pages | **Sonnet** | React component included — still standard work |
| 2.10 | rgba-scrim sweep: grep all `rgba(0,0,0,…)` / `rgba(255,255,255,…)` overlays sitewide, produce keep/flip/tokenize list, apply | edited files + list | **Sonnet** | Not codemod-able; needs per-case reasoning |
| 2.11 | Phase-2 visual QA: screenshot each migrated page light+dark, both leagues; check black-on-black / white-on-white, backdrop blur standard | annotated screenshot set | **Sonnet** (capture) + **Opus** (review) | Capture is mechanical; catching subtle contrast misses is not |

**Exit gate (Fable):** the six page groups pass dark visual review; codemod flagged-lane queue empty for these pages.

### Phase 3 — Long tail + assets

| # | Task | Deliverable | Model | Why |
|---|------|-------------|-------|-----|
| 3.1 ∥ | Codemod batch A — near-tokenized pages (per 2.1 dry-run report, pages with <20 flagged hits): auto-apply lane + verify build | migrated pages | **Haiku** | Mechanical by construction: the Opus-built classifier already made the decisions; Haiku applies + smoke-checks |
| 3.2 ∥ | Codemod batch B — heavy pages: `suggestions.astro` (295), `ContractDeclarationModal` (196), `rookies-2026`, `about`, `dead-money`, remaining tools | migrated pages | **Sonnet** | Big flagged lanes need judgment |
| 3.3 ∥ | `draft-room.css` (300 literals, `--dr-*` prefixed system) — extend its own token block with dark values rather than remapping | edited CSS | **Sonnet** | Self-contained token system, moderate care |
| 3.4 ∥ | Chart dark values: `--chart-grid-color`, `--chart-tick-color`, verify 6-color line palette legibility on `#1e1e1e` | edited tokens | **Haiku** | Tokens already exist; adding dark values from the spec |
| 3.5 ∥ | Asset audit: NFL logos on dark surfaces (decide: keep light variants vs wire `nfl-logo.ts` `variant:'dark'` per context), team icon/banner PNGs, headshots, favicon dark variant already present | audit doc + fixes | **Sonnet** | Visual judgment across many assets |
| 3.6 | `design-system.astro`: add light/dark preview switcher → permanent QA harness | edited page | **Sonnet** | Small interactive feature |

**Exit gate (Fable):** `grep` for raw hexes in migrated scopes ≈ zero outside skip-list; design-system harness renders both themes.

### Phase 4 — QA, docs, release

| # | Task | Deliverable | Model | Why |
|---|------|-------------|-------|-----|
| 4.1 | Playwright sweep script: every `page-directory.json` path × {light, dark} × {theleague, afl} × {1280, 375} | script + screenshot corpus | **Sonnet** | Standard tooling work |
| 4.2 | Full-corpus review: eyeball every dark screenshot, automated contrast check on token pairs, ClientRouter 5-page dark session regression | defect list | **Opus** (review) + **Fable** (sign-off) | The last line of defense before league members see it |
| 4.3 | Fix batch from 4.2 | fixes | **Sonnet** (or **Haiku** for one-liners) | Sized per defect |
| 4.4 ∥ | Docs: refresh `DARK_MODE_COLOR_SPEC.md` to shipped palette; add dark-mode learnings to `docs/claude/insights/domains/design-system.md` | edited docs | **Haiku** | Recording established facts |
| 4.5 ∥ | CLAUDE.md: add dark-mode rule to Editorial Design Standard ("style through tokens; verify both themes; never raw hex") | edited CLAUDE.md | **Sonnet** | This wording steers every future session — worth mid-tier |
| 4.6 | What's New entry: `new-feature`, `leagues: ["theleague","afl"]`, league-neutral copy, full editorial-voice treatment | JSON entry | **Fable/Opus** | The voice is the league's product; top model earns it here |
| 4.7 | What's New screenshot: 1280px dark-mode capture → 16:9 webp → `public/assets/whats-new/dark-mode.webp` | asset | **Haiku** | Scripted capture per CLAUDE.md recipe |
| 4.8 | Optional soak: admin-gate the toggle for a few days, then un-gate + ship entry | flag flip | **Fable** | Release decision |

---

## Effort & spend shape

| Phase | Tasks | Model mix (by task count) |
|-------|-------|---------------------------|
| 1 | 9 | 3 Haiku · 4 Sonnet · 2 Opus |
| 2 | 11 | 0 Haiku · 8 Sonnet · 2 Opus · 1 split |
| 3 | 6 | 2 Haiku · 4 Sonnet |
| 4 | 8 | 3 Haiku · 3 Sonnet · 1 Opus · 1 Fable |
| **Total** | **34** | **~8 Haiku · ~19 Sonnet · ~6 Opus · Fable orchestrates** |

Opus is concentrated on exactly five things: the palette (1.3), the resolver (1.5), the
codemod classifier (2.1), the design canon (2.6), and final visual review (2.11/4.2).
Everything else rides on Sonnet, with Haiku sweeping the mechanical tail the Opus-built
tooling makes safe.

## Risks / gotchas
- **ClientRouter class wipe** (`astro:after-swap`) — the #1 way this silently breaks.
- **Inverted gray scale semantics** — `tokens-dark.css` inverts `--color-gray-*`
  (gray-50 becomes near-black). Correct for bg usage (`gray-50` cards), but any component
  using `gray-50` as *text* would vanish; the codemod review must catch these.
- **rgba() overlays** — hardcoded `rgba(0,0,0,x)` scrims often need to get *lighter* or
  swap to `rgba(255,255,255,x)` in dark; not codemod-able, manual list.
- **`.dark` fallback values** — the defensive `var(--x, #hex)` pattern is safe (fallbacks
  only fire when a token is undefined), no action needed.
- **LoginLayout** doesn't import tokens.css at all (inline `:root` block) — bring it into
  the token system in Phase 1 or explicitly exempt it.
