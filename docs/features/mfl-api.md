# MFL API Reference Documentation

Comprehensive reference for MyFantasyLeague (MFL) API endpoints used in this project, organized by feature area.

## Quick Links

- **Official MFL API Explorer:** https://www49.myfantasyleague.com/2025/options?L=13522&O=79
- **Complete API Documentation:** https://www49.myfantasyleague.com/2025/api_info?STATE=details&L=13522
- **Current Year:** 2025

### Supported Leagues

| League | MFL ID | Host Server | Type |
|--------|--------|-------------|------|
| TheLeague | 13522 | www49 | Dynasty Salary Cap |
| AFL Fantasy | 19621 | www44 | Keeper (24-team) |

## Base URL Patterns

```
Export:  https://api.myfantasyleague.com/YEAR/export?TYPE=REQUEST_TYPE&L=LEAGUE_ID&[PARAMS]
Import:  https://api.myfantasyleague.com/YEAR/import?TYPE=REQUEST_TYPE&L=LEAGUE_ID&[PARAMS]
Misc:    https://api.myfantasyleague.com/YEAR/REQUEST?[PARAMS]
```

## Authentication Guide

### Environment Variables

| Variable | Purpose | Required | Default |
|----------|---------|----------|---------|
| `MFL_LEAGUE_ID` | League identifier | Yes | 13522 |
| `MFL_YEAR` | Season year | No | Current year |
| `MFL_WEEK` | Week number for weekly data | No | null (YTD) |
| `MFL_HOST` | API host URL | No | https://api.myfantasyleague.com |
| `MFL_USER_ID` | User ID for cookie auth | For owner endpoints | - |
| `MFL_APIKEY` | API key for authenticated requests | For assets endpoint | - |

### Authentication Methods

**Cookie-Based Authentication**
- Used for most owner-level endpoints
- Set `MFL_USER_ID` as an HTTP cookie header
- Required for: `moveToIR`, personal lineups, etc.
- Implementation: [src/utils/mfl-matchup-api.ts](src/utils/mfl-matchup-api.ts), [src/utils/mfl-login.ts](src/utils/mfl-login.ts)

**APIKEY Parameter**
- Used for specific authenticated endpoints like `assets`
- Pass as query parameter: `APIKEY={key}`
- Implementation: [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs#L121)

### Access Levels

- **Public:** No authentication required
- **Owner:** League owner/franchise member required (cookie auth)
- **Commissioner:** League commissioner only (elevated cookie auth)

## API Endpoints by Feature Area

### A. Draft & Auction

#### `draftResults` ✅ Currently Used
**Purpose:** Draft selections and order with trade history in comments

**Parameters:**
- Required: `L` (league ID)
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=draftResults&L=13522&JSON=1
```

**Used In:**
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs)

**Notes:** Includes trade chain information in comments field

---

#### `auctionResults`
**Purpose:** Auction picks and prices

**Parameters:**
- Required: `L` (league ID)
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=auctionResults&L=13522&JSON=1
```

---

#### `futureDraftPicks`
**Purpose:** Future draft picks by franchise (for multiple years ahead)

**Parameters:**
- Required: `L` (league ID)
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=futureDraftPicks&L=13522&JSON=1
```

**Notes:** Shows future year draft pick ownership

---

#### `assets` ✅ Currently Used
**Purpose:** Tradable players and draft picks currently owned by each team

**Parameters:**
- Required: `L` (league ID), `APIKEY` (authentication key)
- Auth: Owner (requires APIKEY)

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=assets&L=13522&APIKEY={key}&JSON=1
```

**Used In:**
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs)

**Notes:**
- Requires retry logic (3 retries, 1.5s delay) due to occasional timeouts
- Essential for Draft Pick Predictor feature
- Shows current pick ownership after trades

---

#### `myDraftList` (Export)
**Purpose:** Current franchise's draft board and player rankings

**Parameters:**
- Required: `L` (league ID)
- Optional: `APIKEY` (alternative to cookie auth)
- Auth: Owner (requires `MFL_USER_ID` cookie or `APIKEY`)

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=myDraftList&L=13522&JSON=1
```

**Key Insights (updated 2026-02-27):**
- Returns the authenticated franchise's ordered draft board (list of player IDs)
- Franchise is determined by the auth cookie — no `FRANCHISE_ID` parameter
- Without authentication, returns an error: `"API requires logged in user in league ID..."`
- Response structure (authenticated): Expected to be a `myDraftList` object with ordered player IDs (needs auth testing to confirm exact format)

---

#### `myDraftList` (Import) — WRITE ENDPOINT
**Purpose:** Set the players in an owner's "My Draft List." Completely overwrites the previous draft list.

**Parameters:**
- Required: `L` (league ID), `PLAYERS` (comma-separated player IDs)
- Auth: Owner (requires `MFL_USER_ID` cookie)

**Example:**
```
POST https://api.myfantasyleague.com/2025/import?TYPE=myDraftList&L=13522
Body: PLAYERS=15379,14836,16457,15960,14803,16413
```

**Key Insights (updated 2026-02-27):**
- **Destructive overwrite** — the entire previous draft list is replaced; no partial updates
- The order of player IDs in `PLAYERS` defines the draft board ranking order
- POST is strongly recommended — large draft boards (200+ players) can exceed GET URL length limits
- Franchise is determined by the auth cookie — always operates on the logged-in user's franchise
- **Workflow for custom rankings:** Export current list → modify in UI → re-import full list
- No "move player" or "insert at position" granularity — you must send the complete ordered list every time
- **draftPlayerPool relationship (updated 2026-02-27):** TheLeague (13522) has `draftPlayerPool: "Rookie"`, meaning the MFL draft itself only allows selecting rookies. However, the myDraftList API is a **personal ranking tool**, not a draft-pool-restricted feature. The MFL UI describes it as a guide that "appears in the website's Live Draft Room" — it is conceptually separate from the draft pool. Testing with auth is needed to confirm whether the API accepts arbitrary player IDs or enforces the pool restriction. The MFL help docs describe it as a pre-draft organizational tool.

---

#### `myWatchList` (Export)
**Purpose:** Personal player watch list for tracking players of interest (free agents, trade targets, etc.)

**Parameters:**
- Required: `L` (league ID)
- Auth: Owner (requires `MFL_USER_ID` cookie or `APIKEY`)

**Example:**
```
https://api.myfantasyleague.com/2026/export?TYPE=myWatchList&L=13522&JSON=1
```

**Key Insights (added 2026-02-27):**
- Returns the authenticated franchise's watch list (list of player IDs)
- Franchise is determined by the auth cookie — no `FRANCHISE_ID` parameter
- Without authentication, returns: `"API requires logged in user in league ID..."`
- Response structure (authenticated): Expected to be a `myWatchList` object with player IDs (needs auth testing to confirm exact format)
- The MFL web UI page for this feature is `options?L={LEAGUE_ID}&O=178`
- **Key difference from myDraftList:** Watch list is an unordered set for tracking players throughout the season; draft list is an ordered ranking for draft preparation

---

#### `myWatchList` (Import) — WRITE ENDPOINT
**Purpose:** Add or remove players from an owner's personal watch list

**Parameters:**
- Required: `L` (league ID)
- Optional: `ADD` (comma-separated player IDs to add), `REMOVE` (comma-separated player IDs to remove)
- Auth: Owner (requires `MFL_USER_ID` cookie)

**Example:**
```
POST https://api.myfantasyleague.com/2026/import?TYPE=myWatchList&L=13522
Body: ADD=15379,14836,16457
```

**Key Insights (added 2026-02-27):**
- **Non-destructive updates** — unlike myDraftList, you can ADD and REMOVE individual players without overwriting the entire list
- Supports incremental modifications (ADD only, REMOVE only, or both in one request)
- Franchise is determined by the auth cookie — always operates on the logged-in user's franchise
- **No apparent player restrictions** — the API docs do not mention any limitation on which players can be added (rostered, free agent, rookie, veteran all appear to be valid)
- **No apparent size limit** — the API docs do not document a maximum list size
- **Best candidate for full-player custom rankings** — since it accepts ADD/REMOVE (incremental) and appears to accept any player, this could serve as backend storage for a custom rankings feature that spans all players (not just rookies)

---

### Personal Player Lists: Comparison (added 2026-02-27)

| Feature | `myDraftList` | `myWatchList` |
|---------|---------------|---------------|
| **Purpose** | Ordered draft board for draft preparation | Unordered player tracking list |
| **Order** | Ordered (ranking position matters) | Unordered (set membership) |
| **Update style** | Destructive overwrite (PLAYERS=full list) | Incremental (ADD/REMOVE) |
| **Possible pool restriction** | May be limited to draftPlayerPool (rookies in TheLeague) — needs testing | No documented restrictions |
| **Use during season** | Primarily pre-draft tool | Year-round player tracking |
| **MFL UI page** | Draft section (O=07) | For Owners > My Watch List (O=178) |
| **Custom rankings fit** | Good for rookie draft rankings | Better for full-player rankings |

---

### B. Rosters & Free Agents

#### `rosters` ✅ Currently Used
**Purpose:** Current rosters with salary/contract information

**Parameters:**
- Required: `L` (league ID)
- Optional: `FRANCHISE` (specific team), `W` (week number)
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=rosters&L=13522&JSON=1
https://api.myfantasyleague.com/2025/export?TYPE=rosters&L=13522&W=15&JSON=1
```

