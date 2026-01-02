# Auction Price Predictor - Design Document

## Table of Contents
1. [System Architecture](#system-architecture)
2. [Data Model](#data-model)
3. [Component Structure](#component-structure)
4. [Algorithm Design](#algorithm-design)
5. [User Interface Design](#user-interface-design)
6. [Data Flow](#data-flow)
7. [Technical Decisions](#technical-decisions)

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Client-Side)                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │         /theleague/auction-predictor.astro             │ │
│  │                  (Main Page)                            │ │
│  └────────────────────────────────────────────────────────┘ │
│                          │                                   │
│                          │ loads                             │
│                          ▼                                   │
│  ┌─────────────────┬──────────────────┬──────────────────┐ │
│  │  Data Loaders   │  Core Engines    │   UI Components  │ │
│  │                 │                  │                  │ │
│  │  • MFL Feeds    │  • Tag Predictor │  • Player Table  │ │
│  │  • Salary Avg   │  • Cap Calculator│  • Tag Controls  │ │
│  │  • Draft Picks  │  • Price Engine  │  • Team Analysis │ │
│  │  • Rankings     │  • Market Analyzer  • Sliders      │ │
│  └─────────────────┴──────────────────┴──────────────────┘ │
│                          │                                   │
│                          │ stores                            │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │             Client-Side State Management               │ │
│  │  • Franchise Tag Overrides  • Rankings Cache           │ │
│  │  • Slider Preferences       • Scenario Comparisons     │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
└───────────────────────────────────────────────────────────────┘
                             │
                             │ fetches at build time
                             ▼
┌───────────────────────────────────────────────────────────────┐
│                       Data Sources                            │
├───────────────────────────────────────────────────────────────┤
│  • data/theleague/mfl-feeds/2025/rosters.json                │
│  • data/theleague/mfl-salary-averages-2025.json             │
│  • data/theleague/mfl-feeds/2025/assets.json (draft picks)   │
│  • data/theleague/config.json (teams)                        │
│  • User Input: Rankings (paste)                              │
└───────────────────────────────────────────────────────────────┘
```

### Component Layers

1. **Data Layer**: Static JSON files loaded at build time
2. **Business Logic Layer**: Calculation utilities (TypeScript)
3. **State Management Layer**: Client-side reactive state
4. **Presentation Layer**: Astro components + vanilla JS

---

## Data Model

### Core Entities

#### PlayerValuation
```typescript
interface PlayerValuation {
  // Identity
  id: string;                    // MFL player ID
  name: string;
  position: 'QB' | 'RB' | 'WR' | 'TE' | 'PK' | 'DEF';
  nflTeam: string;
  
  // Current Contract
  currentSalary: number;
  contractYearsRemaining: number;
  franchiseId: string | null;    // Owning team (null if FA)
  
  // Rankings
  dynastyRank?: number;
  redraftRank?: number;
  compositeRank?: number;
  
  // Rankings by Source (independent storage)
  rankings: {
    footballguys?: number;       // FootballGuys rank
    dlf?: number;                // Dynasty League Football rank
    fantasypros?: number;        // FantasyPros rank (future)
    composite?: number;          // Weighted average of available sources
  };
  
  // Player Attributes
  age: number;
  experience: number;
  
  // Franchise Tag
  isExpiring: boolean;
  isFranchiseTagCandidate: boolean;
  franchiseTagProbability: number;  // 0-1
  franchiseTagSalary?: number;
  
  // Auction Predictions
  estimatedPrices: {              // By contract length
    year1: number;
    year2: number;
    year3: number;
    year4: number;
    year5: number;
  };
  recommendedContractLength: number;
  priceConfidenceRange: {
    low: number;
    high: number;
  };
  
  // Market Context
  positionalScarcity: number;     // 0-1
  demandScore: number;            // How many teams need position
}
```

#### TeamCapSituation
```typescript
interface TeamCapSituation {
  franchiseId: string;
  teamName: string;
  
  // 2026 Cap Projection
  projectedCapSpace: number;
  committedSalaries: number;
  deadMoney: number;
  
  // Contracts
  playersUnderContract: number;
  expiringContracts: PlayerValuation[];
  
  // Draft Impact
  draftPicks: Array<{
    round: number;
    pick: number;
    position?: string;           // Predicted
    estimatedSalary: number;     // Slotted
  }>;
  draftPickCommitment: number;
  
  // Available Space
  reserveForInSeasonFA: number;  // 10% buffer
  discretionarySpending: number;
  
  // Roster Needs
  spotsToFill: number;
  positionalNeeds: Array<{
    position: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    currentDepth: number;
    targetAcquisitions: number;
  }>;
  
  // Championship Window
  championshipWindow: 'contending' | 'neutral' | 'rebuilding';
  windowReasoning: string[];
  windowOverride?: boolean;      // User manually set
}
```

#### FranchiseTagPrediction
```typescript
interface FranchiseTagPrediction {
  franchiseId: string;
  teamName: string;
  
  // Prediction
  willTag: boolean;
  taggedPlayer: PlayerValuation | null;
  
  // Candidates (top 5)
  candidates: Array<{
    player: PlayerValuation;
    score: number;               // 0-100 likelihood
    reasons: string[];
  }>;
  
  // Override
  isManualOverride: boolean;
  originalPrediction?: PlayerValuation;
}
```

#### MarketAnalysis
```typescript
interface MarketAnalysis {
  // League-Wide
  totalAvailableCap: number;
  totalAvailablePlayers: number;
  averagePricePerPlayer: number;
  
  // By Position
  positionalMarkets: {
    [position: string]: {
      availablePlayers: number;
      topPlayerPrice: number;
      averagePrice: number;
      demandCount: number;       // Teams needing
      scarcityIndex: number;     // demand / supply
      inflationFactor: number;   // 1.0 = normal, 1.5 = 50% inflation
    };
  };
  
  // Opportunities
  valueOpportunities: Array<{
    player: PlayerValuation;
    expectedPrice: number;
    fairValue: number;
    discountPercent: number;
    reason: string;
  }>;
  
  overvaluedPlayers: Array<{
    player: PlayerValuation;
    expectedPrice: number;
    fairValue: number;
    premiumPercent: number;
    reason: string;
  }>;
}
```

---

## Component Structure

### File Organization

```
src/
├── pages/
│   └── theleague/
│       └── auction-predictor.astro          ← Main page
│
├── components/
│   └── theleague/
│       ├── AuctionPlayerTable.astro         ← Player list/grid
│       ├── FranchiseTagPanel.astro          ← Tag predictions UI
│       ├── TeamCapAnalysis.astro            ← Team breakdowns
│       ├── MarketAnalysisCard.astro         ← Market insights
│       ├── RankingsImporter.astro           ← Paste rankings UI
│       ├── PriceRangeDisplay.astro          ← Multi-contract prices
│       └── ControlPanel.astro               ← Sliders/filters
│
├── utils/
│   ├── salary-calculations.ts               ✅ Shared salary logic
│   ├── franchise-tag-predictor.ts           ✅ Tag algorithm
│   ├── cap-space-calculator.ts              ✅ Cap calculations
│   ├── auction-price-predictor.ts           ✅ Price engine
│   ├── rankings-parser.ts                   ✅ Parse rankings
│   ├── championship-window-detector.ts      ← Auto-detect window
│   ├── draft-pick-cap-impact.ts             ← Rookie salary impact
│   ├── multi-contract-pricer.ts             ← 1-5 year pricing
│   └── market-analyzer.ts                   ← Scarcity/opportunities
│
└── types/
    └── auction-predictor.ts                 ✅ TypeScript interfaces
```

### Component Hierarchy

```
auction-predictor.astro
├── <ControlPanel>
│   ├── Dynasty/Redraft Slider
│   ├── View Selector (Players/Tags/Teams/Market)
│   ├── Position Filter
│   └── Sort Options
│
├── <RankingsImporter> (collapsible)
│   ├── Rankings Status Overview (visual indicator)
│   │   ├── DLF Status Badge (loaded/not loaded + stats)
│   │   └── FootballGuys Status Badge (loaded/not loaded + stats)
│   ├── DLF Rankings Section
│   │   ├── Import Textarea (CSV format)
│   │   ├── Import Button
│   │   ├── Clear Button
│   │   └── Match Results Display
│   ├── FootballGuys Rankings Section
│   │   ├── Import Textarea (TSV format)
│   │   ├── Import Button
│   │   ├── Clear Button
│   │   └── Match Results Display
│   └── Future: Additional Source Sections (extensible)
│
├── [View: Available Players]
│   └── <AuctionPlayerTable>
│       ├── Player Row (repeated)
│       │   ├── Name, Position, Team, Age
│       │   ├── Composite Rank
│       │   ├── <PriceRangeDisplay>
│       │   │   ├── 1yr price
│       │   │   ├── 2yr price
│       │   │   ├── 3yr price (recommended)
│       │   │   ├── 4yr price
│       │   │   └── 5yr price
│       │   └── Tag Status
│
├── [View: Franchise Tags]
│   └── <FranchiseTagPanel>
│       ├── Team Card (×16)
│       │   ├── Team Name & Logo
│       │   ├── Predicted Tag (or "No Tag")
│       │   ├── Override Toggle
│       │   └── Candidate List (top 3)
│
├── [View: Team Analysis]
│   └── <TeamCapAnalysis>
│       ├── Team Card (×16)
│       │   ├── Cap Space
│       │   ├── Committed Salaries
│       │   ├── Draft Picks Impact
│       │   ├── Spots to Fill
│       │   ├── Championship Window Badge
│       │   └── Positional Needs List
│
└── [View: Market Analysis]
    └── <MarketAnalysisCard>
        ├── League Totals
        ├── Position Breakdown Table
        ├── Value Opportunities List
        └── Overvalued Players List
```

---

## Algorithm Design

### 1. Franchise Tag Predictor

**Input**: 
- Expiring players per team
- Salary averages
- Team cap situations
- Player rankings (if available)

**Algorithm**:
```
FOR each team:
  candidates = filter(team.players, contractYear == 1)
  
  FOR each candidate:
    score = 0
    
    // Factor 1: Player Value (40%)
    IF player.compositeRank <= 20:
      score += 40
    ELSE IF player.compositeRank <= 50:
      score += 30
    ELSE:
      score += 20 * (100 - compositeRank) / 100
    
    // Factor 2: Salary vs Tag Cost (20%)
    tagSalary = calculateFranchiseTag(player)
    IF player.currentSalary < tagSalary * 0.7:
      score += 20  // Underpaid, worth tagging
    ELSE IF player.currentSalary > tagSalary * 1.2:
      score -= 10  // Overpaid, avoid tag
    
    // Factor 3: Position Scarcity (15%)
    score += positionalScarcity[player.position] * 15
    
    // Factor 4: Age (10%)
    IF player.age <= 26:
      score += 10
    ELSE IF player.age >= 30:
      score -= 5
    
    // Factor 5: Team Cap (15%)
    IF team.capSpace > 20M:
      score += 15  // Can afford
    ELSE IF team.capSpace < 5M:
      score -= 10  // Tight on cap
  
  // Select top scorer
  topCandidate = candidates.maxBy(score)
  IF topCandidate.score >= 50:
    team.taggedPlayer = topCandidate
  ELSE:
    team.taggedPlayer = null
```

**Output**: FranchiseTagPrediction per team

### 2. Cap Space Calculator

**Input**:
- 2025 roster data
- Salary adjustments (dead money)
- Draft pick predictions

**Algorithm**:
```
FOR each team:
  committedSalaries = 0
  
  FOR each player WHERE contractYear > 1:
    yearsRemaining = contractYear - 1
    
    // Apply 10% escalation for 2026
    salary2026 = player.salary * 1.10
    
    // Apply status multiplier
    IF player.status == 'TAXI_SQUAD':
      capHit = salary2026 * 0.50
    ELSE:
      capHit = salary2026 * 1.00
    
    committedSalaries += capHit
  
  // Add dead money
  deadMoney = sum(salaryAdjustments[team])
  
  // Subtract draft pick commitments
  draftCommitment = 0
  FOR each draftPick:
    position = predictPosition(pick, team.needs)
    salary = getRookieSalary(position, pick.round, pick.overall)
    draftCommitment += salary
  
  // Calculate available
  total = committedSalaries + deadMoney + draftCommitment
  capSpace = $45M - total
  
  // Reserve buffer
  reserve = capSpace * 0.10
  discretionary = capSpace - reserve
```

**Output**: TeamCapSituation per team

### 3. Auction Price Engine

**Input**:
- Available players (not tagged)
- Player rankings
- Team cap situations
- Market factors (dynasty weight, etc.)

**Algorithm**:
```
// Step 1: Calculate total market
totalCap = sum(teams.discretionarySpending)
totalPlayers = count(availablePlayers)
avgPrice = totalCap / totalPlayers

// Step 2: For each player
FOR each player:
  // Base value from rank
  IF player.compositeRank:
    IF rank <= 10:
      multiplier = 10 - (rank - 1) * 0.6
    ELSE IF rank <= 30:
      multiplier = 4.6 - ((rank - 10) / 20) * 2.6
    ELSE IF rank <= 100:
      multiplier = 2 - ((rank - 30) / 70) * 1
    ELSE:
      multiplier = 1 - ((rank - 100) / 100) * 0.5
    
    basePrice = avgPrice * multiplier
  ELSE:
    basePrice = LEAGUE_MINIMUM
  
  // Adjust for age
  ageDiscount = getAgeDiscount(player.age)
  price = basePrice * (1 - ageDiscount)
  
  // Adjust for scarcity
  scarcity = calculatePositionalScarcity(player.position)
  price = price * scarcity.multiplier
  
  // Adjust for market inflation
  price = price * (1 + INFLATION_FACTOR)
  
  // Adjust for historical data
  IF historicalData exists:
    historicalAvg = avg(player.historicalPrices)
    price = price * 0.7 + historicalAvg * 0.3
  
  player.estimatedPrice = round(price, 50000)  // Round to $50k
```

**Output**: PlayerValuation with prices

### 4. Multi-Contract Pricing

**Input**:
- Base auction price
- Player age
- Price vs value comparison

**Algorithm**:
```
FOR length = 1 to 5:
  // Calculate year-by-year with escalation
  yearSalaries = []
  totalValue = 0
  
  FOR year = 0 to length-1:
    yearSalary = basePrice * (1.10 ^ year)
    yearSalaries.push(yearSalary)
    totalValue += yearSalary
  
  avgAnnual = totalValue / length
  
  // Recommend based on age and value
  IF age < 26 AND length >= 4:
    recommendation = 'Highly Recommended'
  ELSE IF age >= 30 AND length >= 4:
    recommendation = 'Not Recommended'
  ELSE IF actualPrice < estimatedValue * 0.8 AND length >= 4:
    recommendation = 'Good Value - Go Long'
  ELSE IF actualPrice > estimatedValue * 1.2 AND length <= 2:
    recommendation = 'Overpay - Go Short'
  ELSE IF length == 3:
    recommendation = 'Safe Middle Ground'
  
  prices[length] = {
    baseYear: basePrice,
    totalValue,
    avgAnnual,
    recommendation
  }
```

**Output**: Price structure for 1-5 years

---

## User Interface Design

### Layout (Desktop)

```
┌─────────────────────────────────────────────────────────────┐
│  🏈 Auction Predictor 2026                     [Import Rankings] │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Dynasty ●────────○────── Redraft  │  [Players ▼]   │  │
│  │      60%         40%                 │                │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  📊 Market Overview                                   │  │
│  │  • 247 players available  • $420M total cap          │  │
│  │  • Avg price: $1.7M      • Scarce: RB, TE           │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  [All Pos ▼] [Sort: Rank ▼]          🔍 Search       │  │
│  ├──────┬────────┬─────┬──────┬─────────────────────────┤  │
│  │ Rank │ Player │ Pos │ Team │ Contract Length Prices  │  │
│  ├──────┼────────┼─────┼──────┼─────────────────────────┤  │
│  │  1   │ Bowers │ TE  │  24  │ 1yr 2yr 3yr 4yr 5yr    │  │
│  │      │   LV   │     │      │ 8.5 9.8 11M 12M 13M    │  │
│  │      │   92%  │     │      │  ←  Recommended  →     │  │
│  ├──────┼────────┼─────┼──────┼─────────────────────────┤  │
│  │  2   │ Allen  │ QB  │  29  │ 1yr 2yr 3yr 4yr 5yr    │  │
│  │      │   BUF  │     │      │ 12M 14M 15M 17M 18M    │  │
│  │      │   95%  │     │      │      ←  Rec  →         │  │
│  └──────┴────────┴─────┴──────┴─────────────────────────┘  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Layout (Mobile)

```
┌──────────────────────┐
│ 🏈 Auction 2026      │
├──────────────────────┤
│ Dyn ●───○ Red (60%)  │
├──────────────────────┤
│ [View: Players ▼]    │
├──────────────────────┤
│ 📊 Market            │
│ 247 players          │
│ $420M cap            │
├──────────────────────┤
│ [Filter] [Sort]      │
├──────────────────────┤
│ ┌──────────────────┐ │
│ │ #1 Brock Bowers  │ │
│ │ TE • LV • Age 24 │ │
│ │ ────────────────  │ │
│ │ 1yr    $8.5M     │ │
│ │ 2yr    $9.8M     │ │
│ │ 3yr ⭐ $11.0M     │ │
│ │ 4yr    $12.3M    │ │
│ │ 5yr    $13.5M    │ │
│ └──────────────────┘ │
│                      │
│ ┌──────────────────┐ │
│ │ #2 Josh Allen    │ │
│ │ QB • BUF • Age 29│ │
│ │ ...              │ │
└──────────────────────┘
```

### Color Scheme

```css
/* League Colors */
--primary: #1c497c;      /* League blue */
--secondary: #3c9950;    /* League green */

/* Status Colors */
--tag-predicted: #f59e0b;    /* Amber - likely tagged */
--tag-override: #8b5cf6;     /* Purple - manual override */
--available: #10b981;         /* Green - available FA */
--unavailable: #ef4444;       /* Red - tagged/unavailable */

/* Value Indicators */
--undervalued: #059669;      /* Dark green - good value */
--fair-value: #6b7280;       /* Gray - fair price */
--overvalued: #dc2626;       /* Dark red - overpay */

/* Contract Lengths */
--contract-1yr: #fee2e2;     /* Light red */
--contract-3yr: #d1fae5;     /* Light green (recommended) */
--contract-5yr: #dbeafe;     /* Light blue */
```

---

## Data Flow

### Initial Page Load

```
1. User visits /theleague/auction-predictor
   ↓
2. Astro loads data at build time:
   - MFL rosters (2025)
   - Salary averages
   - Draft picks
   - Team config
   ↓
3. Server-side processing:
   - Identify expiring contracts
   - Calculate cap spaces
   - Predict franchise tags (baseline)
   - Calculate baseline prices
   ↓
4. Render HTML with:
   - Player table (server-rendered)
   - Control panel (hydrated)
   - Initial state
   ↓
5. Client-side hydration:
   - Attach event listeners
   - Initialize sliders
   - Load saved preferences from localStorage
```

### User Interaction: Franchise Tag Override

```
1. User clicks "Override" on team's tag prediction
   ↓
2. Toggle player as tagged/untagged
   ↓
3. Update client state:
   - franchiseTagOverrides.set(franchiseId, playerId)
   ↓
4. Recalculate affected data:
   - Remove/add player to available pool
   - Recalculate team's cap space
   - Recalculate market totals
   - Recalculate all prices
   ↓
5. Re-render affected components:
   - Update player table
   - Update team cap display
   - Update market analysis
   - Highlight changes (fade-in animation)
   ↓
6. Save state to localStorage:
   - Persist overrides for session
```

### User Interaction: Dynasty/Redraft Slider

```
1. User drags slider
   ↓
2. Throttle updates (every 200ms)
   ↓
3. Calculate new composite ranks:
   FOR each player:
     compositeRank = (dynastyRank * weight) + (redraftRank * (1-weight))
   ↓
4. Recalculate prices (based on new ranks)
   ↓
5. Re-render table (sorted by new ranks)
   ↓
6. Save preference to localStorage
```

### User Interaction: Import Rankings

```
1. User pastes rankings text into source-specific textarea
   (DLF CSV format OR FootballGuys TSV format)
   ↓
2. Click "Import [Source] Rankings" button
   ↓
3. Auto-detect format:
   - Check for commas (CSV) vs tabs (TSV)
   - Parse column structure
   - Extract rank, name, position, team (if available)
   - Handle tier markers and special rows
   ↓
4. Match to MFL players:
   - Use allMFLPlayers array (~3000+ players)
   - Normalize names (lowercase, remove punctuation, Jr/Sr, hyphens)
   - Fuzzy match using similarity algorithm (0.65 threshold)
   - Team-agnostic matching (2026 projections vs 2025 actuals)
   - Match by position to reduce false positives
   ↓
5. Display results:
   - Show match rate (e.g., "608 / 621 matched - 97.9%")
   - List first 10 matched players with confidence scores
   - List first 10 unmatched players with details
   - Update section status badge
   ↓
6. Store rankings independently:
   - Save to localStorage: auctionPredictor.{source}Rankings
   - Update state.rankings.{source}
   - Include metadata: source, importDate, match stats
   - Update status overview display
   - DO NOT overwrite other ranking sources
   ↓
7. Recalculate composite ranks:
   - Average available sources (footballguys, dlf, etc.)
   - Update player valuations
   - Emit 'rankingsImported' event
   ↓
8. Future: Additional sources follow same pattern
   - Each source gets own section, storage key, state field
   - Composite calculation includes all available sources
```

**Independent Storage Architecture**:
- Each ranking source stored separately
- localStorage keys: `auctionPredictor.{sourceName}Rankings`
- State fields: `state.rankings.footballguys`, `state.rankings.dlf`
- API functions: `getPlayerRank(playerId, 'source')`, `getCompositeRank(playerId)`
- Extensible for future sources without code changes to core logic
```

---

## Technical Decisions

### Framework: Astro

**Rationale**:
- Already used in project
- Static site generation for fast load
- Component-based architecture
- Easy integration with existing code
- Client-side interactivity via vanilla JS

**Trade-offs**:
- No backend (all calculations client-side)
- Larger initial bundle (includes all data)
- No server-side caching

### State Management: Vanilla JavaScript

**Rationale**:
- Avoid adding React/Vue dependency
- Simple state object with event listeners
- LocalStorage for persistence
- Adequate for this use case

**Trade-offs**:
- Manual DOM updates
- More verbose than React
- Harder to test

### Data Loading: Build-time

**Rationale**:
- Static data (doesn't change frequently)
- Fast initial load (no API calls)
- Works offline
- Cacheable

**Trade-offs**:
- Requires rebuild to update data
- Large HTML size
- Can't pull real-time MFL data

### Styling: CSS + Tailwind

**Rationale**:
- Consistent with existing site
- Rapid prototyping
- Responsive utilities
- Custom properties for theming

**Trade-offs**:
- Larger CSS bundle
- Class name verbosity

### Calculations: TypeScript

**Rationale**:
- Type safety for complex calculations
- Better IDE support
- Catch errors at compile time
- Self-documenting code

**Trade-offs**:
- Compilation step required
- Learning curve for maintenance

---

## Performance Optimizations

### Initial Load
- Lazy load components below fold
- Compress JSON data
- Use CSS containment
- Defer non-critical JS

### Recalculations
- Debounce slider updates (200ms)
- Memoize expensive calculations
- Use requestAnimationFrame for animations
- Update only changed DOM nodes

### Mobile
- Reduce initial data payload
- Use mobile-specific layouts
- Touch-optimized controls
- Minimize reflows

---

## Extensibility: Adding New Ranking Sources

The rankings system is designed to be extensible for future sources without core logic changes.

### To Add a New Ranking Source:

**1. Add State Interface Field**
```typescript
// In AuctionState interface
rankings: {
  footballguys: RankingData | null;
  dlf: RankingData | null;
  newSource: RankingData | null;  // ← Add here
}
```

**2. Add localStorage Key**
```typescript
// In createInitialState()
newSource: loadRankings('auctionPredictor.newSourceRankings'),
```

**3. Add UI Section**
```html
<!-- In auction-predictor.astro -->
<div class="import-section">
  <h3>New Source Name</h3>
  <textarea id="newSource-rankings-input"></textarea>
  <button id="import-newSource-btn">Import</button>
</div>
```

**4. Add Status Overview Item**
```html
<div class="loaded-ranking-item">
  <div class="ranking-icon">📈</div>
  <div class="ranking-name">New Source</div>
  <div id="newSource-loaded-status">...</div>
</div>
```

**5. Wire Event Handler**
```javascript
document.getElementById('import-newSource-btn')?.addEventListener('click', () => {
  handleRankingsImport('newSource');
});
```

**6. Update Composite Calculation**
```javascript
// In getCompositeRank()
const newSourceRank = getPlayerRank(playerId, 'newSource');
if (newSourceRank) ranks.push(newSourceRank);
```

**No changes needed to:**
- Fuzzy matching logic (reused)
- Storage mechanism (same pattern)
- Display components (data-driven)
- API functions (generic by design)

### Example Future Sources:
- **FantasyPros**: API integration (requires subscription)
- **ESPN**: Expert consensus rankings
- **The Athletic**: Subscriber rankings
- **Custom**: User's own rankings
- **Dynasty Nerds**: Dynasty-specific rankings
- **4for4**: Analytics-based rankings

---

## Security Considerations

**Not applicable** - Tool is client-side only, personal use, no authentication, no data transmission.

---

## Accessibility

- Semantic HTML (tables for data)
- ARIA labels on interactive elements
- Keyboard navigation support
- High contrast ratios (WCAG AA)
- Screen reader announcements for dynamic updates

---

## Browser Support

**Target**: Modern browsers (last 2 versions)
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

**Not supported**: IE11

---

## Testing Strategy

### Unit Tests
- Salary calculations
- Franchise tag predictor
- Price engine
- Rankings parser

### Integration Tests
- Full page load
- Franchise tag override flow
- Rankings import flow
- Slider interaction

### Manual Testing
- Mobile responsiveness (375px, 768px, 1024px)
- Performance (300+ players)
- Edge cases (no rankings, all teams tag same position)

---

## Deployment

1. Build static site: `pnpm run build`
2. Deploy to Vercel (automatic on push to main)
3. Access at: `https://mflfootballv2.vercel.app/theleague/auction-predictor`
4. No authentication required (unlisted URL)

---

## Future Enhancements

1. **Vegas Odds Integration**: When free API found
2. **Historical Trend Charts**: Multi-year price analysis
3. **Auction Simulator**: Run mock auctions with AI opponents
4. **Export to CSV**: Download analysis for offline use
5. **Mobile App**: Native iOS/Android app
6. **Real-time Collaboration**: Share scenarios with friends

---

**Document Version**: 1.0  
**Last Updated**: January 1, 2026  
**Status**: ✅ Ready for Implementation
