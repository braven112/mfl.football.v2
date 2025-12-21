# Draft Pick Predictor Feature

## Overview
A feature to show projected draft order for the upcoming season (2026) based on current season (2025) performance and standings. Includes draft pick trades tracked via MFL API and toilet bowl awards.

## League Configuration
- **Teams:** 16 total
- **Draft Rounds:** 3 rounds
- **Total Picks:** 48 base picks (16 teams × 3 rounds) + 3 toilet bowl picks = 51 total picks
- **League Calendar:** Feb 14th at 8:45 PT
- **Draft Timing:** One week after NFL draft

## Draft Order Rules

### Regular Season Draft Order (Picks 1-15, 17-48)
- Based on final standings using reverse order (worst record = 1st pick, best record = 15th pick)
- Uses same wild card tiebreaker logic as standings page (in reverse)
- League champion always picks **16th** (regardless of record)

### Toilet Bowl Awards
Determined by toilet bowl tournament brackets. 7 teams participate in toilet bowl:
- **Main Toilet Bowl Winner:** Pick 1.17 (Round 1, Pick 17)
- **Toilet Bowl Consolation Winner:** Pick 2.17 (Round 2, Pick 17)
- **Toilet Bowl Consolation 2 Winner:** Pick 2.18 (Round 2, Pick 18)

Toilet Bowl Structure:
- 7 teams make toilet bracket
- 1 play-in game for team entering loser bracket
- Tournament determines winners for above picks

## Features

### 1. Standalone Draft Order Page
- Grid view showing all 51 picks
- Each pick displays team icon/banner
- Organized by round (Round 1: picks 1-16, Round 2: picks 17-32, Round 3: picks 33-48, Specials: 1.17, 2.17, 2.18)
- Updates in real-time as season progresses

### 2. 2026 Roster View Card
- Shows team's picks in order from best to worst
- Left column displays team banner/icon
- Shows trade history:
  - Format: "from [Original Team]"
  - Chain format: "from [Original Team] via [Team 2] via [Team 3]"
- One column layout, best pick at top, worst at bottom

### 3. Draft Pick Tracking
- Uses MFL API to get pick ownership and trade information
- Integrates with transaction data to show trade chains
- Pulls actual draft picks from MFL after draft occurs

## Technical Details

### Data Sources
1. **Standings:** Use existing standings page logic with reverse tiebreakers
2. **Draft Picks:** MFL API endpoint (examples exist in codebase)
3. **Trade History:** Transactions API + MFL API (may be tracked in same endpoint as pick ownership)
4. **Actual Picks:** MFL API (after draft date passes)

### Timing
- **Active Period:** 2025 season through draft (one week after NFL draft)
- **Updates:** Real-time as standings change
- **Yearly Rollover:** When moving to next season, updates to show next season projections
  - 2025 season → shows 2026 draft projections
  - 2026 season → shows 2027 draft projections
  - etc.

### Future Enhancement
- After draft occurs: Display who was actually picked by each team
- Once 2026 NFL season starts (September): Automatically updates to show 2027 projections

## UI/UX Conventions

### Team Name Display Standards

**IMPORTANT:** All team names across the entire application must use the `chooseTeamName()` utility function to ensure consistent display and prevent UI overflow issues.

#### Implementation

**Location:** `src/utils/team-names.ts`

```typescript
import { chooseTeamName } from '../../utils/team-names';

// When displaying team names
const displayName = chooseTeamName([
  team.teamName,           // Primary team name from MFL
  assets?.name || '',      // Asset/custom name
  ...(assets?.aliases || []) // Team aliases
]);
```

#### Rules

1. **Maximum Length:** 15 characters
2. **Selection Priority:**
   - Filter all candidates to those ≤15 characters
   - Choose the **longest** name that fits within the limit
   - If all names exceed 15 chars, truncate the shortest one
3. **Applies to ALL Leagues:**
   - `theleague` (dynasty league)
   - `afl-fantasy` (AFL fantasy league)
   - Any future leagues added to the platform

#### Why This Matters

- Prevents text overflow in matchup cards, brackets, and roster displays
- Ensures consistent team name presentation across all pages
- Handles edge cases where team names are very long (e.g., "Dark Magicians of Chaos" → "Dark Magicians")

#### Where to Use

Apply `chooseTeamName()` when:
- Building seed maps for playoffs
- Resolving team data in bracket views
- Displaying team names in any UI component (matchups, rosters, standings, etc.)
- Creating team-related data structures

**Example from playoff brackets:**
```typescript
// src/utils/playoffs.ts - buildSeedMaps()
displayName: chooseTeamName([
  team.teamName,
  assetMap.get(team.id)?.name || '',
  ...(assetMap.get(team.id)?.aliases || []),
])

// src/pages/theleague/playoffs.astro - resolveTeam()
displayName: chooseTeamName([
  team.teamName,
  assets?.name || '',
  ...(assets?.aliases || []),
])
```

## References
- **MFL API Documentation:** See [MFL-API.md](MFL-API.md) for comprehensive API reference organized by feature area
- MFL API Explorer: https://www49.myfantasyleague.com/2025/options?L=13522&O=79
- Available MFL APIs: https://www49.myfantasyleague.com/2025/api_info?STATE=details&L=13522
- Standings page: Uses existing wild card tiebreaker logic (in reverse for draft order)

## API Endpoint Status
- ✅ draftResults - Fetched in fetch-mfl-feeds.mjs
- ✅ standings - Fetched in fetch-mfl-feeds.mjs
- ✅ assets - Fetched in fetch-mfl-feeds.mjs (requires APIKEY authentication)
- ✅ playoffBracket - Fetched in fetch-mfl-feeds.mjs
- ✅ playoffBrackets - Fetched in fetch-mfl-feeds.mjs
- ✅ rosters - Fetched in fetch-mfl-feeds.mjs, mfl-matchup-api.ts
- ✅ players - Fetched in fetch-mfl-feeds.mjs
- ✅ projectedScores - Fetched in fetch-mfl-feeds.mjs, mfl-matchup-api.ts
- ✅ weeklyResults - Fetched in fetch-mfl-feeds.mjs
- ✅ transactions - Fetched in fetch-mfl-feeds.mjs
- ✅ tradeBait - Fetched in fetch-mfl-feeds.mjs
- ✅ league - Fetched in fetch-mfl-feeds.mjs
- ✅ salaryAdjustments - Fetched in fetch-mfl-feeds.mjs
- ✅ liveScoring - Used in api/live-scoring.ts
- ✅ injuries - Used in mfl-matchup-api.ts

For detailed parameter information, authentication requirements, and usage examples, see [MFL-API.md](MFL-API.md).
