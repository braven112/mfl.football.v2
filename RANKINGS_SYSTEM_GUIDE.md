# Rankings System Guide

## Overview

The Auction Predictor now supports **independent storage and access** of multiple ranking sources:
- **Dynasty League Football (DLF)** - Dynasty-focused rankings (CSV format)
- **FootballGuys** - Expert consensus rankings (TSV format)

Both ranking sources are stored independently in localStorage and state, allowing you to use them separately or create composite rankings.

## Storage Keys

### localStorage
- `auctionPredictor.dlfRankings` - DLF dynasty rankings
- `auctionPredictor.footballguysRankings` - FootballGuys rankings
- Legacy keys (still supported):
  - `auctionPredictor.dynastyRankings` - Maps to DLF
  - `auctionPredictor.redraftRankings` - Maps to FootballGuys

### State Structure
```typescript
interface RankingData {
  source: string;           // "DLF" or "FootballGuys"
  rankingType: 'dynasty' | 'redraft' | 'footballguys' | 'dlf';
  importDate: string;       // ISO timestamp
  rankings: Array<{
    rank: number;
    playerName: string;
    position: string;
    team?: string;
    playerId: string | null;
    matched: boolean;
    confidence: number;
  }>;
}

state.rankings = {
  footballguys: RankingData | null,
  dlf: RankingData | null,
  dynasty: RankingData | null,  // Legacy support
  redraft: RankingData | null,  // Legacy support
}
```

## API Functions

### Check if Rankings are Loaded
```javascript
const hasRankings = window.auctionState.hasRankings();
// Returns true if any rankings are loaded
```

### Get Player Rank from Specific Source
```javascript
// Get FootballGuys rank
const fbRank = window.auctionState.getPlayerRank(playerId, 'footballguys');

// Get DLF rank
const dlfRank = window.auctionState.getPlayerRank(playerId, 'dlf');

// Returns: number | null
```

### Get Composite Rank (Average)
```javascript
const compositeRank = window.auctionState.getCompositeRank(playerId);
// Returns average of all available rankings, or null if no rankings

// Example:
// - FootballGuys: 15
// - DLF: 25
// - Composite: 20 (average)
```

### Get All Rankings for a Player
```javascript
const allRanks = window.auctionState.getAllPlayerRanks(playerId);
// Returns: {
//   footballguys: number | null,
//   dlf: number | null,
//   composite: number | null
// }
```

## Usage Examples

### Example 1: Display Ranks in Player Table
```javascript
state.players.forEach(player => {
  const ranks = window.auctionState.getAllPlayerRanks(player.id);
  
  console.log(`${player.name}:`);
  console.log(`  FootballGuys: #${ranks.footballguys || 'NR'}`);
  console.log(`  DLF: #${ranks.dlf || 'NR'}`);
  console.log(`  Composite: #${ranks.composite || 'NR'}`);
});
```

### Example 2: Filter Top-Ranked Players
```javascript
const topPlayers = state.players.filter(player => {
  const composite = window.auctionState.getCompositeRank(player.id);
  return composite && composite <= 50; // Top 50 composite rank
});
```

### Example 3: Calculate Price Based on Rankings
```javascript
function calculateAuctionPrice(playerId) {
  const ranks = window.auctionState.getAllPlayerRanks(playerId);
  
  // Prefer composite, fall back to individual sources
  const rank = ranks.composite || ranks.dlf || ranks.footballguys;
  
  if (!rank) return null; // Player not ranked
  
  // Simple inverse ranking: Top player = highest price
  const basePrice = 10000000; // $10M
  const rankMultiplier = Math.max(0.1, 1 - (rank / 300));
  
  return Math.round(basePrice * rankMultiplier);
}
```

### Example 4: Use Specific Source for Strategy
```javascript
// Dynasty league: Prefer DLF rankings
function getDynastyValue(playerId) {
  const dlfRank = window.auctionState.getPlayerRank(playerId, 'dlf');
  return dlfRank ? calculatePriceFromRank(dlfRank) : null;
}

// Redraft league: Prefer FootballGuys
function getRedraftValue(playerId) {
  const fbRank = window.auctionState.getPlayerRank(playerId, 'footballguys');
  return fbRank ? calculatePriceFromRank(fbRank) : null;
}

