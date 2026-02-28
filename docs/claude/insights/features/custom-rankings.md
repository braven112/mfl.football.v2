# Custom Rankings — Insights

## 2026-02-28 - @dnd-kit Drag-and-Drop Gotchas

**Context:** Implementing drag-and-drop player reordering with @dnd-kit.

**Insight:** Three things can silently break @dnd-kit dragging:
1. `overflow: hidden` on the sortable container clips dragged elements — they appear to not move
2. `restrictToParentElement` modifier constrains drag movement too aggressively
3. Wrapping sortable items in extra `<div>` elements (instead of `React.Fragment`) confuses position tracking

**Evidence:** User reported "I see the handles but the players don't move." Root cause was all three issues combined. Fix: remove `overflow: hidden` from `.cr-list`, remove `restrictToParentElement`, use `React.Fragment` for item wrappers.

**Recommendation:** When using @dnd-kit:
- Only use `restrictToVerticalAxis` modifier for vertical lists
- Never add `overflow: hidden` to the sortable container
- Use `React.Fragment` (not wrapper divs) when interleaving non-sortable content between sortable items
- Follow the working pattern in `ManageImportsSection.tsx`

---

## 2026-02-28 - Upstash Redis for Serverless KV Storage

**Context:** Needed cross-device persistence without managing a database.

**Insight:** Upstash Redis works well as a simple KV store for Vercel serverless functions. The `@upstash/redis` package auto-reads `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` env vars. No connection management needed — each request is a standalone HTTP call.

**Evidence:** `src/pages/api/cr.ts` — GET/POST endpoint using `redis.get()` and `redis.set()` with key pattern `cr:{franchiseId}`.

**Recommendation:** For small per-user state (<10KB) that needs cross-device sync, Upstash Redis via `@upstash/redis` is simpler than a database. Key pattern: `{feature}:{userId}`.

---

## 2026-02-28 - Edit Mode Pattern for Touch-Safe Drag-and-Drop

**Context:** Users accidentally dragging players on mobile/desktop needed prevention.

**Insight:** @dnd-kit supports dynamically switching sensors. Using `useSensors()` (empty) when not editing and `useSensors(PointerSensor, KeyboardSensor)` when editing completely disables drag without unmounting the sortable context.

**Evidence:** `RankingList.tsx` — `const noSensors = useSensors(); const editSensors = useSensors(PointerSensor, KeyboardSensor);` then `sensors={isEditing ? editSensors : noSensors}`.

**Recommendation:** For any drag-and-drop list that shouldn't always be draggable, use the empty-sensors pattern rather than conditionally rendering `DndContext`.

---

## 2026-02-28 - Mobile Touch Targets for Hidden-on-Hover UI

**Context:** Tier insert zones used CSS `:hover` which doesn't work on touch devices.

**Insight:** Any UI that relies on hover for discoverability needs a mobile fallback. For tier insert zones: always visible at reduced opacity (0.4) on mobile, with `:active` state for full opacity feedback. For drag handles: always visible at 0.5 opacity (no hover-to-reveal).

**Evidence:** `src/styles/custom-rankings.css` `@media (max-width: 640px)` section — `.cr-tier-insert { opacity: 0.4; height: 20px; }` and `.cr-row__handle { opacity: 0.5; }`.

**Recommendation:** Audit all hover-dependent UI for touch fallbacks. Pattern: reduced-but-visible opacity on mobile, `:active` for interaction feedback, minimum 28-32px touch targets.

---

## 2026-02-28 - Composite Hash for Staleness Detection

**Context:** Custom rankings seed from composite data that can change when user modifies imports.

**Insight:** A hash of the composite configuration (member IDs + player count) reliably detects when the source data changed. On mismatch, `mergeWithOverrides()` re-seeds from the new composite while preserving players the user manually moved.

**Evidence:** `src/utils/custom-rankings-seeding.ts` — `computeCompositeHash()` uses sorted member IDs + player count. `mergeWithOverrides()` rebuilds the list: overridden players keep their relative order, new players slot in at composite position, removed players are dropped.

**Recommendation:** For any feature that derives from user-configured source data, store a hash of the source config alongside the derived state. This enables automatic reconciliation without losing user customizations.