**Used In:**
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs)
- [src/utils/mfl-matchup-api.ts](src/utils/mfl-matchup-api.ts)

**Key Insights (updated 2026-02-13):**
- **WARNING:** During the offseason pre-rollover window (season end through Feb 14), the `rosters` endpoint can return STALE data. Players that have been dropped may still appear on rosters, even hours after the drop.
- The `transactions` (TYPE=FREE_AGENT) and `freeAgents` endpoints correctly reflect recent drops during this period.
- Transaction format for drops: `|{player_id},` (pipe prefix = drop-only, no add)
- To get accurate rosters during the offseason, cross-reference with recent transactions and filter out dropped players.
- The `FRANCHISE` parameter filters to a single franchise (e.g., `FRANCHISE=0001`)
- The `W` (week) parameter returns the roster as of that week; omitting it returns the current/latest roster
- Response includes `week` field on each franchise indicating the roster snapshot week

---

#### `freeAgents`
**Purpose:** Available free agents not rostered by any team

**Parameters:**
- Required: `L` (league ID)
- Optional: `POSITION` (filter by position)
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=freeAgents&L=13522&JSON=1
https://api.myfantasyleague.com/2025/export?TYPE=freeAgents&L=13522&POSITION=QB&JSON=1
```

---

### C. Scoring & Results

#### `weeklyResults` ✅ Currently Used
**Purpose:** Weekly scores for starters and non-starters

**Parameters:**
- Required: `L` (league ID)
- Optional: `W` (week number, or "YTD"), `MISSING_AS_BYE`
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=weeklyResults&L=13522&W=1&JSON=1
https://api.myfantasyleague.com/2025/export?TYPE=weeklyResults&L=13522&W=YTD&JSON=1
```

**Used In:**
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs) (fetches weeks 1-14 individually)

**Notes:** Used to generate normalized weekly-results.json

---

#### `liveScoring` ✅ Currently Used
**Purpose:** Real-time franchise scores with remaining game seconds

**Parameters:**
- Required: `L` (league ID)
- Optional: `W` (week), `DETAILS`
- Auth: Public

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=liveScoring&L=13522&W=15&JSON=1
```

**Used In:**
- [src/pages/api/live-scoring.ts](src/pages/api/live-scoring.ts)

**Notes:** Updates in real-time during games

---

#### `playerScores`
**Purpose:** Individual player scores per week

**Parameters:**
- Required: `L` (league ID)
- Optional: `W` (week), `YEAR`, `PLAYERS`, `POSITION`, `STATUS`, `RULES`, `COUNT`
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=playerScores&L=13522&W=15&JSON=1
```

---

#### `projectedScores` ✅ Currently Used
**Purpose:** Expected fantasy points using league scoring rules

**Parameters:**
- Required: `L` (league ID)
- Optional: `W` (week), `PLAYERS`, `POSITION`, `STATUS`, `COUNT`
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=projectedScores&L=13522&W=15&JSON=1
```

**Used In:**
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs)
- [src/utils/mfl-matchup-api.ts](src/utils/mfl-matchup-api.ts)
- [scripts/mfl-api-wrapper.js](scripts/mfl-api-wrapper.js)

---

#### `pointsAllowed` (Defense vs Position / DVP)
**Purpose:** Fantasy points allowed by each NFL team's defense, broken out by position. This is the "Defense vs Position" (DVP) data — shows how many fantasy points each NFL defense allowed to QB, RB, WR, TE, PK, and Def over the full season.

**Parameters:**
- Required: `L` (league ID) — scoring is league-specific (uses your league's scoring rules)
- Optional: `W` (week) — **WARNING: `W` parameter is accepted but IGNORED. The endpoint always returns full-season totals regardless of week parameter.**
- Auth: Public (no authentication required)

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=pointsAllowed&L=13522&JSON=1
```

**Response Structure:**
```json
{
  "pointsAllowed": {
    "team": [
      {
        "id": "DET",
        "position": [
          { "name": "QB", "points": "347.02" },
          { "name": "RB", "points": "283.25" },
          { "name": "WR", "points": "526.55" },
          { "name": "TE", "points": "201.7" },
          { "name": "PK", "points": "143.7" },
          { "name": "Def", "points": "61.22" }
        ]
      }
    ]
  },
  "encoding": "utf-8",
  "version": "1.0"
}
```

**Key Insights (updated 2026-02-24):**
- Returns **full-season cumulative totals**, NOT averages or per-week data
- To get per-game averages, divide by games played (typically 17 for full season)
- All 32 NFL teams are included in the response
- Each team has 6 position entries: QB, RB, WR, TE, PK, Def
- **Quirk:** Some teams have a 7th entry with `"name": ""` and `"points": "0"` — filter these out
- Points are string values, not numbers — parse to float for calculations
- Team codes use MFL non-standard abbreviations (KCC, JAC, NEP, NOS, GBP, TBB, SFO, LVR) — use `normalizeTeamCode()` when matching to standard NFL codes
- Position order varies by team in the response (not guaranteed to be QB, RB, WR, TE, PK, Def)
- League ID is required because scoring is calculated using your league's specific scoring rules (PPR settings, passing TD values, etc.)
- The `W` parameter has zero effect on the response — tested with W=1, W=5, W=10, W=YTD, all return identical season totals
- No per-week breakdown is available from this endpoint; to compute weekly DVP, you would need to use `playerScores` per week and cross-reference with `nflSchedule` to determine opponents
- This corresponds to the "Points Allowed - By Position" report page in the MFL web interface
- The MFL "Coach" tab on the website likely uses this data combined with `projectedScores` and `schedule` data to generate start/sit recommendations

**Use Cases:**
- Defense vs Position rankings (DVP charts)
- Start/sit recommendations based on matchup difficulty
- Identifying favorable/unfavorable matchups for each position
- Weekly lineup optimization when combined with schedule data

