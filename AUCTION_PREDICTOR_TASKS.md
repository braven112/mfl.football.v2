# Auction Price Predictor - Implementation Tasks

## Task Organization

- **Phase 1**: Core Utilities (remaining)
- **Phase 2**: Main Page Structure
- **Phase 3**: Core Components
- **Phase 4**: Advanced Features
- **Phase 5**: Polish & Testing

---

## Phase 1: Core Utilities (Remaining)

### Task 1.1: Championship Window Detector
**File**: `src/utils/championship-window-detector.ts`  
**Estimate**: 2 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create `detectChampionshipWindow()` function
- [ ] Implement scoring algorithm:
  - [ ] Factor: Roster strength (composite ranks of top 12 starters)
  - [ ] Factor: Draft capital (count of 1st/2nd round picks)
  - [ ] Factor: Cap flexibility (available cap space)
  - [ ] Factor: Age curve (average age of key players)
  - [ ] Factor: Recent performance (2025 standings if available)
- [ ] Set thresholds:
  - [ ] Contending: Score ≥ 70
  - [ ] Rebuilding: Score ≤ 40
  - [ ] Neutral: 41-69
- [ ] Generate reasoning array (e.g., "Top-5 QB & RB", "Poor draft capital")
- [ ] Add TypeScript types
- [ ] Unit tests (edge cases: all contenders, all rebuilders)

**Dependencies**: None  
**Output**: `ChampionshipWindowAnalysis` object per team

---

### Task 1.2: Draft Pick Cap Impact Calculator
**File**: `src/utils/draft-pick-cap-impact.ts`  
**Estimate**: 3 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create rookie salary lookup tables:
  ```typescript
  const ROOKIE_SALARIES = {
    QB: { round1: 850000, round2: 650000, round3: 450000, ... },
    RB: { round1: 750000, round2: 550000, round3: 350000, ... },
    // ... other positions
  }
  ```
- [ ] Implement `predictDraftPickPosition()`:
  - [ ] Analyze team's current roster by position
  - [ ] Identify greatest positional needs
  - [ ] Match pick to likely position (e.g., early pick + no QB = QB)
- [ ] Implement `calculateDraftPickSalary()`:
  - [ ] Take pick round, overall number, position
  - [ ] Return slotted salary from lookup table
- [ ] Implement `calculateTotalDraftImpact()`:
  - [ ] Sum all picks for a team
  - [ ] Return total cap commitment
- [ ] Handle edge cases:
  - [ ] Team with no picks (return $0)
  - [ ] Team with 10+ picks (cap at roster spots)
- [ ] Add TypeScript interfaces
- [ ] Unit tests (verify salary tables, position prediction logic)

**Dependencies**: None  
**Output**: Rookie salary estimates per draft pick

---

### Task 1.3: Multi-Contract Pricer
**File**: `src/utils/multi-contract-pricer.ts`  
**Estimate**: 2 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create `generateContractOptions()` function
- [ ] For each length (1-5 years):
  - [ ] Calculate year-by-year salaries with 10% escalation
  - [ ] Calculate total contract value
  - [ ] Calculate average annual value (AAV)
- [ ] Implement recommendation logic:
  - [ ] Young player (age < 26) + value buy = 4-5 years
  - [ ] Old player (age ≥ 30) = 1-2 years max
  - [ ] Overpriced player = shorter contract
  - [ ] Fair price = 3 years (safe default)
- [ ] Generate explanation strings (e.g., "Lock in value on rising star")
- [ ] Return sorted array (1yr → 5yr)
- [ ] Add TypeScript interfaces
- [ ] Unit tests (verify escalations, recommendations)

**Dependencies**: None  
**Output**: Array of contract options with recommendations

---

### Task 1.4: Market Analyzer
**File**: `src/utils/market-analyzer.ts`  
**Estimate**: 3 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create `analyzeMarket()` function
- [ ] Calculate league-wide totals:
  - [ ] Total available cap space
  - [ ] Total available players
  - [ ] Average price per player
