# Schefter Trade-Bait Rumors

**Status:** Planning
**Date:** 2026-04-22
**Parent plan:** [schefter-rumor-mill.md](./schefter-rumor-mill.md)
**Sibling:** [schefter-trade-offer-rumors.md](./schefter-trade-offer-rumors.md)

## TL;DR

When owners add players to their MFL trade block (the "trade bait" list — signaling availability, not an offer), Schefter turns that into natural rumor-mill posts. Core mechanic: a **settle window** debounces per-franchise activity so a dump of six players fires as one clustered post, not six. Adds that cancel out within the window emit nothing. Structured payload (position counts + names + owner comments) lets the LLM pick the right voice: single name on one-offs, positional-theme language on clusters. Launches with a **silent seed only** — no announcement post; the feature debuts on the first real owner delta post-deploy.

---

## Goals & Non-Goals

**Goals**
- Detect adds/removes on every franchise's trade block
- Fire one post per settled franchise-dump, not one per player
- Let the LLM naturally say "Hall hit the block" on singletons and "RB fire sale in Pacific" on clusters
- Launch without flooding the feed with ~17 pre-existing listings
- Surface MFL `willGiveUp`/`willTake` owner comments when present

**Non-Goals**
- Not replacing the pending-trade rumor lane (different trigger, different voice)
- No per-player "still on the block after N days" nagging in v1 (layer later if wanted)
- No reverse-lens "who's shopping" tipster analysis — the owner *wants* this known, attribution is fine

---

## Architecture Overview

```
┌─ fetch-trade-bait.mjs (prebuild + cron)    ┐
│   writes per-franchise snapshot             │
│                                              │
├─ schefter-scan.mjs (cron, every 15m)         ├──► tip queue ──► schefter-rumor-scan.mjs
│   diffs current vs. committedBlock,          │      (Redis)      (existing flow, gossip bucket)
│   respects SETTLE_WINDOW,                    │
│   emits ONE source='trade_bait' tip per     │
│   settled franchise with all net adds        │
└──────────────────────────────────────────────┘
```

The trade-bait detector lives in `schefter-scan.mjs` alongside the existing pending-trade watcher (same cadence, same feed state file, same posting pipeline). It does **not** bypass the gossip cap — trade-bait is attributable gossip, not a transactional event.

---

## Data Layer Changes

### 1. Richer fetch shape

`scripts/fetch-trade-bait.mjs` currently flattens the MFL response to a bare `string[]` of player IDs (line 82), discarding the franchise mapping. Extend it to preserve structure in a new file, keeping the existing flat cache intact for the UI:

```jsonc
// data/theleague/mfl-feeds/<year>/tradeBait-by-franchise.json
{
  "fetchedAt": 1714000000000,
  "franchises": {
    "0001": {
      "playerIds": ["15255", "16610"],
      "willGiveUpComment": "Looking for WR depth, pref dynasty.",
      "willTakeComment": "Any early-round rookie pick."
    },
    "0005": { "playerIds": ["13593"] }
  }
}
```

The flat `tradeBait.json` stays as-is (UI dependencies, caching contract).

### 2. Feed-state extension

Add to `feed.json` next to `pendingTradeWatermark`:

```jsonc
{
  "tradeBaitState": {
    "0001": {
      "committedBlock": ["15255", "16610"],
      "observedBlock":  ["15255", "16610", "16195"],
      "firstChangeTs":  1714000000000,
      "lastChangeTs":   1714000900000
    }
  }
}
```

- `committedBlock` — what we last told the rumor mill about
- `observedBlock` — what we saw on MFL at the last scan
- `firstChangeTs` / `lastChangeTs` — drift timers; null when the franchise is settled

---

## Per-Scan Detection Logic

For each franchise in the fetch result:

```
current      = currentBlock set (from fetch)
state        = feed.tradeBaitState[franchiseId]

// Update drift timers
if current != state.observedBlock:
  state.lastChangeTs  = now
  if !state.firstChangeTs: state.firstChangeTs = now
  state.observedBlock = current

// Compute net deltas
netAdds    = current - state.committedBlock
netRemoves = state.committedBlock - current

// Settled case — no drift either direction
if netAdds empty AND netRemoves empty:
  clear state.firstChangeTs, state.lastChangeTs
  continue

// Still drifting
if now - state.lastChangeTs < SETTLE_WINDOW:
  continue   // quiet, come back next scan

// Settled after drift — emit (or silently sync)
if netAdds not empty:
  emitTradeBaitTip(franchiseId, netAdds, netRemoves, ownerComments)
state.committedBlock = current
clear state.firstChangeTs, state.lastChangeTs
```

**Why this works:**
- Owner dumps 6 players over 20 min → each scan resets `lastChangeTs` → one post after 45 min of quiet.
- Owner adds X then removes X within the window → `netAdds` never includes X → silent.
- Pure removes → no tip, watermark absorbs silently.
- Re-adds (list → remove → list) → silent remove advances `committedBlock`, re-add re-surfaces as netAdds, fires. Correct.

---

## Tunable Constants

| Constant | Default | Rationale |
|----------|---------|-----------|
| `SETTLE_WINDOW_MS` | 45 min | Long enough to consolidate a cleanup session, short enough that lone listings hit the feed within an hour |
| `MAX_SETTLE_WAIT_MS` | 6 hr | Safety cap — if an owner tweaks their block all day, force-emit once rather than holding forever |
| `MIN_ADDS_TO_FIRE` | 1 | No floor; single player is valid breaking news |
| `MAX_ADDS_PER_TIP` | 10 | Defensive — if someone dumps 20 players, truncate and flag so the LLM doesn't list them all |

`MAX_SETTLE_WAIT_MS` fires when `now - firstChangeTs >= MAX_SETTLE_WAIT_MS`, regardless of `lastChangeTs`. Belt + suspenders.

---

## Tip Payload Contract

Structured data in + concise English `text` = LLM picks the right voice.

```ts
{
  id: 'sf_tradebait_<franchiseId>_<fireTs>',
  source: 'trade_bait',
  topic: 'trade_bait',            // NEW topic key — don't collide with web 'trade' tips
  attributable: true,
  author: '<Franchise Name>',
  franchiseHint: '<franchiseId>',
  submittedAt: <fireTs>,
  text: 'Pacific Pigskins added to block: Breece Hall (RB, age 26), '
      + 'Josh Jacobs (RB, age 27), Kenneth Walker (RB, age 25). '
      + "Owner note: 'looking for WR depth.'",
  meta: {
    adds: [
      { id: '15255', name: 'Breece Hall', pos: 'RB', nflTeam: 'NYJ', age: 26 },
      { id: '16610', name: 'Josh Jacobs', pos: 'RB', nflTeam: 'LV',  age: 27 },
      { id: '13593', name: 'Kenneth Walker', pos: 'RB', nflTeam: 'SEA', age: 25 }
    ],
    removes: [],                  // context only; usually not surfaced
    byPos:   { RB: 3 },           // precomputed counts
    totalAdds: 3,
    ownerWillGiveUp: 'looking for WR depth',
    ownerWillTake:   ''
  }
}
```

### LLM voice directive (added to Rumor Mill Mode prompt)

> **trade_bait tips** are owners publicly listing players on the block. Attribution IS allowed — name the franchise. Use `meta.byPos` and `meta.totalAdds` to pick framing:
> - **totalAdds === 1** → lead with the player's name. "Hall hit the block."
> - **totalAdds >= 3 AND one position ≥ 60% of byPos** → positional theme. "RB fire sale in <division>." Name 2–3 headliners max.
> - **totalAdds >= 3 mixed** → "spring cleaning" / "roster purge" framing. Name the 2 biggest names.
> - When `meta.ownerWillGiveUp` or `meta.ownerWillTake` is non-empty, you MAY quote or paraphrase — these are public owner notes on MFL, not anonymous tips.
> - Never invent a listing date — MFL doesn't expose one. Use present tense.

---

## Post CTA — Trade Builder, Not Tip Page

