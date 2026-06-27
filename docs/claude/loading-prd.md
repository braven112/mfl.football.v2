# PRD — Loading Indicator Standard

> **Mirror.** The source of truth for this PRD lives in the product-ops research folder
> (`~/code/product-ops/product-exploration/loading-indicators/PRD.md`). This copy is kept
> in sync here because **this repo is the live reference implementation** of the standard.
> When the two diverge, the product-ops copy wins for the framework sections; this copy
> carries the concrete, repo-specific reference-implementation detail (links below).

| | |
|---|---|
| **Status** | Draft v1 |
| **Author** | Brandon |
| **Last updated** | 2026-06-25 |
| **Type** | Cross-platform product + design standard |
| **Primary surface** | Unified consumer guest apps — native iOS, native Android, booking web |
| **Reference implementation** | **This repo** (two-league fantasy app: TheLeague + AFL Fantasy) |
| **Repo docs** | [loading-standards.md](loading-standards.md) · [loading-inventory.md](loading-inventory.md) · [loading-roadmap.md](loading-roadmap.md) |

> **Sanitization note.** Written to be shareable. The two consumer brands are referred to
> generically as **Brand A** and **Brand B**; internal team names, repo names, and specific
> call-site counts are omitted; the corporate design-token system is **"the design-token
> system."** In *this* repo, the two skins are concretely **TheLeague** and **AFL Fantasy**.

---

## TL;DR

Loading feedback today is improvised per screen: many competing implementations per platform, no shared rule for *when* each indicator appears, inconsistent or missing accessibility support, and brand treatment bolted on ad hoc. We will replace this with **one duration-keyed loading standard** — a single ladder of indicators chosen by *how long the user actually waits*, identical in behavior across brands, with only the accent color and the long-wait moment skinned per brand. The standard ships as a small shared component set per platform that screens adopt in roughly one line, retiring the sprawl. This repo is the **live reference implementation** that proves the framework end-to-end (structure/skin, accessibility, token contract) and de-risks the native build.

---

## Problem Statement

When an interface takes more than a second to respond with no visual feedback, users assume it has frozen — and at high-stakes moments (search, payment, check-in, content load) that erodes trust and increases abandonment. Today each screen invents its own loading treatment, so the experience is inconsistent, frequently flashes loaders on sub-second waits (which reads as a glitch), and — most critically — **lacks reduced-motion and screen-reader support across the board**, a hard accessibility-compliance gap. The cost of not solving it: higher abandonment at conversion-critical flows, standing compliance exposure, and ongoing engineering drag from maintaining many parallel implementations.

---

## Goals

1. **Consistency by rule, not by screen.** 100% of in-scope touchpoints resolve through the shared escalation rule, identical across brands.
2. **Close the accessibility gap.** 100% reduced-motion coverage and 0 WCAG 2.3.3 loading violations.
3. **Reduce perceived wait and abandonment** at high-stakes flows by matching indicator to wait and never faking progress.
4. **Collapse the maintenance surface** from many competing implementations to **one** shared system, then delete legacy.
5. **Preserve brand identity without flattening it** — one structure, two skins; brand character concentrated at the single long-wait moment.

---

## Non-Goals

1. **Redesigning the long-wait brand artwork itself** — the standard defines slot/behavior/a11y; the motif is a separate design deliverable.
2. **Percentage-accurate progress for every operation** — v1 is indeterminate + optional determinate bar; full instrumentation is a fast-follow.
3. **Replacing surfaces we don't control** (third-party/embedded overlays) — documented with a delegation contract, not forced.
4. **A third brand/skin** — architecture must *allow* it (P2); we are not building one.
5. **Network/latency optimization** — separate workstream; this governs *feedback during* waits.

---

## Users & Personas

| Persona | Who | Need |
|---|---|---|
| **Guest (end user)** | A user waiting at a high-stakes moment | Honest, well-timed feedback; never a frozen-looking screen |
| **Motion-sensitive guest** | reduce-motion enabled | Static-but-present indicator; no unguarded shimmer/spin |
| **Screen-reader guest** | assistive tech | Correctly announced loading + resolution |
| **Low-connectivity guest** | degraded mobile network | Feedback tuned to the tail (p95/p99), not the median |
| **Feature engineer** | builds screens | One-line adoption, not a reason to hand-roll another spinner |
| **Designer** | owns the experience | Brand character without re-specifying loading per screen |
| **Accessibility / compliance owner** | owns the bar | Provable, automated loader guarantees |

---

## Core Principle & Framework

**Key off wait duration, not screen, brand, or feature team.**

### The duration ladder

| Elapsed | Context | Indicator |
|---|---|---|
| **< 0.3s** | any | **Nothing** — a flash reads as a glitch |
| **0.3–1s** | any | **Optimistic** — show result, reconcile in background |
| **1–10s** | content load | **Skeleton** mirroring final layout |
| **1–10s** | discrete action | **Inline button spinner** (+ disabled) |
| **predictable length** | any | **Determinate progress bar** (never faked) |
| **10s+** | long / unpredictable | **Branded moment** + narration (the one skinned tier) |

