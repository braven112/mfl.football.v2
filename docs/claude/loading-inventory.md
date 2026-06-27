# Loading State Inventory & Migration Map

**Status:** Phase 0 audit. This is the complete catalog of every loading state on the site today, each tagged with its **target tier** and **target component** under the [Loading State Standard](loading-standards.md). It is the migration map for [loading-roadmap.md](loading-roadmap.md).

**Headline finding:** there is **no shared loading infrastructure**. Every pattern is implemented in isolation — 5 distinct spinners, 1 real skeleton, 1 duplicated shimmer, ~18 ad-hoc loading-text mutations, ~11 one-off disabled-button patterns, 3 CSS button-loading approaches. `SaveIndicator` is the only reusable loading-adjacent component, and it's used once. The closest thing to shared spinner CSS is `.sb-spinner`, defined in a page file rather than an importable module.

---

## 1. Spinners → one `Spinner` (tier 2/3)

Four/five distinct inline CSS spinners, each defined per-file, no shared component.

| File | Class / mechanism | Notes | Target |
|---|---|---|---|
| [src/components/theleague/PlayerNewsModal.astro](../../src/components/theleague/PlayerNewsModal.astro) | `.spinner` div, `border-top: 3px solid #3b82f6` | **Hardcoded hex** — the token-contract anti-pattern. Paired with "Fetching latest news…" | `Spinner` + `var(--league-accent)` |
| [src/components/theleague/LoginForm.astro](../../src/components/theleague/LoginForm.astro) | `.login-form__spinner` span, class toggle + `aria-busy` | Also referenced in `Header.astro` nav login (text-only there) | `Spinner` in button-loading |
| [src/components/theleague/InjuryManager.astro](../../src/components/theleague/InjuryManager.astro) | `.ir-move-button.loading` `::after` pseudo, `color: transparent` text trick | Most complete non-React button loader | button-loading pattern |
| [GifPicker.tsx](../../src/components/theleague/suggestions/GifPicker.tsx) / [ImageUploader.tsx](../../src/components/theleague/suggestions/ImageUploader.tsx) / [IdeaComposer.tsx](../../src/components/theleague/suggestions/IdeaComposer.tsx) | `.sb-spinner`, CSS in [suggestions.astro](../../src/pages/theleague/suggestions.astro) | Shared across 3 components but CSS lives in the page; has reduced-motion guard | `Spinner` |
| [AskInput.tsx](../../src/components/shared/rules-chat/AskInput.tsx) | `.rqa-input__spinner`, CSS duplicated in both [theleague/rules-chat.astro](../../src/pages/theleague/rules-chat.astro) + [afl-fantasy/rules-chat.astro](../../src/pages/afl-fantasy/rules-chat.astro) | Driven by `isLoading` prop | `Spinner` (+ tier 5 for the AI wait) |

---

## 2. Skeletons / shimmer → one `Skeleton` (tier 4)

| File | Mechanism | Reduced-motion guard? | Target |
|---|---|---|---|
| [PendingTradesPanel.tsx](../../src/components/theleague/trade-builder/PendingTradesPanel.tsx) | `.ptp-skeleton` cards, `@keyframes ptp-pulse`, container `aria-busy` | **Yes** (line 724) — the best existing impl, use as the model | `Skeleton` |
| [theleague/playoffs.astro](../../src/pages/theleague/playoffs.astro) | `@keyframes shimmer` sweep | **No guard** — fix on migration | `Skeleton` |
| [afl-fantasy/playoffs.astro](../../src/pages/afl-fantasy/playoffs.astro) | duplicated shimmer | **No guard** — fix on migration | `Skeleton` |

---

## 3. Loading-text mutations → button spinner / tier rules

~18 ad-hoc text swaps. Most become a button-loading state; sub-300ms ones should show **nothing** per the ladder.

| File | Text | Target |
|---|---|---|
| [trade-builder/LoginModal.tsx](../../src/components/theleague/trade-builder/LoginModal.tsx) | "Signing in…" | button-loading |
| [trade-builder/TradeConfirmationModal.tsx](../../src/components/theleague/trade-builder/TradeConfirmationModal.tsx) | "Sending…" | button-loading |
| [suggestions/IdeaComposer.tsx](../../src/components/theleague/suggestions/IdeaComposer.tsx) | "Posting…" | button-loading |
| [suggestions/CommentComposer.tsx](../../src/components/theleague/suggestions/CommentComposer.tsx) | "Posting…" | button-loading |
| [suggestions/PollCreator.tsx](../../src/components/theleague/suggestions/PollCreator.tsx) | "Creating…" | button-loading |
| [shared/SchefterReplyThread.tsx](../../src/components/shared/SchefterReplyThread.tsx) | "…" | button-loading |
| [draft-room/DraftQueuePanel.tsx](../../src/components/theleague/draft-room/DraftQueuePanel.tsx) | "Submitting…" | button-loading |
| [custom-rankings/SaveIndicator.tsx](../../src/components/theleague/custom-rankings/SaveIndicator.tsx) | "Saving…" | keep; align to standard |
| [Header.astro](../../src/components/Header.astro) | "Signing in…" (JS textContent) | button-loading |
| [theleague/lineup.astro](../../src/pages/theleague/lineup.astro) | "Submitting…" | button-loading |
| [theleague/rosters.astro](../../src/pages/theleague/rosters.astro) | "Submitting…" (×2) | button-loading |
| [theleague/playoffs.astro](../../src/pages/theleague/playoffs.astro) / [afl-fantasy/playoffs.astro](../../src/pages/afl-fantasy/playoffs.astro) | "Loading…" timestamp | optimistic / skeleton |
| [schefter/tip.astro](../../src/pages/theleague/schefter/tip.astro) | "Loading the board…", "Checking the Rolodex…" | skeleton / tier 5 |
| [shared/SocialEmbed.tsx](../../src/components/shared/SocialEmbed.tsx) | "Loading tweet/post…" | skeleton |
| [suggestions/SuggestionBox.tsx](../../src/components/theleague/suggestions/SuggestionBox.tsx) | "Loading ideas…" | skeleton |
| [custom-rankings/CustomRankingsPage.tsx](../../src/components/theleague/custom-rankings/CustomRankingsPage.tsx) | "Loading rankings…" | skeleton |
| [draft-room/DraftRoom.tsx](../../src/components/theleague/draft-room/DraftRoom.tsx) | Suspense fallback "Loading queue…" | skeleton |

