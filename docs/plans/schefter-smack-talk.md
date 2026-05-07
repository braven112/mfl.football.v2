# Schefter Smack Talk Hooks

## Context

Schefter already drops a **Friday tips digest** (all outstanding tips from the rumor box, posted to GroupMe weekly). Owners love it — it's been the best smack-talk fuel in the league. This doc catalogues additional smack-talk content angles Schefter can bake into his posts to keep the heat on.

Goal: more reasons for owners to react in the GroupMe. Smack talk drives engagement, engagement drives the league.

## Voice rules (preserve)

- Schefter is **deadpan-confident**, never sneering. He's reporting what he's heard.
- Always uses **named honors as if they're real**: Jerry Jones Award, Brock Osweiler Award (per `data/schefter/league-lore.md`).
- Never invents player or franchise names.
- Caps sarcasm — let the facts (cost-per-point, dead money, point differentials) do the cutting.
- One award/jab per post max — stacking kills the bit.

## Smack talk angle bank

### 1. "Receipts" callbacks

Schefter remembers what owners said. Reference past brags, predictions, or hot takes from the GroupMe and call them out when reality breaks the other way.

> *Two weeks after Music City declared they were "the most dangerous team in the league," they sit 1-4 with the worst points-against and a Brock Osweiler-tier contract on Cooper Kupp. Sources unavailable for comment.*

Implementation: tap the GroupMe message archive (we already sync it in `data/schefter/groupme-archive/` — verify) and extract owner brags via keyword + sentiment. Pin them with context for later callback when the team underperforms.

### 2. Cap-shaming

When an owner makes a roster move that aligns the cap badly, Schefter calls it out by referencing existing awards.

> *Computer Jocks just declared $4M of dead cap on a Day-1 cut. That's Jerry Jones leaderboard energy.*

> *That Drake London extension is now in Brock Osweiler territory. $/point at $14.5M is heading the wrong way.*

Already partially implemented in the rumor-mill bucket logic — extend it to surface in regular Schefter posts, not just rumor responses.

### 3. Standings shade

Weekly Tuesday Power Rankings (separate plan) gives the prime venue, but smaller jabs can drop in mid-week.

> *Bring The Pain are 5-0 against the easiest schedule in the league per our Schedule Strength dashboard. The good news: their next 4 opponents are top-5 in points-for. The bad news: Brandon hasn't said anything to Bring The Pain about it yet.*

Pulls schedule-strength data + GroupMe activity to set up the burn.

### 4. "What if" trade comparisons

When a trade goes down, Schefter retrospectively compares it to similar past trades in TheLeague history (we now have 20 years of `transactions.json`).

> *Tonight's Pigskins-Wabbits trade — Saquon for a 2027 1st and a bench piece — is the most lopsided 1-for-2 swap in TheLeague since the 2018 Devil Dogs deal that aged like milk. (Devil Dogs lost the championship a year later.)*

Needs the Phase 4 trade ledger groundwork first; smack talk emerges naturally from the historical comparisons.

### 5. Streak watch

Track ongoing streaks and call them out when they reach milestones:

- **Win streak** — "Fire Ready Aim has won 4 straight. The last team to start 4-0? The 2010 Acer FC Edge — and we know how that ended (champion, 0-1 in Schefter callbacks)."
- **Loss streak** — *"Cowboy Up dropped their fifth straight. Last 5-game skid in the league: 2024 Maverick. They missed the playoffs by 0.4 points."*
- **Bench-blunder streak** — "Music City has left more than 30 points on their bench in 3 consecutive weeks. That's a Brock Osweiler-grade lineup process."
- **All-play loser streak** — "Vitside is 0-4 in all-play despite a 3-1 record. Math says regression is coming."

Compute streaks from `weekly-results.json` history. Surface when a streak hits 3+, 5+, 7+.

### 6. "Looking ahead" — divisional drama

Schefter primes upcoming matchups by referencing rivalry stakes.

> *Pigskins-Vitside this Sunday. Pigskins lead the all-time series 17-17. The last 3 meetings have been decided by single digits. Both teams are in the playoff hunt and Vitside hasn't beaten the Pigskins in their last 4 tries.*

Once Phase 2 rivalry pages exist, this writes itself — pull the H2H record and the most recent meetings.