Place operations using a **high percentile (p75/p95)**, not the median.

### Structure vs. skin

- **Structure (identical across brands):** thresholds, which indicator fires, placement, motion direction, transition into content, ARIA.
- **Skin (per brand):** accent color (one token) + the long-wait moment. In this repo the accent is `--league-accent` (TheLeague blue / AFL red), resolved by `html[data-league]`.

### One standard, many designs (the PRD is design-system-agnostic)

This PRD specifies **behavior, timing, accessibility, and token discipline — not a specific visual design.** "Structure" is the shared contract; the *visual implementation is owned by each product.* Two brands inside one app diverge only by accent — but **different products on different design systems diverge across their entire visual language.** The airline guest apps and this fantasy app each render the standard in their own components, type, spacing, and motion; both are conformant as long as they obey the ladder, the contexts, the ARIA contract, the reduced-motion rule, and zero hardcoded color. That's what lets one PRD govern both at once — and why this repo's loaders look nothing like the airline's yet follow the same rules.

---

## User Stories

**Guest**
- As a guest, I want immediate honest feedback when something loads, so I trust the app and don't abandon.
- As a guest, I don't want a spinner to flash for a fraction of a second, so quick actions feel instant.
- As a guest on a slow network, I want feedback even when the wait is long, so I keep waiting rather than force-quit.

**Motion-sensitive / screen-reader guest**
- As a motion-sensitive guest, I want loaders to respect reduce-motion, so I get a static indicator.
- As a screen-reader guest, I want loading and its resolution announced, so I know when the screen is busy and ready.

**Feature engineer**
- As a feature engineer, I want to adopt correct loading behavior in ~one line, so I never hand-roll another spinner.
- As a feature engineer, I want the system to choose the indicator from elapsed time + context, so I don't encode timing per screen.

**Designer**
- As a designer, I want consistent-by-default behavior and brand character at one tier, so I don't re-spec loaders per screen.

**Accessibility / compliance owner**
- As a compliance owner, I want an automated guarantee every loader is reduce-motion-safe and announced.

---

## Requirements

### Must-Have (P0)

**P0-1 — Duration-keyed escalation engine.** One pure rule `tier = f(elapsedMs, context)`, thresholds **0.3 / 1 / 10s**, contexts `content` vs `discreteAction`, in one place.
- *Given* 250ms, *then* no loader. *Given* content crossing 1s, *then* skeleton; discrete action crossing 1s, *then* button spinner. *Given* crossing 10s, *then* branded.
- Parity-tested at 0 / 299 / 300 / 999 / 1000 / 9999 / 10000 ms × both contexts. *(Done in the reference impl — see [loading-tier.ts](../../src/utils/loading-tier.ts).)*

**P0-2 — Core indicator set:** optimistic (none), skeleton, inline button spinner, branded moment.

**P0-3 — Structure identical across brands.** No brand branching in indicator logic.

**P0-4 — Skin via a single accent token.** Brand accent through one token; branded tier may carry richer character.

**P0-5 — Zero hardcoded color.** No hex/RGB in loader code; everything via the design-token system.

**P0-6 — Reduced-motion fallback on every animation,** collapsing to static-but-present, same a11y label.

**P0-7 — ARIA contract per tier** (button: `aria-busy` + label + disabled; skeleton: `role=status` + `aria-busy` + polite + "Loading <thing>"; branded: `role=status` + polite + label narration; determinate: `role=progressbar` + values).

**P0-8 — One shared implementation per platform;** in-scope screens migrate and legacy is removed.

### Nice-to-Have (P1)
- **P1-1** Determinate progress bar tier (honest fill).
- **P1-2** Branded narration cycling (accessible).
- **P1-3** Telemetry hooks (`tier`, `elapsed`, in-flight count).
- **P1-4** Focus management on resolve.
- **P1-5** Concurrency/error/cancellation semantics (stack to highest tier; error sticks; cancel resets clean).

### Future Considerations (P2)
- **P2-1** Per-touchpoint branded artwork variants.
- **P2-2** Third brand/skin (architectural insurance).
- **P2-3** Localized narration.
- **P2-4** CI guard failing on new hardcoded loading color / missing reduced-motion block.

---

## Accessibility Requirements (P0, not polish)

- **WCAG 2.3.3:** every animated loader honors reduce-motion — the single largest current gap.
- **Status announcement** via polite live region; resolution perceivable.
- **No motion-only information**; static fallback conveys the same busy state.
- **Determinate progress** exposes value semantics.
- **Automated coverage:** a test under simulated reduce-motion asserts loaders are static; CI-enforced.

---

## Success Metrics

### Leading (days–weeks)
| Metric | Target |
|---|---|
| Touchpoint coverage on shared system | 100% in-scope |
| Reduced-motion coverage | 100% |
| ARIA coverage | 100% in-scope |
| Sub-300ms "flash" rate | ≈ 0% |
| Competing implementations per platform | → 1 |