- [ ] Positional market analysis:
  - [ ] Count available players by position
  - [ ] Calculate top player price by position
  - [ ] Calculate average price by position
  - [ ] Count teams needing each position (demand)
  - [ ] Calculate scarcity index (demand / supply)
  - [ ] Determine inflation factor (scarcity → price multiplier)
- [ ] Identify value opportunities:
  - [ ] Find players where estimated price < fair value by ≥20%
  - [ ] Generate reason (e.g., "Undervalued due to injury history")
- [ ] Identify overvalued players:
  - [ ] Find players where estimated price > fair value by ≥20%
  - [ ] Generate reason (e.g., "Name recognition premium")
- [ ] Add TypeScript interfaces
- [ ] Unit tests (scarcity calculations, opportunity detection)

**Dependencies**: Task 1.1, 1.2 (needs championship windows, draft picks)  
**Output**: `MarketAnalysis` object

---

## Phase 2: Main Page Structure

### Task 2.1: Create Main Page File
**File**: `src/pages/theleague/auction-predictor.astro`  
**Estimate**: 3 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create file with Astro frontmatter
- [ ] Import all data sources:
  - [ ] `data/theleague/mfl-feeds/2025/rosters.json`
  - [ ] `data/theleague/mfl-player-salaries-2025.json`
  - [ ] `data/theleague/mfl-salary-averages-2025.json`
  - [ ] `data/theleague/mfl-feeds/2025/assets.json` (draft picks)
  - [ ] `data/theleague/config.json` (teams)
- [ ] Import utility functions:
  - [ ] `calculateTeamCapSpace()`
  - [ ] `predictFranchiseTags()`
  - [ ] `predictAllAuctionPrices()`
  - [ ] `analyzeMarket()`
  - [ ] `detectChampionshipWindow()`
- [ ] Perform server-side calculations:
  - [ ] Parse rosters, identify expiring contracts
  - [ ] Calculate cap space for all teams
  - [ ] Predict franchise tags (baseline)
  - [ ] Get available free agents (not tagged)
  - [ ] Calculate auction prices
  - [ ] Analyze market
- [ ] Serialize data for client:
  - [ ] Convert to JSON
  - [ ] Embed in `<script>` tag as `window.__INITIAL_DATA__`
- [ ] Set up page layout:
  - [ ] Use existing `Layout.astro` wrapper
  - [ ] Add page title, meta tags
  - [ ] Include league header/nav

**Dependencies**: All Phase 1 tasks  
**Output**: Basic page structure with data loaded

---

### Task 2.2: Client-Side State Management
**File**: `src/pages/theleague/auction-predictor.astro` (inline script)  
**Estimate**: 4 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create state object:
  ```javascript
  const state = {
    players: [...],
    teams: [...],
    franchiseTags: [...],
    market: {...},
    preferences: {
      dynastyWeight: 0.6,
      view: 'players',
      positionFilter: 'all',
      sortBy: 'rank',
    },
    overrides: {
      franchiseTags: new Map(),  // franchiseId → playerId
      championshipWindows: new Map(),
    },
  }
  ```
- [ ] Implement state update functions:
  - [ ] `updateDynastyWeight(weight)`
  - [ ] `updateFranchiseTagOverride(franchiseId, playerId)`
  - [ ] `updateChampionshipWindow(franchiseId, window)`
  - [ ] `recalculateCompositeRanks()`
  - [ ] `recalculatePrices()`
  - [ ] `recalculateMarket()`
- [ ] Implement localStorage persistence:
  - [ ] Save preferences on change
  - [ ] Load preferences on page load
  - [ ] Clear function (reset to defaults)
- [ ] Implement event bus for component communication:
  ```javascript
  const events = {
    on(event, callback) { ... },
    emit(event, data) { ... },
  }
  ```
- [ ] Add error handling for invalid states
- [ ] Add performance monitoring (console.time)

**Dependencies**: Task 2.1  
**Output**: Reactive state management system

---

### Task 2.3: Base HTML Structure
**File**: `src/pages/theleague/auction-predictor.astro` (template section)  
**Estimate**: 2 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create page header:
  - [ ] Title: "2026 Auction Predictor"
  - [ ] Subtitle with date/league name
  - [ ] "Import Rankings" button (opens modal)
