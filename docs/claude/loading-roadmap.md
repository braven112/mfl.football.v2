# Loading State Roadmap

**Status:** Phase 0 complete (this doc, the [standard](loading-standards.md), and the [inventory](loading-inventory.md)). Phases 1+ are not yet started.

The migration is **purely additive until the final wave** — new components ship alongside the old ones, screens move over one at a time, and legacy code is deleted only after its replacements are proven. There is no risky cutover, so there's no rollback playbook to write; the safety mechanism is "the old path still exists until the new one is verified."

---

## Phase 0 — Standards & inventory ✅ (this phase)

**Done:** the duration ladder, structure/skin model, token/ARIA/reduced-motion contracts, the planned component API, and a complete tagged inventory.

**Exit criteria:** all three docs written and cross-linked; CLAUDE.md section added; inventory file paths resolve against the repo. No runtime code changed.

---

## Phase 1 — Build the shared primitives

Build the components described in [loading-standards.md](loading-standards.md) "Planned component API," mirroring the `PlayerCell` dual Astro + JS pattern. **No screen migrations yet** — just the toolkit plus a demo/reference.

- `src/styles/loading.css` — tokenized, custom-prop-driven, reduced-motion guard baked in.
- `Spinner.astro`, `Skeleton.astro`, `ThinkingDots.astro` (extracted from `SchefterReplyThread`), `BrandedLoader.astro`.
- `src/utils/loading-html.ts` — `buildSpinnerHTML()` / `buildSkeletonHTML()` with `esc()`.
- `src/utils/loading-tier.ts` — `resolveLoadingTier(elapsedMs, context)` pure function + unit tests.
- `useLoadingState()` React hook.

**Exit criteria:** primitives render under both `data-league` skins; reduced-motion verified; `resolveLoadingTier` unit-tested at every threshold boundary (0 / 299 / 300 / 999 / 1000 / 9999 / 10000 ms × both contexts); a reference page demonstrates all tiers.

---

## Phase 2 — Migrate low-risk leaves

Replace the safest, most isolated implementations first to prove the components in production with minimal blast radius.

- The 5 spinners (start with `PlayerNewsModal`'s hardcoded-hex one).
- The `.sb-spinner` cluster (already shares CSS — low effort).
- `SocialEmbed`, `SuggestionBox`, `CustomRankingsPage` text loaders → skeletons.

**Exit criteria:** each migrated screen visually matches or improves on the old one; no console errors; both leagues correct; legacy CSS for the migrated item removed in the same PR.

---

## Phase 3 — Migrate high-traffic content & actions

- Roster / free-agent / results tables → `Skeleton`.
- The playoffs shimmer (both leagues) → `Skeleton` **with the reduced-motion guard it currently lacks**.
- Button-loading states: `lineup`, `rosters`, `ContractDeclarationModal`, trade-builder modals, suggestions composers, `DraftQueuePanel`.

**Exit criteria:** the ~18 text-mutation sites and 3 CSS button-loading states converted; double-submit prevention verified on every form; ARIA labels present.

---

## Phase 4 — Branded 10s+ tier for AI endpoints

Build the tier-5 narrated moment and wire it to the LLM-backed touchpoints (Schefter generation, Ask Roger, news digest, rules-chat). This is the one tier that carries league character — design the motif/voice per league via `--league-accent` and brand copy.

**Exit criteria:** branded moment fires only above the 10s threshold; narration cycles via `aria-label` updates; reduced-motion static fallback ships with the animated asset.

---

## Phase 5 — Delete legacy & enforce

- Remove the last hand-rolled spinners, shimmer keyframes, and one-off loading CSS.
- Standardize the ~14 `aria-live` regions to the ARIA contract.
- Consider a lightweight guard (lint rule or test) against new hardcoded loading CSS / missing reduced-motion guards, so the standard doesn't erode.

**Exit criteria:** grep for the retired class names (`.sb-spinner`, `.ptp-skeleton`, `.rqa-input__spinner`, ad-hoc `@keyframes shimmer/spin`) returns only the shared system; What's New / weekly changelog entry if any of this is guest-visible.

---

## Sequencing notes

- Phases 2–4 can overlap; they're independent clusters from the [inventory](loading-inventory.md).
- Every phase keeps the old path alive until its replacement is verified — migrate, verify, then delete in the same PR.
- Telemetry (p75/p95 per touchpoint) would sharpen which operations truly need skeleton vs. branded tier; not a blocker, but worth wiring if/when available.
