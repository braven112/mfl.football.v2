# Companion app — the live broadcast wedge

**Status:** EXPLORATION. Nothing decided.
**Parent:** `docs/plans/mfl-replacement-feasibility.md`
**Direction chosen (Sept 2026):** individual manager as the customer, the live
broadcast board as the wedge, ESPN as the second provider, pricing open.
**Model:** `scripts/prototypes/broadcast-cost-model.py` — assumptions are
labelled constants at the top; change them and re-run.

---

## The architecture decides the economics

**Poll the NFL once, centrally. Never per user.** One ingest loop refreshes the
whole slate every ~20s and writes a compact per-league blob; clients poll that
blob through the edge cache. Ingest is then **O(1) in users** and delivery is
CDN-absorbed — N users in one league share one origin hit per TTL.

Get that wrong (poll per user, or recompute per request) and the same product
costs 100× more and falls over at 1:00 PM ET, when literally every user arrives
at once.

With it right, infra is close to free:

| Users / leagues | Infra per season | Per user |
|---|---|---|
| 100 / 10 | $184 | $1.84 |
| 1,000 / 100 | $258 | $0.26 |
| 10,000 / 1,000 | $1,002 | $0.10 |

Bandwidth is ~78% of that and is the only thing worth optimising (delta
updates and gzip should cut the 40 KB blob by ~5×).

## The data feed is the entire cost structure

| | Infra | Data | Season total | Per user |
|---|---|---|---|---|
| **Free ESPN endpoints**, 10k users | $1,002 | **$0** | **$1,002** | $0.10 |
| **Paid real-time**, 100 users | $184 | $7,500 | $7,684 | **$76.84** |
| **Paid real-time**, 1,000 users | $258 | $7,500 | $7,758 | $7.76 |
| **Paid real-time**, 10,000 users | $1,002 | $7,500 | $8,502 | $0.85 |

A real-time feed is **$500–3,000/mo and sales-gated** (SportsDataIO publishes
no real price). It is a **fixed** cost, so it is ruinous at 100 users and
trivial at 10,000.

**Therefore: launch on the free ESPN endpoints this repo already uses**
(`src/utils/espn-game-detail.ts`, `src/pages/api/nfl-game-detail.ts`). Buy a
feed only when paying volume covers it. Crossover is roughly **500–800 paying
users at $10–15/season**.

The stated risk of the free feed — "ESPN is intermittently 403 from the
sandbox" (`docs/claude/rules/live-scoring.md`) — is survivable for a hobby
board and fatal for a paid one. That is the real trigger to buy, not user count.

---

## The problem with the chosen combination

Individual manager **+** broadcast wedge **+** ESPN is coherent in every way
but one: **ESPN private leagues need `ESPN_S2` and `SWID` cookies, and they
cannot be obtained programmatically.** The user has to open DevTools and copy
two values, and ESPN expires them on an undocumented schedule.

For a commissioner doing a one-time league setup that is acceptable friction.
For a casual manager who came for a pretty Sunday scoreboard it is a
conversion wall, and it re-breaks silently mid-season.

Mitigations, best first:

1. **A browser extension that reads the cookies and posts them.** One click,
   no DevTools, and it can refresh them silently when they rotate — which
   also fixes the expiry problem rather than just the onboarding one. A
   third-party "ESPN Cookie Finder" extension already exists, which is both
   proof it works and proof of demand.
2. **A bookmarklet** — no store review, but one manual click per expiry.
3. **Public ESPN leagues need no cookies at all.** Ship those first and learn
   whether the board converts before building auth for the private case.
4. **Sleeper as the true second provider, ESPN third.** Sleeper needs no auth
   whatsoever — paste a username — and covers 97% of the modern player pool.
   ESPN is the bigger audience; Sleeper is the one that can ship this month.

## The problem with broadcast as the revenue product

A broadcast board is used **~3 hours × 18 weeks = 54 hours a year**,
concentrated entirely on Sundays, competing with a live view every platform
already gives away. That is hard to charge a monthly subscription for.

It is, however, the single most **screenshot-able** thing here — which makes it
an excellent *acquisition* product and a poor *revenue* one.

**The reframe: broadcast is free and viral; the paid thing is scale.** A
manager in one league watches free. A manager in four leagues pays for the
unified board that no platform will ever build, because no platform wants to
show you your other leagues. That is value-metric pricing aimed exactly at the
heavy user, and the free tier is the marketing.

Season pass, not monthly — the product does not exist in March.

---

## What already exists vs. what is new

Most of this is built. The new work is narrow:

- **Built:** the broadcast board, live ESPN game detail, the scoring engine
  (now exact for players and DST), the player-identity crosswalk covering
  `espn_id`/`sleeper_id`/`yahoo_id` alongside `mfl_id`.
- **New:** a provider interface with MFL and ESPN behind it; per-user accounts
  and league connections; the central ingest loop; the cookie extension.

**One known hazard, already hit once.** `docs/claude/insights/features/live-broadcast.md`
records that a projection belongs to a player *in a league*, so a cross-league
board's shared player map could not hold one — it held 0, pinning every
win-probability bar to a hard 100%. Multi-tenancy is exactly that bug at
larger scale. Whatever the provider abstraction looks like, **league-scoped
values must not live in a shared player map.**

---

## Open questions

1. Sleeper before ESPN? It ships far sooner and proves the board converts
   before any auth work exists.
2. Is the free-tier/paid-tier split above the right shape, or should the
   broadcast itself be the paid thing?
3. Does a browser extension count as acceptable scope, or is that a different
   project?