- [ ] Create control panel section:
  - [ ] Dynasty/Redraft slider
  - [ ] View selector (tabs: Players, Tags, Teams, Market)
  - [ ] Position filter dropdown
  - [ ] Sort dropdown
  - [ ] Search input
- [ ] Create view containers:
  - [ ] `<div id="players-view">` (default visible)
  - [ ] `<div id="tags-view">` (hidden)
  - [ ] `<div id="teams-view">` (hidden)
  - [ ] `<div id="market-view">` (hidden)
- [ ] Add footer with last updated timestamp
- [ ] Apply CSS classes (Tailwind)
- [ ] Add loading spinner (hidden by default)

**Dependencies**: Task 2.1  
**Output**: Page skeleton with navigation

---

## Phase 3: Core Components

### Task 3.1: Auction Player Table Component
**File**: `src/components/theleague/AuctionPlayerTable.astro`  
**Estimate**: 5 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create Astro component file
- [ ] Accept props:
  - [ ] `players: PlayerValuation[]`
  - [ ] `sortBy: string`
  - [ ] `positionFilter: string`
- [ ] Render table structure:
  - [ ] Headers: Rank, Name, Pos, Team, Age, 1yr, 2yr, 3yr, 4yr, 5yr, Status
  - [ ] Sortable headers (click to sort)
  - [ ] Sticky header on scroll
- [ ] Render player rows:
  - [ ] Avatar/headshot (from MFL if available)
  - [ ] Name with team badge
  - [ ] Position badge (colored by position)
  - [ ] Age with icon (🔥 if young, ⏳ if old)
  - [ ] Contract prices (5 columns)
  - [ ] Recommended contract highlighted (⭐)
  - [ ] Tag status badge (🏷️ if likely tagged)
- [ ] Add responsive design:
  - [ ] Desktop: Full table
  - [ ] Tablet: Hide 4yr/5yr columns
  - [ ] Mobile: Card layout (stack vertically)
- [ ] Add sorting functionality:
  - [ ] Click header to sort
  - [ ] Toggle asc/desc
  - [ ] Persist sort in state
- [ ] Add filtering:
  - [ ] Filter by position
  - [ ] Filter by status (available, tagged)
  - [ ] Filter by search query
- [ ] Add pagination (50 per page)
- [ ] Add empty state (no players match filters)
- [ ] Add loading state
- [ ] Style with Tailwind + custom CSS

**Dependencies**: Task 2.3  
**Output**: Functional player list/table

---

### Task 3.2: Price Range Display Component
**File**: `src/components/theleague/PriceRangeDisplay.astro`  
**Estimate**: 2 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create Astro component
- [ ] Accept props:
  - [ ] `prices: { year1, year2, year3, year4, year5 }`
  - [ ] `recommendedLength: number`
  - [ ] `playerAge: number`
- [ ] Render price cells:
  - [ ] Format as currency ($8.5M)
  - [ ] Show escalation percentage vs base (e.g., +10%, +21%)
  - [ ] Highlight recommended (green background, ⭐ icon)
  - [ ] Dim not recommended (gray text)
- [ ] Add tooltips on hover:
  - [ ] Show full contract breakdown
  - [ ] Show total value over contract
  - [ ] Show recommendation reason
- [ ] Add mobile optimization:
  - [ ] Vertical stack on small screens
  - [ ] Collapsible detail view
- [ ] Style with color coding:
  - [ ] Green = recommended
  - [ ] Gray = neutral
  - [ ] Red = not recommended (age mismatch)

**Dependencies**: Task 3.1  
**Output**: Reusable price display component

---

### Task 3.3: Franchise Tag Panel Component
**File**: `src/components/theleague/FranchiseTagPanel.astro`  
**Estimate**: 4 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create Astro component
- [ ] Accept props:
  - [ ] `predictions: FranchiseTagPrediction[]`
  - [ ] `onOverride: (franchiseId, playerId) => void`
