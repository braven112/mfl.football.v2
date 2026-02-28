# Rookie Draft Predictor - Requirements Document

## Executive Summary

Build a rookie draft prediction tool that uses expert consensus rookie rankings to predict the draft order and calculate cap impact. This tool serves dual purposes: (1) standalone rookie draft board, and (2) data integration for the auction predictor to improve accuracy of team cap space and positional needs.

## Business Objectives

### Primary Goals
1. Predict rookie draft order based on expert consensus rankings
2. Calculate total rookie draft cap commitments per team
3. Integrate rookie draft predictions into auction predictor for improved accuracy
4. Provide exportable draft board for league preparation

### Success Criteria
- Predict draft selections within 3 picks of actual for top 12 picks
- Match consensus "tier breaks" for positional runs
- Accurately calculate rookie salary cap impact (100% accuracy)
- Reduce auction price prediction errors by 10%+ through better demand modeling

## Relationship to Auction Predictor

### Data Architecture (Shared Infrastructure)

Both tools use the **same ranking storage system**:

```typescript
// Shared localStorage keys
localStorage: {
  'auctionPredictor.dlfRookieRankings': RankingData,
  'auctionPredictor.footballguysRookieRankings': RankingData,
  'auctionPredictor.dlfRankings': RankingData,          // Veterans
  'auctionPredictor.footballguysRankings': RankingData, // Veterans
}

// Shared state structure
state.rankings = {
  veterans: {
    dlf: RankingData | null,
    footballguys: RankingData | null,
  },
  rookies: {
    dlf: RankingData | null,
    footballguys: RankingData | null,
  }
}
```

### Integration Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Rookie Draft Predictor                    │
│                   (Standalone Page/Tool)                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  User Actions:                                                │
│  1. Import DLF rookie rankings                               │
│  2. Import FootballGuys rookie rankings                      │
│  3. View predicted draft order                               │
│  4. Export draft board                                       │
│                                                               │
│  Outputs Stored:                                              │
│  • localStorage: rookie rankings                             │
│  • Composite rookie ranks calculated                         │
│  • Draft simulation results                                  │
│                                                               │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ Data flows to ↓
                            │
┌───────────────────────────┴─────────────────────────────────┐
│                    Auction Predictor                         │
│              (Uses Rookie Draft Predictions)                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Reads From Storage:                                          │
│  • localStorage: rookie rankings (same keys)                 │
│  • Draft pick assignments by team                            │
│                                                               │
│  Calculations:                                                │
│  FOR each team WITH draft picks:                             │
│    1. Simulate rookie selections (consensus order)           │
│    2. Calculate rookie salaries (slotted)                    │
│    3. Reduce available auction cap                           │
│    4. Mark positional needs as filled                        │
│    5. Reduce market positional demand                        │
│                                                               │
│  Result: More accurate auction prices                        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## User Stories

### US-RD1: Import Rookie Rankings
**As a** league owner  
**I want to** import rookie rankings from expert sources  
**So that** I have consensus data to predict draft order

**Acceptance Criteria:**
- Support DLF rookie CSV format
- Support FootballGuys rookie TSV format
- Same fuzzy matching system as veteran rankings (85%+ match rate)
- Store in shared localStorage: `auctionPredictor.{source}RookieRankings`
- Visual status showing which sources loaded
- Match statistics displayed (total, matched, unmatched, rate)

### US-RD2: View Predicted Draft Order
**As a** league owner  
**I want to** see a predicted rookie draft order  
**So that** I can prepare my draft strategy

**Acceptance Criteria:**
- Display picks 1.01 through 5.16 (5 rounds × 16 teams)
- Show for each pick:
  - Team name and logo
  - Predicted player selection (name, position, school)
  - Composite rookie rank
  - Source ranks (DLF, FootballGuys individually)
  - Slotted salary for that pick/position
  - Team positional need filled