### Lagging (weeks–months)
| Metric | Target |
|---|---|
| Abandonment at priority flows | Measurable reduction vs. baseline |
| Perceived performance / satisfaction | Improvement vs. baseline |
| WCAG 2.3.3 loading audit | Pass (0 violations) |
| "App is frozen/stuck" support contacts | Reduction |
| Loading-related maintenance cost | Reduction |

Set success + stretch targets once baselines are pulled (p50/p75/p95/p99 per touchpoint).

---

## Scope by Surface

| Surface | In scope (v1) |
|---|---|
| Native iOS | Engine + indicators + a11y + tokens; migrate in-scope screens |
| Native Android | Same, mirrored, parity-tested |
| Booking web | Adopt official design-system loader/skeleton; close ARIA + reduced-motion |
| **Reference implementation (this repo)** | Full standard built natively as the working proof |

**Out of scope:** non-owned overlays (documented); non-loading animation; latency reduction.

---

## Reference Implementation (this repo)

This two-league app has the same essential shape as the primary surface — **one codebase, two brand skins** — so it's the proving ground for the standard.

**Status — Phase 1 built:**
- Tokenized stylesheet: [src/styles/loading.css](../../src/styles/loading.css)
- Primitives: [Spinner](../../src/components/shared/loading/Spinner.astro) · [Skeleton](../../src/components/shared/loading/Skeleton.astro) · [ThinkingDots](../../src/components/shared/loading/ThinkingDots.astro) · [BrandedLoader](../../src/components/shared/loading/BrandedLoader.astro)
- Engine + JS builders: [loading-tier.ts](../../src/utils/loading-tier.ts) · [loading-html.ts](../../src/utils/loading-html.ts)
- **Clickable prototype:** [loading-prototype.astro](../../src/pages/theleague/loading-prototype.astro) — every tier under both skins side by side, plus a duration-escalation simulator.

**What it proves for the primary surface:** the duration ladder + `f(elapsed, context)` rule work in practice; **structure/skin holds with zero code branching** (the same components reskin per brand through one token — verified: spinner border resolves blue under TheLeague, red under AFL); the token / reduced-motion / ARIA contracts are implementable and testable; and stakeholders get a real artifact to react to before native investment.

---

## Milestones & Phasing

| Phase | Outcome | Exit criteria |
|---|---|---|
| **0 — Foundation** | Standard + inventory + roadmap | Documented; touchpoints mapped ✅ |
| **1 — Primitives** | Shared components + prototype | Render under both skins; reduced-motion + a11y; engine parity-tested ✅ |
| **2 — Low-risk leaves** | Migrate isolated loaders | Visual parity; legacy removed per item |
| **3 — High-traffic** | Migrate content + action buttons | Double-submit prevention; ARIA present |
| **4 — Branded tier** | Wire 10s+ moment to AI/long-wait | Fires past threshold; narration accessible; static fallback ships with animation |
| **5 — Delete & enforce** | Remove legacy; CI guard | Inventory shows only the shared system |

Phases 2–4 overlap; migrate → verify → delete in the same change. No risky cutover. Full detail: [loading-roadmap.md](loading-roadmap.md).

---

## Dependencies & Risks

**Dependencies:** design-token system supplies accent/surface/shimmer/scrim/motion tokens; design delivers branded artwork + static reduced-motion variant per brand; telemetry provides percentile wait data.

**Risks:** artwork delays (mitigate: placeholder shell, drop-in slot) · large legacy migration (additive, wave-based) · embedded overlay collisions (delegation contract) · a11y regressions over time (CI guard P2-4) · token gaps (early request, placeholders).

---

## Open Questions

- **[Data]** Real p50/p75/p95/p99 per priority touchpoint? *(blocks final ladder placement + baselines)*
- **[Design]** Long-wait motif per brand, animated + static assets confirmed? *(blocks Phase 4 finish)*
- **[Design systems]** Which tokens exist vs. need creating? *(non-blocking; placeholders)*
- **[Product]** Confirm canonical brand-moment touchpoints. *(blocks Phase 4 scope)*
- **[Engineering]** Sequencing to retire the largest legacy loader path. *(non-blocking early)*
- **[Platform owners]** Do secondary surfaces adopt or delegate? *(affects final coverage number)*

In this repo specifically, the LLM-backed endpoints (Schefter generation, Ask Roger, news digest, rules-chat) are the natural homes for the branded 10s+ tier.

---

## Appendix

**Glossary** — *Tier*: a rung of the ladder. *Context*: `content` vs `discreteAction`. *Structure/Skin*: behavior+ARIA (shared) vs accent+artwork (per brand). *Branded moment*: the single 10s+ skinned tier.

**Repo links** — [loading-standards.md](loading-standards.md) · [loading-inventory.md](loading-inventory.md) · [loading-roadmap.md](loading-roadmap.md) · prototype: `/theleague/loading-prototype`

**Source of truth** — `~/code/product-ops/product-exploration/loading-indicators/PRD.md` and its sibling research docs.
