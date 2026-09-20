# Replacing MFL — feasibility and staging

**Status:** SCOPING ONLY. Nothing here is decided or built.
**Question asked:** what would it take to replace MFL's stats with our own
provider — and, behind it, whether this site could become a competitor to MFL.
**Branch:** `claude/mfl-stats-provider-replacement-n6q2v1`
**Written:** Sept 2026, measured against this repo as it stands.

---

## The finding that reframes the question

**MFL never gives us stats. It gives us already-scored fantasy points.**

Every stat-shaped feed under `data/<league>/mfl-feeds/<year>/` is post-scoring:

| Feed | Actual shape |
|---|---|
| `playerScores-by-week.json` | `{"weeks":{"1":{"13116": 25.66}}}` — a number per MFL player id |
| `weekly-results.json` | `{"weeks":[{"scores":{"0002": 120.54}}]}` — franchise totals |
| `playerScores-ytd.json` | season totals, same shape |
| `players.json` | identity only (name, pos, team, `espn_id`) — no production |

There is no passing yards, no target, no carry, no snap anywhere in the MFL
feeds this repo pulls. The only raw NFL production we hold is
`data/nfl/snap-counts-<year>.json` (NFLverse) and live ESPN game detail
(`src/utils/espn-game-detail.ts`) — both added by us, neither from MFL.

So "replace MFL stats with our own provider" is not a feed swap. It is
**building a fantasy scoring engine**. The provider is the easy half.

The good news is in the next section: the scoring engine is much smaller than
it sounds.

---

## What replacing MFL actually decomposes into

Four layers, increasing in difficulty. They can be done in order, and layers
0–2 are worth doing even if layer 3 never happens.

### Layer 0 — Raw NFL facts *(easy, already half-done)*

MFL supplies `players`, `nflSchedule`, `nflByeWeeks`, `injuries`,
`fantasyPointsAllowed`, `adp`. All available from a paid provider or NFLverse.
We already run two non-MFL NFL sources in production, so the pattern exists.

### Layer 1 — The scoring engine *(smaller than expected)*

Both league rule sets are already written down, and neither is exotic — no IDP,
no bonus thresholds, no fractional-yard weirdness beyond per-yard rates.

| | TheLeague (`docs/claude/league-rules.md`) | AFL (`docs/claude/afl-rules.md`) |
|---|---|---|
| Passing | 0.04/yd, TD 6, INT −2, 2pt 2 | identical |
| Rushing | 0.1/yd, TD 6, 2pt 2 | identical |
| Receptions | TE 1.0 / WR 0.5 / RB 0.25 | TE 1.5 / WR 1.0 / RB 1.0 |
| Rec yards/TD | 0.1/yd, 6 | identical |
| Kicking | XP 1, FG ≤30 = 3, FG 31+ = 0.1/yd | identical |
| Team D | Sack 1, INT 2, FR 2, Saf 2, Blk 2, TD 6, 2pt 2 | identical |
| Points allowed | 0–35 → 15, 36+ → −6 | 6 tiers: 0–6→10 … 35+→−4 |
| Misc | Fumble lost −2, return yds 0.03/yd | identical |

That is roughly **25 rules across two configs**. Everything needed to compute
them is in NFLverse play-by-play, including FG distance and return yardage.

**This is the single most encouraging finding in this document.** A
config-driven scorer covering both leagues is days of work, not months — and
because it must already handle two rule sets, it lands multi-tenant-shaped for
free.

The *cost* is not writing it. The cost is being right forever:

- **Stat corrections.** The NFL revises box scores through Wednesday. MFL
  absorbs that invisibly today. Own scoring and you own re-scoring settled
  weeks, and every artifact baked from them — standings, Schefter posts, the
  Pecking Order, push notifications already sent.
- **Disputes.** The AFL constitution literally names *"Official stat provider:
  My Fantasy League (system of record)"* with a Wednesday 8:00 PM PT dispute
  window. Changing the scorer is a **governance change requiring an owner vote**,
  not just a deploy.