- Color-code by position
- Show "tier breaks" where ranking gaps are large
- Update in real-time as rankings imported

### US-RD3: Understand Draft Selection Logic
**As a** league owner  
**I want to** see why each player was predicted to each team  
**So that** I can validate the predictions make sense

**Acceptance Criteria:**
- Show reasoning for each pick:
  - "Highest ranked available: RB #2"
  - "Fills critical need: WR depth"
  - "Best player available (BPA) strategy"
- Highlight picks where team need overrides BPA
- Show alternative selections (next 2-3 options)
- Display team positional needs before each pick

### US-RD4: Calculate Total Rookie Cap Impact
**As a** league owner  
**I want to** see total rookie draft spending by team  
**So that** I know their available auction budget

**Acceptance Criteria:**
- Show for each team:
  - Number of draft picks
  - Total rookie salary commitments
  - Breakdown by round
  - Impact on auction cap (before/after)
- League-wide summary:
  - Total rookie spending across all teams
  - Average rookie commitment per team
  - Impact on total auction pool
- Export to CSV for analysis

### US-RD5: Export Draft Board
**As a** league owner  
**I want to** export the predicted draft board  
**So that** I can share it or use it for preparation

**Acceptance Criteria:**
- Export formats: CSV, JSON
- Includes all pick data (team, player, rank, salary)
- Can import back into tool
- Can print as PDF

### US-RD6: Configure Draft Strategy
**As a** league owner  
**I want to** adjust the balance between rankings and team needs  
**So that** I can test different draft strategies

**Acceptance Criteria:**
- Slider control: "Rankings Priority" (0-100%)
  - 100% = Pure BPA (Best Player Available by composite rank)
  - 0% = Pure Need (ignore rankings, only fill positional needs)
  - 50% = Balanced (use rankings, break ties with needs)
- Global strategy sets default for all teams
- Per-team strategy overrides available
- Visual indicator showing which strategy each team is using
- Reasoning updates to show strategy influence:
  - "BPA Strategy: Selected #3 overall"
  - "Need-Based: Critical RB need, selected #8 RB"
  - "Balanced: Top-ranked WR filling high-priority need"

**Example Strategies:**
- **Contending Team (70% rankings)**: Mostly BPA, slight need consideration
- **Rebuilding Team (90% rankings)**: Draft best talent regardless of need
- **Win-Now Team (40% rankings)**: Prioritize filling roster holes

### US-RD7: Set Team-Specific Strategies
**As a** league owner  
**I want to** set different draft strategies per team  
**So that** I can model how different teams approach the draft

**Acceptance Criteria:**
- Click team to set custom strategy percentage
- Show team context when setting strategy:
  - Championship window status
  - Critical positional needs
  - Current roster depth
- Suggested strategies based on team status:
  - Contending → 60-80% rankings
  - Rebuilding → 85-100% rankings
  - Neutral → 40-60% rankings
- Visual distinction for teams with custom strategies
- Reset to global strategy option

### US-RD8: Integration with Auction Tool
**As a** league owner  
**I want to** see how rookie draft affects auction prices  
**So that** I can make better auction decisions

**Acceptance Criteria:**
- Auction tool automatically detects rookie rankings in storage
- Shows "Rookie Draft Impact" section in auction tool
- Displays per team:
  - Rookie cap commitments
  - Positions filled by rookies
  - Adjusted auction budget
- Market analysis reflects reduced demand:
  - "3 teams drafting RBs → RB demand reduced"
  - Scarcity multipliers adjusted
  - Price predictions recalculated

## Functional Requirements

### FR-RD1: Draft Simulation Algorithm