**Computed Per-Game Average Example:**
```typescript
// To get per-game averages:
const gamesPlayed = 17; // full regular season
const avgPointsAllowed = parseFloat(position.points) / gamesPlayed;
```

**Related APIs:**
- `nflSchedule` — Get upcoming NFL matchups to pair with DVP data
- `playerScores` — For computing weekly DVP breakdowns manually
- `projectedScores` — MFL's own projections (may already factor in matchups)
- `whoShouldIStart` — MFL's start/sit advisor (requires auth)

---

### D. Standings & Playoffs

#### `leagueStandings` ✅ Currently Used
**Purpose:** Current standings with customizable columns

**Parameters:**
- Required: `L` (league ID)
- Optional: `COLUMN_NAMES`, `ALL`, `WEB`
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=standings&L=13522&JSON=1
```

**Used In:**
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs) (as `TYPE=standings`)

**Notes:** Used for Draft Pick Predictor feature with reversed tiebreaker logic

---

#### `playoffBrackets` ✅ Currently Used
**Purpose:** All playoff brackets metadata (main playoffs and toilet bowl)

**Parameters:**
- Required: `L` (league ID)
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=playoffBrackets&L=13522&JSON=1
```

**Used In:**
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs)

**Notes:** Returns list of available brackets with their IDs

---

#### `playoffBracket` ✅ Currently Used
**Purpose:** Specific bracket games/results (includes toilet bowl tournament)

**Parameters:**
- Required: `L` (league ID), `BRACKET_ID`
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=playoffBracket&L=13522&BRACKET_ID=1&JSON=1
```

**Used In:**
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs)
- [src/utils/mfl-schedule-integration.ts](src/utils/mfl-schedule-integration.ts)

**Notes:**
- Bracket IDs typically: 1 (main playoffs), 2 (toilet bowl)
- Used for toilet bowl special draft picks (1.17, 2.17, 2.18)

---

### E. Transactions & Trades

#### `transactions` ✅ Currently Used
**Purpose:** Non-pending transactions; shows pending if you're the owner

**Parameters:**
- Required: `L` (league ID)
- Optional: `W` (week), `TRANS_TYPE`, `FRANCHISE`, `DAYS`, `COUNT`
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=transactions&L=13522&JSON=1
https://api.myfantasyleague.com/2025/export?TYPE=transactions&L=13522&W=15&JSON=1
```

**Used In:**
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs)

---

#### `tradeBait` (Export) ✅ Currently Used
**Purpose:** Trade bait for all franchises

**Parameters:**
- Required: `L` (league ID)
- Optional: `INCLUDE_DRAFT_PICKS`
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=tradeBait&L=13522&JSON=1
https://api.myfantasyleague.com/2025/export?TYPE=tradeBait&L=13522&INCLUDE_DRAFT_PICKS=1&JSON=1
```

**Response Structure (confirmed from `fetch-trade-bait.mjs`):**
```json
{
  "tradeBaits": {
    "tradeBait": [
      {
        "franchise_id": "0008",
        "willGiveUp": "15749,14836",
        "inExchangeFor": "Looking for WR1"
      }
    ]
  }
}
```

Note: `willGiveUp` uses camelCase in the export response, but `WILL_GIVE_UP` (screaming snake case) in the import request. The export field may be a comma-separated string without a trailing comma (unlike `pendingTrades` which has a trailing comma).

**Used In:**
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs)
- [scripts/fetch-trade-bait.mjs](scripts/fetch-trade-bait.mjs)

---

#### `pendingWaivers`
**Purpose:** Owner's submitted waivers awaiting processing

**Parameters:**
- Required: `L` (league ID)
- Optional: `FRANCHISE_ID`
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=pendingWaivers&L=13522&JSON=1
```

---

#### `pendingTrades`
**Purpose:** Offered and received trade proposals

**Parameters:**
- Required: `L` (league ID)
- Optional: `FRANCHISE_ID`
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=pendingTrades&L=13522&JSON=1
```

---

### F. League Configuration

#### `league` ✅ Currently Used
**Purpose:** General setup parameters, rosters, franchise/division names

**Parameters:**
- Required: `L` (league ID)
- Optional: Cookie (commissioner shows private data)
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=league&L=13522&JSON=1
```

**Used In:**
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs)
- [src/utils/mfl-matchup-api.ts](src/utils/mfl-matchup-api.ts)

**Response Structure (key fields):**
```json
{
  "league": {
    "name": "The League",
    "id": "13522",
    "salaryCapAmount": "45000000",
    "rosterSize": "22",
    "taxiSquad": "3",
    "injuredReserve": "50",
    "usesSalaries": "1",
    "usesContractYear": "1",
    "keeperType": "dynasty",
    "h2h": "YES",
    "lastRegularSeasonWeek": "14",
    "endWeek": "17",
    "draftPlayerPool": "Rookie",
    "currentWaiverType": "BBID_FCFS",
    "bbidMinimum": "425000",
    "bbidIncrement": "25000",
    "includeTaxiWithSalary": "50",
    "includeIRWithSalary": "100",
    "starters": { "count": "9", "position": [...] },
    "franchises": { "franchise": [...], "count": "16" },
    "divisions": { "division": [...], "count": "4" },
    "history": { "league": [...] }
  }
}
```

**Key Insights (updated 2026-01-17):**
- Contains ALL league configuration including salary cap, roster rules, waiver settings
- `starters.position` array defines starting lineup requirements with min-max limits
- `franchises.franchise` includes `bbidAvailableBalance` for each team's remaining FAAB
- `includeTaxiWithSalary: "50"` means taxi squad players count 50% toward cap
- `includeIRWithSalary: "100"` means IR players count 100% toward cap
- `history.league` array provides URLs to all historical league years
- Note: API redirects from `api.myfantasyleague.com` to the league's specific host (e.g., www49 for 13522, www44 for 19621)
- `usesSalaries: "0"` indicates no salary cap (AFL Fantasy), `usesSalaries: "1"` indicates salary cap league (TheLeague)
- `usesContractYear: "0"` indicates no contract years (keeper league), `usesContractYear: "1"` indicates dynasty contracts
- `playerLimitUnit` can be "LEAGUE" (one copy per league) or "CONFERENCE" (one copy per conference)
- `conferences` object only present in leagues with conference structure (AFL Fantasy has 2 conferences)
- `divisions.division[].conference` links divisions to their parent conference

---

#### `rules`
**Purpose:** League scoring rules and settings

**Parameters:**
- Required: `L` (league ID)
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=rules&L=13522&JSON=1
```

**Response Structure:**
```json
{
  "rules": {
    "positionRules": [
      {
        "positions": "QB|RB|WR|TE|PK",
        "rule": [
          { "event": "#P", "points": "0.04" },
          { "event": "#P_20_99_1", "points": "1" },
          { "event": "PC", "points": "6" },
          ...
        ]
      },
      { "positions": "Def", "rule": [...] }
    ]
  }
}
```

**Common Event Codes:**
| Code | Description |
|------|-------------|
| `#P` | Passing yards (per yard) |
| `PC` | Passing TD |
| `IN` | Interception thrown |
| `#R` | Rushing yards (per yard) |
| `RC` | Rushing TD |
| `#C` | Receiving yards (per yard) |
| `CC` | Receiving TD |
| `RZ` | Reception (PPR) |
| `FL` | Fumble lost |
| `FG` | Field goal made |
| `PA` | Points allowed (defense) |
| `SK` | Sacks |
| `IR` | Interception return |

**Key Insights (updated 2026-01-17):**
- Scoring rules are position-specific, with position groups like "QB|RB|WR|TE|PK"
- PPR values vary by position AND by league:
  - TheLeague (13522): TE=1.0, WR=0.5, RB=0.25
  - AFL Fantasy (19621): TE=1.5 (TE premium), WR=1.0, RB=1.0
