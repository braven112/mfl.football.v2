# Loading State Standard

**Status:** Phase 0 — standard adopted, components not yet built. This document is the contract; [loading-inventory.md](loading-inventory.md) is the migration map; [loading-roadmap.md](loading-roadmap.md) is the build plan.

The single visual standard for every loading state on the site. Like the [Editorial Design Standard](insights/domains/design-system.md) and the [Player Lockup](../../CLAUDE.md), loading feedback is now a shared system rather than something each screen reinvents. Adapted from the cross-platform loading framework developed for the Alaska + Hawaiian guest apps and re-grounded in this repo's tokens, two-league theming, and component conventions.

---

## Core principle — key off wait duration, not screen

The most important rule: **loading indicators are chosen by how long the user actually waits**, not by which page they're on, which feature owns the code, or which brand is active. Define one ladder of states tied to time thresholds; keep the structure identical across both leagues; let the brand skin only the parts that should feel branded.

### The duration ladder

| Elapsed | Context | Indicator | Where it shows up here |
|---|---|---|---|
| **< 0.3s** | any | **Nothing** | A loader that flashes and vanishes in under 300ms reads as a glitch. Local filters/sorts/toggles never get a spinner. |
| **0.3–1s** | any | **Optimistic** — show the result, reconcile in background | Tab switches, filter changes, preference toggles. |
| **1–10s** | content load | **Skeleton** that mirrors the final layout | Roster lists, free-agent tables, results panels, detail modals. The neutral default. |
| **1–10s** | discrete action | **Inline button spinner** (+ button disabled) | Submit lineup, login, send trade, post comment, draft a pick. |
| **predictable length** | any | **Determinate progress bar** | Rare here; documented for completeness, low priority. |
| **10s+** | AI / long wait | **Branded "on the wire" moment** with narration | Schefter generation, Ask Roger, news digest, rules-QA. The one tier that carries league character. |

**Design each tier off a high percentile (p75/p95), not the median.** A call that's typically 1s but 12s on bad mobile/airport wifi is a long-wait call for the users who matter most. When telemetry exists, map operations onto the ladder using p75/p95, not the average.

### Indicator types in detail

1. **No indicator / optimistic (< ~0.3s).** Show the result instantly, reconcile in the background. Direct-manipulation actions (taps, toggles, navigation, filters) should always feel instant. Never show a loader that vanishes in under 300ms.
2. **Inline button spinner (0.3–~3s, discrete actions).** A single action with no new layout to reveal yet — submit, login, send. Spinner replaces or sits inside the button. **Disable the button on activate** to prevent double-submit.
3. **Skeleton screen (1–~10s, content with structure).** Gray placeholder blocks mirroring the final layout. Use for any full-page or content-area load where the shape is predictable. Perceived as faster than a spinner even at identical load time, brand-neutral by nature, and works unchanged under both league skins.
4. **Determinate progress bar (predictable-length operations).** Use only when duration is knowable. Bias the curve to feel fast (move faster at the start). **Never fake progress** — a stalled bar is worse than an honest spinner.
5. **Branded full-screen moment (10s+ or genuinely unpredictable).** Reserve for long, unavoidable, high-stakes waits — here, the LLM-backed endpoints. Pair with narration that says what's happening. It must survive being seen hundreds of times, so keep the motion simple.

---

## Structure vs. skin — the two-league model

This repo runs two brands (TheLeague, AFL Fantasy) off one codebase. That maps directly onto the Alaska/Hawaiian structure-vs-skin split.

**Structure — identical across both leagues:**
The duration thresholds, which indicator fires, where it sits, the motion direction, the transition into loaded content, and the ARIA pattern. This is what "consistent" actually means to a user moving between contexts.

**Skin — per league, accent color only:**
The accent (spinner arc, progress fill, branded-moment character) comes from the existing **`--league-accent`** token, which already resolves per `html[data-league]` in [src/styles/tokens.css](../../src/styles/tokens.css):

```css
:root                      { --league-accent: var(--color-primary); } /* TheLeague blue #1c497c */
html[data-league="afl"]    { --league-accent: #c41e3a; }              /* AFL red */
```

**Components reference `var(--league-accent)` and never branch on league in code.** The skin resolves automatically with zero JS. The branded 10s+ tier is the one place richer league character (voice, motif) is allowed; everything below it is brand-neutral infrastructure built once.

---

## Token contract — zero hex

No hex/RGB literals in loader code. Every value flows through a token in [src/styles/tokens.css](../../src/styles/tokens.css):

