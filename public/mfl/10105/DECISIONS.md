# Archie's FFL (10105) — playoff standings widget: tiebreaker & ordering decisions

> Status as of 2026-09-21: **shipped and settled.** The widget is live at
> `v2.mfl.football/mfl/10105/`, Victory Points are published by MFL, Points For
> breaks ties, and no questions remain open. This records every ordering and
> tiebreaker decision, and which assumptions the live MFL feed contradicted
> along the way.
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
<script src="https://v2.mfl.football/mfl/10105/standings.js" defer></script>
```

It carries no league id. Host, year and league are read from the page's own
URL, so the same file serves any league it is dropped into.

**Every page load:** read `location` → fetch `TYPE=league` and
`TYPE=leagueStandings` same-origin → group by division in MFL's row order →
build the four tiers → rewrite the table body. Two calls, not three: Victory
Points come from the standings feed once the league publishes them, so the
schedule is not needed.

**Shipping a change:** edit `standings.js`, push, Vercel deploys, live. The
commissioner re-pastes nothing, ever. That is the reason the file is hosted
rather than embedded in the module.

**Until the branch reaches `main`,** `https://v2.mfl.football/mfl/10105/standings.js`
404s — `v2.mfl.football` serves this app's `public/` directory, but only what is
deployed. `paste-in.html` exists so the widget can be tried before then.

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

### O2 — What breaks a Victory Point tie **(RESOLVED 2026-09-21)**
**Decision: Points For.** Equal VP is separated by points scored, then by MFL's
own row order for anything still level.

This mattered from the first day it shipped. With two games a week and a 3/2/1
bucket a team can score only 0–6 VP per week, so after two weeks **26 of the 99
teams sat on 6 VP and another large block on 5** — the order inside each tier
was MFL feed position, which is arbitrary to a reader. Points For separates all
26, and at the cut it put **Invaders in over Rams by 1.1 points**, both on 5 VP.

**The average is the basis, and that is fine here.** MFL publishes the Points
For TOTAL (`pf`) only when the standings display carries it; this league shows
the AVERAGE (`avgpf`). Average and total rank identically when every team has
played the same number of games, and this league's format guarantees that —
**every team plays two games every week**, confirmed by the commissioner and
verified in the schedule feed (99 matchups a week, each team in exactly two,
nobody on a bye). So no change to the MFL standings display is needed.

The widget still prefers `pf` and falls back to `avgpf`, so adding the total to
the display later would change nothing. The one scenario that would break the
equivalence is a team missing a week entirely — a forfeit or a withdrawal
leaving different game counts across the league. If that ever happens, add
Points For to the standings display and the widget picks up the total by
itself.

D8 stands but means less now: a tie marker no longer says "undecided", only
"level on VP, separated on Points For".


### O3 — The record column **(RESOLVED 2026-09-21)**
**Decision: print MFL's own `W-L-T` exactly as the feed gives it** — `2-0-0`,
not a reformatted `2-0`. Shortening it was tried and rejected: the page should
say what MFL says, so an owner comparing the two surfaces sees one number in one
format.

Worth remembering when reading the column: teams play **twice** a week, so a
week produces 2-0-0, 1-1-0 or 0-2-0. Week 1 was 34 / 31 / 34.

### O4 — Tier sizes if the league size changes **(CLOSED 2026-09-21)**
Raised because 2025 ran 96 teams in 8 divisions against 2026's 99 in 9. Closed
without a rule: the league is set up as it should be, and 9 / 9 / 12 is correct
for it. If the division count ever changes, the three constants at the top of
`standings.js` are a one-line edit — that is what they are there for.

### O5 — Whether a division leader is ever decided on VP **(CLOSED 2026-09-21)**
No. MFL's standings decide who leads a division; VP only orders those nine
among themselves. Confirmed as correct by the client.

## Everything is settled

No open questions remain. The widget is live, reads MFL on every page load, and
the only recurring human task is entering prize money in the module.

## Non-tiebreaker issue found in the current page

The existing HTML hardcodes each franchise icon with a per-team year:
`fflnetdynamic2023/`, `fflnetdynamic2024/`, `fflnetdynamic2025/`. Those years
differ because each icon was uploaded in a different season, so no single year
can be used to build the URLs. The feed's `franchise.icon` field carries the
correct current URL per team and should be used instead.