```typescript
interface DraftSimulation {
  picks: DraftPick[];
  teamCommitments: Map<string, RookieCommitment>;
  positionalTiers: PositionalTier[];
}

interface DraftPick {
  round: number;
  pick: number;
  overallPick: number;
  team: string;
  teamStrategy: number;        // 0-100, rankings priority percentage
  player: RookiePlayer;
  reasoning: string[];
  alternatives: RookiePlayer[];
  slottedSalary: number;
  bpaOption?: RookiePlayer;    // Best player available (for comparison)
  needOption?: RookiePlayer;   // Best need match (for comparison)
}

interface RookiePlayer {
  name: string;
  position: string;
  school: string;
  compositeRank: number;
  sourceRanks: {
    dlf?: number;
    footballguys?: number;
  };
}

interface RookieCommitment {
  teamId: string;
  totalSalary: number;
  picks: number;
  byRound: { [round: number]: number };
  positionsFilled: string[];
}
```

### FR-RD2: Selection Algorithm with Strategy Weighting

```
FUNCTION simulateRookieDraft(teams, rookieRankings, draftPicks, globalStrategy, teamStrategies):
  drafted = []
  
  FOR each pick IN draft_order:
    team = pick.team
    strategy = teamStrategies[team.id] ?? globalStrategy  // 0-100, rankings priority %
    
    // Get available rookies
    available = rookieRankings.filter(r => 
      !drafted.includes(r.id)
    )
    
    // Option 1: Best Player Available (BPA)
    bpa = available.sort_by(composite_rank)[0]
    
    // Option 2: Best Need Match
    teamNeeds = analyzeTeamNeeds(team)
    needCandidates = available.filter(r => 
      r.position IN teamNeeds.critical_needs OR
      r.position IN teamNeeds.high_needs
    ).sort_by(composite_rank)
    
    needMatch = needCandidates[0] ?? bpa  // Fallback to BPA if no needs
    
    // Strategy-Based Selection
    selection = determineSelectionByStrategy(
      bpa, 
      needMatch, 
      strategy, 
      available, 
      teamNeeds
    )
    
    // Record pick with context
    drafted.push(selection.id)
    pick.player = selection
    pick.teamStrategy = strategy
    pick.bpaOption = bpa
    pick.needOption = needMatch
    pick.reasoning = generateReasoning(selection, bpa, needMatch, strategy, teamNeeds)
    pick.alternatives = getAlternatives(available, selection, 3)
    pick.slottedSalary = getSlottedSalary(pick.round, pick.number, selection.position)
    
    // Update team state
    team.rookieCommitments += pick.slottedSalary
    team.positionNeeds[selection.position].filled = true
    
  RETURN simulation_results


FUNCTION determineSelectionByStrategy(bpa, needMatch, strategy, available, teamNeeds):
  // Pure BPA (90-100%)
  IF strategy >= 90:
    RETURN bpa
  
  // Pure Need (0-10%)
  IF strategy <= 10:
    RETURN needMatch
  
  // Balanced Strategy (11-89%)
  // Calculate composite score for each candidate
  candidates = []
  
  FOR each player IN available:
    // Rankings score (0-100, #1 = 100, #100 = 0)
    rankScore = 100 - player.compositeRank
    
    // Need score (0-100)
    needScore = calculateNeedScore(player.position, teamNeeds)
    
    // Weighted composite
    weightedScore = (rankScore * strategy/100) + (needScore * (100-strategy)/100)
    
    candidates.push({
      player: player,
      rankScore: rankScore,
      needScore: needScore,
      weightedScore: weightedScore
    })
  
  // Select highest weighted score
  bestCandidate = candidates.sort_by(weightedScore DESC)[0]
  RETURN bestCandidate.player


FUNCTION calculateNeedScore(position, teamNeeds):
  IF position IN teamNeeds.critical_needs:
    RETURN 100  // Critical need
  ELSE IF position IN teamNeeds.high_needs:
    RETURN 75   // High priority
  ELSE IF position IN teamNeeds.medium_needs:
    RETURN 50   // Medium priority
  ELSE IF position IN teamNeeds.low_needs:
    RETURN 25   // Low priority
  ELSE:
    RETURN 0    // No need at position
```