| Role | Token |
|---|---|
| Skeleton block fill | `--color-gray-100` / `--color-gray-200` |
| Skeleton shimmer highlight | lighter gray sweep over `--content-bg` |
| Accent (spinner arc, progress fill) | `var(--league-accent)` |
| Radius | `--radius-md`, `--radius-sm`, `--radius-full` (spinner) |
| Spacing | `--spacing-*` |
| Motion timing | `--transition-fast` / `-base` / `-slow` |
| Branded overlay backdrop | `rgba(15, 23, 42, 0.45)` + `backdrop-filter: blur(2px)` (the mandated frosted-glass modal backdrop) |

The hardcoded `#3b82f6` in `PlayerNewsModal.astro`'s spinner is exactly the anti-pattern this contract removes.

---

## ARIA contract

Every loading surface announces itself to assistive tech. Patterns by tier:

| Tier | ARIA |
|---|---|
| Button spinner | `aria-busy="true"`, `aria-label="<verb phrase>"` (e.g. "Submitting lineup"), `disabled` |
| Determinate fill | `role="progressbar"`, `aria-valuenow` / `-valuemin` / `-valuemax`, `aria-label` |
| Skeleton | `role="status"`, `aria-busy="true"`, `aria-live="polite"`, `aria-label="Loading <thing>"` |
| Branded 10s+ | `role="status"`, `aria-live="polite"`, narration delivered via `aria-label` updates — **not** a fresh announcement per animation frame |

The repo already has ~14 `aria-live` / `role="status"` regions (lineup, salary, draft room, etc.); these fold into this contract rather than being replaced.

---

## Reduced-motion contract — non-negotiable

This repo handles `prefers-reduced-motion` **per-file** with no global stylesheet, and coverage is inconsistent: `PendingTradesPanel` and `schefter-feed-compact.css` guard their animations (good models), but the **playoffs shimmer** (`src/pages/theleague/playoffs.astro`, `src/pages/afl-fantasy/playoffs.astro`) and the `player-cell.css` eligible-pulse ship **no guard at all**.

The standard makes the guard mandatory: **every** loading animation includes an explicit block that collapses the motion to a static-but-present state, following the proven in-repo pattern:

```css
@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; }   /* still a visible tinted placeholder */
  .spinner  { animation: none; }   /* static ring, same aria-label */
}
```

The static fallback **keeps the same ARIA label** — reduced-motion users and screen-reader users get the same announcement as everyone else.

---

## Planned component API (built in a later phase)

Loaders must work in all three render contexts this site uses — Astro templates, React islands, and vanilla-JS HTML-string builders. Follow the canonical **dual Astro + JS pattern** already proven by `PlayerCell`:

- [src/components/theleague/PlayerCell.astro](../../src/components/theleague/PlayerCell.astro) — Astro component
- [src/utils/player-cell-html.ts](../../src/utils/player-cell-html.ts) — `buildPlayerCellHTML()` emitting the *same* classes for client-side rendering
- [src/styles/player-cell.css](../../src/styles/player-cell.css) — one stylesheet; size/variant via CSS custom props on the root class

The loading system mirrors this exactly:

| Artifact | Shape |
|---|---|
| `src/styles/loading.css` | One stylesheet. Size/variant via custom props on the root class (`--spinner-size`, `--skeleton-radius`, etc.); `--compact` modifier overrides those props. Includes the reduced-motion guard. Imported in component frontmatter (`import '../../styles/loading.css'`) for global scope — the PlayerCell trick. |
| `Spinner.astro`, `Skeleton.astro` | Tier 2/3/4 primitives. Optional `ThinkingDots.astro` (extract from `SchefterReplyThread`) and `BrandedLoader.astro` (tier 5). |
| `src/utils/loading-html.ts` | `buildSpinnerHTML()` / `buildSkeletonHTML()` emitting the same `.spinner` / `.skeleton` classes as strings, with an `esc()` helper for any interpolated text. |
| `resolveLoadingTier(elapsedMs, context)` | Pure function — the one escalation rule from the framework. Trivially testable. |
| `useLoadingState()` (React hook) | Thin wrapper that drives elapsed-time escalation and replaces scattered `isLoading` booleans. |

`resolveLoadingTier` and `LoadingContext` (`'content'` vs `'discreteAction'`) are the two inputs that decide which indicator shows in the 1–10s band. Brand is a separate dimension that only affects skin.

---

## Design gotchas

- **Don't let a fast load wear a slow load's clothing.** Match the indicator to the real wait. A skeleton on a 200ms load is as wrong as no feedback on a 6s one.
- **Never fake progress.** A stalled progress bar erodes trust more than honest waiting.
- **Reserve the branded moment for genuinely long waits.** Firing the tier-5 treatment on a routine 2s load cheapens it.
- **Connectivity is bimodal.** Mobile and stadium/airport wifi mean p95/p99 is where a large share of guests live on game day. Design for the tail.

---

*Framework source: Nielsen Norman Group, Smashing Magazine, Smart Interface Design Patterns, and the Alaska + Hawaiian loading-indicator research (`~/code/product-ops/product-exploration/loading-indicators/`).*
