# Schefter Trade-Offer Rumors (Phase 6 addendum)

**Status:** Planning
**Date:** 2026-04-16
**Parent plan:** [schefter-rumor-mill.md](./schefter-rumor-mill.md)

## TL;DR

When owners send trade offers to each other (offer phase, not yet commish-approval), Schefter sometimes posts a vague rumor — position or pick only, never player names or specific teams. Owners who offer more get more column inches: a weighted probability tier rewards activity. Makes league feel alive. Applies the same "salt, not sugar" restraint as the rest of the rumor mill.

## Can we see the data?

Yes. MFL's `GET /{year}/export?TYPE=pendingTrades&L=13522` returns every open offer in the league when called with the commish `MFL_USER_ID` cookie. Existing code already does this in Phase 1 ([scripts/schefter-scan.mjs:555+](scripts/schefter-scan.mjs)). Each row includes:

- `offerId` — unique id, stable until acceptance/rejection/expiration
- `offeredBy` + `offeredTo` — franchise ids
- `willGiveUp` + `willReceive` — comma-separated asset strings (player ids, draft picks like `DP_01_03`, BBID entries)
- `timestamp` — submitted time
- `expires` — auto-expiry time
- Commish-approval status (present only once accepted by counter-party) — this is the existing Phase 1 trigger

We want a **different state**: offers that exist but haven't been accepted yet. Same endpoint, filter rows WITHOUT the approval-pending flag, and treat them as "offers in flight."

## Weighting Rules

Per owner, rolling 7-day window:

