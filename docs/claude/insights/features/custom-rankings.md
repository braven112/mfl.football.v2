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

---

## 2026-08-27 - The Board Became the My Draft List Importer/Exporter

**Context:** `/cr` was an admin-only experiment seeded from the composite. It
now pulls from and pushes to MFL's `myDraftList` for every owner, and is
gated only by league membership.

**The board must seed its own ranking sources.** `syncBuiltinImports()` was
called from the Import Rankings page and NOWHERE else, so a browser that had
never opened that page had no built-ins, therefore no composite, therefore an
empty board. With the board's only two seeds being the composite and MFL, an
owner with no MFL draft list had no way to build one — the exact owner the
importer exists for. It presented as "push does nothing" (the empty-board guard
fired) and the true fault was three steps upstream. If a page depends on
localStorage state that another page populates, it must populate it too:
`tests/draft-list-board-seeding.test.ts` pins the call AND its ordering against
the composite read, because seeding after the read is the same bug.

**Availability is asked from one owner's seat, not the league's.** The Free
Agents page defines `rostered` as "held in EVERY conference" — unavailable to
anybody. A draft board must ask "held in MINE". The AFL is a duplicate-player
league and 60 of its 108 rostered players sit on two rosters at once, so a
player held only in the other conference is fully draftable by you. Same shared
math (`afl-conference-rosters.mjs`), deliberately different predicate — don't
collapse them. It fails closed: an untrustworthy roster payload hides the
filter rather than hiding players wrongly.

**Draft pool comes from `league.draftPlayerPool`, and rookies are `status: "R"`
in the players feed** — a flag present only for the current league year, which
is exactly what MFL drafts on. TheLeague is `Rookie` (237 draftable), the AFL
is `Both` (2,525 for a franchise in either conference).

**The availability filter limits the push; the position filter must not.**
Availability is a fact about the league; position is a way of reading the
board, and pushing while looking at QBs would replace an owner's whole MFL list
with quarterbacks. The narrowing lives in `selectPushablePlayers()` as a pure
function of (order, pool) precisely so the position filter is not one
identifier away from reaching it.

**A live board is mostly undraftable in a rookie league.** TheLeague's board
seeded from veteran-heavy ranking sources carried 22 draftable rookies out of
237 that exist. The filter is honest about it, but the board is a thin place to
draft from — seeding a rookie-pool league from the draftable pool rather than
the composite is the open follow-up.