- [ ] Render team cards (4 columns × 4 rows):
  - [ ] Team logo
  - [ ] Team name
  - [ ] Predicted tag player (name, position, salary)
  - [ ] Confidence indicator (0-100%)
  - [ ] "Override" toggle button
- [ ] Override UI:
  - [ ] Click "Override" → opens dropdown
  - [ ] Dropdown shows top 5 candidates
  - [ ] Select different player or "No Tag"
  - [ ] Highlight override (purple border)
  - [ ] Show original prediction (strikethrough)
- [ ] Candidate list (collapsible):
  - [ ] Show top 3-5 candidates
  - [ ] Show score (0-100)
  - [ ] Show reasons (bullets)
- [ ] Add responsive design:
  - [ ] Desktop: 4 columns
  - [ ] Tablet: 2 columns
  - [ ] Mobile: 1 column
- [ ] Add animations:
  - [ ] Fade in on override
  - [ ] Highlight flash on change
- [ ] Style with league colors

**Dependencies**: Task 2.3  
**Output**: Franchise tag management UI

---

### Task 3.4: Team Cap Analysis Component
**File**: `src/components/theleague/TeamCapAnalysis.astro`  
**Estimate**: 4 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create Astro component
- [ ] Accept props:
  - [ ] `teams: TeamCapSituation[]`
  - [ ] `sortBy: string` (cap space, window, etc.)
- [ ] Render team cards (4 columns × 4 rows):
  - [ ] Team logo & name
  - [ ] Cap space (large number, colored by amount)
  - [ ] Committed salaries breakdown:
    - [ ] Active roster
    - [ ] Taxi squad
    - [ ] Dead money
    - [ ] Draft picks
  - [ ] Championship window badge (🏆 contending, 🔨 rebuilding, ⚖️ neutral)
  - [ ] Positional needs list (top 3)
  - [ ] Spots to fill count
- [ ] Add expandable details:
  - [ ] Click card → show full breakdown
  - [ ] Show all expiring contracts
  - [ ] Show all draft picks
  - [ ] Show positional depth chart
- [ ] Add championship window override:
  - [ ] Click badge → dropdown
  - [ ] Select: Contending, Neutral, Rebuilding
  - [ ] Highlight override (purple border)
  - [ ] Recalculate prices on change
- [ ] Add responsive design:
  - [ ] Desktop: 4 columns
  - [ ] Tablet: 2 columns
  - [ ] Mobile: 1 column (list view)
- [ ] Add sorting:
  - [ ] By cap space (high/low)
  - [ ] By championship window
  - [ ] By spots to fill
  - [ ] Alphabetically
- [ ] Style with conditional colors:
  - [ ] Green = high cap space
  - [ ] Red = low cap space
  - [ ] Gold = contending
  - [ ] Gray = rebuilding

**Dependencies**: Task 2.3  
**Output**: Team financial overview UI

---

### Task 3.5: Market Analysis Card Component
**File**: `src/components/theleague/MarketAnalysisCard.astro`  
**Estimate**: 3 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create Astro component
- [ ] Accept props:
  - [ ] `analysis: MarketAnalysis`
- [ ] Render league totals section:
  - [ ] Total available cap (big number)
  - [ ] Total available players
  - [ ] Average price per player
  - [ ] Supply/demand ratio
- [ ] Render positional breakdown table:
  - [ ] Columns: Position, Supply, Demand, Scarcity, Avg Price, Inflation
  - [ ] Sort by scarcity (descending)
  - [ ] Highlight scarce positions (scarcity > 1.5)
  - [ ] Color-code inflation factor
- [ ] Render value opportunities list:
  - [ ] Show top 10 undervalued players
  - [ ] Show expected price vs fair value
  - [ ] Show discount percentage (e.g., -25%)
  - [ ] Show reason
  - [ ] Link to player row
- [ ] Render overvalued players list:
  - [ ] Show top 10 overpriced players
  - [ ] Show expected price vs fair value
  - [ ] Show premium percentage (e.g., +30%)
  - [ ] Show reason
  - [ ] Warn against overpaying
- [ ] Add responsive design:
  - [ ] Desktop: 2-column layout
  - [ ] Mobile: Stacked sections
