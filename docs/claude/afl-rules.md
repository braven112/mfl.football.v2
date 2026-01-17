# AFL Fantasy Rules Reference

Complete rules for AFL Fantasy (MFL ID: 19621), fetched from MFL API.

---

## League Overview

| Setting | Value |
|---------|-------|
| **League Name** | American Football League (AFL Fantasy) |
| **MFL ID** | 19621 |
| **Domain** | afl-fantasy.com |
| **Format** | Keeper (7 keepers/year) |
| **Teams** | 24 franchises |
| **Conferences** | 2 (American League, National League) |
| **Divisions** | 4 (North, South, East, West) |
| **Tier System** | Premier League / D-League |
| **Draft Rounds** | 9 |
| **Head-to-Head** | Yes |

### Key Differences from TheLeague

| Feature | AFL Fantasy | TheLeague |
|---------|-------------|-----------|
| Format | Keeper (7/year) | Dynasty (salary cap) |
| Teams | 24 | 16 |
| Salary Cap | None | $45M |
| Contracts | None | Yes |
| Draft Pool | Rookies + Veterans | Rookies only |
| TE PPR | 1.5 (premium) | 1.0 |
| Season End | Week 18 | Week 17 |

---

## Roster Configuration

| Setting | Value |
|---------|-------|
| **Roster Size** | 16 players |
| **Taxi Squad** | None |
| **Injured Reserve** | 10 slots |
| **Total Capacity** | 26 spots (16 active + 10 IR) |
| **Keepers** | 7 required annually |

### Starting Lineup (9 starters)

| Position | Required | Notes |
|----------|----------|-------|
| QB | 1 | Exactly 1 |
| RB | 1-4 | Flex with WR/TE |
| WR | 1-4 | Flex with RB/TE |
| TE | 1-4 | Flex with RB/WR |
| PK | 1 | Exactly 1 |
| Def | 1 | Exactly 1 |

The RB/WR/TE positions share a combined flex pool with minimum 3 starters total.

---

## No Salary Cap

AFL Fantasy does **not** use salaries or contracts:

| Setting | Value |
|---------|-------|
| **Uses Salaries** | No |
| **Uses Contract Years** | No |
| **Keeper System** | 7 players kept annually |

---

## Waiver & Free Agency Rules

| Setting | Value |
|---------|-------|
| **Waiver Type** | BBID (Blind Bid) |
| **Lockout** | Yes (roster lock during games) |

---

## Draft Rules

| Setting | Value |
|---------|-------|
| **Draft Type** | Email-based (slow draft) |
| **Player Pool** | Rookies AND Veterans |
| **Keepers** | 7 required |

---

## Season Structure

| Setting | Value |
|---------|-------|
| **Start Week** | 1 |
| **Last Regular Season Week** | 14 |
| **Playoff Weeks** | 15-18 |
| **End Week** | 18 |
| **Partial Lineups** | Not allowed |

---

## Scoring Rules

### Passing

| Category | Points | Notes |
|----------|--------|-------|
| Passing Yards | 0.04/yard | 1 point per 25 yards |
| Passing TD | 6 | |
| Interception | -2 | |
| 2-Point Conversion (pass) | 2 | |

### Rushing

| Category | Points | Notes |
|----------|--------|-------|
| Rushing Yards | 0.1/yard | 1 point per 10 yards |
| Rushing TD | 6 | |
| 2-Point Conversion (rush) | 2 | |

### Receiving (TE Premium PPR)

**Reception Points by Position:**

| Position | PPR Value | Name |
|----------|-----------|------|
| TE | 1.5 | **TE Premium** (50% bonus) |
| WR | 1.0 | Full PPR |
| RB | 1.0 | Full PPR |

| Category | Points |
|----------|--------|
| Receiving Yards | 0.1/yard |
| Receiving TD | 6 |

### Kicking

