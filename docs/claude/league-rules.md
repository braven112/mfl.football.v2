# TheLeague Rules Reference

Complete rules for TheLeague (MFL ID: 13522), fetched from MFL API.

---

## League Overview

| Setting | Value |
|---------|-------|
| **League Name** | The League |
| **MFL ID** | 13522 |
| **Established** | 2007 |
| **Format** | Dynasty / Keeper |
| **Teams** | 16 franchises |
| **Divisions** | 4 (Northwest, Southwest, Central, Eastern) |
| **Head-to-Head** | Yes |

---

## Roster Configuration

| Setting | Value |
|---------|-------|
| **Roster Size** | 22 players |
| **Taxi Squad** | 3 spots |
| **Injured Reserve** | 50 slots |
| **Total Capacity** | 75 spots (22 active + 3 taxi + 50 IR) |

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

## Salary Cap & Contract Rules

| Setting | Value |
|---------|-------|
| **Salary Cap** | $45,000,000 |
| **Uses Salaries** | Yes |
| **Uses Contract Years** | Yes |
| **Salary Escalation** | 10% annually |
| **Taxi Squad Cap Impact** | 50% (players count at half salary) |
| **IR Cap Impact** | 100% (players count full salary) |

### Contract Designations

| Code | Meaning | Description |
|------|---------|-------------|
| `F` | Franchise Tag | Premium retention designation |
| `R` | Rookie Contract | Rookie Contract status |
| `R1` | 1st Rnd. Contract | 1st Round Rookie Contract status |
| (blank) | Standard | Normal contract |

### Key Constants (from codebase)

```typescript
SALARY_CAP = 45_000_000       // $45M hard cap
ROSTER_LIMIT = 28             // Maximum active roster
ESCALATION_RATE = 1.10        // 10% annual salary increase
```

---

## Waiver & Free Agency Rules (BBID)

| Setting | Value |
|---------|-------|
| **Waiver Type** | BBID FCFS (Blind Bid + First-Come-First-Served) |
| **BBID Minimum** | $425,000 |
| **BBID Increment** | $25,000 |
| **BBID Tiebreaker** | Sort order |
| **BBID Conditional** | Yes |
| **Max Waiver Rounds** | 4 |
| **Lockout** | Yes (roster lock during games) |

---

## Draft Rules (Rookie Draft)

| Setting | Value |
|---------|-------|
| **Draft Type** | Email-based (slow draft) |
| **Player Pool** | Rookies only |
| **Timer** | ONS (overnight suspension) |
| **Timer Suspension** | 03:00 - 07:00 PT |
| **Pick Time Limit** | 12 hours per pick |

---

## Season Structure

| Setting | Value |
|---------|-------|
| **Start Week** | 1 |
| **Last Regular Season Week** | 14 |
| **Playoff Weeks** | 15-17 |
| **End Week** | 17 |
| **Partial Lineups** | Not allowed |
| **Best Lineup** | No (actual lineup used) |

### Standings Tiebreakers (in order)

1. Win Percentage (PCT)
2. Head-to-Head (H2H)
3. Division Win Percentage (DIVPCT)
4. All-Play Percentage (ALL_PLAY_PCT)
5. Points Scored (PTS)
6. Power Ranking (PWR)
7. Victory Points (VICTORY_POINTS)
8. Opponent Points (OPP_PTS)

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

### Receiving (Position-Specific PPR)

**Reception Points by Position:**

| Position | PPR Value | Name |
|----------|-----------|------|
| TE | 1.0 | Full PPR |
| WR | 0.5 | Half PPR |
| RB | 0.25 | Quarter PPR |

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
| Points Allowed 0-35 | 15 |
| Points Allowed 36+ | -6 |

### Miscellaneous

| Category | Points |
|----------|--------|
| Fumble Lost | -2 |
| Return Yards | 0.03/yard |

---

## 16 Franchises

| ID | Team Name | Abbrev | Division |
|----|-----------|--------|----------|
| 0001 | Pacific Pigskins | SKINS | Northwest |
| 0002 | Da Dangsters | DANG | Northwest |
| 0003 | Maverick | MAVS | Central |
| 0004 | Heavy Chevy | CHEVY | Southwest |
| 0005 | The Mariachi Ninjas | NINJA | Central |
| 0006 | The Music City Mafia | MUSIC | Southwest |
| 0007 | Fire Ready Aim | FIRE | Eastern |
| 0008 | Bring the Pain | PAIN | Central |
| 0009 | Wascawy Wabbits | WABS | Eastern |
| 0010 | Computer Jocks | JOCKS | Northwest |
| 0011 | Midwestside Connection | MWS | Southwest |
| 0012 | Vitside Mafia | VIT | Northwest |
| 0013 | Gridiron Geeks | GEEKS | Southwest |
| 0014 | Cowboy Up | CBOY | Central |
| 0015 | Dark Magicians of Chaos | DMOC | Eastern |
| 0016 | Running Down The Dream | DREAM | Eastern |

### Divisions

| Division | Teams |
|----------|-------|
| **Northwest** | Pacific Pigskins, Da Dangsters, Computer Jocks, Vitside Mafia |
| **Southwest** | Heavy Chevy, The Music City Mafia, Midwestside Connection, Gridiron Geeks |
| **Central** | Maverick, The Mariachi Ninjas, Bring the Pain, Cowboy Up |
| **Eastern** | Fire Ready Aim, Wascawy Wabbits, Dark Magicians of Chaos, Running Down The Dream |

---

## MFL API Endpoints for Rules

| Endpoint | Purpose |
|----------|---------|
| `TYPE=league` | Full league configuration, roster rules, divisions |
| `TYPE=rules` | Scoring rules by position |
| `TYPE=salaries` | Player salary/contract data |
| `TYPE=rosters` | Current team rosters |

**Base URL:** `https://api.myfantasyleague.com/{year}/export?TYPE={type}&L=13522&JSON=1`

---

## Key Implications for Features

### Auction Price Predictor
- Must account for 10% annual escalation
- Taxi squad players at 50% cap impact
- Position-specific PPR affects player valuations (TEs most valuable for receptions)

### Roster Management
- 22 active roster spots + 3 taxi + 50 IR
- Flexible RB/WR/TE starting requirements

### Trade Analysis
- Contract years and salaries are critical factors
- Franchise tag (F) and RFA (R2) designations affect value
