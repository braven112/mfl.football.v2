# MFL API Reference Documentation

Comprehensive reference for MyFantasyLeague (MFL) API endpoints used in this project, organized by feature area.

## Quick Links

- **Official MFL API Explorer:** https://www49.myfantasyleague.com/2025/options?L=13522&O=79
- **Complete API Documentation:** https://www49.myfantasyleague.com/2025/api_info?STATE=details&L=13522
- **League ID:** 13522
- **Current Year:** 2025

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

#### `myDraftList`
**Purpose:** Current franchise's draft board and player rankings

**Parameters:**
- Required: `L` (league ID)
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=myDraftList&L=13522&JSON=1
```

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

#### `tradeBait` ✅ Currently Used
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

**Used In:**
- [scripts/fetch-mfl-feeds.mjs](scripts/fetch-mfl-feeds.mjs)

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

**Notes:** Essential for team names, configurations, and league rules

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

#### `calendar`
**Purpose:** League calendar events summary

**Parameters:**
- Required: `L` (league ID)
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=calendar&L=13522&JSON=1
```

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

#### `moveToIR` (via /freeagency endpoint)
**Purpose:** Move player to Injured Reserve

**Parameters:**
- Required: `L` (league ID), player data
- Auth: Owner (requires MFL_USER_ID cookie)

**Used In:**
- [src/pages/api/move-to-ir.ts](src/pages/api/move-to-ir.ts)

**Notes:** POST request to `/freeagency` endpoint with `TYPE=moveToIR`

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

#### `tradeProposal`
**Purpose:** Propose trade to another franchise

**Parameters:**
- Required: `L`, `OFFEREDTO`, `WILL_GIVE_UP`, `WILL_RECEIVE`
- Optional: `COMMENTS`, `EXPIRES`, `FRANCHISE_ID`
- Auth: Owner

---

### J. Other Useful Endpoints

#### `login`
**Purpose:** Validate credentials and receive authentication cookie

**Parameters:**
- Required: `USERNAME`, `PASSWORD`, `XML`
- Auth: Public

**Used In:**
- [src/utils/mfl-login.ts](src/utils/mfl-login.ts)

---

#### `myleagues`
**Purpose:** All leagues for current authenticated user

**Parameters:**
- Optional: `YEAR`, `FRANCHISE_NAMES`
- Auth: Owner

**Example:**
```
https://api.myfantasyleague.com/2025/export?TYPE=myleagues&JSON=1
```

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