### FR-RD3: Team Needs Analysis

```
FUNCTION analyzeTeamNeeds(team):
  needs = {
    critical: [],  // 0-1 players at position, or aging starters (30+)
    high: [],      // 2 players at position, or depth concerns
    medium: [],    // 3 players at position
    low: []        // 4+ players at position
  }
  
  FOR each position:
    players = team.roster.filter(p => p.position == position)
    depth = players.length
    avgAge = average(players.map(p => p.age))
    starterQuality = getStarterQuality(players, position)
    
    // Critical need criteria
    IF depth <= 1:
      needs.critical.push({
        position: position,
        reason: `Only ${depth} player${depth == 1 ? '' : 's'} at ${position}`,
        severity: 100
      })
    ELSE IF depth == 2 AND avgAge >= 30:
      needs.critical.push({
        position: position,
        reason: `Aging depth at ${position} (avg age ${avgAge})`,
        severity: 90
      })
    ELSE IF starterQuality == 'poor' AND depth <= 3:
      needs.critical.push({
        position: position,
        reason: `Weak starter quality, limited depth`,
        severity: 85
      })
    
    // High need criteria
    ELSE IF depth == 2:
      needs.high.push({
        position: position,
        reason: `Thin depth at ${position}`,
        severity: 75
      })
    ELSE IF depth == 3 AND avgAge >= 28:
      needs.high.push({
        position: position,
        reason: `Aging roster at ${position}`,
        severity: 70
      })
    
    // Medium need criteria
    ELSE IF depth == 3:
      needs.medium.push({
        position: position,
        reason: `Adequate depth at ${position}`,
        severity: 50
      })
    
    // Low priority (well-stocked)
    ELSE IF depth >= 4:
      needs.low.push({
        position: position,
        reason: `Strong depth at ${position}`,
        severity: 25
      })
  
  RETURN needs


FUNCTION getStarterQuality(players, position):
  // Analyze the top starter(s) at this position
  starters = players.sort_by(composite_rank).slice(0, getStarterCount(position))
  
  IF starters.isEmpty():
    RETURN 'none'
  
  avgRank = average(starters.map(p => p.compositeRank))
  
  // Position-specific thresholds
  thresholds = {
    QB: { elite: 12, good: 24, average: 36 },
    RB: { elite: 24, good: 40, average: 60 },
    WR: { elite: 36, good: 60, average: 90 },
    TE: { elite: 12, good: 20, average: 30 }
  }
  
  threshold = thresholds[position]
  
  IF avgRank <= threshold.elite:
    RETURN 'elite'
  ELSE IF avgRank <= threshold.good:
    RETURN 'good'
  ELSE IF avgRank <= threshold.average:
    RETURN 'average'
  ELSE:
    RETURN 'poor'


FUNCTION getStarterCount(position):
  // How many starters needed at each position
  RETURN {
    QB: 1,
    RB: 2,
    WR: 3,
    TE: 1
  }[position]
```

### FR-RD4: Reasoning Generation