### 7. Rookie report cards

After Week 8, drop a Schefter post grading every team's rookie draft class so far.

> *Wabbits drafted Caleb Williams 1.01 to be a franchise QB and through 8 weeks he's averaging 22.3 PPG. Best rookie investment of the offseason.*

> *Pigskins gambled a 1st on a Day-3 RB project. Through 8 weeks he has 4 touches. The Jerry Jones Award committee has taken notice.*

Pulls from `draftResults.json` + per-week scoring.

### 8. "Trash heap" weekly

A single post highlighting the **3 worst single-week roster decisions** of the past week. Bench points left, dead-money cuts, scoring 50- in a winnable matchup.

> *🗑️ This week's Trash Heap*
> 1. *Music City: 38 points on the bench in a 4-point loss*
> 2. *Cowboy Up: started Russell Wilson on bye*
> 3. *Mavericks: 0 fantasy points from QB1*

Algorithmic, lands every Friday alongside the tips digest.

### 9. Schefter Live Reactions to MFL chat

Already partially implemented (Schefter watches the GroupMe). Extend with:

- React to **owner brag posts** with a lightweight tease ("Bold claim with that $/point heading into Sunday — we'll see").
- React to **owner complaints about lineup losses** with a relevant historical receipt ("This is the 4th week this season Music City has been on the wrong end of that conversation").
- React to **trade announcements** with a retrospective grade tied to existing awards.

### 10. End-of-year roast

In Week 18, Schefter publishes a Year in Review with three superlatives per franchise (best moment, worst moment, defining stat). Maximum smack-talk density for the season finale.

## Implementation routes

These ideas don't need a single new endpoint — they slot into existing Schefter generation paths:

| Smack-talk angle | Where it lives |
|---|---|
| Receipts callbacks (#1) | `scripts/schefter-rumor-scan.mjs` and `scripts/schefter-scan.mjs` — both already generate posts from triggers; add a "callback" trigger type that watches for hypocrisy |
| Cap-shaming (#2) | Already in rumor-mill bucket logic — extend to standalone Schefter posts |
| Standings shade (#3) | New script `scripts/schefter-standings-shade.mjs` runs Wed/Thu after Tuesday Power Rankings publishes |
| Trade comparisons (#4) | Hook into existing transaction-detection in `schefter-scan.mjs` |
| Streak watch (#5) | Tuesday Power Rankings article surfaces streaks; standalone alerts when a streak hits a threshold |
| Looking-ahead matchups (#6) | Friday post (alongside tips digest) — pulls rivalry data |
| Rookie report cards (#7) | One-time generation, Week 8 + Week 14 |
| Trash heap weekly (#8) | New Friday script, posts alongside tips |
| Live reactions (#9) | Extend `scripts/schefter-groupme-listen.mjs` |
| End-of-year roast (#10) | Existing weekly-recap pipeline; Week 18 special issue |

## Sequencing

Don't implement all ten at once. Suggested order:

1. **Trash Heap weekly** (#8) — low-risk, deterministic, runs alongside the existing Friday tips digest. Smack-talk gold from day 1.
2. **Streak watch** (#5) — easy to compute, naturally drops into Tuesday Power Rankings.
3. **Cap-shaming standalone posts** (#2) — extend existing logic, doesn't add new infrastructure.
4. **Looking-ahead matchups** (#6) — depends on Phase 2 rivalry data.
5. **Receipts callbacks** (#1) — most engaging but riskiest; needs sentiment + GroupMe archive parsing.
6. **Trade comparisons** (#4) — depends on Phase 4 trade ledger.
7. **Rookie report cards** (#7) — can ship anytime.
8. **End-of-year roast** (#10) — December delivery.
9. **Live reactions** (#9) — already partial; refine.
10. **Standings shade** (#3) — wraps after the Power Rankings article is live.

## Smack-talk tone tester

Before any new angle ships, gut-check the generated copy:

- Would a reasonable owner laugh, or feel attacked?
- Does it punch up (cap mismanagement) rather than down (kicking a player who got injured)?
- Does it use the canon awards (Jerry Jones / Osweiler) without inventing new ones?
- Is it ONE jab, or stacked? Stacked = cut.
- Would Schefter actually say it on TV?

If any answer is no, regenerate.
