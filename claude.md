# MFL Football v2 - Feature Documentation

## Team Personalization

For details on the team preference cookie system and personalization features across both leagues, see [PERSONALIZATION.md](./PERSONALIZATION.md).

Key features:
- Persistent cookie-based team/conference preferences per league
- Dual URL parameter system:
  - `?myteam=0001` - Sets user's team preference cookie (from MFL context)
  - `?franchise=0005` - View-only mode (doesn't update preference)
- Cross-page team context retention
- Smart fallback: cookie → auth user → default (0001)
- Integration points across TheLeague and AFL Fantasy

---

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

### Team Name Display Standards - 4-Tier System

**IMPORTANT:** All team names across the entire application must use the `chooseTeamName()` utility function to ensure consistent display and prevent UI overflow issues.

#### 4-Tier Naming Structure

Each team in both leagues has 4 name variants stored in config files:

1. **Full Name** (any length) - Official team name from config
   - Example: `"Dark Magicians of Chaos"`
   - Used for: Full displays, headers, official contexts

2. **Medium Name** (≤15 chars) - `nameMedium` field in config
   - Example: `"Dark Magicians"`
   - Used for: Playoff brackets, matchup cards, roster displays (DEFAULT)

3. **Short Name** (≤10 chars) - `nameShort` field in config
   - Example: `"DMOC"`
   - Used for: Mobile views, tight spaces, compact displays

4. **Abbreviation** (2-6 chars) - `abbrev` field from MFL API
   - Example: `"DMOC"` (TheLeague), `"SMOKE"` (AFL)
   - Used for: Ultra-compact displays, tables, scoreboards

#### Config File Structure

**Location:**
- TheLeague: `src/data/theleague.config.json`
- AFL Fantasy: `data/afl-fantasy/afl.config.json`

```json
{
  "franchiseId": "0015",
  "name": "Dark Magicians of Chaos",
  "nameMedium": "Dark Magicians",
  "nameShort": "DMOC",
  "abbrev": "DMOC",
  "aliases": ["Dark Magicians", "Dark Magician", "DMC"]
}
```

#### Implementation

**Location:** `src/utils/team-names.ts`

```typescript
import { chooseTeamName } from '../../utils/team-names';

// NEW OBJECT FORMAT (Recommended)
// Pass all available name options and specify context
const displayName = chooseTeamName({
  fullName: team.name,
  nameMedium: assets?.nameMedium,
  nameShort: assets?.nameShort,
  abbrev: assets?.abbrev,
  mflTeamName: team.teamName,
  aliases: assets?.aliases
}, 'default'); // Context: 'default' | 'short' | 'abbrev'

// LEGACY ARRAY FORMAT (Still supported for backward compatibility)
const displayName = chooseTeamName([
  team.teamName,           // Primary team name from MFL
  assets?.name || '',      // Asset/custom name
  ...(assets?.aliases || []) // Team aliases
]);
```

#### Context-Aware Display

**IMPORTANT:** Pages must specify the appropriate context based on available space:

```typescript
// Default context (≤15 chars) - For playoff brackets, matchup cards
const bracketName = chooseTeamName({
  fullName: team.name,
  nameMedium: assets?.nameMedium,
  nameShort: assets?.nameShort,
  abbrev: assets?.abbrev
}); // Returns: "Dark Magicians"

// Short context (≤10 chars) - For mobile views, tight spaces
const mobileName = chooseTeamName({
  fullName: team.name,
  nameMedium: assets?.nameMedium,
  nameShort: assets?.nameShort,
  abbrev: assets?.abbrev
}, 'short'); // Returns: "DMOC"

// Abbrev context - For ultra-compact displays
const compactName = chooseTeamName({
  fullName: team.name,
  nameMedium: assets?.nameMedium,
  nameShort: assets?.nameShort,
  abbrev: assets?.abbrev
}, 'abbrev'); // Returns: "DMOC"
```

#### Selection Logic

The function automatically selects the best name based on context:

**Default Context (≤15 chars):**
1. Use `nameMedium` if available and ≤15 chars
2. Fallback to longest valid option from `[fullName, mflTeamName, aliases]`
3. If all exceed limit, truncate shortest to 15 chars

**Short Context (≤10 chars):**
1. Use `nameShort` if available and ≤10 chars
2. Fallback to `abbrev` if available
3. Fallback to longest valid option from `[nameMedium, fullName, mflTeamName, aliases]`
4. If all exceed limit, truncate shortest to 10 chars

**Abbrev Context:**
1. Use `abbrev` if available
2. Fallback to `nameShort`

#### Why This Matters

- **Prevents UI overflow** in matchup cards, brackets, and roster displays
- **Ensures consistency** across all pages and device sizes
- **Optimizes readability** for different display contexts
- **Handles edge cases** where team names are very long

#### Where to Use

Apply `chooseTeamName()` when:
- Building seed maps for playoffs
- Resolving team data in bracket views
- Displaying team names in any UI component (matchups, rosters, standings, etc.)
- Creating team-related data structures
- **Mobile responsive layouts** (use `'short'` context)
- **Compact tables** (use `'abbrev'` context)

#### Migration Examples

**Before (Legacy):**
```typescript
displayName: chooseTeamName([
  team.teamName,
  assetMap.get(team.id)?.name || '',
  ...(assetMap.get(team.id)?.aliases || []),
])
```

**After (New Format):**
```typescript
displayName: chooseTeamName({
  fullName: assetMap.get(team.id)?.name || team.teamName,
  nameMedium: assetMap.get(team.id)?.nameMedium,
  nameShort: assetMap.get(team.id)?.nameShort,
  abbrev: assetMap.get(team.id)?.abbrev,
  mflTeamName: team.teamName,
  aliases: assetMap.get(team.id)?.aliases
})
```

#### Special Cases

**Fire Ready Aim (0007):**
- Full: "Fire Ready Aim"
- Medium: "Fire Ready" (custom)
- Short: "FRA" (custom abbreviation)
- MFL Abbrev: "FIRE"

**Vitside Mafia (0012):**
- Full: "Vitside Mafia"
- Medium: "Vitside" (custom)
- Short: "Vit" (custom abbreviation)
- MFL Abbrev: "VIT"

#### Backward Compatibility

✅ **Legacy array format still works!** Existing code continues to function without changes. The new object format is recommended for new implementations and provides more flexibility for responsive designs.

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