- **Reconciliation forever.** While MFL still pays out, any 0.1 disagreement is
  a bug on our side by definition.

### Layer 2 — System of record *(the "database replacement")*

Rosters, transactions, salaries, standings, schedule, draft results, playoff
brackets, accounting, franchise history. **TheLeague 2007–2026 (20 seasons),
AFL 2003–2026 (24 seasons).** ~178 MB of committed JSON today.

Precedent exists: `contract-storage.ts` and `accounting` already treat Upstash
as the system of record for data MFL does not hold. This layer generalizes that.

### Layer 3 — Transactions and officiating *(the real MFL)*

This is where MFL's 25 years actually live, and none of it is in our repo today
— we *proxy* these to MFL:

- BBID blind-bid waiver processing (tie-breaks, budget, order)
- Trade submission, acceptance, veto windows, pick+player packages
- Roster limits, taxi/IR eligibility, salary-cap enforcement on every write
- Lineup locks per real kickoff time
- Live draft rooms with real-time shared state, auction timers
- League-year rollover, contract escalation, comp picks

Current write surface that would need a native engine behind it:
`waiver-claim`, `waiver-claims`, `trades/submit`, `trades/respond`,
`cut-player`, `move-to-ir`, `move-to-practice`, `draft-list`, `watch-list`,
`trade-bait`, plus the lineup path.

---

## Six things easy to miss

1. **MFL is our identity provider.** `src/utils/mfl-login.ts` POSTs credentials
   to MFL and resolves `franchise_id` from `TYPE=myleagues`. Retire MFL and
   nobody can sign in until accounts, password reset and invites exist.

2. **MFL player ids are the join key for the entire repo.** `player-map.ts`,
   contracts, rankings (`ri:0001`), the Schefter tagger, watch lists, draft
   queues, headshots, composites — all keyed on `mflId`. Either keep MFL ids as
   canonical forever (cheap, permanently odd) or build a crosswalk. Note the
   trap `docs/claude/rules/live-scoring.md` already documents: a wrong id
   **resolves a different player rather than failing**, and that bug class has
   shipped here twice.

3. **The build shape changes.** `data/` is 178 MB of committed JSON; prebuild
   bakes artifacts; preview builds read those artifacts instead of fetching
   (`tests/prebuild-slim.test.ts`); sync commits to `main` are production
   builds. Moving to Postgres is an improvement, but it touches the cadence
   logic in `src/utils/sync-cadence.ts` and the whole slim-prebuild derivation.

4. **Multi-tenancy inverts the architecture.** `src/config/leagues-data.mjs` is
   a build-time registry of 3 known leagues, enforced by
   `tests/league-literal-guard.test.ts`, with 169 pages living under
   `src/pages/<league>/`. A competitor means arbitrary leagues with arbitrary
   rules — the registry becomes a table, `leagueHasFeature()` becomes a runtime
   read, and the 24 forked sibling pages
   (`tests/fixtures/page-fork-baseline.json`) stop being technical debt and
   become impossible.

5. **The other owners live in the MFL app.** Any period where we score here and
   they transact there produces two sources of truth that will disagree.

6. **Dynasty history is MFL's real moat.** Ours is already extracted
   (2003–2026). A prospective customer's is not, and MFL has no export worth
   the name.

---

## Provider options (budget: "whatever it takes")

| Provider | Price | Fit |
|---|---|---|
| **NFLverse** | Free | Full play-by-play, best-in-class ids, complete history. **Not live** — updates on a lag. Perfect for backfill, scoring validation and Tue–Wed correction passes; cannot drive Sunday. |
| **SportsDataIO** | ~$25–200/mo published, quote-based production keys | Real-time NFL, 99.9% SLA, fantasy-shaped endpoints, documented id crosswalks. **The likely pick.** |
| **Sportradar** | Custom, ~$500–5,000+/mo | Official-grade. Overkill for two leagues; the right answer only if this becomes a product with paying customers. |

**Recommendation: NFLverse + SportsDataIO together**, not either alone.
NFLverse gives free historical backfill and an independent second opinion for
reconciliation; SportsDataIO gives the live Sunday feed. Two sources that
agree is how you earn the right to be the system of record.

