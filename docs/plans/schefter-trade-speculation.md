# Schefter Trade Speculation Posts (GroupMe)

> **Scope note (post-Phase-2):** Three-team / cycle speculation is **out of
> scope** for this plan. Only two-team speculation ships. Any mention of
> three-team / 3-way / 3-cycle in earlier drafts is historical — the matcher
> only enumerates two-team candidates.

## Context

Original idea #14 was a "Trade Block Matchmaker" — algorithm that takes everyone's `tradeBait.json` listings and surfaces viable two-team trades. Brandon's reframe: **don't make this an interactive page; turn it into Schefter speculation posts that drop into GroupMe periodically.** Owners will use them for smack talk, jokes, and occasional "wait actually, let's do this" moments.

This is a content-generation feature, not a tool. Output is GroupMe posts (and Schefter feed entries) that read like:

> 🟡 **Schefter sources tell me…** *Pacific Pigskins are circling Wabbits TE Brock Bowers. They're sitting on Russell Wilson and a 2027 2nd, both said to be on the table. Sources note Wilson alone won't move it — there's likely a pick involved.*

The post is **speculation** — not a real trade offer. Built from `tradeBait.json` overlap + cap math + dynasty value diffs. Schefter's voice frames it as a rumor. Owners react in the GroupMe.

## Cadence

**Daily quiet drops** — once a day at a randomized time (1 PM Pacific, ±2hrs jitter) drop ONE two-team speculation post. Keeps the feed alive without being spammy. NFL-calendar-aware cadence (`scripts/lib/speculation-cadence.mjs`) ramps the frequency up around the trade deadline / draft / FA windows and dials it down in quiet stretches.

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

### Step 3: Quality gate

Reject any candidate that:
- Has shown up in actual MFL trade activity in the last 14 days (boring)
- Has been speculation-posted in the last 30 days (rotation)
- Has a participant who hasn't logged into the site in 14+ days (dead franchise)
- Involves a player on IR or with major injury status (insensitive)

### Step 4: Schefter blurb generation

Use Claude API. System prompt enforces:
- Schefter voice (mirror `data/schefter/league-lore.md`)
- **Local-media / fan-chatter framing** — the speculation does NOT come from
  owners or front offices. It comes from beat writers, talk-radio callers,
  fan boards, and barstool chatter. Schefter REPORTS on that buzz; he is
  not relaying a leak from inside either team. Both front offices should be
  framed as silent or non-committal ("neither front office has commented",
  "[team] hasn't acknowledged", "this isn't coming from the building").
- Phrases to lean on: "the talk-radio crowd in [team]-country", "fan boards
  are floating", "local beat writers have been speculating", "season-ticket
  holders have been wondering aloud", "a Wednesday call-in show floated".
- Phrases to AVOID: "sources tell me [team] is shopping/circling", "in talks",
  "front-office sources" — those imply a leak from inside the team and
  defeat the framing.
- Lead with the marquee player; reference cap or pick context as the angle
- Cap at 3 sentences
- Never fabricate names of players not in the candidate package
- Tag both franchises with their `nameMedium` for GroupMe formatting

Sample outputs to aim for (note the local-media / fan-chatter framing —
NOT a leak from either team):

> 🟡 *The talk-radio crowd in Bring-The-Pain country has spent the week chewing on whether Drake London makes sense in their offense. Local boards are floating Davante Adams and a 2027 1st as the kind of return Wabbits would have to consider — neither front office has acknowledged the chatter.*

> 🟢 *Computer Jocks fan boards have been wondering aloud whether a Patrick Mahomes / 2027 2nd swap with Maverick fits both teams' timelines. The buzz is coming from outside the buildings — Maverick has not commented and Jocks have stayed quiet.*

Color emojis for tier:
- 🟡 Two-team blockbuster (high dynasty value)
- 🟢 Two-team value pick-up (depth move)

### Step 5: Posting

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
  - Runs commit to main with the new feed entry + speculation-history ledger
- **Off-season behavior** — speculation actually increases during off-season (auction/draft prep is when trades happen). Don't disable seasonally.
- **Owner opt-out** — let any franchise mute speculation posts about themselves via a config field (e.g. `theleague.config.json`'s team config: `"speculationMute": true`). For owners who don't want to be public targets.

## Phasing

| Phase | Scope | Effort | Status |
|---|---|---|---|
| 1 | Two-team matching algorithm + Schefter blurb generation + Schefter feed post (no GroupMe yet) | 1.5 days | ✅ shipped (PR #184) |
| 2 | GroupMe posting hook + deep link back to feed entry | 0.5 day | ✅ shipped |
| 3 | ~~Three-team match search + Monday block-buster cadence~~ | — | ❌ cancelled (out of scope) |
| 4 | Per-franchise pinned "Latest Trade Buzz" card on detail pages | 0.5 day | pending |
| 5 | Quality-gate refinements + dynasty-value model tuning against historical real trades | open-ended | pending |

## Risk / failure modes

- **Posting a trade speculation that's offensive or insensitive** — the quality gate must catch IR/injury players. Sentiment review of generated blurbs.
- **Over-targeting one franchise** — rotation gate prevents posting about the same franchise twice in a 7-day window.
- **Stale `tradeBait.json`** — if an owner forgets to update their listings, our matching might be irrelevant. Display a "based on listings as of X" footnote on each post.
- **Owners getting tired of it** — start daily and dial down to 3x/week if signal-to-noise drops.

## Smack-talk ideas the user wants in the feed

(Pulled from Brandon's intent for the Friday tips digest reframe — these belong in the broader Schefter content engine, not just speculation posts. Captured here so we have one source of truth for "what content does Schefter generate.")

See `docs/plans/schefter-smack-talk.md` for the full ideas list.