| Category | Points |
|----------|--------|
| Extra Point Made | 1 |
| Field Goal 0-30 yards | 3 |
| Field Goal 31+ yards | 0.1/yard (e.g., 50-yarder = 5.0) |

### Team Defense

| Category | Points |
|----------|--------|
| Sack | 1 |
| Interception | 2 |
| Fumble Recovery | 2 |
| Safety | 2 |
| Blocked Kick | 2 |
| Defensive TD | 6 |
| Defensive 2-Point Conversion | 2 |

**Points Allowed Scoring (Tiered):**

| Points Allowed | Fantasy Points |
|----------------|----------------|
| 0-6 | 10 |
| 7-13 | 7 |
| 14-20 | 4 |
| 21-27 | 1 |
| 28-34 | -1 |
| 35+ | -4 |

### Miscellaneous

| Category | Points |
|----------|--------|
| Fumble Lost | -2 |
| Return Yards | 0.03/yard |

---

## 24 Franchises

AFL uses a **tiered system** with Premier League and D-League designations within each conference.

### American League (Conference 00)

#### North Division
| ID | Team Name | Abbrev | Tier |
|----|-----------|--------|------|
| 0001 | Smokane FC | SMOKE | Premier League |
| 0002 | Drunk Indians | DRUNK | Premier League |
| 0004 | Get off my Ditka | DITKA | D-League |
| 0006 | Da Dangsters | DANG | Premier League |
| 0010 | Fullybaked | BAKD | Premier League |
| 0012 | Suh girls, one cup | SHIT | Premier League |

#### South Division
| ID | Team Name | Abbrev | Tier |
|----|-----------|--------|------|
| 0003 | Team Minty Fresh | MINT | D-League |
| 0005 | Computer Jocks | JOCKS | D-League |
| 0007 | Avenging Amish | AMISH | D-League |
| 0008 | Dicks out for Harambe | DICK | Premier League |
| 0009 | Vitside Mafia | VIT | Premier League |
| 0011 | Midwestside Connection | MWS | D-League |

### National League (Conference 01)

#### East Division
| ID | Team Name | Abbrev | Tier |
|----|-----------|--------|------|
| 0015 | The Mariachi Ninjas | NINJAS | Premier League |
| 0017 | Titsburgh Feelers | TITS | D-League |
| 0019 | Badd Boys | BADD | Premier League |
| 0022 | Balls Deep | BALLS | Premier League |
| 0023 | Cock Gobbler | DkLuvr | D-League |
| 0024 | No Soup For You | SOUP | D-League |

#### West Division
| ID | Team Name | Abbrev | Tier |
|----|-----------|--------|------|
| 0013 | Muck Juggling Micks | MICKS | D-League |
| 0014 | Thundering Herd | HERD | D-League |
| 0016 | Swiftie 4 Life | SWIFTY | D-League |
| 0018 | Jewpacabra | JEW | D-League |
| 0020 | The Boondock Saints | SAINTS | Premier League |
| 0021 | Chatmaster | CHAT | Premier League |

---

## MFL API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `TYPE=league` | Full league configuration |
| `TYPE=rules` | Scoring rules by position |
| `TYPE=rosters` | Current team rosters |

**Base URL:** `https://api.myfantasyleague.com/{year}/export?TYPE={type}&L=19621&JSON=1`

---

## Feature Flags

From `afl.config.json`:

| Feature | Enabled |
|---------|---------|
| Salary Averages | No |
| Toilet Bowl | No |
| Draft Predictor | Yes |
| Contract Management | No |

---

## Key Implications for Features

### Compared to TheLeague
- No salary cap calculations needed
- No contract year tracking
- Keeper selections drive roster management instead of cap space
- TE Premium scoring (1.5 PPR) makes TEs more valuable than in TheLeague
- Full PPR for RBs (vs quarter PPR in TheLeague) changes RB valuations
- Extended season (Week 18) affects playoff scheduling
- Tier system (Premier League/D-League) adds promotion/relegation dynamics