- Passing TDs worth 6 points (non-standard, many leagues use 4)
- Range rules use format like `#P_20_99_1` (passing yards 20-99, 1 bonus point)
- Defense points allowed (OPA) scoring can be tiered (specific point values per PA range) or linear formula
- TheLeague uses simplified formula: `15 - (0.6 * PA)` for 0-35 PA, then -6 + (-0.01 * PA) for 36+
- AFL Fantasy uses detailed tiered OPA scoring with specific values at each point threshold
- Common event codes: CC=catch count (PPR), #P=pass TD count, #R=rush TD count, #C=catch TD count
- `*` prefix on points means "multiply by count" (e.g., `*0.1` for 0.1 points per yard)

---

#### `schedule` ✅ Currently Used
**Purpose:** Fantasy matchup schedule

**Parameters:**
- Required: `L` (league ID)
- Optional: `W` (week), `F` (franchise)
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=schedule&L=13522&JSON=1
https://api.myfantasyleague.com/2025/export?TYPE=schedule&L=13522&W=15&JSON=1
```

**Used In:**
- [src/utils/mfl-matchup-api.ts](src/utils/mfl-matchup-api.ts)
- [packages/mfl-data-fetcher/src/index.ts](packages/mfl-data-fetcher/src/index.ts)

---

#### `calendar` (Export)
**Purpose:** League calendar events — returns all events currently on the MFL league calendar

**Parameters:**
- Required: `L` (league ID)
- Auth: Owner (requires `MFL_USER_ID` cookie or `APIKEY`)

**Response Formats:**
- `JSON=1` → JSON object with calendar events
- `XML=1` → XML calendar data
- Default (no format param) → ICS (iCalendar) format for calendar app subscriptions

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=calendar&L=13522&JSON=1
https://api.myfantasyleague.com/2025/export?TYPE=calendar&L=13522
```

**Key Insights (updated 2026-03-08):**
- Requires authentication — returns error without `MFL_USER_ID` cookie or `APIKEY`
- The default (no JSON/XML param) response format appears to be ICS per the MFL API overview documentation
- Contains both MFL system-generated events (waiver processing, trade deadlines) and commissioner-created custom events
- The JSON response structure needs authenticated testing to confirm exact field names

---

#### `calendarEvent` (Import) — WRITE ENDPOINT
**Purpose:** Add events to the MFL league calendar. Commissioner-only write endpoint.

**Endpoint:**
```
POST https://api.myfantasyleague.com/{YEAR}/import?TYPE=calendarEvent&L={LEAGUE_ID}
```

**Parameters:**
- `L` (required): League ID
- `EVENT_TYPE` (required): Event category identifier. Known values:
  - `DRAFT_START` — Draft start time
  - `AUCTION_START` — Auction start time
  - `TRADE` — Trade deadline
  - `WAIVER_REVERSE` — Reverse-order waiver processing
  - `WAIVER_BBID` — Blind bid waiver processing
  - `WAIVER_UNLOCK` — Waivers unlock (free agency opens)
  - `WAIVER_LOCK` — Waivers lock (roster lock)
  - `CUSTOM` — Custom/user-defined event
- `START_TIME` (required): Unix timestamp (seconds) for event start
- `END_TIME` (optional): Unix timestamp (seconds) for event end
- `HAPPENS` (optional): Number of weeks to repeat the event (creates recurring weekly events)

**Authentication:** Commissioner-level cookie required

**Method:** POST (import endpoints are POST-based)

**Key Insights (updated 2026-03-08):**
- **Commissioner-only** — requires commissioner-level MFL session cookie, not just owner auth
- The `HAPPENS` parameter creates recurring events: setting `HAPPENS=17` with a weekly event would create it for all 17 NFL weeks
- `EVENT_TYPE` values like `TRADE`, `WAIVER_BBID`, `WAIVER_LOCK`, `WAIVER_UNLOCK` correspond to MFL functional events that may actually **control league behavior** (e.g., setting `TRADE` with a `START_TIME` may set/move the trade deadline)
- `CUSTOM` type is for informational events that don't affect league mechanics
- **No documented delete/edit API** — there is no known way to delete or modify existing calendar events via the API. If an event needs to be changed, you may need to re-create it or use the MFL web UI
- The distinction between "functional" event types (TRADE, WAIVER_*) and "informational" (CUSTOM) needs authenticated testing to confirm whether importing a TRADE event actually moves the trade deadline or just adds a calendar entry
- Unix timestamps are assumed to be in **seconds** (standard Unix time), not milliseconds

**Example — Add a custom offseason event:**
```
POST https://api.myfantasyleague.com/2025/import?TYPE=calendarEvent&L=13522
Content-Type: application/x-www-form-urlencoded
Cookie: MFL_USER_ID={commissioner_cookie}

EVENT_TYPE=CUSTOM&START_TIME=1711065600&END_TIME=1711152000
```

**Example — Set recurring weekly waiver processing:**
```
POST https://api.myfantasyleague.com/2025/import?TYPE=calendarEvent&L=13522
Content-Type: application/x-www-form-urlencoded
Cookie: MFL_USER_ID={commissioner_cookie}

EVENT_TYPE=WAIVER_BBID&START_TIME=1725580800&HAPPENS=17
```

**Related APIs:**
- `calendar` (export) — Read back all calendar events
- `league` (export) — Contains some league date settings (trade deadlines, waiver configuration) in the league setup

---

### G. Players & Injuries

#### `players` ✅ Currently Used
**Purpose:** All player IDs, names, positions, teams

**Parameters:**
- Required: `L` (optional for global player list)
- Optional: `DETAILS`, `SINCE`, `PLAYERS`
- Auth: Public

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=players&L=13522&DETAILS=1&JSON=1
```

**Used In:**
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs)
- [src/utils/mfl-matchup-api.ts](src/utils/mfl-matchup-api.ts)
- [scripts/mfl-api-wrapper.js](scripts/mfl-api-wrapper.js)

**Notes:**
- Results in large file (~1.5MB)
- `DETAILS=1` includes additional player metadata

---

#### `injuries` ✅ Currently Used
**Purpose:** NFL injury report status and details

**Parameters:**
- Optional: `W` (week)
- Auth: Public

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=injuries&L=13522&JSON=1
```

**Used In:**
- [src/utils/mfl-matchup-api.ts](src/utils/mfl-matchup-api.ts)
- [scripts/mfl-api-wrapper.js](scripts/mfl-api-wrapper.js)

---

#### `playerProfile`
**Purpose:** Player bio, height/weight, Average Draft Position

**Parameters:**
- Required: `P` (player ID)
- Auth: Public

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=playerProfile&P=14292&JSON=1
```

---

#### `playerRanks`
**Purpose:** External expert player rankings from FantasySharks.com. Read-only reference data, not personalized.

**Parameters:**
- Optional: `POS` (filter by position, e.g., QB, RB, WR, TE)
- Optional: `SOURCE` (ranking source, default is `sharks`)
- Auth: Public (no authentication required, no league ID needed)

**Example:**
```
https://api.myfantasyleague.com/2026/export?TYPE=playerRanks&JSON=1
https://api.myfantasyleague.com/2026/export?TYPE=playerRanks&POS=QB&JSON=1
```

**Response Structure (confirmed 2026-02-27):**
```json
{
  "player_ranks": {
    "player": [
      { "rank": "1", "id": "15281", "last_week": "1", "change": "0" },
      { "rank": "2", "id": "16211", "last_week": "2", "change": "0" },
      { "rank": "3", "id": "16162", "last_week": "3", "change": "0" }
    ]
  }
}
```

**Key Insights (added 2026-02-27):**
- Returns ranked list of ALL players (not league-specific, not draft-pool-restricted)
- Fields: `rank`, `id`, `last_week`, `change` — all string values
- `change` can be numeric string (e.g., "0", "5", "-3") or "NEW" for newly ranked players
- Field order in JSON varies between entries (not guaranteed)
- **Not personalizable** — these are static expert rankings, not user-editable
- Could serve as a **seed/default ordering** for a custom rankings feature
- Must go to `api.myfantasyleague.com` (not www49 etc.) — direct host URLs return an error
- No league ID required — these are cross-league rankings

---

### H. Salaries & Contracts

#### `salaries`
**Purpose:** Player salaries and contract details

**Parameters:**
- Required: `L` (league ID)
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=salaries&L=13522&JSON=1
```