```
FUNCTION generateReasoning(selection, bpa, needMatch, strategy, teamNeeds):
  reasoning = []
  
  // Strategy context
  IF strategy >= 90:
    reasoning.push(`🎯 Pure BPA Strategy (${strategy}% rankings priority)`)
  ELSE IF strategy <= 10:
    reasoning.push(`🎯 Need-Based Strategy (${100-strategy}% need priority)`)
  ELSE:
    reasoning.push(`🎯 Balanced Strategy (${strategy}% rankings, ${100-strategy}% need)`)
  
  // Selection rationale
  IF selection.id == bpa.id AND selection.id == needMatch.id:
    // Perfect alignment
    reasoning.push(`✅ Best Player Available AND fills team need`)
    reasoning.push(`   Rank: #${selection.compositeRank} overall (DLF: #${selection.sourceRanks.dlf}, FBG: #${selection.sourceRanks.footballguys})`)
    
    need = findNeed(selection.position, teamNeeds)
    reasoning.push(`   Need: ${need.reason} (${need.severity}/100 priority)`)
    
  ELSE IF selection.id == bpa.id:
    // Went with rankings
    reasoning.push(`📊 Selected Best Player Available`)
    reasoning.push(`   Rank: #${selection.compositeRank} overall`)
    
    IF needMatch.position != bpa.position:
      reasoning.push(`   Passed on need: ${needMatch.name} (${needMatch.position}, #${needMatch.compositeRank})`)
      need = findNeed(needMatch.position, teamNeeds)
      reasoning.push(`   ${need.reason}`)
    
  ELSE IF selection.id == needMatch.id:
    // Went with need
    reasoning.push(`🎯 Selected to Fill Position Need`)
    need = findNeed(selection.position, teamNeeds)
    reasoning.push(`   Need: ${need.reason} (${need.severity}/100 priority)`)
    reasoning.push(`   Rank: #${selection.compositeRank} overall`)
    
    rankDiff = selection.compositeRank - bpa.compositeRank
    reasoning.push(`   Passed on BPA: ${bpa.name} (${bpa.position}, #${bpa.compositeRank}, Δ${rankDiff})`)
    
  ELSE:
    // Balanced decision
    reasoning.push(`⚖️ Weighted Selection (rankings + need)`)
    reasoning.push(`   Rank: #${selection.compositeRank} overall`)
    need = findNeed(selection.position, teamNeeds)
    IF need:
      reasoning.push(`   Need: ${need.reason}`)
    
    reasoning.push(`   BPA alternative: ${bpa.name} (${bpa.position}, #${bpa.compositeRank})`)
    reasoning.push(`   Need alternative: ${needMatch.name} (${needMatch.position}, #${needMatch.compositeRank})`)
  
  // Positional context
  positionRank = getPositionRank(selection.position, selection.compositeRank)
  reasoning.push(`   ${selection.position} rank: #${positionRank}`)
  
  // Tier context
  tier = getTier(selection.position, selection.compositeRank)
  IF tier.isBreak:
    reasoning.push(`   ⚠️ Tier break: Last player in Tier ${tier.number}`)
  ELSE:
    reasoning.push(`   Tier ${tier.number} ${selection.position}`)
  
  RETURN reasoning


FUNCTION findNeed(position, teamNeeds):
  FOR category IN ['critical', 'high', 'medium', 'low']:
    need = teamNeeds[category].find(n => n.position == position)
    IF need:
      RETURN need
  RETURN null
```

### FR-RD5: Tier Detection

```
FUNCTION detectPositionalTiers(rookieRankings):
  tiers = []
  
  FOR each position:
    positionRookies = rookieRankings.filter(r => r.position == position)
      .sort_by(composite_rank ASC)
    
    tier = 1
    currentTier = {
      position: position,
      tier: 1,
      players: [positionRookies[0]],
      rankRange: { start: positionRookies[0].compositeRank, end: null }
    }
    
    FOR i in 1..positionRookies.length-1:
      current = positionRookies[i-1]
      next = positionRookies[i]
      
      rankGap = next.compositeRank - current.compositeRank
      
      // Tier break criteria
      IF rankGap > 5 OR 
         (tier <= 2 AND rankGap > 3):  // Stricter for top tiers
        
        // Close current tier
        currentTier.rankRange.end = current.compositeRank
        currentTier.avgRank = average(currentTier.players.map(p => p.compositeRank))
        currentTier.count = currentTier.players.length
        tiers.push(currentTier)
        
        // Start new tier
        tier++
        currentTier = {
          position: position,
          tier: tier,
          players: [next],
          rankRange: { start: next.compositeRank, end: null },
          previousGap: rankGap
        }
      ELSE:
        // Continue current tier
        currentTier.players.push(next)
    
    // Close final tier
    currentTier.rankRange.end = positionRookies[positionRookies.length-1].compositeRank
    currentTier.avgRank = average(currentTier.players.map(p => p.compositeRank))
    currentTier.count = currentTier.players.length
    tiers.push(currentTier)
  
  RETURN tiers
