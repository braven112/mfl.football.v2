# Schefter Tip Page — Engagement Plan

Status: proposed — 2026-04-18
Owner: Brandon
Related: [schefter-rumor-mill.md](../../.claude/plans/schefter-rumor-mill.md) · [schefter-trade-offer-rumors.md](../../.claude/plans/schefter-trade-offer-rumors.md)

## Overview

The tip page at [/theleague/schefter/tip](../../src/pages/theleague/schefter/tip.astro) is currently a static form that drops an anonymous tip into a Redis queue and forgets. This plan turns it into a persistent, engaging surface — with personal history, social proof, and a feedback loop from the rumors it produces.

### Goals
- Reward owners who tip, without compromising anonymity.
- Close the loop between a tip and the rumor it seeds (so owners see their influence).
- Create cross-rumor narrative threads so storylines compound across days.
- Never widen the de-anonymization surface for admins or light tippers.

### Non-goals
- No public identity disclosure. Every feature preserves the one-way `hashTipsterId()` contract.
- No changes to the marinate/rate/fuzz rules defined in the original Rumor Mill plan.

---

## Codebase context

### Existing infrastructure (reuse)
| Capability | File |
|---|---|
| Tip form + submit handler | [src/pages/theleague/schefter/tip.astro](../../src/pages/theleague/schefter/tip.astro) |
| Tip API (validation, rate limit, Redis queue) | [src/pages/api/schefter/tip.ts](../../src/pages/api/schefter/tip.ts) |
| Tip types + constants | [src/types/schefter-tips.ts](../../src/types/schefter-tips.ts) |
| Tipster hash (one-way) | [src/utils/schefter-tipster-hash.ts](../../src/utils/schefter-tipster-hash.ts) |
| Scanner / rumor generator | [scripts/schefter-rumor-scan.mjs](../../scripts/schefter-rumor-scan.mjs) |
| Feed storage | [src/data/theleague/schefter-feed.json](../../src/data/theleague/schefter-feed.json) |
| Reaction store (hash per post) | [src/utils/schefter-reactions.ts](../../src/utils/schefter-reactions.ts) |
| Reaction API (GET/POST) | [src/pages/api/schefter-reactions.ts](../../src/pages/api/schefter-reactions.ts) |
| Allowed emoji set | `SCHEFTER_REACTIONS` in [src/types/schefter.ts](../../src/types/schefter.ts) |
| News feed page (rumor cards) | [src/pages/theleague/news/index.astro](../../src/pages/theleague/news/index.astro) |

### Redis key catalog (current)
| Key | Purpose |
|---|---|
| `schefter:tips:queue` | LPUSH tip queue drained by the scanner |
| `schefter:tips:first_tip_ts` | Marinate-timer anchor (SET NX on queue transition empty → non-empty) |
| `schefter:tips:ratelimit:{hashedOwnerId}` | INCR per-owner daily counter with 24h TTL |
| `schefter:reactions:{postId}` | Hash of emoji → `franchiseId[]` |

### Cloud infra (Vercel + Upstash)
All features in this plan target the existing Vercel deployment. Redis is Upstash (REST URL in `UPSTASH_REDIS_REST_URL`). No new infrastructure needed.

---

## Phases

Eleven changes, sequenced by dependency and shipping velocity. First sprint is P0 + Quick Wins + Reactions; second sprint is Scorecard + Whisper Back; remainder as needed.

### P0 — Admin rate-limit fix (MUST SHIP FIRST)

**Problem.** [src/pages/api/schefter/tip.ts:181-204](../../src/pages/api/schefter/tip.ts) exempts `isCommissionerOrAdmin(user)` from the 3-tips-per-24h cap. Once any counter surface exists (Phase 1, Phase 6, etc.), an admin going over 3 is immediately identified — their own scorecard or tips-left widget becomes a de-anonymization oracle.

**Fix.** Remove the admin exemption. Everyone is capped at 3/24h, full stop.

**Files:**
- [src/pages/api/schefter/tip.ts](../../src/pages/api/schefter/tip.ts) — delete `const isAdmin = …` branch, always run the INCR + expire logic.

**Acceptance:**
- Admin user sending a 4th tip in 24h gets `429 rate_limited` (same body as a regular owner).
- No code path can surface a "tips used today" count greater than 3 for any user.

**LOE: XS** (15 min).

---

### Phase 1 — Tips-left counter

**What.** "2 of 3 tips left today" chip on the tip page. Submit button disables at 0.