---

#### `salaryAdjustments` ✅ Currently Used
**Purpose:** League-wide salary adjustments and cap changes

**Parameters:**
- Required: `L` (league ID)
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=salaryAdjustments&L=13522&JSON=1
```

**Used In:**
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs)

---

### I. Import Endpoints (Write Operations)

#### `lineup` (Import) — WRITE ENDPOINT
**Purpose:** Set the weekly starting lineup for a franchise. Completely overwrites any previously submitted lineup for that week.

**Endpoint:**
```
POST https://api.myfantasyleague.com/{YEAR}/import?TYPE=lineup&L={LEAGUE_ID}
```

**Parameters (POST body, `application/x-www-form-urlencoded`):**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `TYPE` | Yes | Must be `lineup` |
| `L` | Yes | League ID |
| `W` | Yes | Week number (e.g., `14`) |
| `STARTERS` | Yes | Comma-separated MFL player IDs — see format below |
| `COMMENTS` | No | Short message saved with lineup submission |
| `TIEBREAKERS` | No | For leagues using tiebreaker players only |
| `BACKUPS` | No | Deprecated — no longer supported |
| `FRANCHISE_ID` | No | Commissioner-only: act on behalf of another franchise |

**Authentication:** Owner — requires `MFL_USER_ID` cookie. ALWAYS use `mflFetch()` from `src/utils/mfl-fetch.ts`, never raw `fetch()`, because `api.myfantasyleague.com` 302-redirects to `www49` and Node.js undici strips the Cookie header on cross-origin redirects.

**STARTERS Format:**
Comma-separated MFL player IDs, no position slot designations needed:
```
STARTERS=13592,13604,15255,14836,14974,13674,17104,11936,0532
```
MFL resolves position slots automatically. There is no "FLEX" or "OP" token in the STARTERS value — just player IDs.

**Defense (DEF) player IDs:**
Team defenses use a 4-digit ID with leading zero, e.g.:
- `0532` = Houston Texans Defense
- `0520` = Washington Commanders Defense
- `0504` = New England Patriots Defense

These are retrieved via `TYPE=players&DETAILS=1` where `position: "Def"`.

**TheLeague (13522) Starter Requirements:**
- Total: exactly 9 starters
- QB: exactly 1
- RB: 1–4
- WR: 1–4
- TE: 1–4
- PK: exactly 1
- Def: exactly 1
- (The RB/WR/TE flex slots fill the remaining spots to reach 9)

**Example Request:**
```
POST https://api.myfantasyleague.com/2026/import?TYPE=lineup&L=13522
Content-Type: application/x-www-form-urlencoded
Cookie: MFL_USER_ID={cookie}

TYPE=lineup&L=13522&W=14&STARTERS=13592,13604,15255,14836,14974,13674,17104,11936,0532
```

**Response Format:**
MFL returns HTTP 200 for both success and failure — must inspect body:
```xml
<!-- Success -->
<status>OK</status>