---

## Staged path

Each phase is independently valuable and independently abortable.

### Phase 0 — Own the NFL facts · ~3–5 weeks
Stand up Neon Postgres. Ingest NFLverse history (2003→) plus SportsDataIO live.
Build the player-identity crosswalk (MFL id ↔ GSIS ↔ ESPN ↔ SportsDataIO) as a
first-class table. Keep MFL ids canonical for now — that is the cheap call.
**Unblocks immediately:** real stat lines on player pages, efficiency metrics,
better projections, snap/target share. Features MFL structurally cannot offer.

### Phase 1 — Shadow scoring · ~3–4 weeks + one full season of validation
Config-driven scorer, both rule sets. Runs every week, writes to Postgres,
surfaces **admin-only**. A reconciliation report diffs our number against MFL's
per player per week. Ship nothing owner-facing until it is exact for a season.
**This is the cheapest possible test of whether the whole idea is real.**

### Phase 2 — Own the ledger · ~6–10 weeks
Postgres becomes system of record for what we *already* own (contracts,
accounting, owner tenures, franchise history, rankings, the board) plus the
full 20/24-year archive migrated off committed JSON. MFL still runs live
transactions. Shrinks `data/`, kills the git-size class of problems, makes the
history queryable.

### Phase 3 — Own the transactions · ~12–20 weeks, in-season risk
Native waiver/trade/lineup/draft engine. Requires an owner vote in both
leagues. **Highest-risk phase by far** — a blown waiver run in week 8 is
unrecoverable, and there is no dry-run for a live draft.

### Phase 4 — The competitor pivot · 6+ months, different project
Multi-tenancy, self-serve league creation, rules configuration UI, billing,
support, an MFL importer. Not an extension of phases 0–3; a new product that
reuses their engine.

---

## Honest assessment of the competitor question

**The asset is real.** ~520k lines, 528 test suites, 169 pages, and a feature
set MFL has nothing comparable to — the Schefter AI beat reporter, the live
broadcast board, the contracts/cap system, the Owners' Poll, Pecking Order,
push notifications, GroupMe integration. Nobody else in this market has an AI
league insider. That is a genuine wedge.

**The market is the problem, not the engineering.**

- MFL's customers are commissioners of leagues 10–25 years old. Switching cost
  is enormous and the downside is catastrophic — they are not price-sensitive,
  they are *risk*-sensitive.
- The field is already crowded and mostly **free**: Sleeper is free with the
  best mobile app in the category; Fleaflicker is free and covers most dynasty
  features; League Tycoon is free and already does contracts, cap, extensions,
  franchise tags, comp picks and draft lotteries — the exact niche a
  contracts-and-cap platform would target.
- Being the system of record means 24/7 obligation: waivers must run at 3 AM in
  week 8 whether or not you are awake.

**The sharper play, if the goal is a product:** stay a *companion*, not a
platform. Phases 0–2 give a stats-and-media layer that plugs into MFL, Sleeper
and Fleaflicker via their APIs. It sells to leagues on every platform instead
of asking anyone to migrate, it keeps the differentiated features (Schefter,
broadcast, contracts, poll) as the product, and it never has to run a waiver at
3 AM. Phase 3 stays available if that layer finds traction.

**Do Phase 0 and Phase 1 regardless of the answer.** They are valuable if this
becomes a product, valuable if it stays two private leagues, and Phase 1's
reconciliation report is the only honest evidence about whether replacing MFL
is achievable at all — for roughly six weeks of work plus a season of watching.

---

## Open questions for the owner

1. Does an owner vote to change the official stat provider pass in either
   league? The AFL constitution names MFL explicitly.
2. Companion product across platforms, or platform replacement? Phases 0–2 are
   identical either way, so this can be deferred until Phase 1 reports back.
3. Keep MFL ids canonical permanently, or bear a crosswalk migration?
   (Recommendation: keep them. They are inert as identifiers and the remap
   risk is a known, previously-shipped bug class.)