---

## 4. CSS button-loading states → one standardized pattern (tier 3)

| File | Class | Treatment |
|---|---|---|
| [theleague/lineup.astro](../../src/pages/theleague/lineup.astro) | `.lineup-submit--loading` | opacity + text only, no spinner — duplicated in [afl-fantasy/lineup.astro](../../src/pages/afl-fantasy/lineup.astro) |
| [ContractDeclarationModal.astro](../../src/components/theleague/ContractDeclarationModal.astro) | `.cdm-submit.loading` | opacity only, no spinner |
| [InjuryManager.astro](../../src/components/theleague/InjuryManager.astro) | `.ir-move-button.loading` | `::after` spinner — promote this as the model |

Plus ~11 React components that only set `disabled` during fetch (no spinner): `SchefterReactionBar`, `SchefterWhisperBack`, `SchefterReplyThread`, trade-builder `LoginModal`/`TradeConfirmationModal`, suggestions `IdeaComposer`/`CommentComposer`/`PollCreator`/`ImageUploader`, `DraftQueuePanel`, `AskInput`.

---

## 5. Thinking-dots → `ThinkingDots` (tier 5 / AI)

| File | Mechanism | Target |
|---|---|---|
| [shared/SchefterReplyThread.tsx](../../src/components/shared/SchefterReplyThread.tsx) + [schefter-feed-compact.css](../../src/styles/schefter-feed-compact.css) | `.sfc-typing__dot` ×3, `@keyframes sfc-typing-bounce`, `role="status" aria-live="polite"`, has reduced-motion guard | **The most polished loading UX in the repo** — extract and promote to the AI/branded tier indicator |

---

## 6. Branded 10s+ tier (new — no current implementation)

The LLM-backed endpoints that genuinely run 5–15s+ and earn a tier-5 branded moment:

- **Schefter generation** (`scripts/schefter-*`, feed posts)
- **Ask Roger** — [src/pages/api/rules-qa.ts](../../src/pages/api/rules-qa.ts)
- **News digest / intel scanner**
- **Rules chat** — [theleague/rules-chat.astro](../../src/pages/theleague/rules-chat.astro), [afl-fantasy/rules-chat.astro](../../src/pages/afl-fantasy/rules-chat.astro)

These currently show only a spinner or text; they're the home for the branded narrated moment.

---

## 7. Accessibility live regions — fold into the ARIA contract

~14 existing `aria-live` / `role="status"` regions, inconsistent in usage: lineup (`#lineup-status`, `#lineup-announcer`, `#lineup-changes`), salary (`#salary-announcer`), dead-money (`#filter-announcer`), salary-history (`#chart-announcer`), players (`#auction-announcer`), projected-free-agents (`.pfa-showing`), nav drawer/footer commish regions, `LeagueSummaryTable`, `TradeAlertModal`, `ContractDeclarationModal`, `TradeBuilder.tsx`, `DraftRoom.tsx`. Keep these; standardize their labels per the ARIA contract.

---

## 8. Explicitly NOT loading — leave alone

Animated status indicators that signal live/active state, not waiting. Out of scope:

- `LiveScoringHero` `.lsh__pulse` ([live-scoring-hero.css](../../src/styles/live-scoring-hero.css)) — LIVE badge
- `TradeDeadlineHero` `.tdhero__pulse` ([trade-deadline-hero.css](../../src/styles/trade-deadline-hero.css)) — countdown
- Draft room on-the-clock / danger-timer pulses ([draft-room.css](../../src/styles/draft-room.css))
- `PlayerCell` eligible-avatar pulse ([player-cell.css](../../src/styles/player-cell.css)) — note: **lacks a reduced-motion guard**, worth fixing opportunistically but not a loading state

---

## Migration summary

| Cluster | Count | Target |
|---|---|---|
| Spinners | 5 distinct | one `Spinner` |
| Skeletons / shimmer | 3 (1 good, 2 unguarded) | one `Skeleton` |
| Loading-text mutations | ~18 | button-loading / tier rules |
| CSS button-loading | 3 + ~11 disabled-only | one button-loading pattern |
| Thinking-dots | 1 | `ThinkingDots` (extract) |
| Branded 10s+ | 0 (new) | `BrandedLoader` |
| a11y live regions | ~14 | fold into ARIA contract |