<!-- Failure -->
<error>Some error description here</error>
```
Guard against HTML responses (login redirect when auth fails) and `<error>` tags.

**Key Insights (added 2026-03-28):**
- **Destructive overwrite** — submitting a lineup replaces any previously set lineup for that week
- **No slot designations** — just send player IDs, MFL resolves positions automatically
- **FLEX is implicit** — for TheLeague's flex-style roster (1-4 RB/WR/TE), just send 9 valid player IDs with the right position mix
- **Future weeks are supported** — the `W` parameter accepts future week numbers; lineups lock when the first game of that week kicks off
- **No dedicated read endpoint** — use `weeklyResults?W={week}` for submitted lineups (gives `starters` field as comma-separated IDs); the `rosters` endpoint does NOT show starter/bench distinction
- **Commissioner impersonation** — pass `FRANCHISE_ID` in POST body and send both `MFL_USER_ID` + `MFL_IS_COMMISH` cookies
- **Redirect behavior** — `api.myfantasyleague.com/import` POST does NOT redirect (unlike GET exports). The `mflFetch` utility handles this safely either way.

**Reading Current Lineups:**
The `weeklyResults` export is the only way to see submitted lineups via API:
```
GET https://api.myfantasyleague.com/{YEAR}/export?TYPE=weeklyResults&L=13522&W={week}&JSON=1
```
Response franchise object:
```json
{
  "id": "0001",
  "score": "82.62",
  "starters": "13592,13604,15255,14836,14974,13674,17104,11936,0507,",
  "nonstarters": "16617,16080,16610,16632,0513,11232,16778,13424,12658,16432,16642,",
  "optimal": "17104,0507,11936,13592,13604,14836,13674,16610,15255,",
  "player": [
    { "id": "13592", "score": "8.08", "status": "starter", "shouldStart": "1" },
    { "id": "16617", "score": "0.00", "status": "nonstarter", "shouldStart": "0" }
  ]
}
```
Note: `weeklyResults` only has data after the week is processed. For a live/current week, it may show partial scores.

**Related:**
- `src/utils/mfl-fetch.ts` — required for authenticated writes
- `src/pages/api/move-to-ir.ts` — canonical simple write pattern
- `src/pages/api/trades/submit.ts` — canonical mflFetch write pattern
- `data/theleague/mfl-feeds/2025/league.json` → `starters` object for roster slot requirements

---

#### `ir` (Import) — WRITE ENDPOINT
**Purpose:** Move player(s) to Injured Reserve and/or activate player(s) from IR back to active roster. Owner-level — no commissioner access required.

**Endpoint:**
```
POST https://api.myfantasyleague.com/{YEAR}/import?TYPE=ir&L={LEAGUE_ID}
Content-Type: application/x-www-form-urlencoded
Cookie: MFL_USER_ID={userCookie}
```

**Parameters (verified 2026-05-07 against MFL's live `api_info?STATE=details` page):**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `L` | Yes | League ID |
| `ACTIVATE` | Conditional | Comma-separated player IDs to **activate** — move FROM Injured Reserve TO Active Roster. At least one of `ACTIVATE` or `DEACTIVATE` must be present. |
| `DEACTIVATE` | Conditional | Comma-separated player IDs to **deactivate** — move FROM Active Roster TO Injured Reserve. |
| `DROP` | No | Comma-separated player IDs to drop from the roster entirely (regardless of bucket). |
| `FRANCHISE_ID` | No | **Commissioner impersonation only.** For owner mode, the franchise is implied by the auth cookie — *do not send `FRANCHISE_ID`* in owner-mode writes. |

**Authentication:** Owner (`MFL_USER_ID` cookie only). Use `mflFetch()` from `src/utils/mfl-fetch.ts`.

**Example — place one player on IR:**
```
TYPE=ir&L=13522&DEACTIVATE=14800
```

**Example — return player from IR (and simultaneously place a different player on IR):**
```
TYPE=ir&L=13522&ACTIVATE=14800&DEACTIVATE=16642
```

**Key insights:**
- **Verb-form parameter names.** It is `ACTIVATE`/`DEACTIVATE`, NOT `ACTIVATED`/`DEACTIVATED`. The trailing `D` was the source of a long-running silent-failure bug — MFL accepts the request shape but silently no-ops when it doesn't recognize the parameter, while still returning `<status>OK</status>`.
- **`ACTIVATE` = off IR; `DEACTIVATE` = onto IR.** Terminology reads from the *player's* perspective: a player being placed on IR is "deactivated" (taken out of action). This is the inverse of the transaction-log field naming, which records `activated`/`deactivated` in the past tense from the league's perspective.
- **Do NOT send FRANCHISE_ID in owner-mode requests.** It's only for commissioner impersonation. Sending it in a non-impersonating request can trigger MFL's lockout-impersonation check and silently no-op the write.
- TheLeague has `injuredReserve: "50"` — 50-slot IR limit (effectively unlimited).
- IR players count 100% toward salary cap (`includeIRWithSalary: "100"`).
- The `freeagency?TYPE=moveToIR` path mentioned in some prior internal docs is **not a working endpoint** — it returns 404 at every host tested. Use `import?TYPE=ir`.

**Confidence:** Verified — parameter names and semantics quoted directly from MFL's API Test Form on 2026-05-07.

**Used In:**
- [src/pages/api/move-to-ir.ts](src/pages/api/move-to-ir.ts)
- [src/utils/mfl-matchup-api.ts](src/utils/mfl-matchup-api.ts) — `runRosterMove`

---

#### `taxi_squad` (Import) — WRITE ENDPOINT
**Purpose:** Move player(s) onto or off of the taxi (practice) squad. Owner-level — no commissioner access required.

**Endpoint:**
```
POST https://api.myfantasyleague.com/{YEAR}/import?TYPE=taxi_squad&L={LEAGUE_ID}
Content-Type: application/x-www-form-urlencoded
Cookie: MFL_USER_ID={userCookie}
```

**Parameters (verified 2026-05-07 against MFL's live `api_info?STATE=details` page):**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `L` | Yes | League ID |
| `PROMOTE` | Conditional | Comma-separated player IDs to **promote** — move FROM Taxi Squad TO Active Roster. At least one of `PROMOTE` or `DEMOTE` must be present. |
| `DEMOTE` | Conditional | Comma-separated player IDs to **demote** — move FROM Active Roster TO Taxi Squad. |
| `DROP` | No | Comma-separated player IDs to drop from the roster entirely (regardless of bucket). |
| `FRANCHISE_ID` | No | **Commissioner impersonation only.** For owner mode, the franchise is implied by the auth cookie — *do not send `FRANCHISE_ID`* in owner-mode writes. |

**Authentication:** Owner (`MFL_USER_ID` cookie only). Use `mflFetch()` from `src/utils/mfl-fetch.ts`.

**Example — move rookie onto taxi squad:**
```
TYPE=taxi_squad&L=13522&DEMOTE=17096
```

**Example — promote rookie off taxi squad to active:**
```
TYPE=taxi_squad&L=13522&PROMOTE=17096
```

**Example — swap: move one player off taxi, one player on:**
```
TYPE=taxi_squad&L=13522&PROMOTE=17037&DEMOTE=17076
```

**Key insights:**
- **Verb-form parameter names.** It is `PROMOTE`/`DEMOTE`, NOT `PROMOTED`/`DEMOTED`. The trailing `D` was the source of a long-running silent-failure bug — MFL accepts the request shape but silently no-ops when it doesn't recognize the parameter, while still returning `<status>OK</status>`.
- **Direction reads from the active-roster perspective.** `PROMOTE` means *up to* the active roster; `DEMOTE` means *down to* the taxi squad. The transaction log records the inverse perspective — `promoted` there logs a player who was *placed onto* taxi (i.e. demoted from the import endpoint's POV). The mismatch is real; map deliberately.
- **Do NOT send FRANCHISE_ID in owner-mode requests.** It's only for commissioner impersonation. Sending it in a non-impersonating request can trigger MFL's lockout-impersonation check and silently no-op the write.
- TheLeague taxi squad size limit: `taxiSquad: "3"` — max 3 players at any time.
- Taxi squad players count 50% toward salary cap (`includeTaxiWithSalary: "50"`).
- **Eligibility (TheLeague-specific):** In practice, only rookies (IDs 17xxx) are eligible. All 9 taxi players in 2025 and all 3 in 2026 are from recent draft classes. Enforced by MFL based on league rules, not an API parameter.
- **Player must already be on active roster:** Taxi squad moves require the player to be on the franchise's active roster first (status: ROSTER). Cannot taxi a free agent directly.
- `contractInfo: "TO"` on 2026 taxi players is the "Taxi Option" contract status (a 2026 league rule change).
- Auto-taxi via commissioner impersonation does **not** work in TheLeague: `lockout: "Yes"` causes MFL to reject the impersonating write with `"Can not impersonate another franchise when LOCKOUT is on."` (See `scripts/sync-draft-pick-contracts.mjs` history — auto-taxi was removed in PR #173 for this reason.) Practice-squad placement runs entirely through the per-owner UI flow.

**Confidence:** Verified — parameter names and semantics quoted directly from MFL's API Test Form on 2026-05-07.

**Related:**
- `src/utils/mfl-fetch.ts` — required for authenticated writes
- `data/theleague/mfl-feeds/2025/transactions.json` — source of TAXI transaction evidence

---

#### `fcfsWaiver`
**Purpose:** Immediate first-come-first-served add/drop execution

**Parameters:**
- Required: `L` (league ID)
- Optional: `ADD`, `DROP`, `FRANCHISE_ID`
- Auth: Owner

---

#### `waiverRequest`
**Purpose:** Submit waiver claims for waiver processing

**Parameters:**
- Required: `L` (league ID), `ROUND`, `PICKS`
- Optional: `REPLACE`, `FRANCHISE_ID`
- Auth: Owner

---

#### `tradeProposal` — WRITE ENDPOINT
**Purpose:** Propose a trade to another franchise

**Endpoint:**
```
POST https://api.myfantasyleague.com/2026/import?TYPE=tradeProposal&L=13522
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `L` | Yes | League ID |
| `OFFEREDTO` | Yes | Target franchise ID in 4-digit padded string format (e.g., `"0003"`) |
| `WILL_GIVE_UP` | Yes | Comma-separated list of assets you are offering (see Asset Format below) |
| `WILL_RECEIVE` | Yes | Comma-separated list of assets you want to receive (see Asset Format below) |
| `COMMENTS` | No | Short message to the trade target (free text) |
| `EXPIRES` | No | Unix timestamp for proposal expiration; defaults to one week from submission |
| `FRANCHISE_ID` | No | Commissioner use only: act on behalf of a franchise owner |

**Auth:** Owner (requires `MFL_USER_ID` cookie)

**Asset Format in `WILL_GIVE_UP` / `WILL_RECEIVE`:**

| Asset Type | Format | Example | Notes |
|------------|--------|---------|-------|
| Player | Numeric MFL player ID | `15749` | Standard MFL player ID |
| Current-year draft pick | `DP_{round-1}_{pick-1}` | `DP_2_10` for round 3, pick 11 | Round and pick are **zero-indexed** (one less than actual) |
| Future-year draft pick | `FP_{franchiseId}_{year}_{round}` | `FP_0005_2027_2` | Round is the **actual** round number; franchise is 4-digit padded |
| Blind bid dollars | `BB_{amount}` | `BB_10.50` | Decimal notation |