```

## Data Model

### Team Strategy Configuration

```typescript
interface TeamStrategyConfig {
  globalStrategy: number;  // 0-100, default rankings priority
  teamOverrides: Map<string, TeamStrategy>;
}

interface TeamStrategy {
  teamId: string;
  strategyPercentage: number;  // 0-100, rankings priority
  customized: boolean;         // True if manually set
  suggestedStrategy: number;   // Auto-calculated based on team status
  reasoning: string;           // Why this strategy is suggested
}

// Example:
const defaultConfig: TeamStrategyConfig = {
  globalStrategy: 70,  // Default: 70% rankings, 30% need
  teamOverrides: new Map([
    ['BRA', {
      teamId: 'BRA',
      strategyPercentage: 95,
      customized: true,
      suggestedStrategy: 85,
      reasoning: 'Rebuilding team - prioritize talent acquisition'
    }],
    ['SEA', {
      teamId: 'SEA',
      strategyPercentage: 40,
      customized: true,
      suggestedStrategy: 50,
      reasoning: 'Win-now mode - fill immediate roster holes'
    }]
  ])
}
```

### Rookie Rankings Storage

```typescript
interface RookieRankingData {
  source: 'DLF' | 'FootballGuys' | 'FantasyPros';
  rankingType: 'rookie';
  importDate: string;
  rankings: RookieRanking[];
  statistics: {
    total: number;
    matched: number;
    unmatched: number;
    matchRate: number;
  };
}

interface RookieRanking {
  rank: number;
  playerName: string;
  position: string;
  school: string;
  team?: string;           // Projected NFL team (may differ from actual)
  playerId: string | null; // MFL ID if matched
  matched: boolean;
  confidence: number;      // Fuzzy match confidence (0-1)
}
```

### Integration with Auction Tool

```typescript
// Auction tool reads this data
interface AuctionIntegrationData {
  rookieDraftSimulation: {
    completed: boolean;
    picks: DraftPick[];
    teamCommitments: Map<string, RookieCommitment>;
  };
  
  adjustedTeamData: Array<{
    teamId: string;
    originalCap: number;
    rookieCommitments: number;
    adjustedCap: number;
    positionsFilled: string[];
  }>;
  
