# Archie's FFL (10105) — playoff standings widget: tiebreaker & ordering decisions

> Working document. Status as of 2026-09-21. The widget is NOT built yet; this
> records every ordering/tiebreaker decision made so far, what is still open,
> and which assumptions the live MFL feed has already contradicted.
>
> League: **Archie's Fantasy Football League**, MFL id **10105**, host
> **www48.myfantasyleague.com**. Verified live: 99 franchises, 9 divisions.

## The league, as the feed actually describes it

Facts below are read from the live MFL export, not assumed.

| Fact | Value | Source |
|---|---|---|
| Franchises | 99 | `TYPE=league` |
| Divisions | 9 (11 teams each) | `TYPE=league` → `divisions.count` |
| Games per team per week | **2** | `TYPE=schedule` — 99 matchups, each team in exactly 2 |
| Both games share one score | Yes, 99 of 99 | one lineup, two opponents |
| MFL standings sort | `PCT, PTS, H2H` | `league.standingsSort` |
| VP settings present | win 2, loss 0, tie 1, buckets `3 2 1`, weeks 1–18 | `league.victoryPoints*` |
| VP published by MFL | **No** — not in the standings page or the export | `column_names`, `/2026/standings` |
| Accounting ledger | **Empty** (`{}`) | `TYPE=accounting` |

Prior-season drift, which is why nothing is hardcoded: **2025 had 96 franchises
and 8 divisions.** The widget reads division count and membership from the feed
every load.

## Decisions made

### D1 — Ranking metric is Victory Points, not Average Score
The whole table ranks on VP. Replaces the current Avg Score basis.
**Status: decided.** Unblocked 2026-09-21 — the client enables VP in MFL so
the figure is published and read rather than calculated. See O1.

### D2 — Division leaders take seeds 1–9, unconditionally
All 9 division leaders are seeded above every non-leader regardless of VP. A
leader with low VP still outranks a high-VP wild card.
**Status: decided.**

### D3 — "Division leader" means whoever MFL's standings put first
Not "highest VP in the division". The widget groups the feed's rows by division
preserving MFL's order and takes the first row of each group. MFL has already
applied the league's official tiebreaker chain (`PCT, PTS, H2H`) — some of which
we cannot reproduce — so its order is authoritative for *who* leads.
**Status: decided.** Consistent with the standing repo rule "never re-sort MFL's
standings rows" (`docs/claude/rules/standings-brackets-draft-order.md`).

**Consequence to raise with the client:** MFL decides the leader by win
percentage, but the widget then orders those 9 leaders by VP. So the page mixes
two ranking systems by design — a team can lead its division on PCT while
sitting 9th of 9 leaders on VP.

### D4 — Division runners-up take seeds 10–18, unconditionally
Second row of each division group, in MFL's order. In regardless of VP, own
highlight colour.
**Status: decided.** New — not in the current page.

### D5 — Wild cards are the next 12 by VP, seeds 19–30
Drawn from everyone not already in via D2/D4. Third highlight colour.
**Status: decided.**

### D6 — Remaining 69 teams rank by VP, seeds 31–99
**Status: decided.**

### D7 — Seeds within each tier are ordered by VP
Leaders ordered 1–9 by VP among themselves; runners-up 10–18 by VP among
themselves; wild cards and the field likewise.
**Status: decided.**

### D8 — A VP tie is shown, never silently broken
Tied teams render at the same rank with a marker. At the wild card cut this
means the band can show more than 12 teams, with an overflow note saying the
league tiebreaker decides the final spot.
**Status: decided — but see O2; this is far more common than anyone assumed.**

### D9 — Winnings stay manual
MFL's accounting ledger for this league is empty, so winnings cannot be derived.
They live in an editable map in the config block. Everything else on the page is
automatic.
**Status: decided, forced by the data.**

### D10 — Tier sizes are config constants, not weekly edits
`DIVISION_LEADER_SEEDS = 9`, `RUNNER_UP_SEEDS = 9`, `WILD_CARD_SEEDS = 12`.
Season-level; the field size falls out of the feed's division count.
**Status: decided.** Confirmed against the design 2026-09-21: 9 + 9 + 12 = 30
qualifiers, 69 in the field, 99 total.