Multiple assets are comma-separated: `WILL_GIVE_UP=15749,FP_0005_2027_1`

**Example Request:**
```
POST https://api.myfantasyleague.com/2026/import?TYPE=tradeProposal&L=13522
Content-Type: application/x-www-form-urlencoded
Cookie: MFL_USER_ID={cookie}

OFFEREDTO=0003&WILL_GIVE_UP=15749,DP_1_05&WILL_RECEIVE=16211,FP_0003_2027_1&COMMENTS=Let%27s+deal&EXPIRES=1774544400
```

---

#### `tradeResponse` — WRITE ENDPOINT
**Purpose:** Accept, reject, or withdraw (revoke) a pending trade proposal

**Endpoint:**
```
POST https://api.myfantasyleague.com/2026/import?TYPE=tradeResponse&L=13522
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `L` | Yes | League ID |
| `TRADE_ID` | Yes | Trade identifier from the `pendingTrades` export response |
| `RESPONSE` | Yes | Action to take — valid values: `accept`, `reject`, `revoke` |
| `COMMENTS` | No | Message (useful for rejections to explain why) |
| `FRANCHISE_ID` | No | Commissioner use only: act on behalf of a franchise owner |

**Auth:** Owner (requires `MFL_USER_ID` cookie)

**RESPONSE Value Rules:**
- `accept` — only the **target** franchise (the one who received the offer) may use this
- `reject` — only the **target** franchise (the one who received the offer) may use this
- `revoke` — only the **originating** franchise (the one who sent the offer) may use this

Attempting to use the wrong RESPONSE value for your role will fail.

**Example: Accept a trade**
```
POST https://api.myfantasyleague.com/2026/import?TYPE=tradeResponse&L=13522
Cookie: MFL_USER_ID={cookie}

TRADE_ID=12345&RESPONSE=accept
```

**Example: Reject a trade with a message**
```
POST https://api.myfantasyleague.com/2026/import?TYPE=tradeResponse&L=13522
Cookie: MFL_USER_ID={cookie}

TRADE_ID=12345&RESPONSE=reject&COMMENTS=Not+enough+value+for+my+WR1
```

**Example: Revoke (withdraw) your own proposal**
```
POST https://api.myfantasyleague.com/2026/import?TYPE=tradeResponse&L=13522
Cookie: MFL_USER_ID={cookie}

TRADE_ID=12345&RESPONSE=revoke
```

---

#### `pendingTrades` — READ ENDPOINT
**Purpose:** Retrieve all pending trade proposals (sent and received) for the authenticated franchise

**Endpoint:**
```
GET https://api.myfantasyleague.com/2026/export?TYPE=pendingTrades&L=13522&JSON=1
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `L` | Yes | League ID |
| `FRANCHISE_ID` | No | Commissioner use only: specify which franchise to view. Pass `0000` to get trades pending commissioner approval |
| `APIKEY` | No | Alternative to cookie auth |

**Auth:** Owner (requires `MFL_USER_ID` cookie or `APIKEY`)

**Response Structure:**

The response mirrors the completed trade transaction format (confirmed via `transactions` endpoint with `TRANS_TYPE=TRADE`):

```json
{
  "pendingTrades": {
    "trade": [
      {
        "id": "12345",
        "franchise": "0008",
        "franchise2": "0010",
        "franchise1_gave_up": "15749,DP_1_05,",
        "franchise2_gave_up": "16211,FP_0003_2027_1,",
        "timestamp": "1773270789",
        "expires": "1774544400",
        "comments": "Let's deal",
        "by_commish": "0"
      }
    ]
  },
  "encoding": "utf-8",
  "version": "1.0"
}
```

**Key Fields:**

| Field | Description |
|-------|-------------|
| `id` | Trade ID — use this as `TRADE_ID` in `tradeResponse` |
| `franchise` | The franchise who **originated** the trade proposal (same as `franchise1`) |
| `franchise2` | The franchise who **received** the trade offer |
| `franchise1_gave_up` | Assets offered by `franchise` — comma-separated string with trailing comma |
| `franchise2_gave_up` | Assets offered by `franchise2` — comma-separated string with trailing comma |
| `timestamp` | Unix timestamp of when the trade was proposed |
| `expires` | Unix timestamp of when the offer expires |
| `comments` | Optional message from the proposing franchise |
| `by_commish` | `"1"` if initiated by commissioner, `"0"` otherwise |

**Important notes:**
- MFL may return a single object (not array) when there is exactly one pending trade — always normalize to array before iterating
- Asset strings end with a trailing comma (e.g., `"15749,"` not `"15749"`) — strip before parsing
- Draft pick format matches proposal format: `DP_{r-1}_{p-1}` for current year, `FP_{franchiseId}_{year}_{round}` for future picks
- When there are no pending trades, the response returns `"pendingTrades": ""` (empty string, not empty object) — guard against this

**Empty state response (no pending trades):**
```json
{
  "pendingTrades": "",
  "encoding": "utf-8",
  "version": "1.0"
}
```

---

#### `tradeBait` (Import) — WRITE ENDPOINT
**Purpose:** Set the authenticated franchise's trade block (overwrites any previous trade bait)

**Endpoint:**
```
POST https://api.myfantasyleague.com/2026/import?TYPE=tradeBait&L=13522
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `L` | Yes | League ID |
| `WILL_GIVE_UP` | Yes | Comma-separated list of player IDs being offered (same asset format as `tradeProposal`) |
| `IN_EXCHANGE_FOR` | No | Free-text description of desired return (max 256 characters) |

**Auth:** Owner (requires `MFL_USER_ID` cookie)

**Behavior:** Completely overwrites any previously entered trade bait. To clear your trade block, send `WILL_GIVE_UP` with an empty value.

**Example:**
```
POST https://api.myfantasyleague.com/2026/import?TYPE=tradeBait&L=13522
Cookie: MFL_USER_ID={cookie}

WILL_GIVE_UP=15749,14836&IN_EXCHANGE_FOR=Looking+for+WR1+or+mid-1st+pick
```

---

### J. Other Useful Endpoints

#### `login`
**Purpose:** Validate credentials and receive authentication cookie

**Parameters:**
- Required: `USERNAME`, `PASSWORD`
- Optional: `LEAGUE_ID`, `XML=1` or `JSON=1`
- Auth: Public

**Example:**
```
POST https://api.myfantasyleague.com/2025/login
Content-Type: application/x-www-form-urlencoded

USERNAME=myuser&PASSWORD=mypass&LEAGUE_ID=13522&JSON=1
```

**Used In:**
- [src/utils/mfl-login.ts](src/utils/mfl-login.ts)

**Response Structure:**
```json
{
  "cookie": "base64_encoded_session_cookie"
}
```

**Key Insights (updated 2026-01-18):**
- Returns a Base64-encoded cookie that may contain `+`, `/`, and `=` characters
- Cookie must be URL-escaped before passing back in subsequent requests
- Response does NOT include `franchise_id` or `myteam` value - you must call `myleagues` to get this
- Use POST method over HTTPS to protect credentials
- The cookie should be passed as: `Cookie: MFL_USER_ID=cookie_value`

---

#### MFL Web Login with Redirect (Non-API)

**Purpose:** Redirect users to MFL login page and have them return to your site

**URL Format:**
```
https://www{XX}.myfantasyleague.com/{YEAR}/login?L={LEAGUE_ID}&URL={ENCODED_RETURN_URL}
```

**Parameters:**
- `L` - League ID (required)
- `URL` - URL-encoded destination after successful login (optional)

**Example:**
```
https://www49.myfantasyleague.com/2025/login?L=13522&URL=https%3A%2F%2Fmysite.com%2Fcallback
```

**Key Insights (updated 2026-01-18):**
- The `URL` parameter allows redirect to external sites after login
- **IMPORTANT:** MFL does NOT pass franchise_id back in the redirect URL
- After redirect, user has MFL cookie set in browser but your site cannot read it (different domain)
- The redirect is purely for UX - user logs in on MFL, then is sent back to your URL
- To identify the user's franchise after redirect, you need your own authentication flow

**Workaround for Franchise Identification:**
Since MFL doesn't pass franchise_id back in the redirect, the codebase uses a two-step process:
1. User logs in via our `/login` page with MFL credentials
2. We call MFL's `login` API to validate, then `myleagues` API to get franchise_id
3. We create our own JWT session with the franchise_id embedded

See: [src/utils/mfl-login.ts](src/utils/mfl-login.ts) and [AUTH_SYSTEM.md](AUTH_SYSTEM.md)

---

#### `myleagues`
**Purpose:** All leagues for current authenticated user, INCLUDING their franchise_id in each league

**Parameters:**
- Optional: `YEAR`, `FRANCHISE_NAMES`, `USERNAME`, `PASSWORD`
- Auth: Owner (via cookie) OR pass USERNAME/PASSWORD directly

**Example:**
```
# With cookie authentication
https://api.myfantasyleague.com/2025/export?TYPE=myleagues&JSON=1