Every rumor post today carries a single CTA: `link = TIP_PAGE_PATH` / `linkLabel = "Got a tip? Whisper to Schefter →"` (`schefter-rumor-scan.mjs:182-184, 1917-1918`). GroupMe payloads append `TIP_PAGE_ABSOLUTE_URL`.

For trade_bait posts this is the wrong destination — a reader who sees "Pigskins dumped three RBs" wants to open the block in the trade builder, not the tip form.

**Override contract** (driven off the primary bucket):

- When the primary bucket is a `trade_bait` bucket with a single `franchiseHint`, override the post:
  - `link` → `/theleague/trade-builder?b=<franchiseHint>`
  - `linkLabel` → `Open in Trade Builder →` (generic — franchise name is already in the body via attribution)
  - GroupMe suffix → absolute trade-builder URL (`${PUBLIC_BASE_URL}/theleague/trade-builder?b=<franchiseHint>`) in place of the tip-page URL
- Any other bucket (including mixed buckets that happen to include a trade_bait tip) retains the existing tip-page CTA.
- Trade-builder query-param precedent: `rosters.astro:2413` / `:6981` already link with `?b=<franchiseId>` — same convention.

**Implementation note:** simplest to compute both CTAs per post and pick based on primary-bucket introspection in the same block that sets `link`/`linkLabel` today (`schefter-rumor-scan.mjs:1901-1920`). Expose a helper like `resolveCta(primaryBucket)` returning `{ link, linkLabel, groupMeUrl }` so the post-build site and the `groupMeTextFor` builder stay in sync.

## Bucket Integration

Reuses the existing rumor-scan bucketing with minimal changes:

- Bucket key: `topic:trade_bait:<franchiseId>` — one bucket per franchise per cycle
- Bucket kind: `gossip` (competes for gossip cap, not trade-offer lane)
- Priority: standard `bucketPriorityScore` (size + age) — a trade-bait tip with 5 adds will naturally out-rank a single-source web gossip tip
- Quiet hours: respected (held until 7am PT)

No changes needed to `pickPrimaryBucket` — the existing gossip-bucket selection handles it.

---

## Initial Release Strategy

**Problem:** 17 players currently on the block. A naive first run would interpret all 17 as fresh adds and flood.

**Decision:** silent seed only. No kickoff post, no launch announcement — the feature starts existing, and the first real owner delta is the first post.

### Silent seed (automatic, first run)

On the first detection pass where `feed.tradeBaitState` is absent or a franchise has no entry:
- Set `committedBlock = currentBlock` for every franchise
- Set `observedBlock = currentBlock`
- Leave drift timers null
- Emit **nothing**

Next real delta (post-seed) is the first real post. Clean debut; no noise.

### Rejected: hand-fired kickoff post

Earlier draft included a `--kickoff-trade-bait` CLI flag for a "State of the Block" snapshot post on launch day. Dropped in favor of letting the feature surface organically on the first real owner action. If demand materializes later, the flag is an easy additive layer — state schema + tip payload already support it.

---

## Edge Cases & Guards

| Case | Handling |
|------|----------|
| Franchise adds + removes same player mid-window | `netAdds` stays empty. Silent. |
| Franchise adds X, we emit, then removes X | Silent remove. `committedBlock` drops X. Future re-add fires again correctly. |
| MFL fetch fails | Skip this cycle. Don't touch state. Retry next scan. |
| Franchise has willGiveUp comment change with no player change | Currently ignored. Comment updates alone don't fire a post. (Could surface later if noisy enough.) |
| `MAX_ADDS_PER_TIP` exceeded | Truncate `meta.adds` to the top 10 by salary/age rank. Set `meta.truncated = true` so LLM hedges. |
| State file corrupted / missing mid-run | Treat as seed event for affected franchises. Silent. |
| Franchise removed entirely from league | Drop from `tradeBaitState` on next scan (defensive, unlikely). |
| Player traded while on block | MFL drops them from tradeBait automatically. `netRemoves` absorbs silently. |

---

## Files to Create / Modify