- [ ] Style with data visualization:
  - [ ] Use bar charts for inflation
  - [ ] Use sparklines for trends (if historical data)
  - [ ] Use color gradients for scarcity

**Dependencies**: Task 2.3, Task 1.4  
**Output**: Market insights dashboard

---

### Task 3.6: Rankings Importer Component
**File**: `src/components/theleague/RankingsImporter.astro`  
**Estimate**: 4 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create Astro component
- [ ] Create modal/drawer UI:
  - [ ] "Import Rankings" button triggers open
  - [ ] Overlay with close button
  - [ ] Centered modal (desktop) or bottom sheet (mobile)
- [ ] Create import form:
  - [ ] Dynasty rankings textarea
  - [ ] Redraft rankings textarea
  - [ ] Format instructions (collapsible)
  - [ ] Example preview
  - [ ] "Parse & Match" button
- [ ] Implement parsing logic (client-side):
  - [ ] Call `parseRankingsText()` from rankings-parser.ts
  - [ ] Call `matchRankingsToPlayers()`
  - [ ] Show progress indicator
- [ ] Display results:
  - [ ] Success message (e.g., "247 / 250 matched")
  - [ ] List unmatched players
  - [ ] Manual matching UI (dropdown to select MFL player)
- [ ] Implement save functionality:
  - [ ] Update state with new ranks
  - [ ] Recalculate composite ranks
  - [ ] Recalculate prices
  - [ ] Close modal
  - [ ] Show success toast
- [ ] Add validation:
  - [ ] Warn if < 90% match rate
  - [ ] Validate format (check for tier markers)
  - [ ] Handle empty input
- [ ] Add error handling:
  - [ ] Parse errors (invalid format)
  - [ ] Network errors (if loading from URL in future)
- [ ] Add sample data button:
  - [ ] Pre-fill with example rankings
  - [ ] For testing/demo purposes
- [ ] Style as modal with Tailwind

**Dependencies**: Task 2.2 (state management)  
**Output**: Rankings import workflow

---

### Task 3.7: Control Panel Component
**File**: `src/components/theleague/ControlPanel.astro`  
**Estimate**: 3 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create Astro component
- [ ] Dynasty/Redraft slider:
  - [ ] Range input (0-100)
  - [ ] Labels: "Dynasty" (left) and "Redraft" (right)
  - [ ] Value display (e.g., "60% Dynasty / 40% Redraft")
  - [ ] Debounced onChange (200ms)
  - [ ] Save to state & localStorage