# With direct credentials (less secure, use HTTPS)
https://api.myfantasyleague.com/2025/myleagues?USERNAME=myuser&PASSWORD=mypass&JSON=1
```

**Response Structure:**
```json
{
  "myleagues": {
    "league": [
      {
        "id": "13522",
        "name": "TheLeague",
        "franchise_id": "0003",
        "franchise_name": "Team Name",
        "url": "https://www49.myfantasyleague.com/2025/home/13522"
      }
    ]
  }
}
```

**Key Insights (updated 2026-01-18):**
- **This is the only reliable way to get franchise_id for a user**
- Response includes `franchise_id` (4-digit string like "0003") for each league
- The `FRANCHISE_NAMES=1` parameter includes team names but may cause timeouts for users with many leagues
- Can pass USERNAME/PASSWORD directly instead of using cookie auth
- Response field names vary across MFL deployments - check for: `franchise_id`, `franchiseId`, `FRANCHISE_ID`
- League host information is also included in the response

**Used In:**
- [src/utils/mfl-login.ts](src/utils/mfl-login.ts)

---

#### `nflSchedule`
**Purpose:** NFL game schedule and scores

**Parameters:**
- Optional: `W` (week, or "ALL")
- Auth: Public

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=nflSchedule&JSON=1
https://api.myfantasyleague.com/2025/export?TYPE=nflSchedule&W=15&JSON=1
```

---

#### `nflByeWeeks`
**Purpose:** NFL team bye weeks

**Parameters:**
- Optional: `W` (week)
- Auth: Public

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=nflByeWeeks&JSON=1
```

---

#### `adp`
**Purpose:** Average Draft Position data across MFL leagues

**Parameters:**
- Optional: `PERIOD`, `FCOUNT`, `IS_PPR`, `IS_KEEPER`, `IS_MOCK`, `CUTOFF`, `DETAILS`
- Auth: Public

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=adp&IS_PPR=1&JSON=1
```

---

## Caching Strategy

### Implementation
- **Current Year:** Daily cache (invalidated after 24 hours)
- **Historical Years:** Permanent cache (never invalidated)
- **Cache Location:** `/data/theleague/mfl-feeds/{YEAR}/`

### Cache Files
Current cached MFL data includes:
- `assets.json` - Draft pick ownership
- `draftResults.json` - Draft history with trades
- `league.json` - League configuration
- `playoff-brackets.json` - Playoff structure
- `players.json` - All players (~1.5MB)
- `projectedScores.json` - Projections
- `rosters.json` - Team rosters
- `salaryAdjustments.json` - Salary data
- `standings.json` - Current standings
- `tradeBait.json` - Trade block
- `transactions.json` - League transactions
- `weekly-results.json` - Normalized weekly scores

### Implementation Files
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs)
- [packages/mfl-data-fetcher/src/index.ts](packages/mfl-data-fetcher/src/index.ts)

## Response Formats

All endpoints support multiple response formats:

| Format | Parameter | Usage |
|--------|-----------|-------|
| XML | `XML=1` | Default format |
| JSON | `JSON=1` | Preferred format (used throughout codebase) |
| RSS | Automatic | For feed endpoints (messageBoard, siteNews) |
| ICS | Automatic | For calendar endpoint |

**Example:**
```
# JSON (preferred)
https://api.myfantasyleague.com/2025/export?TYPE=league&L=13522&JSON=1

# XML (default)
https://api.myfantasyleague.com/2025/export?TYPE=league&L=13522&XML=1
```

## Error Handling Best Practices

### Retry Logic
For authenticated endpoints that may timeout:
- Implement retry mechanism (e.g., 3 retries with 1.5s delay)
- Example: `assets` endpoint in [scripts/fetch-mfl-feeds.mjs:121](scripts/fetch-mfl-feeds.mjs#L121)

```javascript
// Example retry logic
for (let retry = 0; retry < 3; retry++) {
  try {
    const response = await fetch(url);
    if (response.ok) return await response.json();
  } catch (error) {
    if (retry === 2) throw error;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}
```

### Graceful Fallbacks
- Always fall back to cached data when API calls fail
- Return empty objects/arrays rather than throwing errors
- Log warnings for debugging but don't break user experience

**Implementation Examples:**
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs)
- [src/utils/mfl-matchup-api.ts](src/utils/mfl-matchup-api.ts)
- [scripts/mfl-api-wrapper.js](scripts/mfl-api-wrapper.js)

## Host Configuration

### Default Hosts
- **API Calls:** `https://api.myfantasyleague.com`
- **Web UI:** Calculated as `https://www{leagueId % 50}.myfantasyleague.com`
  - Example: League 13522 → `https://www49.myfantasyleague.com`

### Dynamic Host Calculation
```javascript
const hostNumber = leagueId % 50;
const webHost = `https://www${hostNumber}.myfantasyleague.com`;
```

## Quick Reference: Currently Used Endpoints

| Endpoint | Purpose | File |
|----------|---------|------|
| `assets` | Draft pick ownership | fetch-mfl-feeds.mjs |
| `draftResults` | Draft history | fetch-mfl-feeds.mjs |
| `injuries` | Injury reports | mfl-matchup-api.ts |
| `league` | League config | fetch-mfl-feeds.mjs |
| `liveScoring` | Real-time scores | api/live-scoring.ts |
| `playoffBracket` | Playoff results | fetch-mfl-feeds.mjs |
| `playoffBrackets` | Playoff metadata | fetch-mfl-feeds.mjs |
| `players` | Player database | fetch-mfl-feeds.mjs |
| `projectedScores` | Projections | fetch-mfl-feeds.mjs |
| `rosters` | Team rosters | fetch-mfl-feeds.mjs |
| `salaryAdjustments` | Salary data | fetch-mfl-feeds.mjs |
| `schedule` | Matchup schedule | mfl-matchup-api.ts |
| `standings` | Current standings | fetch-mfl-feeds.mjs |
| `tradeBait` | Trade block | fetch-mfl-feeds.mjs |
| `transactions` | Transaction history | fetch-mfl-feeds.mjs |
| `weeklyResults` | Weekly scores | fetch-mfl-feeds.mjs |

## Additional Resources

- **MFL API Forums:** https://forums.myfantasyleague.com/
- **API Support:** Contact MFL support for APIKEY requests
- **Rate Limiting:** MFL does not publicly document rate limits, but implement reasonable delays between requests