| Offers in last 7 days | P(post triggers) for the new offer |
|-----------------------|-----------------------------------|
| 1st | 40% |
| 2nd | 80% |
| 3rd | 80% |
| 4th+ | 80% (cap, don't inflate further) |

Probability is rolled **per new offer**, not per owner per week. An owner who sends 3 offers gets 3 dice rolls (40%, 80%, 80%). On average ≈2 posts from that owner. A single-offer owner has ≈40% chance of one post. Active owners become rumor fixtures; casual owners stay background noise.

Counts **toward** the daily rumor-mill cap (3/day). Trade-PENDING (commish approval) posts still bypass the cap — different bucket.

## Player Escalation Rule (CRITICAL)

Track `schefter:player_offer_history:{playerId}` as a sorted set of `{offeringFranchiseId, timestamp}` entries, rolling 21-day (3-week) window. Count **distinct offering franchises** for each player in that window:

| Distinct teams received offer for same player in last 3 weeks | What Schefter can say |
|--------------------------------------------------------------|----------------------|
| 0–2 | Base vagueness rules apply. No player-specific language. |
| **3** | **"Tightened circle" mode** — Schefter can hint more directly at the player's trait or archetype ("an aging WR with one big year left in him", "a power RB", "a QB with something to prove"). Still no name. Can reference position + rough tier. |
| **4+** | **"Everyone knows" mode** — Schefter can name the player, but the framing is still rumor with plausible deniability. Must use hedge language ("I'm told…", "just smoke", "nothing confirmed", "still fluid"). Never asserts a deal is close — only that the player's name keeps coming up. |

This mirrors how real beat reporters escalate: the first whispers stay source-protected, but once "everyone already knows", the reporter can surface the name without burning the source.

**Storage:** use MFL `player_id` (stable). Key TTL 30d, entries older than 21d pruned on each insert via `ZREMRANGEBYSCORE`.

## Schefter Voice Playbook

All rumor posts inherit these — enforced via the LLM system prompt.

**Openers (pick one, rotate):**
- "I'm told…"
- "Hearing…"
- "Per source…"
- "Quietly…"
- "Plenty of noise around…"
- "One to watch…"
- "File this under 'developing' but…"

**Hedges (always include at least one when naming a player):**
- "Still just smoke."
- "Nothing imminent."
- "Barring a last-minute change…"
- "To be determined."
- "Or not. We'll see."

**Closers (pick one):**
- "Developing."
- "More to come."
- "Stay tuned."
- "We'll see."
- "Here we go."
- "One to watch."

**Rhythm rules:**
- Short sentences. Staccato. Three beats.
- Drop the subject when you can. ("Done deal." not "It's a done deal.")
- Commas sparingly — a period usually works.
- 2–4 sentences TOTAL per post.

**Claude's humor layer (season lightly, never overdo):**
- Dry observational asides ("Classic April behavior.", "That's what negotiation looks like.")
- Self-aware bot wink every 5th post or so ("I see all the phones. Don't ask how.")
- League-insider ribbing when the tip clearly originates from volume ("Somebody's running up the league's Verizon bill.")
- Never cheesy. Never explain the joke.

## Vagueness Rules (CRITICAL)

Schefter's trade-offer posts MUST NOT reveal:
- Player names (any player on either side)
- Specific franchise names on either side
- Exact draft pick round/slot

Schefter CAN reveal:
- **Position involved** — "a running back", "an aging wideout", "a QB" (pulled from player map via player id in assetString)
- **Draft pick year + round only** — "a future first", "a 2027 second" (derived from `DP_{round}_{slot}` pattern — strip slot)
- **Division or regional hint** — only if 2+ distinct offers happened in the division this week; otherwise just "a league owner"
- **Volume cue** — "keeping the phones warm", "making another run at it" for 2+ offers this week from same hasher

Example outputs:
- 1st offer, WR involved, 2027 first included: *"Hearing someone's dangling a future first and a wideout around — early-week window-shopping or serious business? Developing."*
- 2nd offer from same owner, includes RB: *"The same owner that was poking around earlier this week is back at it — this time with a running back on the table. Squeaky wheel gets the tampering fine."*

## Anonymization Architecture

Add a "source redaction" layer that runs before the LLM:
1. For every offer, resolve `willGiveUp` + `willReceive` to **position tokens** and **pick tokens only**. Never pass player names or franchise names to the LLM.
2. Attach a `volumeHint` field derived from the owner's 7d offer count: `first_offer | repeat_offer | serial`.
3. Attach `divisionHint` only when the weekly division offer count ≥ 2.

Prompt additions explicitly forbid team/player disclosure. System prompt includes refusal examples.

## Redis Schema

| Key | Type | Purpose | TTL |
|-----|------|---------|-----|
| `schefter:trade_offers:seen` | Set | offerIds already evaluated (dice rolled) — prevents double-rolling on polling lag | 30d |
| `schefter:trade_offers:owner:{franchiseId}` | Sorted set | `{ts, offerId}` entries for dice-based counting; prune entries older than 7d on each insert | — |
| `schefter:trade_offers:div:{division}` | Sorted set | Same pattern, for division hint | — |

## Scanner Integration

Fold into existing [scripts/schefter-rumor-scan.mjs](scripts/schefter-rumor-scan.mjs) as a new input source, alongside tips and GroupMe mentions. Per run:

1. Fetch `pendingTrades` (reuse Phase 1 fetch)
2. Filter to offers in the "offered" state (NOT already commish-approval pending)
3. For each offer not in `schefter:trade_offers:seen`:
   - Add to `seen` (30d TTL)
   - Count owner's offers in last 7d (sorted set `ZCOUNT`)
   - Roll probability per table above
   - If roll passes → redact to position/pick tokens → push a synthesized `Tip` into the rumor-mill queue with `source: 'trade_offer'`, `attributable: false`, `topic: 'trade'`, redacted text
   - If roll fails → still record the offer in sorted sets (so future dice rolls count it), just don't queue a tip
4. The existing rumor-mill scanner then processes the queue normally (subject to 3/day cap, 4h spacing, 1h marinate)

## Edge Cases

- **Offer withdrawn before Schefter posts**: harmless — tip is in-queue, post fires regardless. Feature, not a bug: the rumor is still "true" (offer was made).
- **Offer expires naturally**: same as withdrawn. Watermark handles dedup.
- **Counter-offer** (new offerId, same franchises): treated as a fresh offer, gets its own dice roll. Probably desirable — active negotiation = more rumor fuel.
- **Offer accepted**: it moves to commish-approval state, Phase 1 handles that separately. No double-post (different `transactionSubType`).
- **Trade rejected by counter-party**: no rumor — only surface actual outgoing offers, not the rejection.
- **Commish runs a trade (no offer flow)**: bypasses this system. Not a leak to worry about.

## Type Additions

Extend [src/types/schefter-tips.ts](src/types/schefter-tips.ts):
```ts
export type TipSource = 'web' | 'groupme' | 'trade_offer';

export type TradeOfferTip = Tip & {
  source: 'trade_offer';
  attributable: false;
  volumeHint: 'first_offer' | 'repeat_offer' | 'serial';
  positionTokens: string[];         // ['RB', 'WR']
  pickTokens: string[];             // ['2027 1st', '2026 3rd']
  divisionHint?: string;            // only if division active
  offerId: string;                  // for audit only, never to LLM
};
```

## Phases

### Phase 6a — Detection + counters (no posting)
- Add offer polling + sorted-set tracking
- Log dice roll outcomes without queuing tips
- Run for a week to confirm volume + distribution feels right
- **If the numbers are way off** (e.g. league averages 30 offers/week so Schefter would post 12x/day), tune probabilities DOWN before enabling posting

### Phase 6b — Redaction + queuing
- Position/pick token resolution
- Tip synthesis + queue push
- LLM prompt update with redaction rules

### Phase 6c — Live
- Flip `SCHEFTER_TRADE_OFFER_RUMORS_ENABLED=1`
- Monitor for anonymity leaks — any post that names a player or team gets the feature killed instantly

## Risks

1. **Position + pick combo can deanonymize.** If only one owner in the league has a specific aging WR they're known to shop, "a wideout and a future first" telegraphs the trade. Mitigation: the volume hint and division hint never combine with specific assets in the same post — either describe volume OR describe assets, not both unless 2+ distinct trades match the pattern this week.

2. **Post fatigue.** If the probabilities produce too many posts, the 3/day cap absorbs the overflow but tips get stale (24h expiry). Acceptable — Schefter posting once about yesterday's offers is better than spamming.

3. **Gambling tell.** If a rumor fires and an owner recognizes their own offer, they know Schefter can see offers. Not a real risk — owners already assume the commish and Schefter see everything.

## Deliverables (when we execute)

- New scanner step in `scripts/schefter-rumor-scan.mjs`
- Extended tip types
- New Redis keys documented
- New env var: `SCHEFTER_TRADE_OFFER_RUMORS_ENABLED`
- Detection-only dry-run mode for Phase 6a
- Two screenshots / sample posts for Phase 5 What's New entry

## Out of Scope

- Surfacing trade-offer data in the UI (would break anonymity guarantee for any other owner who reads the page)
- Post-mortem posts when a trade gets accepted (Phase 1 already handles that lane)
- Individual-owner tip opt-out (add only if an owner complains)