- [ ] View selector (tabs):
  - [ ] Tabs: Players, Tags, Teams, Market
  - [ ] Highlight active tab
  - [ ] onClick switches view
  - [ ] Update URL hash (e.g., #players)
- [ ] Position filter dropdown:
  - [ ] Options: All, QB, RB, WR, TE, PK, DEF
  - [ ] Show count per position
  - [ ] Update table on change
- [ ] Sort dropdown:
  - [ ] Options: Rank, Name, Position, Age, Price (1yr)
  - [ ] Ascending/Descending toggle
  - [ ] Update table on change
- [ ] Search input:
  - [ ] Debounced search (300ms)
  - [ ] Search by player name, team, position
  - [ ] Show result count
  - [ ] Clear button
- [ ] Add responsive design:
  - [ ] Desktop: Horizontal layout
  - [ ] Mobile: Vertical stack, collapsible sections
- [ ] Style with Tailwind + custom slider styles

**Dependencies**: Task 2.2  
**Output**: Central control hub

---

## Phase 4: Advanced Features

### Task 4.1: URL State Synchronization
**File**: `src/pages/theleague/auction-predictor.astro` (client script)  
**Estimate**: 2 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Implement hash-based routing:
  - [ ] `#players` → show players view
  - [ ] `#tags` → show tags view
  - [ ] `#teams` → show teams view
  - [ ] `#market` → show market view
- [ ] Implement query params:
  - [ ] `?dynasty=60` → set dynasty weight
  - [ ] `?pos=RB` → filter by position
  - [ ] `?sort=age` → sort by age
- [ ] Listen to URL changes (popstate event)
- [ ] Update state when URL changes
- [ ] Update URL when state changes (without reload)
- [ ] Generate shareable links (copy button)
- [ ] Handle invalid URLs gracefully

**Dependencies**: Task 3.7  
**Output**: Shareable, bookmarkable URLs

---

### Task 4.2: Export to CSV
**File**: `src/utils/csv-exporter.ts`  
**Estimate**: 2 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create `exportPlayersToCSV()` function
- [ ] Generate CSV with columns:
  - [ ] Rank, Name, Position, Team, Age, Dynasty Rank, Redraft Rank
  - [ ] 1yr Price, 2yr Price, 3yr Price, 4yr Price, 5yr Price
  - [ ] Recommended Length, Tag Status, Scarcity Score
- [ ] Create `exportTeamsToCSV()` function
- [ ] Generate CSV with columns:
  - [ ] Team, Cap Space, Committed, Dead Money, Draft Picks
  - [ ] Spots to Fill, Championship Window, Positional Needs
- [ ] Trigger download on button click
- [ ] Handle special characters (commas, quotes)
- [ ] Add filename with timestamp

**Dependencies**: Task 3.1, 3.4  
**Output**: Downloadable CSV files

---

### Task 4.3: Print-Friendly View
**File**: `src/pages/theleague/auction-predictor.astro` (CSS)  
**Estimate**: 1 hour  
**Status**: Not Started

**Subtasks**:
- [ ] Add `@media print` styles
- [ ] Hide navigation, controls, buttons
- [ ] Show all rows (remove pagination)
- [ ] Adjust font sizes for readability
- [ ] Force black & white (optional)
- [ ] Add page breaks between sections
- [ ] Add header with league name & date
- [ ] Add footer with page numbers

**Dependencies**: Task 3.1  
**Output**: Printer-optimized layout

---

### Task 4.4: Historical Data Integration (Future)
**File**: `src/utils/historical-data-loader.ts`  
**Estimate**: 4 hours  
**Status**: Not Started (blocked on data availability)

**Subtasks**:
- [ ] Research historical auction data sources
- [ ] Create data schema for past auctions
- [ ] Implement data loader
- [ ] Integrate into price predictor (weighted average)
- [ ] Add trend charts to player cards
- [ ] Add historical accuracy metrics

**Dependencies**: None (independent feature)  
**Output**: Historical context for predictions

---

### Task 4.5: Vegas Odds Integration (Future)
**File**: `src/utils/vegas-odds-fetcher.ts`  
**Estimate**: 6 hours  
**Status**: Not Started (blocked on API research)

**Subtasks**:
- [ ] Research free Vegas odds APIs
- [ ] Evaluate: The Odds API, ESPN API, others
- [ ] Implement API client
- [ ] Fetch data:
  - [ ] Team win totals
  - [ ] MVP odds
  - [ ] Player props (TDs, yards, etc.)
- [ ] Map to MFL players
- [ ] Integrate into price predictor (bonus for high MVP odds)
- [ ] Display odds in player cards
- [ ] Cache data (avoid rate limits)

**Dependencies**: None (independent feature)  
**Output**: Vegas-informed price adjustments

---

## Phase 5: Polish & Testing

### Task 5.1: Unit Tests
**Files**: `tests/auction-predictor/*.test.ts`  
**Estimate**: 6 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Test `franchise-tag-predictor.ts`:
  - [ ] Verify scoring algorithm
  - [ ] Test edge cases (no candidates, all weak)
  - [ ] Test overrides
- [ ] Test `cap-space-calculator.ts`:
  - [ ] Verify escalation math
  - [ ] Test taxi squad multiplier
  - [ ] Test draft pick impact
- [ ] Test `auction-price-predictor.ts`:
  - [ ] Verify price calculations
  - [ ] Test scarcity adjustments
  - [ ] Test age discounts
- [ ] Test `rankings-parser.ts`:
  - [ ] Test FootballGuys format
  - [ ] Test FantasyPros format
  - [ ] Test fuzzy matching
  - [ ] Test tier parsing
- [ ] Test `multi-contract-pricer.ts`:
  - [ ] Verify escalations
  - [ ] Test recommendations
- [ ] Test `market-analyzer.ts`:
  - [ ] Verify scarcity calculations
  - [ ] Test value detection
- [ ] Run tests: `pnpm test`
- [ ] Achieve ≥80% coverage

**Dependencies**: All Phase 1 tasks  
**Output**: Test suite with good coverage

---

### Task 5.2: Integration Tests
**Files**: `tests/auction-predictor/integration.test.ts`  
**Estimate**: 4 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Test full page load:
  - [ ] Verify data loads
  - [ ] Verify calculations run
  - [ ] Verify DOM renders
- [ ] Test franchise tag override:
  - [ ] Override tag
  - [ ] Verify cap space updates
  - [ ] Verify prices recalculate
- [ ] Test rankings import:
  - [ ] Paste rankings
  - [ ] Verify parsing
  - [ ] Verify prices update
- [ ] Test dynasty/redraft slider:
  - [ ] Move slider
  - [ ] Verify ranks update
  - [ ] Verify prices update
- [ ] Test view switching:
  - [ ] Switch to Tags view
  - [ ] Switch to Teams view
  - [ ] Switch to Market view
- [ ] Use Playwright or Vitest

**Dependencies**: All Phase 2-3 tasks  
**Output**: End-to-end test coverage

---

### Task 5.3: Mobile Responsiveness Testing
**Estimate**: 3 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Test on physical devices:
  - [ ] iPhone (375px, 414px)
  - [ ] Android (360px, 412px)
  - [ ] iPad (768px, 1024px)
- [ ] Test in browser DevTools:
  - [ ] Chrome responsive mode
  - [ ] Safari responsive mode
- [ ] Verify layouts:
  - [ ] Player table → cards
  - [ ] Team grid → list
  - [ ] Control panel → stacked
- [ ] Test interactions:
  - [ ] Touch slider
  - [ ] Tap to override tags
  - [ ] Scroll performance
- [ ] Fix issues:
  - [ ] Text too small
  - [ ] Buttons too small
  - [ ] Overlapping elements
  - [ ] Horizontal scroll

**Dependencies**: All Phase 3 tasks  
**Output**: Fully responsive UI

---

### Task 5.4: Performance Optimization
**Estimate**: 3 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Measure initial load time (Lighthouse)
- [ ] Optimize JavaScript bundle:
  - [ ] Code splitting
  - [ ] Lazy load components
  - [ ] Remove unused code
- [ ] Optimize CSS:
  - [ ] Purge unused Tailwind classes
  - [ ] Minify CSS
- [ ] Optimize data loading:
  - [ ] Compress JSON files (gzip)
  - [ ] Lazy load non-critical data
- [ ] Optimize recalculations:
  - [ ] Memoize expensive functions
  - [ ] Debounce slider updates
  - [ ] Use requestAnimationFrame for animations
- [ ] Measure recalculation time:
  - [ ] Should be < 100ms for slider change
  - [ ] Should be < 500ms for full recalc
- [ ] Target metrics:
  - [ ] Initial load < 2s
  - [ ] Time to Interactive < 3s
  - [ ] Recalculation < 100ms

**Dependencies**: All Phase 2-3 tasks  
**Output**: Fast, performant app

---

### Task 5.5: Accessibility Audit
**Estimate**: 2 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Run Lighthouse accessibility audit
- [ ] Test with screen reader (VoiceOver on macOS)
- [ ] Verify keyboard navigation:
  - [ ] Tab through controls
  - [ ] Enter to activate buttons
  - [ ] Arrow keys for sliders
- [ ] Check color contrast (WCAG AA):
  - [ ] Text vs background
  - [ ] Interactive elements
- [ ] Add ARIA labels:
  - [ ] Slider: `aria-label="Dynasty vs Redraft weight"`
  - [ ] Buttons: `aria-label="Override franchise tag"`
  - [ ] Dynamic content: `aria-live="polite"`
- [ ] Add focus indicators:
  - [ ] Visible focus rings
  - [ ] Skip to content link
- [ ] Fix issues found
- [ ] Achieve Lighthouse score ≥90

**Dependencies**: All Phase 3 tasks  
**Output**: Accessible UI (WCAG AA)

---

### Task 5.6: User Acceptance Testing
**Estimate**: 2 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Recruit 2-3 league members for testing
- [ ] Provide test scenarios:
  - [ ] "Find the best value RB"
  - [ ] "Override team X's franchise tag"
  - [ ] "Import your own rankings"
  - [ ] "Check your team's cap space"
- [ ] Observe testing session (screen share)
- [ ] Collect feedback:
  - [ ] What was confusing?
  - [ ] What was missing?
  - [ ] What worked well?
- [ ] Document issues
- [ ] Prioritize fixes
- [ ] Implement critical fixes
- [ ] Re-test

**Dependencies**: All Phase 3 tasks  
**Output**: User-validated app

---

### Task 5.7: Documentation & Help Text
**Files**: `src/components/theleague/HelpModal.astro`  
**Estimate**: 2 hours  
**Status**: Not Started

**Subtasks**:
- [ ] Create help modal component
- [ ] Add "?" button in header
- [ ] Write help sections:
  - [ ] How to use the tool
  - [ ] How to import rankings
  - [ ] How to override franchise tags
  - [ ] How to interpret prices
  - [ ] How contract lengths work
  - [ ] What is championship window
  - [ ] FAQ
- [ ] Add tooltips throughout UI:
  - [ ] Dynasty/Redraft slider explanation
  - [ ] Franchise tag score explanation
  - [ ] Scarcity index explanation
  - [ ] Recommended contract reasoning
- [ ] Add inline help text (collapsible)
- [ ] Style help modal

**Dependencies**: Task 2.3  
**Output**: User documentation

---

## Task Summary

### Total Estimates by Phase

| Phase | Tasks | Estimated Hours |
|-------|-------|-----------------|
| Phase 1: Core Utilities | 4 | 10 hours |
| Phase 2: Main Page | 3 | 9 hours |
| Phase 3: Core Components | 7 | 25 hours |
| Phase 4: Advanced Features | 5 | 15 hours (3 blocked) |
| Phase 5: Polish & Testing | 7 | 22 hours |
| **TOTAL** | **26** | **81 hours** |

### Critical Path

1. Phase 1 → Phase 2 → Phase 3 (required for MVP)
2. Phase 5 (testing & polish)
3. Phase 4 (nice-to-haves)

### MVP Scope (40 hours)

**Must-Have**:
- ✅ Core utilities (Phase 1): 10 hours
- ✅ Main page structure (Phase 2): 9 hours
- ✅ Player table + prices (Task 3.1, 3.2): 7 hours
- ✅ Franchise tag panel (Task 3.3): 4 hours
- ✅ Team cap analysis (Task 3.4): 4 hours
- ✅ Control panel (Task 3.7): 3 hours
- ✅ Basic testing (Task 5.1, 5.3): 9 hours

**Total**: 46 hours

**Defer to v2**:
- Market analysis component (Task 3.5)
- Rankings importer (Task 3.6)
- Advanced features (Phase 4)
- Full test coverage (remaining Phase 5)

---

## Risk Mitigation

### High-Risk Items

1. **Performance with 300+ players**
   - Mitigation: Pagination, virtualization, debouncing
   - Test early with full dataset

2. **Rankings parsing accuracy**
   - Mitigation: Manual matching UI, validation
   - Test with multiple formats

3. **Mobile layout complexity**
   - Mitigation: Test early on devices
   - Use progressive enhancement

4. **State management bugs**
   - Mitigation: Unit tests, integration tests
   - Careful state updates

---

## Next Steps

1. **Start with Phase 1**: Complete remaining utilities
2. **Build Phase 2**: Set up page structure and data loading
3. **Iterate on Phase 3**: Build components one at a time
4. **Test continuously**: Run tests after each task
5. **Deploy MVP**: Get feedback, iterate

---

**Document Version**: 1.0  
**Last Updated**: January 1, 2026  
**Total Tasks**: 26  
**Estimated Effort**: 81 hours (MVP: 46 hours)
