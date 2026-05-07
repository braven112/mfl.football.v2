# Schefter Trade Speculation Posts (GroupMe)

## Context

Original idea #14 was a "Trade Block Matchmaker" — algorithm that takes everyone's `tradeBait.json` listings and surfaces viable two- and three-way trades. Brandon's reframe: **don't make this an interactive page; turn it into Schefter speculation posts that drop into GroupMe periodically.** Owners will use them for smack talk, jokes, and occasional "wait actually, let's do this" moments.

This is a content-generation feature, not a tool. Output is GroupMe posts (and Schefter feed entries) that read like:

> 🟡 **Schefter sources tell me…** *Pacific Pigskins are circling Wabbits TE Brock Bowers. They're sitting on Russell Wilson and a 2027 2nd, both said to be on the table. Sources note Wilson alone won't move it — there's likely a pick involved.*

The post is **speculation** — not a real trade offer. Built from `tradeBait.json` overlap + cap math + dynasty value diffs. Schefter's voice frames it as a rumor. Owners react in the GroupMe.

## Cadence

Two flavors:

1. **Daily quiet drops** — once a day at a randomized time (1 PM Pacific, ±2hrs jitter) drop ONE speculation post. Keeps the feed alive without being spammy.
2. **Block-buster Mondays** — every Monday at 11 AM Pacific, drop the **best three-way trade speculation** of the week. This is the marquee one — uses 3-team graph search and surfaces the most absurd-but-mathematically-viable swap.

## Routes / surfaces

- **GroupMe** — main delivery channel (where owners hang out)
- **Schefter feed** (`/news`) — same post drops into the feed for permanence
- **Each franchise's detail page** — pinned "Latest Trade Buzz" card in the trade-block section, showing the most recent speculation involving that franchise

## Data sources

All on disk already:

- `data/theleague/mfl-feeds/<year>/tradeBait.json` — explicit player listings owners are shopping. Has been fetched daily for years.
- `data/theleague/mfl-feeds/<year>/rosters.json` — current roster of each franchise (for cap math + finding match candidates)
- `data/theleague/mfl-player-salaries-<year>.json` — salaries (cap fit)
- `data/theleague/derived/franchise-history.json` — recent franchise form (post should reference: are they buyers or sellers?)
- ADP / KTC / RSP data — dynasty value for matching pieces fairly

## Speculation matching algorithm

`scripts/schefter-trade-speculation.mjs` runs daily:

### Step 1: Build "wants" and "haves"

For each franchise:
- **Wants** = positions they need (from existing `analyzeFreeAgentNeeds` utility) + players in their division they've been losing to (suggests hole)
- **Haves** = active `tradeBait.json` listings + roster bench depth at saturated positions

### Step 2: Two-team match search

For each pair (Buyer, Seller):
- Pick a "have" from Seller (high dynasty value)
- Find a return package from Buyer's "haves" that:
  - Hits Seller's "wants"
  - Is within 15% dynasty-value parity (use ADP/KTC + age curve)
  - Fits Seller's cap space
- Score the trade by:
  - Dynasty fit (how well it serves both sides)
  - Drama factor (rivals trading > random pair)
  - Cap-relief drama (does it dump a Brock Osweiler-tier contract?)
- Top 5 highest-scoring pairs become candidate posts

### Step 3: Three-team match search (Monday only)

Build a graph: every franchise's wants/haves as nodes. Find a 3-cycle where:
- A trades to B (B wants what A has)
- B trades to C
- C trades to A
- All three have ~equal dynasty value swings

Surface the best one weekly.

### Step 4: Quality gate

Reject any candidate that:
- Has shown up in actual MFL trade activity in the last 14 days (boring)
- Has been speculation-posted in the last 30 days (rotation)
- Has a participant who hasn't logged into the site in 14+ days (dead franchise)
- Involves a player on IR or with major injury status (insensitive)

### Step 5: Schefter blurb generation

Use Claude API. System prompt enforces:
- Schefter voice (mirror `data/schefter/league-lore.md`)
- Speculation framing — "sources tell me", "circling", "kicking the tires", "in talks"
- Lead with the marquee player; reference cap or pick context as the angle
- Cap at 3 sentences
- Never fabricate names of players not in the candidate package
- Tag both franchises with their `nameMedium` for GroupMe formatting