**Files:**
- NEW: [src/pages/api/schefter/tips-remaining.ts](../../src/pages/api/schefter/tips-remaining.ts)
  - `GET` reads `schefter:tips:ratelimit:{hashedOwnerId}`. Returns `{ used: number, remaining: number, resetsAt?: number }`.
  - Auth required. Hashes the user id the same way the submit endpoint does.
- [src/pages/theleague/schefter/tip.astro](../../src/pages/theleague/schefter/tip.astro) — new chip near the submit button; fetch on mount; refetch after a successful submit.

**Acceptance:**
- Counter matches reality after each submit (including a 429).
- Shows "resets in Xh Ym" when at 0.
- Never shows >3.

**LOE: S** (2hr). Depends on P0.

---

### Phase 2 — Last rumor dropped

**What.** Sidebar line: "Last rumor: 3 hours ago — 'Hearing the Northwest is buzzing…'".

**Files:**
- [src/pages/theleague/schefter/tip.astro](../../src/pages/theleague/schefter/tip.astro) — server-side pull of the most recent `subType === 'rumor_mill'` post from the feed JSON, render in the sidebar.

No new API or Redis keys — feed JSON is already imported on this page.

**Acceptance:**
- Correct timestamp + headline snippet for the newest rumor.
- Hides gracefully when no rumor has ever been posted.

**LOE: XS** (45 min).

---

### Phase 3 — Rotating placeholder prompts

**What.** Textarea placeholder changes with the selected topic:
- `trade` → "e.g. Hearing the Northwest is shopping their 1st for a vet WR…"
- `roster` → "e.g. Somebody in the East just gave up on their rebuild…"
- `prediction` → "e.g. Calling it now — Breece Hall isn't making it through Week 8…"
- `commish` (Beef) → "e.g. The Commish keeps scheduling the auction when I'm on vacation. I see you."
- `other` → "Tell me what's brewing."

**Files:**
- [src/pages/theleague/schefter/tip.astro](../../src/pages/theleague/schefter/tip.astro) — client-side `change` handler on `#tip-topic` that swaps `textarea.placeholder`.

**LOE: XS** (30 min).

---

### Phase 4 — Good tip vs. bad tip examples

**What.** Collapsible sidebar card explaining the fuzzing — shows an example raw tip beside what Schefter would actually print.

**Content (copy):**
- **Example 1 — Single-source franchise mention**
  - Tip: "The Magicians are shopping their 1.03 for a WR."
  - What Schefter prints: "Sources in the East whisper that a franchise is dangling a top rookie pick for WR help. Developing."
- **Example 2 — Multi-source franchise mention**
  - Tip (plus one other owner on the same team): "The Magicians are shopping their 1.03."
  - What Schefter prints: "League sources tell me multiple owners are talking about the Dark Magicians. Worth watching."
- **Example 3 — Commish**
  - Tip: "The Commish is sandbagging the trade review window."
  - What Schefter prints: "Word around the league is the commissioner's office is drawing some static. Developing."

**Files:**
- [src/pages/theleague/schefter/tip.astro](../../src/pages/theleague/schefter/tip.astro) — new `<details>` card in the right rail.

**LOE: XS** (1hr, mostly copywriting).

---

### Phase 5 — React to rumor

**What.** On rumor-mill cards in the news feed, show a reaction picker scoped to four semantic verdicts: `🔥 smoke`, `💯 confirmed`, `🤔 fake news`, `📉 cooked`. Existing reactions infra stores + counts.

#### Anonymity tweak (required)

Today `src/utils/schefter-reactions.ts` stores `franchiseId[]` per emoji — so other users can see who reacted. For rumor posts, seeing "Pigskins reacted 🔥" creates a soft signal about who's paying attention and could correlate with tip patterns.

**Option A (recommended, smaller)** — Add an anonymous mode to the reactions module.
- `toggleReactionAnonymous(postId, hashedOwnerId, emoji)` — identical API but keys go through the tipster hash.
- Display path returns counts only (never the id list) for rumor posts.

**Option B (bigger)** — Fork rumor reactions into a dedicated `schefter:rumor_reactions:{postId}` key with only counts (no member list). Simpler data model but duplicates code.

Pick **A**.