### D11 — Every team renders at equal weight
Seeds 31–99 keep full-size rows with banners, exactly like the qualifiers. The
alternative — compacting or collapsing the 69 non-qualifiers to shorten the
page — was considered and declined: the page is a full league table, not a
playoff picture with an appendix.
**Status: decided 2026-09-21.** Cost is a long scroll on a phone, accepted
knowingly.

## How it reaches MFL and stays current

**No scheduled job exists, by design.** The widget reads MFL at page-load time,
so the table cannot be stale — it holds no data of its own. A weekly sync would
reintroduce exactly the failure mode being removed, just automated.

**Install, once:** one line in the MESSAGE6 module, below the table.

```html
<script src="https://mfl.football/mfl/10105/standings.js" defer></script>
```

It carries no league id. Host, year and league are read from the page's own
URL, so the same file serves any league it is dropped into.

**Every page load:** read `location` → fetch `TYPE=league`,
`TYPE=leagueStandings` and `TYPE=schedule` same-origin → group by division in
MFL's row order → build the four tiers → rewrite the table body.

**Shipping a change:** edit `standings.js`, push, Vercel deploys, live. The
commissioner re-pastes nothing, ever. That is the reason the file is hosted
rather than embedded in the module.

**On failure:** the widget writes a visible "standings unavailable" state into
the table rather than leaving plausible zeros. A wrong number nobody questions
is worse than an obvious gap.

**The only recurring human task is winnings**, and only while MFL's ledger for
this league stays empty (D9).

## Open questions for the client

### O1 — Victory Points are not readable **(RESOLVED 2026-09-21 — action on the client)**
The league has VP fully configured, but `standingsSort` omits `VICTORY_POINTS`,
and MFL's export returns only the columns the standings display is set to show.
The live standings page shows no VP column either.

**Decision: the commissioner enables Victory Points in MFL's own standings
display.** MFL then computes and publishes the figure, the widget reads one
field, and our seeding is identical to the league's by construction — no
calculation of ours to be wrong. Build does not start until this is on.

The page to change:

```
https://www48.myfantasyleague.com/2026/csetup?L=10105&C=STANDINGS
```

Titled "Archie's Fantasy Football League Standings Setup"; the form is behind
the commissioner login. Add Victory Points to the standings sort/display.

**Verify it worked** — this returns a `vp` field per franchise once the setting
is live, and nothing today:

```
https://www48.myfantasyleague.com/2026/export?TYPE=leagueStandings&L=10105&JSON=1
```

**Still ask the client:** does their definition of a Victory Point include the
3/2/1 scoring-bucket bonus, or is it just 2 per win? MFL will publish whatever
the league is configured for, so this is a question about intent, not data — but
if the configured value is not what the league means by "victory points", every
seed is wrong in a way the feed cannot reveal.

### O2 — Ties are the normal state early on. Is D8 still right?
With two games a week and a 3/2/1 bucket, a team can score only 0–7 VP per week.
After week 1 the 99 teams held just seven distinct VP values: **26 teams tied on
7, 25 tied on 1.** A 12-team wild card cut through a 26-way tie is not a
footnote.

**Ask the client:** what actually breaks a VP tie? The natural answer is to fall
back to the league's existing chain — `PCT`, then `PTS`, then head-to-head —
which needs no new rule and matches how MFL already orders the standings.

### O3 — Does the record column mean what it used to?
The current page shows a single `0-0`. Teams play twice a week, so a week
produces 2-0, 1-1 or 0-2. Week 1 was 34 / 31 / 34. Confirm the column should
show the two-game record and not something else.

### O4 — Do the tier sizes move when the league size does?
2025: 96 teams, 8 divisions. 2026: 99 teams, 9 divisions. The 9/9/12 split
tracks the division count today. If the league goes to 10 divisions, does it
become 10/10/12, or does the 30-team field stay fixed?

### O5 — Should a division's leader ever be decided on VP?
D3 says no. Worth an explicit confirmation, since it is the one place the page
deliberately departs from "everything is VP".

## Non-tiebreaker issue found in the current page

The existing HTML hardcodes each franchise icon with a per-team year:
`fflnetdynamic2023/`, `fflnetdynamic2024/`, `fflnetdynamic2025/`. Those years
differ because each icon was uploaded in a different season, so no single year
can be used to build the URLs. The feed's `franchise.icon` field carries the
correct current URL per team and should be used instead.
