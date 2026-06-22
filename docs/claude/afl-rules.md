# AFL Fantasy Rules Reference

Complete rules for AFL Fantasy (MFL ID: 19621).

**Source of truth:** the league constitution at
`src/pages/afl-fantasy/docs/rules.html` (rendered at `/afl-fantasy/rules`).
This document mirrors that constitution for quick reference and adds the
MFL-platform technical detail (scoring values, roster config, franchises,
endpoints) that the constitution prose does not cover. If the two ever
disagree, the constitution wins for *rules*; the MFL feeds win for *live data*.

---

## League Overview

| Setting | Value |
|---------|-------|
| **League Name** | American Football League (AFL Fantasy) |
| **MFL ID** | 19621 |
| **Official site** | AFL-Fantasy.com |
| **Domain** | afl-fantasy.com |
| **Format** | 24-team keeper league (7 keepers/year) |
| **Commissioner** | Brandon Shields |
| **Franchise Fee** | $100.00 per team (PayPal fee: $1 per $25 of dues) |
| **Time Zone** | Pacific (PST) unless otherwise noted |
| **Conferences** | 2 — American League (AL, conf `00`), National League (NL, conf `01`) |
| **Divisions** | 4 — 2 per conference, 6 teams each (North/South in AL, East/West in NL) |
| **Side competition** | Premier League / D-League (promotion & relegation, all-play) |
| **Head-to-Head** | Yes |
| **Draft Rounds** | 9 |

### Key Differences from TheLeague

| Feature | AFL Fantasy | TheLeague |
|---------|-------------|-----------|
| Format | Keeper (7/year) | Dynasty (salary cap) |
| Teams | 24 | 16 |
| Salary Cap | None | $45M |
| Contracts | None | Yes |
| Draft Pool | Rookies + Veterans | Rookies only |
| TE PPR | 1.5 (premium) | 1.0 |

---

## Important Dates

| Event | Date |
|-------|------|
| Deadline to notify Commish of intent to return | March 1 |
| Open recruitment period for new owners | March 1 – April 1 |
| League dues deadline | April 1 |
| Keeper selection deadline (7 keepers) | July 15 |
| Trade deadline | Wednesday between Week 10 and 11 |
| Annual draft window | August 20 – August 25 |
| Last day to move players from IR to active roster | Super Bowl Sunday |

---

## Division Setup

- 2 conferences, 2 divisions each, 6 teams per division.
- Each team plays the other teams **in its division twice** during the regular season.

---

## Team Rosters

- Max **16 players** on the active roster.
- Positions: **QB, RB, WR, TE, PK, DEF** (any combination).
- Additional **IR players** may be carried from **July 15** until **Super Bowl Sunday**.

### Injured Reserve

- **No limit** on IR spots.
- Only players listed **Doubtful**, **Out**, or on the official **IR** list are eligible.
- IR violations → team may not submit a lineup the following week.
- Exceptions at the Commissioner's discretion.

### Starting Lineup (9 starters)

| Position | Starters |
|----------|----------|
| QB | 1 |
| RB | 1–4 |
| WR | 1–4 |
| TE | 1–4 |
| K | 1 |
| DEF | 1 |
| **Total** | **9** |

The RB/WR/TE positions share a combined flex pool (minimum 3 of the 9 starters).

### Lineup Submission

- Lineups are due at **"game time"** of the player involved.
- If no lineup is submitted, the **previous week's lineup** is used.
- A valid lineup must exclude players on a bye or listed **"Out"** if a bench replacement exists.

---

## Trades

- All trades go through the league website and require **Commissioner approval**.
- The Commissioner may approve/decline any trade and may require a **non-refundable $50 deposit** toward the following season.
- Trading window: **conclusion of Week 17 through the day before Week 11** (typically Wednesday). **Trade deadline: Wednesday between Week 10 and 11.**
- Teams trading any **draft pick** must submit a **non-refundable $50 deposit** for the following season.
- Draft picks may be traded up to **one year in advance**.
- All teams must have **9 total draft picks** from the start of the draft until the **July 15 keeper deadline**.
- Between **July 15 and draft day**, players may be traded for current-year picks, provided each team has **16 players and/or picks** going into the draft.
- Miss the keeper deadline → keeper limit drops to **6** and a compensatory pick at **9.13**.
- Unequal pick counts in a pick trade → Commissioner may assign the **lowest available pick** to balance it.

---

## Free Agents (Waivers)

- **Rolling waiver system ("Yahoo" style)** for priority. *(Not BBID/blind-bid.)*
- Initial waiver order = **base draft order from the previous season**.
- Waiver adds allowed **Week 1 through Week 17**.
- Requests accepted **Sunday kickoff → Wednesday 9:00 PM**; all claims process **Wednesday 9:00 PM**.
- Dropped players are **locked until the next Sunday kickoff**.
- **First-Come, First-Served (FCFS)** allowed **Wednesday 9:00 PM → Sunday kickoff**, and from **Draft Day until the regular season starts**. Players dropped during FCFS are locked until the next Sunday kickoff.

