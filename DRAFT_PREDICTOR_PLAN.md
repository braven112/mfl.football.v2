# Draft Pick Predictor Feature - Implementation Plan

## Overview
Create a draft pick predictor feature with two main components:
1. A standalone draft order page showing all 51 picks in a grid view
2. A card in the 2026 roster view showing individual team's draft picks with trade history

## Codebase Context

### Existing Patterns
- **Data Loading:** Uses `import.meta.glob()` to load JSON feeds at build time
- **Standings Logic:** `/src/utils/standings.ts` has wild card tiebreaker logic (will be reversed for draft order)
- **Team Configuration:** `theleague.assets.json` contains team icons, banners, names
- **Grid Layout:** Chart-grid uses CSS grid `repeat(2, 1fr)` for responsive 2-column layout
- **Draft Data:** `DraftCapitalTable.astro` exists with placeholder draft capital data structure

### Key Files to Reference
- `/src/utils/standings.ts` - Standings and tiebreaker logic
- `/src/pages/rosters.astro` - Where 2026 at a glance section lives (line 1216)
- `/src/components/theleague/DraftCapitalTable.astro` - Existing draft capital structure
- `/src/components/theleague/ChartCard.astro` - Card wrapper component
- `/src/data/mfl-feeds/2025/standings.json` - Standings data structure
- `/src/data/mfl-feeds/2025/draftResults.json` - Draft results with trade comments

## Phase 1: Data & Utilities

### 1.1 Create `/src/utils/draft-utils.ts`
**Purpose:** Core draft order calculations and data manipulation

**Functions to implement:**
- `calculateDraftOrder(standings: StandingsFranchise[], leagueWinnerId: string): DraftPrediction[]`
  - Input: Current season standings, league winner franchise ID
  - Returns: Array of DraftPrediction objects in draft order (1-51)
  - Logic: Reverse standings with tiebreakers, place league winner at pick 16

- `getToiletBowlPicks(toiletBowlWinners: ToiletBowlResult[]): SpecialDraftPick[]`
  - Input: Array of toilet bowl tournament results
  - Returns: Array of special picks (1.17, 2.17, 2.18)
  - Maps winners to their assigned picks

- `parseTradeChain(comment: string): TradeHistory`
  - Input: Draft pick comment from draftResults.json
  - Returns: Parsed trade chain with original and intermediate teams
  - Example: "[Pick traded from Bring the Pain.]" → {original: "Bring the Pain", chain: ["Bring the Pain"]}

- `combineOwnershipAndTrades(mflAssets: MFLAssets, tradeHistory: Map): DraftPickOwnership[]`
  - Input: MFL assets API response, historical trade data
  - Returns: Array of picks with ownership and full trade chain

**Type Definitions:**
```typescript
interface DraftPrediction {
  overallPickNumber: number;  // 1-51
  round: number;               // 1-3
  pickInRound: number;         // 1-16 or special (17, 18)
  franchiseId: string;
  teamName: string;
  teamIcon: string;
  currentStanding: {
    wins: number;
    losses: number;
    allPlayPct: number;
    pointsFor: number;
  };
  tradeHistory?: {
    originalTeam: string;
    chain: string[];  // ["Team A", "Team B", "Team C"]
  };
  isToiletBowlPick: boolean;
  toiletBowlType?: 'winner' | 'consolation' | 'consolation2';
  isLeagueWinner: boolean;
}

interface ToiletBowlResult {
  level: 'winner' | 'consolation' | 'consolation2';
  franchiseId: string;
}

interface SpecialDraftPick {
  round: number;
  pickInRound: number;
  franchiseId: string;
  level: string;
}
```

### 1.2 Create Toilet Bowl Detection Utility
**File:** `/src/utils/toilet-bowl-utils.ts`

**Functions:**
- `extractToiletBowlWinners(playoffData: PlayoffBracketData): ToiletBowlResult[]`
  - Input: Playoff bracket/bracket data structure
  - Returns: Winners from three toilet bowl levels
  - Must determine bracket structure from existing code/data