// Blended approach using dynasty weight
function getBlendedValue(playerId, dynastyWeight = 0.6) {
  const dlf = window.auctionState.getPlayerRank(playerId, 'dlf');
  const fb = window.auctionState.getPlayerRank(playerId, 'footballguys');
  
  if (!dlf && !fb) return null;
  if (!dlf) return calculatePriceFromRank(fb);
  if (!fb) return calculatePriceFromRank(dlf);
  
  // Weighted average
  const blendedRank = (dlf * dynastyWeight) + (fb * (1 - dynastyWeight));
  return calculatePriceFromRank(blendedRank);
}
```

## Import Statistics

Each ranking source tracks:
- **Total players**: Count in the import file
- **Matched players**: Successfully linked to MFL database
- **Unmatched players**: Not found (free agents, rookies, etc.)
- **Match rate**: Percentage of successful matches (target: 85%+)
- **Import date**: When rankings were last updated

Access statistics:
```javascript
const dlfData = state.rankings.dlf;
if (dlfData) {
  console.log('DLF Statistics:');
  console.log('- Total:', dlfData.rankings.length);
  console.log('- Matched:', dlfData.rankings.filter(r => r.matched).length);
  console.log('- Imported:', new Date(dlfData.importDate).toLocaleDateString());
}
```

## UI Components

### Rankings Status Overview
Visual indicator showing which rankings are loaded:
- Green badge + statistics when loaded
- Gray badge when not loaded
- Import date and match rate displayed
- Located at top of Rankings Import view

### Individual Import Sections
Each source has its own:
- Text area for paste input
- Import button
- Clear button (removes from state + localStorage)
- Results display (total, matched, unmatched, match rate)
- Unmatched players list (first 20)

## Data Flow

1. **User pastes rankings** → Text area
2. **Clicks Import** → `handleRankingsImport()`
3. **Parse format** → `parseTabSeparated()` (auto-detects CSV/TSV)
4. **Match players** → `matchPlayerToMFL()` (fuzzy matching, 0.65 threshold)
5. **Save to localStorage** → `auctionPredictor.{source}Rankings`
6. **Update state** → `state.rankings.{source}`
7. **Update UI** → `updateRankingsStatusOverview()`
8. **Emit event** → `eventBus.emit('rankingsImported')`

## Match Rate Targets

- **Excellent**: 95%+ (FootballGuys achieved 97.9%)
- **Good**: 85-95% (DLF achieved 100%)
- **Acceptable**: 75-85%
- **Poor**: <75%

Typical unmatched players:
- Free agents not on any roster
- Practice squad players
- Rookies not yet in MFL database
- Retired players still ranked

## Best Practices

1. **Always check if rankings exist** before using them:
   ```javascript
   if (window.auctionState.hasRankings()) {
     // Use rankings
   } else {
     // Prompt user to import rankings
   }
   ```

2. **Handle null values gracefully**:
   ```javascript
   const rank = window.auctionState.getCompositeRank(playerId);
   const displayRank = rank || 'NR'; // Show "NR" for not ranked
   ```

3. **Use composite ranks for broad consensus**:
   ```javascript
   // Better than relying on single source
   const composite = window.auctionState.getCompositeRank(playerId);
   ```

4. **Store rankings externally** if doing complex analysis:
   ```javascript
   const allRankings = {
     dlf: state.rankings.dlf?.rankings || [],
     footballguys: state.rankings.footballguys?.rankings || []
   };
   ```

5. **Re-import rankings periodically** as experts update their boards during the season

## Future Enhancements

Potential additions:
- [ ] FantasyPros API integration (requires paid subscription)
- [ ] Multiple ranking sources per category (e.g., 3 dynasty sources)
- [ ] Weighted composite (give more weight to preferred sources)
- [ ] Historical ranking tracking (see rank changes over time)
- [ ] Outlier detection (flag when sources disagree significantly)
- [ ] Custom manual rankings input

## Troubleshooting

### Rankings not loading on page refresh
- Check browser console for localStorage errors
- Verify localStorage quota not exceeded
- Try clearing and re-importing

### Low match rate (<75%)
- Check format (CSV vs TSV)
- Verify column order matches expected format
- Look for unusual name formats in unmatched list

### Missing star players in matches
- Verify they're not on long-term contracts (check `state.allMFLPlayers`)
- Check for name format differences (Jr., initials, hyphens)
- Review console debug logs for similarity scores

### State not updating after import
- Check browser console for errors
- Verify `updateRankingsStatusOverview()` is called
- Refresh page to reload from localStorage