**Files:**
- [src/utils/schefter-reactions.ts](../../src/utils/schefter-reactions.ts) — new `toggleReactionAnonymous()` + `getAnonymousReactions()` exports. Use `hashedOwnerId` as list member.
- [src/pages/api/schefter-reactions.ts](../../src/pages/api/schefter-reactions.ts) — accept `anonymous: true` in the POST body; branch to the new functions; never return `userReaction` for anonymous posts (client can still tell via a boolean).
- [src/types/schefter.ts](../../src/types/schefter.ts) — add `SCHEFTER_RUMOR_REACTIONS = ['🔥', '💯', '🤔', '📉']`; export `isValidRumorReaction()`.
- [src/components/theleague/schefter/RumorCard.astro](../../src/components/theleague/schefter/RumorCard.astro) (new or wherever rumor cards render) — use the restricted emoji set and call the anonymous endpoint.

**Acceptance:**
- Reactor identity is never in the response for rumor posts.
- Counts are accurate. Same owner can toggle within the 4-emoji set.
- Existing non-rumor feed reactions are unaffected.

**LOE: S** (2–3hr). +S if scanner reads prior-rumor reactions to tune the next post's tone (Phase 5.1, optional).

---

### Phase 6 — Anonymous tipster scorecard

**What.** Personal + leaderboard view of tipster activity, keyed only by `hashedOwnerId`.

#### Redis schema
| Key | Type | Purpose |
|---|---|---|
| `schefter:tipster:codename:{hashedOwnerId}` | STRING | Stable codename ("Deep Throat", "Burner Phone", "Unnamed Source") |
| `schefter:tipster:rumors_total:{hashedOwnerId}` | INT (STRING) | Lifetime count of rumor posts this tipster seeded |
| `schefter:tipster:rumors_season:{season}:{hashedOwnerId}` | INT (STRING) | Per-season count (season = `YYYY` league year) |
| `schefter:tipster:leaderboard:{season}` | ZSET | `hashedOwnerId` scored by season rumor count |

#### Codename generation
Deterministic from hash so the same user always gets the same codename without storing identity:
1. On first tip, call `getOrCreateCodename(hashedOwnerId)`:
   - If `schefter:tipster:codename:{hashedOwnerId}` exists, return it.
   - Else derive `slot = parseInt(hashedOwnerId.slice(0,6), 16) % CODENAMES.length`, pick `CODENAMES[slot]`; append a `#N` suffix to guarantee uniqueness (check a `schefter:tipster:codename_index` hash that maps codename → assigned count).
   - SET NX the result.
2. Codename list — ~30 entries like `Deep Throat`, `Burner Phone`, `Back-Channel`, `The Leak`, `The Whisper`, `Unnamed Source`, `Smoke Signal`, `Off the Record`, `Anonymous #17`. Kept in [src/utils/schefter-codenames.ts](../../src/utils/schefter-codenames.ts) (new).

#### Scanner hook
In [scripts/schefter-rumor-scan.mjs](../../scripts/schefter-rumor-scan.mjs), after a rumor post is committed to the feed:
```js
const contributors = new Set();
for (const tip of batch) {
  if (tip.source === 'web' && tip.hashedOwnerId) contributors.add(tip.hashedOwnerId);
}
await Promise.all([...contributors].map(async (hid) => {
  await redis.incr(`schefter:tipster:rumors_total:${hid}`);
  await redis.incr(`schefter:tipster:rumors_season:${seasonYear}:${hid}`);
  await redis.zincrby(`schefter:tipster:leaderboard:${seasonYear}`, 1, hid);
  await getOrCreateCodename(hid);
}));
```
GroupMe and `trade_offer` tips are skipped (no hashed owner).

#### API
- NEW: [src/pages/api/schefter/tipster-stats.ts](../../src/pages/api/schefter/tipster-stats.ts)
  - `GET` auth required.
  - Returns:
    ```json
    {
      "me": { "codename": "Deep Throat #2", "rumorsTotal": 3, "rumorsSeason": 2 },
      "leaderboard": [
        { "codename": "Deep Throat #1", "rumorsSeason": 7 },
        ...up to 10
      ],
      "seasonYear": 2026
    }
    ```
  - The `me` block hashes the user id server-side. The leaderboard returns codenames only — never the hash.

#### UI
- [src/pages/theleague/schefter/tip.astro](../../src/pages/theleague/schefter/tip.astro) — two new sidebar cards:
  1. "Your record" — codename + lifetime + season counts.
  2. "Top tipsters this season" — top 10 by codename + count.

**Acceptance:**
- Never exposes `hashedOwnerId` or `userId` in any response.
- Counters only increment when a rumor is actually posted (not per tip).
- Codename stable for the same user across sessions.
- Leaderboard respects the 3/day cap from P0 — max contributable = `3 * days`.

**LOE: M** (6–8hr). Depends on P0.

---

### Phase 7 — Whisper back