  adjustedMarketDemand: {
    [position: string]: {
      originalDemand: number;
      rookiesFilling: number;
      adjustedDemand: number;
    };
  };
}
```

## User Interface Design

### Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│                    Rookie Draft Predictor                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  [Rankings Import Section]                                   │
│  ┌─────────────────────┬─────────────────────┐              │
│  │ DLF Rookie Rankings │ FootballGuys Rookies│              │
│  │ Status: ✅ Loaded   │ Status: ✅ Loaded   │              │
│  │ [Import] [Clear]    │ [Import] [Clear]    │              │
│  └─────────────────────┴─────────────────────┘              │
│                                                               │
│  [Draft Strategy Control]                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Global Strategy:                                     │    │
│  │                                                       │    │
│  │  Need ◄────────●────────────► Rankings               │    │
│  │   0%          70%           100%                     │    │
│  │                                                       │    │
│  │  Current: 70% Rankings Priority (Balanced)           │    │
│  │  • Uses consensus rankings as primary guide          │    │
│  │  • Considers team needs to break ties                │    │
│  │  • Favors filling critical roster holes              │    │
│  │                                                       │    │
│  │  [Set Team-Specific Strategies ▼]                    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  [Team Strategy Overrides] (Collapsed by Default)            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Teams with Custom Strategies:                        │    │
│  │                                                       │    │
│  │ 🔧 BRA (95% Rankings) - Rebuilding, draft BPA        │    │
│  │ 🔧 SEA (40% Rankings) - Win-now, fill holes          │    │
│  │ 🔧 NYG (50% Rankings) - Balanced approach            │    │
│  │                                                       │    │
│  │ [Customize All Teams] [Reset All to Global]          │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  [Draft Board]                                                │
│  Round 1                                                      │
│  ┌─────┬──────┬────────────────┬──────┬────────┬──────┬────┐│
│  │Pick │Team  │ Player         │ Pos  │School  │Salary│Str │││
│  ├─────┼──────┼────────────────┼──────┼────────┼──────┼────┤│
│  │1.01 │ BRA🔧│ Ashton Jeanty  │ RB   │ Boise  │$2.50M│95% │││
│  │     │      │ 🎯 Pure BPA Strategy              [Details▼]│││
│  │     │      │ ✅ BPA AND fills critical need (0 RBs)      │││
│  │     │      │ 📊 Rank: #1 overall (DLF:#1, FBG:#2)       │││
│  ├─────┼──────┼────────────────┼──────┼────────┼──────┼────┤│
│  │1.02 │ SEA🔧│ Travis Hunter  │ WR   │ Colo   │$2.40M│40% │││
│  │     │      │ 🎯 Need-Based Strategy            [Details▼]│││
│  │     │      │ ⚖️ Selected to fill high-priority WR need  │││
│  │     │      │ 📊 Rank: #3 overall, WR #1                │││
│  │     │      │ ⚠️ Passed on BPA: Tetairoa (WR, #2)       │││
│  └─────┴──────┴────────────────┴──────┴────────┴──────┴────┘│
│                                                               │
│  [Team Commitments Summary]                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ BRA (95% Rankings🔧): 5 picks, $8.5M total           │   │
│  │   • Positions filled: RB, WR, WR, TE, OL             │   │
│  │   • Strategy: Rebuilding - prioritize talent         │   │
│  │                                                       │   │
│  │ SEA (40% Rankings🔧): 3 picks, $5.2M total           │   │
│  │   • Positions filled: WR, RB, CB                     │   │
│  │   • Strategy: Win-now - fill immediate needs         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  [Export Options]                                             │
│  [Export CSV] [Export JSON] [Print PDF] [Share Simulation]   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Team Strategy Customization Modal

```
┌─────────────────────────────────────────────────────────────┐
│  Set Strategy for BRA                              [Close ✕] │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Championship Window: 🔴 Rebuilding (Score: 35/100)          │
│  Draft Picks: 1.01, 1.12, 2.01, 3.03, 4.01                  │
│                                                               │
│  Critical Needs:                                              │
│  • RB - Only 0 players, weak depth                           │
│  • WR - Only 2 players, aging (avg age 29)                   │
│  • TE - Only 1 player                                        │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Draft Strategy:                                      │    │
│  │                                                       │    │
│  │  Need ◄────────────────●──► Rankings                 │    │
│  │   0%                  95%  100%                      │    │
│  │                                                       │    │
│  │  Current: 95% Rankings Priority                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  💡 Suggested Strategy: 85% Rankings                         │
│  Reasoning: Rebuilding teams should prioritize talent        │
│  acquisition over immediate need. Build young core.          │
│                                                               │
│  Strategy Presets:                                            │
│  [Pure BPA (100%)] [Rebuilding (85%)] [Balanced (50%)]       │
│  [Win-Now (30%)]   [Pure Need (0%)]                          │
│                                                               │
│  [Apply] [Apply to Similar Teams] [Cancel]                   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Integration Points

### localStorage Schema