**Modify:**
- `scripts/fetch-trade-bait.mjs` — preserve franchise mapping, emit new `tradeBait-by-franchise.json` alongside existing flat cache
- `scripts/schefter-scan.mjs` — new detector section mirroring the pending-trade watcher
- `scripts/schefter-rumor-scan.mjs` — recognize `source: 'trade_bait'` and `topic: 'trade_bait'` in bucketing + anonymization (bypass anonymization since `attributable: true`)
- `.claude/agents/schefter.md` (or the rumor-mill skill doc) — add trade_bait voice directive block

**New:**
- `data/theleague/mfl-feeds/<year>/tradeBait-by-franchise.json` — fetch output (generated, gitignored if desired)
- `tests/trade-bait-detector.test.ts` — unit tests for the diff/settle logic (pure function)

**Test cases to lock in:**
1. First-run seeds silently
2. Single add → fires after SETTLE_WINDOW with 1 player
3. Six adds over 20 min → one post with all 6
4. Add + remove same player within window → silent
5. Add, settle, fire, then remove → silent remove, `committedBlock` updated
6. Re-add after silent remove → new post fires
7. `MAX_SETTLE_WAIT_MS` force-fires when drift never stabilizes
8. Pure removes never fire
9. CTA override — trade_bait primary bucket sets `link = /theleague/trade-builder?b=<franchiseId>`; non-trade_bait buckets keep tip-page CTA

---

## Phased Rollout

### Phase 1 — Detector + silent seed
- Extend fetch script with franchise mapping
- Add detector + state schema to `schefter-scan.mjs`
- Pure unit tests for diff/settle logic
- Deploy with silent seed; verify no posts fire on first runs
- Wait 1–2 owner actions to validate end-to-end

### Phase 2 — Voice tuning
- Add `trade_bait` directive to rumor-mill prompt
- Verify clustering language vs. singleton language on real posts
- Iterate on prompt if voice is off

### Phase 3 (future) — Staleness surfacing
- Track `listedAt` per player from state
- Optional post: "X has been on the block for 3 weeks with no takers"
- Opt-in; easy to layer once v1 is stable

### Phase 4 (future, if demand) — Hand-fired "State of the Block" post
- Restore the `--kickoff-trade-bait` path if we later decide an announcement post is worth it
- State schema + tip payload already support it; purely additive

---

## Risks & Open Questions

1. **Owner comments as attack vector.** `willGiveUp`/`willTake` are free-form owner text. The LLM will paraphrase them. Low risk — owners wrote those comments for public consumption — but worth flagging: don't let the LLM treat comments as adjudicated facts. The prompt should hedge ("the Pigskins say they're…").

2. **Fetch frequency.** Existing trade-bait fetch is prebuild-only. The detector needs it on every 15-min scan cycle, not just prebuild. Either call the fetcher inline from `schefter-scan.mjs` or schedule it as a sibling cron.

3. **Owner who strategically adds 1 player/day.** They could monopolize the feed (7 posts over 7 days). Mitigation: existing gossip cap (3/day, 4hr spacing) already protects. No special logic needed.

4. **Pending-trade overlap.** If a player is on the block AND then gets traded, two posts fire (trade_bait rumor, then pending-trade rumor). Acceptable — they're distinct events. Revisit if it feels redundant in practice.

5. **First-scan timing vs. deploy window.** If deploy lands mid-cleanup (owner tweaking block at that exact moment), the seed captures a transient state. Minor — `MAX_SETTLE_WAIT_MS` and the next real delta recover. Not worth engineering around.

---

## Success Criteria

- First two weeks post-launch: zero flood events (>3 trade_bait posts in a single day)
- Single-player adds fire as single-player posts (no generic cluster framing)
- Multi-player dumps of one position fire as positional-theme posts (verified by eyeballing 3+ examples)
- Kickoff post lands cleanly with no follow-up flood on the next scan cycle
- Owner comments surface at least once in the first month's posts (proves the pathway works)

---

**Next step:** Brandon confirms scope + SETTLE_WINDOW default (45 min). Then implement Phase 1 detector with unit tests; deploy with silent seed; observe.