**Note:** Need clarification on playoff data structure - will likely need to parse from existing playoff data or create mechanism to input results

### 1.3 Update `/src/types/standings.ts`
Add new types for draft predictions:
- `DraftPrediction`
- `DraftPickOwnership`
- `ToiletBowlResult`
- Add these to standings-related types

## Phase 2: MFL API Integration

### 2.1 Create `/src/utils/mfl-assets-fetcher.ts`
**Purpose:** Fetch and parse MFL assets API for draft pick ownership

**Functions:**
- `fetchMFLDraftAssets(year: number, leagueId: string): Promise<MFLAssets>`
  - Fetch from: `https://www49.myfantasyleague.com/{year}/export?TYPE=assets&L={leagueId}&JSON=1`
  - Parse and normalize response
  - Return structured pick ownership data

**Integration:**
- Will be called during build time (like other MFL feeds)
- May need to add to deployment scripts if it's not already fetched
- Should cache in `/src/data/mfl-feeds/{YEAR}/assets.json`

## Phase 3: Standalone Draft Predictor Page

### 3.1 Create `/src/pages/draft-predictor.astro`
**Purpose:** Main draft prediction page

**Structure:**
```astro
---
// Load all necessary data
import standings from 'mfl-feeds/2025/standings.json'
import assets from 'mfl-feeds/2025/assets.json'  // Draft picks owned
import draftResults from 'mfl-feeds/2025/draftResults.json'  // Trade history
import { calculateDraftOrder, combineOwnershipAndTrades } from '../utils/draft-utils'

// Calculate draft predictions
const draftPredictions = calculateDraftOrder(standings.leagueStandings.franchise, leagueWinnerId)
const draftWithOwnership = combineOwnershipAndTrades(assets, draftResults)

// For future years, show who was actually picked
const actualPicks = getActualDraftResults(year)  // After draft date
---

<TheLeagueLayout>
  <DraftPredictorView predictions={draftPredictions} actualPicks={actualPicks} />
</TheLeagueLayout>
```

### 3.2 Create `/src/components/theleague/DraftPredictorView.astro`
**Purpose:** Main container and layout for draft predictor page

**Features:**
- Title and description
- Filter/sort controls (optional)
- Call to DraftPredictorGrid component
- Legend explaining pick colors (special picks, league winner, etc.)

### 3.3 Create `/src/components/theleague/DraftPredictorGrid.astro`
**Purpose:** Grid display of all 51 picks

**Structure:**
- 3x16 grid layout (3 rounds, 16 picks per round, plus special picks)
- Each cell shows:
  - Team icon
  - Team name (or abbreviation)
  - Round.Pick number
  - Pick ranking indicator
  - Trade history (hover tooltip?)

**CSS Classes:**
```css
.draft-grid {
  display: grid;
  grid-template-columns: repeat(16, 1fr);
  gap: 0.5rem;
}

.draft-pick {
  aspect-ratio: 1;
  border-radius: 0.5rem;
  overflow: hidden;
  position: relative;
  cursor: pointer;
}

.draft-pick--league-winner {
  border: 3px solid gold;
}

.draft-pick--toilet-bowl {
  border: 2px dashed #ff6b6b;
}

.draft-pick-content {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(...);
}

.draft-pick-icon {
  width: 60%;
  aspect-ratio: 1;
  object-fit: contain;
}

.draft-pick-number {
  font-size: 0.75rem;
  font-weight: 700;
  margin-top: auto;
}
```

**Responsiveness:**
- Desktop: 16 columns
- Tablet: 8 columns
- Mobile: 4 columns

## Phase 4: 2026 Roster View Card

### 4.1 Create `/src/components/theleague/DraftPicksCard.astro`
**Purpose:** Display team's draft picks for a given season

**Props:**
```typescript
interface Props {
  franchiseId: string;
  draftPredictions: DraftPrediction[];  // All predictions
  season: number;  // 2026, 2027, etc
}
```