**What.** Threaded follow-up tips. From any rumor card, an owner can drop a reply tip scoped to that rumor. Scanner groups threaded tips together and Schefter calls out continuity ("Following up on yesterday's Northwest chatter…").

#### Type changes
[src/types/schefter-tips.ts](../../src/types/schefter-tips.ts):
```ts
export interface Tip {
  // ...existing fields
  /** Rumor post id this tip is a follow-up to. Optional. */
  repliesToPostId?: string;
}
```

Also in [src/types/schefter.ts](../../src/types/schefter.ts), rumor posts gain an optional `threadId`:
```ts
export interface SchefterPost {
  // ...existing
  threadId?: string; // UUID per thread; first post in thread == threadId
}
```

#### Redis
| Key | Type | Purpose |
|---|---|---|
| `schefter:thread:{threadId}` | ZSET | `postId` scored by postedAt, for permalink thread view |
| `schefter:thread_of:{postId}` | STRING | Resolves a rumor post → its threadId (for fast lookup when a whisper-back arrives) |

Thread TTL: 14 days of inactivity (refreshed on new post).

#### API
- [src/pages/api/schefter/tip.ts](../../src/pages/api/schefter/tip.ts) — accept `repliesToPostId?: string`. Validate:
  - Post id exists in the feed and is of subType `rumor_mill`.
  - Not older than 14 days.
  - Counts toward the 3/24h cap.
- Scanner anonymization step passes `threadId` through in each tip's `safe` object. When a batch contains whisper-backs, the rumor post gets the `threadId` set (reuse the parent's threadId or create one).
- NEW: [src/pages/api/schefter/thread.ts](../../src/pages/api/schefter/thread.ts) `GET ?id={threadId}` returns the ordered list of rumor posts in the thread.

#### Scanner grouping
In `anonymizeTips()`, tips with the same `repliesToPostId` group under a new scope kind:
```js
{ kind: 'thread-followup', parentHeadlineSnippet: '…', parentScope: '…' }
```
LLM instructions gain a rule: when any tip has `scope.kind === 'thread-followup'`, open with continuity language ("Following up on yesterday's report…"). Still respects single-source fuzz rules.

#### UI
- Rumor card — "Whisper back" button that opens a mini tip form pre-filled with `repliesToPostId`.
- Rumor permalink ([src/pages/theleague/news/[id].astro](../../src/pages/theleague/news/%5Bid%5D.astro)) — if the rumor has a `threadId`, render the rest of the thread inline (chronological).

**Acceptance:**
- Rate limit still enforced. Whisper-backs count.
- Thread continuity language appears when ≥1 whisper-back is in a batch.
- Fuzz rules unchanged — a thread of single-source franchise whispers still generalizes to division.
- Thread view degrades gracefully when posts are deleted.

**LOE: L** (1 day). Stacks on Phase 6 (whisper-backs should increment the tipster scorecard just like original tips).

---

### Phase 8 — Rumor cooker timeline

**What.** "Schefter is marinating 2 tips. Next rumor drops around 8:42pm." Live client-side countdown.

**Files:**
- NEW: [src/pages/api/schefter/cooker-status.ts](../../src/pages/api/schefter/cooker-status.ts)
  - `GET` public (no auth needed — no identity info).
  - Reads `schefter:tips:queue` length + `schefter:tips:first_tip_ts`.
  - Returns `{ queueDepth: number, marinateStartedAt: number | null, nextEarliestPostAt: number | null }`. Marinate period = 1 hour.
- [src/pages/theleague/schefter/tip.astro](../../src/pages/theleague/schefter/tip.astro) — sidebar card with countdown.

**Acceptance:**
- Never reveals tip content or tipster.
- Shows "Quiet right now" when queue is empty.
- Respects the existing "at most 3 rumors per day" cap — if daily cap is hit, say so.

**LOE: S** (3hr).

---

### Phase 9 — Hot topics this week

**What.** Chips showing which topics are buzzing in the last 7 days: "Beef 🔥 12", "Trade interest 🔥 8".

#### Redis
| Key | Type | Purpose |
|---|---|---|
| `schefter:topic_counts:7d` | HASH | `topic` → rolling count |

Cron (new, daily at 00:05 UTC): decay each count by ~14% (roughly 1/7) to approximate a 7-day exponential window. Alternatively, use a ZSET keyed by timestamp for exact rolling count — pick exact if perf allows.

#### Scanner hook
In `tip.ts`, after successful enqueue: `HINCRBY schefter:topic_counts:7d {topic} 1`.