---

## Keepers

- Keep **7 players** each year; cut down to the keeper limit by **July 15**.
- Miss the deadline → keeper limit reduced to **6** + compensatory pick at **9.13**.

---

## Draft & Draft-Order Prediction

The draft is annual, **9 rounds**, NFL-style. Only non-keepers are eligible.

### Base order

- Determined by the **final standings from Week 13** of the previous season (worst record picks first).
- The **conference champion** is forced to the **last pick (12th)** in their own conference draft (the two conferences draft separately).
- Ties are broken by the **official standings tiebreaker rules** (see below).

### NIT bonus (Round 1 only)

- Each conference awards points by base draft position: **12 points (worst record) → 1 point (conference champion)**.
- The **top 5 NIT finishers** in each conference get **+1.5 points**.
- **Round 1 is reordered by total points** (most points = pick 1). Ties → the team with the **higher original draft position** gets the higher pick.
- **Rounds 2–9 follow the base reverse-standings order** (no NIT carryover).

> **Implementation:** `src/utils/afl-draft-utils.ts` (`calculateAFLDraftOrder`) +
> `src/pages/afl-fantasy/draft-predictor.astro`. The base order uses
> `sortByRecordReverse`, which applies the standings-tiebreaker chain below.
> Head-to-head is derived from `weekly-results-raw.json`
> (`buildHeadToHeadFromRaw`) because the standings feed's `h2h*` fields only
> echo the overall record.

---

## Schedule

- **17-game** schedule per franchise.
- Each team plays **division opponents twice**, **other conference opponents once**, and **one game vs the opposite conference** team that finished in the same position the prior year.
- **Doubleheaders** in **Weeks 1, 2, 3, and 13** (this is how 13 calendar weeks yield 17 games).

---

## Scoring & Errors (governance)

- Notify the Commissioner by **email** on discovering a scoring error.
- All disputes due by **Wednesday 9:00 PM**; the Commissioner reviews and notifies involved teams.
- Official stat provider: **My Fantasy League** (system of record).
- Confirmed errors that change a matchup outcome → league-wide notice + correction.

### Scoring values (MFL config)

**Passing:** 0.04/yd (1 pt per 25 yds) · Pass TD 6 · INT −2 · 2-pt pass 2
**Rushing:** 0.1/yd (1 pt per 10 yds) · Rush TD 6 · 2-pt rush 2
**Receiving (TE-premium PPR):** TE **1.5/rec**, WR **1.0/rec**, RB **1.0/rec** · 0.1/rec yd · Rec TD 6
**Kicking:** XP 1 · FG 0–30 yds = 3 · FG 31+ yds = 0.1/yd (e.g. 50-yarder = 5.0)
**Team Defense:** Sack 1 · INT 2 · Fum Rec 2 · Safety 2 · Blocked kick 2 · Def TD 6 · Def 2-pt 2
**Points-allowed tiers:** 0–6 → 10 · 7–13 → 7 · 14–20 → 4 · 21–27 → 1 · 28–34 → −1 · 35+ → −4
**Misc:** Fumble lost −2 · Return yards 0.03/yd

---

## Game Tiebreakers

**Regular season:** a tie stays a tie.

**Playoffs**, in order:
1. Highest scoring bench player
2. Most points by starting kicker
3. Better regular season W–L record
4. Better regular season Power Rank
5. Most total points scored
6. Coin flip

---

## Standings Tiebreakers

> **Ties are always broken within divisions first.**

**2-Team & 3-Team Division ties:**
1. Head-to-head (W-L-T % between the clubs)
2. Best W-L-T % within the division
3. Best W-L-T % within the conference
4. Power Rank
5. Total points scored
6. All-Play record
7. Victory Points
8. Most points allowed
9. Coin flip

**Wild Card ties** (different divisions — starts at conference record, **no head-to-head/division step**):
1. Best W-L-T % within the conference
2. Power Rank
3. Total points scored
4. All-Play record
5. Victory Points
6. Most points allowed
7. Coin flip

*(3-team sets: eliminate, then revert to step 1 of the 2-club format. With only
2 divisions per conference the 3-team wild-card set cannot trigger, since ties
break within divisions first.)*

---

## Playoff Structure

The league splits into two groups:

### League Championships
- Each conference sends **4 teams**: 2 division winners (seeds 1–2) + 2 wild cards (seeds 3–4). Wild cards = the 2 best remaining W–L records.
- **Week 14:** AL 1v4, AL 2v3, NL 1v4, NL 2v3
- **Week 15:** AL G1 winner vs AL G2 winner; NL G1 winner vs NL G2 winner
- **Week 16:** AL Champion vs NL Champion — **World Championship**

### NIT Tournament
- The remaining **16 teams** play a consolation bracket.
- Seeded **1–16 by final regular-season Power Rank**; #1 vs #16, #2 vs #15, etc.

---

## Premier League / D-League Competition

Runs independently, **Week 1 → Week 17**, all-play format.