**Features:**
- Show team's picks in order (best to worst)
- Display trade history with "from X" or "from X via Y" format
- Organized vertically (one column)
- Link to full draft predictor page

**Structure:**
```
┌─────────────────────────────┐
│ 2026 Draft Picks            │
├─────────────────────────────┤
│ [Icon] 1.3 - Pick #3        │
│         from Pacific Pigskins│
│ [Icon] 1.8 - Pick #8        │
│ [Icon] 2.15 - Pick #31      │
│          from Bring the Pain│
│          via Computer Jocks │
└─────────────────────────────┘
```

### 4.2 Update `/src/pages/rosters.astro`
**Location:** 2026 at a glance section (around line 1248)

**Changes:**
1. Import DraftPicksCard component
2. Add to chart-grid:
   ```astro
   <DraftPicksCard franchiseId={franchiseId} draftPredictions={predictions} season={2026} />
   ```
3. Add CSS to make it responsive (may need grid-span adjustments)

**CSS Addition:**
```css
.chart-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  /* ... existing styles ... */
}

/* For grids with 3 items (2 existing + draft picks), adjust layout */
.chart-grid:has(> :nth-child(3)) {
  grid-template-columns: 1fr 1fr;
}
```

## Phase 5: Integration & Real Data

### 5.1 Wire Up MFL API Calls
- Add to build scripts to fetch `/2025/export?TYPE=assets&L=13522&JSON=1`
- Parse and save to `src/data/mfl-feeds/2025/assets.json`
- Set up same pattern for future years

### 5.2 Dynamic Year Selection
- Make pages work for current season + next season
- Update calculations based on actual year
- Handle edge cases (off-season, pre-draft, post-draft)

### 5.3 Toilet Bowl Data Input
**Two options:**
1. **Manual Configuration:** Create config file with annual toilet bowl results
2. **API Integration:** Parse from existing playoff/bracket data if available

## Implementation Order

1. **Start with data utilities** (Phase 1)
   - Create draft-utils.ts with core logic
   - Create type definitions
   - Test with sample data

2. **Create standalone page** (Phase 3)
   - Build draft-predictor.astro page
   - Build DraftPredictorGrid component
   - Verify grid layout and styling

3. **Create roster view card** (Phase 4)
   - Build DraftPicksCard component
   - Integrate into rosters.astro
   - Verify 2-column grid layout

4. **Wire up real MFL data** (Phase 5)
   - Create mfl-assets-fetcher.ts
   - Update build scripts
   - Connect real data to components

5. **Handle toilet bowl logic**
   - Determine data source/input method
   - Implement toilet bowl calculations

6. **Testing & Polish**
   - Responsive design testing
   - Edge cases (no picks, all picks traded, etc)
   - Performance optimization

## Open Questions

1. **Toilet Bowl Data:** How should toilet bowl winners be determined and input?
   - Manual config file per year?
   - Parse from existing playoff/bracket structure?
   - Manual entry in admin interface?

2. **Trade Chain Parsing:** Current draftResults.json has comments like "[Pick traded from X]" - should we:
   - Parse just from comments in draftResults?
   - Also use historical MFL assets data to build full chain?
   - Store trade chain in a separate data file?

3. **Timing for Features:**
   - Should draft predictor page be available immediately or only after certain date?
   - When to show "actual picks" vs "projected picks"?

4. **UI/UX Details:**
   - Should picks in 2026 card be clickable to expand/show trade details?
   - Should we show confidence levels or alternative scenarios?
   - How prominent should the draft card be in the 2026 view?

## Success Criteria

- Draft predictor page displays all 51 picks in grid with team icons
- 2026 roster view has draft picks card showing team's picks
- Trade history is displayed with proper chain formatting
- Real-time updates as standings change
- Responsive design works on all device sizes
- Handles year transitions smoothly (2025→2026, 2026→2027, etc)
- Once draft occurs, shows actual picks picked