#### API + UI
- NEW: [src/pages/api/schefter/hot-topics.ts](../../src/pages/api/schefter/hot-topics.ts) returns sorted topic counts.
- Tip page sidebar card "Trending" — chips rendered from the response.

**LOE: M** (5hr).

---

### Phase 10 — Tip of the week

**What.** Weekly badge recognizing the tip that produced the most-read rumor.

**Blocker:** We don't track rumor reads today. Implementing this requires:
1. Impression tracker on `rumor_mill` posts (client-side beacon to `/api/schefter/rumor-impression`).
2. Weekly cron to pick the top-read rumor, look up its `tipIds`, award a badge to each contributing `hashedOwnerId`.

**Defer** unless analytics infra gets built for other reasons.

**LOE: L** (1.5 days).

---

## Shipping order (recommended)

### Sprint 1 — "Living surface" (1 day)
1. **P0** admin rate-limit fix
2. Phase 1 — Tips-left counter
3. Phase 2 — Last rumor dropped
4. Phase 3 — Rotating placeholders
5. Phase 5 — React to rumor
6. Phase 4 — Good/bad examples (copywriting)

### Sprint 2 — "Identity + continuity" (2 days)
7. Phase 6 — Anonymous tipster scorecard
8. Phase 7 — Whisper back

### Sprint 3 — "Polish" (as priorities allow)
9. Phase 8 — Rumor cooker timeline
10. Phase 9 — Hot topics
11. Phase 10 — Tip of the week (only after impression tracking exists)

---

## Testing plan

### Automated (vitest)
- `tests/schefter-tip-api.test.ts` — P0 cap applies to admins; Phase 1 response shape; Phase 7 `repliesToPostId` validation.
- `tests/schefter-tipster-stats.test.ts` — Phase 6 Redis mutations; codename determinism; leaderboard returns no raw hashes.
- `tests/schefter-reactions-anonymous.test.ts` — Phase 5 never returns reactor identity for rumor posts.

### Manual (preview deploy)
- Sign in as admin → confirm 4th tip in 24h gets 429.
- Submit a tip → scanner runs → confirm the scorecard increments exactly once.
- Whisper back on a 15-day-old rumor → confirm rejection.
- React on a rumor card → confirm count updates without revealing reactor identity.

### Security review
- Scan all new API responses for any leak of `user.id`, raw `franchiseId` on rumor reactions, or `hashedOwnerId`.
- Confirm rate limit is shared between original tips and whisper-backs.

---

## Deployment (cloud)

All phases deploy through the standard Vercel pipeline:

1. Work in a worktree branch, push to preview: invoke `/test` skill.
2. Verify on the Vercel preview URL (auth cookies propagate from production — use an alt MFL account for rate-limit testing).
3. Merge to `main` via `/live` skill.

No new environment variables required for any phase; all Redis keys use the existing `UPSTASH_REDIS_REST_*` credentials.

---

## Open questions

- **Codename flavor** — go with Schefter-voiced ("Deep Throat", "Back-Channel") or something more fantasy-football-native ("The Rodney Dangerfield", "Manish Mehta")? Decision needed before Phase 6.
- **Rumor reaction emoji set** — lock at 4 (🔥 💯 🤔 📉) or allow a wider vocabulary? Four keeps the verdict meaningful; more makes the page livelier.
- **Thread TTL** — 14 days proposed. Longer = better storylines; shorter = fresher. Confirm before Phase 7.
- **What's New entry** — the scorecard + whisper-back deserve individual entries with screenshots. Quick wins can be bundled into a single "Tip page gets louder" entry.

---

## Appendix — Sprint 1 one-PR diff outline

For anyone implementing Sprint 1 as a single PR, touched files:

```
src/pages/api/schefter/tip.ts                       # P0 (-6 lines)
src/pages/api/schefter/tips-remaining.ts            # Phase 1 NEW
src/pages/theleague/schefter/tip.astro              # Phases 1, 2, 3, 4
src/pages/api/schefter-reactions.ts                 # Phase 5
src/utils/schefter-reactions.ts                     # Phase 5
src/types/schefter.ts                               # Phase 5
src/components/theleague/schefter/RumorCard.astro   # Phase 5 (likely new)
tests/schefter-tip-api.test.ts                      # NEW
tests/schefter-reactions-anonymous.test.ts          # NEW
src/data/whats-new.json                             # NEW entry
public/assets/whats-new/tip-page-living-surface.webp # NEW screenshot
```

Estimated total: 1 working day including verification.