```typescript
// Strategy persistence
localStorage['rookieDraft.globalStrategy'] = 70;  // 0-100
localStorage['rookieDraft.teamStrategies'] = JSON.stringify({
  'BRA': { percentage: 95, customized: true, reasoning: '...' },
  'SEA': { percentage: 40, customized: true, reasoning: '...' }
});

// Simulation results (for auction tool integration)
localStorage['rookieDraft.lastSimulation'] = JSON.stringify({
  timestamp: '2026-01-01T12:00:00Z',
  globalStrategy: 70,
  picks: [...],
  teamCommitments: {...},
  strategyUsed: 'balanced'
});

// Rankings (shared with auction tool)
localStorage['auctionPredictor.dlfRookieRankings'] = JSON.stringify({...});
localStorage['auctionPredictor.footballguysRookieRankings'] = JSON.stringify({...});
```

### With Auction Predictor

1. **Shared Storage**: Both tools read/write to same localStorage keys
2. **Data Flow**: Rookie predictor → Storage → Auction predictor
3. **Automatic Detection**: Auction tool checks for rookie rankings on load
4. **Recalculation**: Auction prices update when rookie data changes

### With MFL Data

1. **Draft Picks**: Read from `assets.json` (same as auction tool)
2. **Team Info**: Read from `config.json` (same as auction tool)
3. **Slotted Salaries**: Use same rules table as auction tool

## Success Metrics

### Prediction Accuracy
- Top 12 picks within 3 positions: 75%+ target
- Correct position in Round 1: 85%+ target
- Team need match: 70%+ target

### Strategy System
- User testing different strategies: 80%+ users adjust slider
- Team-specific overrides used: 40%+ users customize at least one team
- Strategy reasoning helpful: 90%+ users understand why each pick was made
- Simulation re-runs: Users test avg 3-5 different strategy configurations

### Integration Impact
- Auction price variance reduction: 10%+ improvement
- Cap calculation accuracy: 100% (no errors)
- Demand modeling improvement: 15%+ better scarcity predictions
- Strategy-aware predictions: Different strategies yield 15-25% different results

## Testing Strategy Scenarios

### Scenario 1: Pure BPA (100% Rankings)
**Setup**: All teams use 100% rankings priority  
**Expected Outcome**: 
- Draft follows consensus rankings almost exactly
- Top 12 picks = top 12 ranked rookies
- Some teams draft same position multiple times
- Teams with critical needs may still have gaps

### Scenario 2: Pure Need (0% Rankings)
**Setup**: All teams use 0% rankings priority  
**Expected Outcome**:
- Positional runs start earlier (e.g., 5 QBs in Round 1)
- Lower-ranked players drafted early to fill needs
- Teams with fewer needs may reach for marginal upgrades
- More variation from consensus rankings

### Scenario 3: Balanced (70% Rankings, Global)
**Setup**: All teams use 70% rankings priority  
**Expected Outcome**:
- Draft mostly follows rankings with occasional need picks
- Tier breaks trigger need-based decisions
- Top 15 picks within ±5 ranks of consensus
- Natural positional balance emerges

### Scenario 4: Team-Specific Strategies
**Setup**: 
- Contenders (4 teams): 40% rankings (need-focused)
- Rebuilders (4 teams): 95% rankings (BPA-focused)
- Neutral (8 teams): 70% rankings (balanced)

**Expected Outcome**:
- Contenders reach for starters in Rounds 2-3
- Rebuilders accumulate top talent regardless of position
- Most variance in middle rounds (2-3)
- Different teams end up with different position distributions

## Future Enhancements

- Mock draft simulator (drag-and-drop manual overrides)
- Trade calculator (pick value charts)
- Historical rookie performance correlation
- ADP (Average Draft Position) tracking from real drafts
- Custom draft order input (account for trades)
- What-if scenarios (team trades picks mid-draft)
- Integration with NFL Draft results (auto-update when rookies are drafted)
- Strategy templates library ("Contender", "Rebuilding", "BPA Purist")
- Comparative simulation (run multiple strategies side-by-side)
- Export strategy report (explain each team's approach)