Sample outputs to aim for:

> 🟡 *Sources tell me Bring The Pain has been kicking the tires on Wabbits WR Drake London. The ask is steep — multiple sources point to Davante Adams and a 2027 1st as the starting point. Pain is short on cap room to absorb London's $14M, so a third team may need to facilitate.*

> 🟢 *Computer Jocks are signaling they want to win now. Sources say they've reached out to Maverick about a Patrick Mahomes / 2027 2nd swap. Maverick is reportedly listening — the pick alone isn't enough but Jocks might be willing to attach a bench piece.*

> 🔴 *Three-team buzz: Pigskins, Vitside, and Music City are reportedly working on a deal that would send Saquon to the Pigskins, Justin Jefferson to Vitside, and a haul of picks to Music City. None of the three have confirmed but sources say the framework is real.*

Color emojis for tier:
- 🔴 Three-team mega-deal (Mondays only)
- 🟡 Two-team blockbuster (high dynasty value)
- 🟢 Two-team value pick-up (depth move)

### Step 6: Posting

- Append to `src/data/theleague/schefter-feed.json` with `type: "trade-speculation"` and the franchises involved
- Post to GroupMe via the existing `scripts/schefter-groupme-listen.mjs` posting hook (or its underlying primitive — check current pattern). Include a deep link back to a specific Schefter feed post URL.
- Mark candidates as "consumed" in a small ledger (`data/theleague/derived/speculation-history.json`) so step 4's rotation gate works.

## Smack-talk hooks built in

The whole point is to bait owners into reacting. The blurbs should include conversational hooks owners can riff on:

- **Reference the rivalry** — "If this goes through, Pigskins-Vitside Week 11 just got spicier."
- **Reference cap pain** — "Music City would need to cut Brock Osweiler-tier money to fit the salary in."
- **Reference recent form** — "Coming off a 1-4 stretch, Music City is in pure asset-collection mode."
- **Tease at insider info** — "One source close to the deal says talks are in the 'mutual interest' phase."
- **Quote a fictitious agent or scout** — "An NL exec told me, 'this is the kind of move that ends with somebody getting roasted in GroupMe.'" *(meta humor)*

## Operational notes

- **GitHub Actions** — `.github/workflows/schefter-trade-speculation.yml`
  - Daily cron at 8 PM UTC = 1 PM Pacific (well within league active hours)
  - Monday cron at 7 PM UTC = noon Pacific for the three-team blockbuster
  - Both runs commit to main with the new feed entry + speculation-history ledger
- **Off-season behavior** — speculation actually increases during off-season (auction/draft prep is when trades happen). Don't disable seasonally.
- **Owner opt-out** — let any franchise mute speculation posts about themselves via a config field (e.g. `theleague.config.json`'s team config: `"speculationMute": true`). For owners who don't want to be public targets.

## Phasing

| Phase | Scope | Effort |
|---|---|---|
| 1 | Two-team matching algorithm + Schefter blurb generation + Schefter feed post (no GroupMe yet) | 1.5 days |
| 2 | GroupMe posting hook + speculation-history ledger for rotation | 0.5 day |
| 3 | Three-team match search + Monday block-buster cadence | 1 day |
| 4 | Per-franchise pinned "Latest Trade Buzz" card on detail pages | 0.5 day |
| 5 | Quality-gate refinements + dynasty-value model tuning against historical real trades | open-ended |

## Risk / failure modes

- **Posting a trade speculation that's offensive or insensitive** — the quality gate must catch IR/injury players. Sentiment review of generated blurbs.
- **Over-targeting one franchise** — rotation gate prevents posting about the same franchise twice in a 7-day window.
- **Stale `tradeBait.json`** — if an owner forgets to update their listings, our matching might be irrelevant. Display a "based on listings as of X" footnote on each post.
- **Owners getting tired of it** — start daily and dial down to 3x/week if signal-to-noise drops.

## Smack-talk ideas the user wants in the feed

(Pulled from Brandon's intent for the Friday tips digest reframe — these belong in the broader Schefter content engine, not just speculation posts. Captured here so we have one source of truth for "what content does Schefter generate.")

See `docs/plans/schefter-smack-talk.md` for the full ideas list.