- Each team plays **every other team once per week** (23 games/week).
- **Top 4 Premier League** teams win money.
- **Bottom 2 Premier League** teams are relegated to the D-League.
- **Top 2 D-League** teams are promoted.
- Prize ties → **split winnings**.

**Promotion/Relegation Playoff:** Premier League 9th & 10th + D-League 3rd & 4th compete for 2 Premier League spots; **top 2 by All-Play record** earn/keep Premier League.

**Tiebreakers:** prize ties split; promotion/relegation ties broken by **Total Points Scored**.

---

## Payouts

| Item | Amount |
|------|--------|
| League Dues | $2,400 |
| League Site Fees | −$180 |
| **Total Prize Money** | **$2,220** |

| Prize | Amount |
|-------|--------|
| League Championship | $300 |
| Conference Championship | $150 |
| Division Championship | $150 |
| Wild Card | $100 |
| Premier League Champion | $225 |
| Premier League 2nd | $150 |
| Premier League 3rd | $100 |
| Premier League 4th | $50 |
| D-League Champion | $50 |
| NIT Champion | $50 |

*The League Champion is also a Conference Champion → $450 total for both titles.*

---

## Replacement Owners

- Owners must submit lineups weekly. Failing **two consecutive weeks** or **three times in a season** → asked to surrender the franchise.
- Departing teams are taken over **as-is** (rosters, keepers, picks, financial obligations). No refunds.
- The Commissioner maintains a waiting list. Ownership may not be sold/transferred without approval; a voluntarily-vacated team becomes league property until reassigned.
- **2+ simultaneous departures** → a **dispersal draft** of the pooled players and picks.

---

## Rule Changes

- Rule changes require a **75% vote (18 of 24)**.
- Votes **between July 15 and Week 17** require **100%** to take effect immediately; 75–99% takes effect the following season.
- Votes ideally occur between the trade deadline and the end of Week 17.
- **Abstentions count as "Yes."** Polls are final **5 days** after opening.
- Anything not covered is resolved by the **Commissioner**.

---

## 24 Franchises

### American League (Conference `00`)

#### North Division
| ID | Team | Abbrev | Tier |
|----|------|--------|------|
| 0001 | Smokane FC | SMOKE | Premier League |
| 0002 | Drunk Indians | DRUNK | Premier League |
| 0004 | Get off my Ditka | DITKA | D-League |
| 0006 | Da Dangsters | DANG | Premier League |
| 0010 | Fullybaked | BAKD | Premier League |
| 0012 | Suh girls, one cup | SHIT | Premier League |

#### South Division
| ID | Team | Abbrev | Tier |
|----|------|--------|------|
| 0003 | Team Minty Fresh | MINT | D-League |
| 0005 | Computer Jocks | JOCKS | D-League |
| 0007 | Avenging Amish | AMISH | D-League |
| 0008 | Dicks out for Harambe | DICK | Premier League |
| 0009 | Vitside Mafia | VIT | Premier League |
| 0011 | Midwestside Connection | MWS | D-League |

### National League (Conference `01`)

#### East Division
| ID | Team | Abbrev | Tier |
|----|------|--------|------|
| 0015 | The Mariachi Ninjas | NINJAS | Premier League |
| 0017 | Titsburgh Feelers | TITS | D-League |
| 0019 | Badd Boys | BADD | Premier League |
| 0022 | Balls Deep | BALLS | Premier League |
| 0023 | Cock Gobbler | DkLuvr | D-League |
| 0024 | No Soup For You | SOUP | D-League |

#### West Division
| ID | Team | Abbrev | Tier |
|----|------|--------|------|
| 0013 | Muck Juggling Micks | MICKS | D-League |
| 0014 | Thundering Herd | HERD | D-League |
| 0016 | Swiftie 4 Life | SWIFTY | D-League |
| 0018 | Jewpacabra | JEW | D-League |
| 0020 | The Boondock Saints | SAINTS | Premier League |
| 0021 | Chatmaster | CHAT | Premier League |

---

## MFL API & Platform Notes

| Endpoint | Purpose |
|----------|---------|
| `TYPE=league` | Full league configuration |
| `TYPE=rules` | Scoring rules by position |
| `TYPE=rosters` | Current team rosters |

**Base URL:** `https://api.myfantasyleague.com/{year}/export?TYPE={type}&L=19621&JSON=1`

### Feature flags (`afl.config.json`)

| Feature | Enabled |
|---------|---------|
| Salary Averages | No |
| Toilet Bowl | No |
| Draft Predictor | Yes |
| Contract Management | No |

### ⚠️ Constitution vs. MFL platform config

The MFL platform is currently configured with **`lastRegularSeasonWeek = 14`**
and **`endWeek = 18`**, which does **not** match the constitution's prose
(13-week regular season with doubleheaders → 17 games, League Championship
playoffs Weeks 14–16, NIT, Premier/D-League Weeks 1–17). Treat the
**constitution as authoritative for rules** and the **MFL feeds as authoritative
for live week/scoring data**. If features depend on week boundaries, read them
from the MFL feed rather than hardcoding the constitution's week numbers.
