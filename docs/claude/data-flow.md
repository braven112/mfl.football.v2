# Data Flow Architecture

## Overview

Data flows through three main stages:
1. **External Sources** (MFL API, ESPN, etc.)
2. **Cache Layer** (JSON files in `data/`)
3. **Components** (Astro pages, React components)

## Data Sources

### MFL API
Primary data source for fantasy league information.

**Fetched by:** `scripts/fetch-mfl-feeds.mjs`

**Endpoints used:**
- `rosters` - Team rosters and player assignments
- `players` - Player information and metadata
- `standings` - League standings
- `playoffBracket` / `playoffBrackets` - Playoff tournament data
- `draftResults` - Draft picks and results
- `transactions` - Trades, adds, drops
- `salaryAdjustments` - Contract modifications
- `assets` - Team logos and assets (requires API key)
- `league` - League configuration
- `projectedScores` - Player projections
- `weeklyResults` - Game results by week
- `tradeBait` - Trade block listings
- `liveScoring` - Real-time scoring (fetched live)
- `injuries` - Player injury status

### External APIs
- **ESPN** - NFL schedule (`scripts/fetch-espn-schedule.mjs`)
- **Weather** - Game weather data (`scripts/enrich-schedule-with-weather.mjs`)
- **Odds** - Betting lines (`scripts/fetch-live-odds.mjs`)

## Cache Layer

### TheLeague Data
Location: `src/data/theleague/`
```
theleague/
├── rosters.json
├── players.json
├── standings.json
├── playoffBracket.json
├── draftResults.json
├── transactions.json
├── salaryAdjustments.json
└── ...
```

### AFL Fantasy Data
Location: `data/afl-fantasy/`
```
afl-fantasy/
├── rosters.json
├── players.json
├── standings.json
├── afl.config.json
└── ...
```

### NFL Data
Location: `src/data/`
```
data/
├── nfl-schedule.json
├── nfl-weather.json
└── live-odds.json
```

## Component Data Loading

### Astro Pages (Server-Side)
```typescript
// In frontmatter (---) section
import rostersData from '../../data/theleague/rosters.json';
import playersData from '../../data/theleague/players.json';

// Process data in frontmatter
const players = playersData.players.player;
const rosters = rostersData.rosters.franchise;
```

### React Components (Client-Side)
```typescript
// Props passed from Astro page
interface Props {
  players: Player[];
  rosters: Roster[];
}

// Or fetch via API endpoint
const response = await fetch('/api/live-scoring');
const data = await response.json();
```

## Real-Time Data

### Live Scoring
- Endpoint: `/api/live-scoring`
- Source: MFL `liveScoring` API
- Polling: Client-side at configured interval
- File: `src/pages/api/live-scoring.ts`

### Live Auction
- Utilities: `src/utils/live-auction-poller.ts`
- Activity detection: `src/utils/live-auction-activity-detector.ts`
- Polls MFL auction endpoint during active auctions

## Data Refresh Strategy

| Data Type | Refresh Frequency | Method |
|-----------|------------------|--------|
| Rosters | On deploy / manual | `pnpm sync:theleague` |
| Standings | On deploy / manual | Build-time fetch |
| Live Scoring | Every 30-60s | Client polling |
| NFL Schedule | Weekly | `pnpm fetch:espn:schedule` |
| Weather | Game day | `pnpm fetch:weather` |
| Salary Averages | Pre-build | `pnpm update:salary:all` |

## League Context

The app supports two leagues with shared code:

| League | Slug | MFL ID | Data Path |
|--------|------|--------|-----------|
| TheLeague | `theleague` | 13522 | `src/data/theleague/` |
| AFL Fantasy | `afl` | 19621 | `data/afl-fantasy/` |

**Context utility:** `src/utils/league-context.ts`

```typescript
import { getLeagueContext } from '../utils/league-context';

const league = getLeagueContext(Astro.url);
// Returns: { slug: 'theleague', leagueId: '13522', ... }
```
