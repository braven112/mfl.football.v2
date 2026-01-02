# Auction Price Predictor - Requirements Document

## Executive Summary

Build a comprehensive auction price prediction tool to analyze the 2026 free agent market and provide data-driven insights for winning the league's free agency auction. The tool will predict franchise tag decisions, calculate available cap space, estimate player auction prices across multiple contract lengths, and identify value opportunities.

## Business Objectives

### Primary Goal
Provide accurate auction price predictions for all available free agents to maximize value and build the optimal roster within cap constraints.

### Success Criteria
- Predict auction prices within ±20% accuracy for top 50 players
- Successfully identify 5+ undervalued players (market inefficiencies)
- Provide actionable recommendations for roster strategy
- Complete analysis before free agency period begins (March 15-21)

## User Stories

### US-1: View All Available Free Agents
**As a** league owner  
**I want to** see all players whose contracts expire in 2026  
**So that** I can plan which positions I need to target in the auction

**Acceptance Criteria:**
- Display all players with 1-year contracts remaining (expiring)
- Show player name, position, current team, current salary, age
- Filter by position
- Sort by various metrics (rank, salary, age)
- Show franchise tag eligibility

### US-2: Predict Franchise Tag Decisions
**As a** league owner  
**I want to** see predicted franchise tag decisions for all teams  
**So that** I know which elite players will NOT be available

**Acceptance Criteria:**
- Algorithm predicts one franchise tag per team (or none)
- Shows top 3-5 tag candidates per team with reasoning
- Displays predicted franchise tag salary for each candidate
- Updates available player pool based on predictions

### US-3: Override Franchise Tag Predictions
**As a** league owner  
**I want to** manually override franchise tag predictions  
**So that** I can test different scenarios and see market impact

**Acceptance Criteria:**
- Click to select/deselect any expiring player as franchise tagged
- Real-time recalculation of all auction prices when changed
- Show visual diff of what changed (players added/removed from market)
- Can reset to baseline prediction
- Can save multiple scenarios

### US-4: Import Player Rankings
**As a** league owner  
**I want to** paste rankings from multiple expert sources  
**So that** the tool uses expert consensus for accurate player valuations

**Acceptance Criteria:**
- Support multiple independent ranking sources (DLF, FootballGuys, FantasyPros, etc.)
- Each source stored independently in state and localStorage
- Auto-detect format (CSV, TSV, JSON)
- Fuzzy matching with 85%+ match rate target
- Show match statistics per source (total, matched, unmatched, match rate)
- Display unmatched players for review
- Visual status indicator showing which sources are loaded
- Ability to clear/reload individual sources without affecting others
- Support for adding new ranking sources in the future
- Store rankings with metadata (source, import date, match statistics)

### US-4A: Import Rookie Rankings
**As a** league owner  
**I want to** paste rookie-specific rankings from multiple expert sources  
**So that** I can predict rookie draft order and anticipate team roster construction

**Acceptance Criteria:**
- Support same independent ranking sources as veteran players (DLF, FootballGuys)
- Store rookie rankings separately from veteran rankings
- localStorage keys: `auctionPredictor.{source}RookieRankings`
- Same fuzzy matching and match statistics as veteran rankings
- Use rookie rankings for two purposes:
  1. **Rookie Draft Predictor Tool** (standalone page):
     - Predict consensus rookie draft order
     - Show by-team draft selections
     - Display projected rookie salaries by draft slot
  2. **Auction Predictor Integration**:
     - Calculate team draft pick cap commitments
     - Predict positional needs filled by draft
     - Adjust team available cap for auction
     - Reduce team demand for positions addressed in draft
- Composite rookie rank = weighted average of available sources
- Visual indicator showing which rookie ranking sources loaded
- Example use case: If consensus #1 pick is RB, team with 1.01 reduces RB demand in auction

**Integration with Auction Tool:**
```
FOR each team:
  FOR each draft pick:
    predicted_position = matchPickToNeed(team, rookieRankings)
    rookie_salary = slottedSalary[round][pick][position]
    
    // Reduce available auction cap
    team.availableCap -= rookie_salary
    
    // Reduce positional demand
    team.positionNeeds[predicted_position] -= 1
    
    // Adjust market scarcity
    positionalMarkets[predicted_position].demand -= 1
```

### US-5: View Auction Prices by Contract Length
**As a** league owner  
**I want to** see projected prices for 1, 2, 3, 4, and 5-year contracts  
**So that** I can adjust my bidding strategy based on price points

**Acceptance Criteria:**
- Display price ranges for all contract lengths
- Show recommended contract length based on age and value
- Calculate using 10% annual escalation
- Visual indicator for "good value" contract lengths
- Real-time updates when factors change

### US-6: Adjust Dynasty vs Redraft Weighting
**As a** league owner  
**I want to** adjust the dynasty/redraft ranking weight via slider  
**So that** I can match my championship window and roster needs

**Acceptance Criteria:**
- Slider from 100% dynasty to 100% redraft
- Default: 60% dynasty / 40% redraft
- Real-time price updates as slider moves
- Save preference per session
- Clear visual feedback of current weighting

### US-7: View Market Analysis
**As a** league owner  
**I want to** see positional scarcity and market trends  
**So that** I can identify where prices will be inflated or deflated

**Acceptance Criteria:**
- Show supply/demand by position
- Identify scarce positions (high demand, low supply)
- Show total available cap space across league
- Display average prices by position
- Highlight inflation/deflation trends

### US-8: Identify Value Opportunities
**As a** league owner  
**I want to** see undervalued and overvalued players  
**So that** I can target bargains and avoid overpaying

**Acceptance Criteria:**
- List top 10 undervalued players (ranked higher than price suggests)
- List top 10 overvalued players (price exceeds ranking value)
- Show expected discount/premium percentage
- Provide reasoning for each opportunity
- Update in real-time with scenario changes

### US-9: View Team Cap Situations
**As a** league owner  
**I want to** see each team's available cap space and needs  
**So that** I can predict bidding competition

**Acceptance Criteria:**
- Display 2026 projected cap space for all 16 teams
- Show committed salaries with 10% escalation applied
- Display dead money obligations
- Show roster spots to fill
- Highlight positional needs per team
- Identify teams with most/least cap flexibility

### US-10: Championship Window Detection
**As a** league owner  
**I want to** see which teams are contending vs rebuilding  
**So that** I can predict their auction behavior

**Acceptance Criteria:**
- Auto-detect championship window (contending/neutral/rebuilding)
- Based on: roster age, cap space, draft capital, recent record
- Manual override for each team
- Show reasoning for classification
- Affects roster strategy recommendations

### US-11: Mobile Responsive Design
**As a** league owner  
**I want to** use the tool on my phone during the auction  
**So that** I can reference prices while bidding

**Acceptance Criteria:**
- Fully functional on mobile (375px width minimum)
- Key data visible without horizontal scroll
- Touch-friendly controls (sliders, toggles)
- Fast load time (<3 seconds)
- Accessible on tablet and desktop

## Functional Requirements

### FR-1: Data Sources
- **MFL Player Data**: Use 2025 season rosters with contractYear = 1 for expiring players
- **Salary Averages**: Use existing mfl-salary-averages-2025.json for franchise tag calculations
- **Draft Pick Data**: Use draft-predictor logic to determine team draft picks
- **Rookie Salaries**: Use slotted salary table from rules (by position and pick)
- **Historical Auctions**: Load past transaction data from MFL API if available
- **External Rankings - Veterans**: User-provided via copy/paste with independent storage
  - **Dynasty League Football (DLF)**: CSV format dynasty rankings
  - **FootballGuys**: TSV format consensus rankings
  - **FantasyPros**: Future support (requires API subscription)
  - **Custom Sources**: Extensible architecture for additional sources
  - Each source stored independently with metadata (source name, import date, match stats)
  - Composite ranking calculated as weighted average of available sources
  - localStorage keys: `auctionPredictor.{sourceName}Rankings`
- **External Rankings - Rookies**: User-provided via copy/paste with independent storage
  - **Dynasty League Football (DLF) Rookies**: CSV format rookie dynasty rankings
  - **FootballGuys Rookies**: TSV format rookie consensus rankings
  - Same architecture as veteran rankings (independent storage, fuzzy matching)
  - localStorage keys: `auctionPredictor.{sourceName}RookieRankings`
  - **Dual Purpose**:
    1. **Standalone Rookie Draft Predictor Tool**: Predict consensus draft order
    2. **Auction Tool Integration**: Calculate draft pick cap impact and reduce positional demand
  - Composite rookie rank used to predict team draft selections by position
  - Example: Team with 1.01 pick + #1 ranked RB → Reduces team RB demand in auction
- **Vegas Odds**: Future integration (team wins, player props, MVP odds)

### FR-2: Calculations

#### Franchise Tag Salary
```
Franchise Tag = MAX(
  current_salary × 1.20,
  avg_top_3_at_position
)
Contract: 1 year
```

#### Available Cap Space (2026)
```
Step 1: For each player with contractYear > 1
  2026_salary = current_salary × 1.10 (10% escalation)
  
Step 2: Sum by status
  active_salaries = sum(ROSTER players at 100%)
  injured_salaries = sum(IR players at 100%)
  practice_salaries = sum(TAXI players at 50%)
  
Step 3: Add dead money
  dead_money = sum(salary adjustments)
  
Step 4: Calculate available
  cap_space = $45M - (active + injured + practice + dead_money)
```

#### Draft Pick Cap Impact
```
For each team's draft picks:
  // Step 1: Predict position based on rookie rankings consensus
  IF rookie_rankings_available:
    top_available_rookie = findTopRankedRookie(
      composite_rookie_rank,
      team.positionalNeeds,
      already_drafted_rookies
    )
    predicted_position = top_available_rookie.position
  ELSE:
    // Fallback: Use team needs priority
    predicted_position = team.positionNeeds[0].position
  
  // Step 2: Apply slotted salary from rules table
  rookie_salary = slottedSalary[round][pick][predicted_position]
  
  // Step 3: Reduce available cap by rookie commitments
  team.availableCap -= rookie_salary
  
  // Step 4: Reduce positional demand for market analysis
  team.positionNeeds[predicted_position].targetAcquisitions -= 1
  positionalMarkets[predicted_position].demand -= 1

Example Scenario:
  Team: BRA (1.01 pick)
  Composite Rookie Rankings: #1 Ashton Jeanty (RB)
  
  Prediction:
    - BRA will draft Jeanty at 1.01
    - Rookie salary: $2.5M (Round 1, Pick 1, RB)
    - BRA available cap: $15M → $12.5M
    - BRA RB need: High → Satisfied
    - Market RB demand: 8 teams → 7 teams
    - Result: BRA unlikely to pursue expensive RB in auction
```

#### Rookie Rankings Integration
```
Purpose 1: Standalone Rookie Draft Predictor Tool
  - Display consensus rookie draft order
  - Show predicted selections by team
  - Calculate total rookie draft cap impact
  - Provide exportable draft board

Purpose 2: Auction Predictor Integration
  
  Step 1: Calculate Composite Rookie Ranks
    FOR each rookie:
      composite_rank = weighted_average(
        dlf_rookie_rank,
        footballguys_rookie_rank,
        ...other_sources
      )
  
  Step 2: Simulate Draft Order
    drafted_rookies = []
    FOR each pick in draft_order:
      team = pick.team
      
      // Filter available rookies
      available = rookies.filter(r => 
        !drafted_rookies.includes(r) &&
        r.position IN team.positionNeeds
      )
      
      // Select highest ranked available
      selection = available.sort_by(composite_rank)[0]
      
      drafted_rookies.push(selection)
      
      // Apply cap impact
      team.availableCap -= slottedSalary[pick.round][pick.number][selection.position]
      
      // Reduce positional demand
      team.positionNeeds[selection.position].satisfied = true
      positionalMarkets[selection.position].demand -= 1
  
  Step 3: Recalculate Auction Market
    // Market scarcity adjusted for rookies filling needs
    // Team budgets adjusted for rookie salaries
    // Positional demand reduced where rookies drafted
    
Example Impact:
  Before Rookie Integration:
    - 8 teams need RB
    - Market RB scarcity: High (1.6x multiplier)
    - Top RB auction price: $8M
  
  After Rookie Integration (3 RBs drafted in top 10):
    - 5 teams need RB
    - Market RB scarcity: Medium (1.2x multiplier)
    - Top RB auction price: $6M (25% decrease)
```

#### Reserve for In-Season FA
```
Reserve = cap_space × 0.10 (10% buffer)
Discretionary = cap_space - reserve
```

#### Auction Price Calculation
```
Base Algorithm:
1. Rank-based value = f(composite_rank, total_cap, total_players)
2. Apply position scarcity multiplier
3. Apply age discount curve
4. Apply contract length preference
5. Apply market inflation factor
6. Apply historical data (weighted)

Composite Rank = (dynasty_rank × dynasty_weight) + (redraft_rank × redraft_weight)

Price Factors (in priority order):
1. Composite Rank (40%)
2. Position Scarcity (20%)
3. Available Cap Space (15%)
4. Team Needs (10%)
5. Age/Trajectory (10%)
6. Historical Prices (5%)
```

#### Multi-Contract Pricing
```
For years = 1 to 5:
  year_1_salary = base_price
  year_2_salary = year_1 × 1.10
  year_3_salary = year_2 × 1.10
  year_4_salary = year_3 × 1.10
  year_5_salary = year_4 × 1.10
  
  total_value = sum(all years)
  avg_annual = total_value / years
  
Recommendations:
  - Young players (age <26): favor 4-5 year contracts
  - Prime players (age 26-29): favor 2-3 year contracts
  - Veterans (age 30+): favor 1-2 year contracts
  - Bargains (price < value): longer contracts
  - Overpays (price > value): shorter contracts
```

### FR-3: User Interface Components

#### Main Views
1. **Dashboard** - Overview with key metrics
2. **Available Players** - Sortable/filterable table
3. **Franchise Tags** - Predictions with override controls
4. **Team Analysis** - Cap space and needs by team
5. **Market Analysis** - Scarcity and opportunities
6. **Rankings Import** - Paste and match interface

#### Interactive Controls
- Dynasty/Redraft slider (0-100%)
- Championship window selector per team
- Franchise tag toggles per player
- Position filters
- Sort options
- Contract length tabs/toggle

## Non-Functional Requirements

### NFR-1: Performance
- Initial load: <3 seconds
- Recalculation (franchise tag toggle): <500ms
- Slider adjustment: <200ms (smooth)
- Support 300+ player calculations simultaneously

### NFR-2: Accuracy
- Franchise tag predictions: Match actual >80% of time
- Price predictions: Within ±20% for top 50 players
- Cap space calculations: Match MFL exactly

### NFR-3: Usability
- No user documentation needed (intuitive)
- Mobile-friendly (responsive down to 375px)
- Clear visual feedback for all actions
- Keyboard accessible

### NFR-4: Reliability
- Client-side calculations (no server dependency for core features)
- Graceful handling of missing data
- Validation on all user inputs
- Error messages are actionable

### NFR-5: Maintainability
- Reuse existing salary calculation functions
- Share code with rosters page
- TypeScript for type safety
- Modular component structure
- Comprehensive inline documentation

## Constraints

### Technical Constraints
- Must work with existing Astro framework
- Must use existing MFL data structure
- Must integrate with existing salary calculation logic
- Client-side only (no backend database)

### Data Constraints
- 2026 MFL data not available until February 15
- Must work with 2025 data and project forward
- External rankings require manual import
- Vegas odds API may not be available (free tier limits)

### Business Constraints
- Tool is for personal use (not shared with league)
- No authentication required (unlisted page)
- Must complete before March 15 (auction start)

## Out of Scope (Future Enhancements)

### Phase 2 Features (Post-Auction Tool)
- **Rookie Draft Predictor Tool** (standalone page)
  - Full rookie draft board with predicted order
  - Team-by-team selections with reasoning
  - Mock draft simulator
  - Rookie rankings import (DLF, FootballGuys)
  - Export draft board to CSV
  - Note: Rookie rankings storage infrastructure completed in Phase 1

### Long-Term Enhancements
- Automated ranking imports via API
- Real-time Vegas odds integration
- Auction simulation / mock auction tool
- Historical trend analysis (multi-year)
- Trade value calculator
- Draft pick trade value calculator
- Mobile app (native)
- Browser extension
- Email/SMS alerts
- Multi-league support
- Collaborative features

## Assumptions

1. User has basic understanding of league rules
2. User will manually import rankings (no automation)
3. Historical auction data can be approximated if not available
4. Most teams will reserve 5-10% cap for in-season FA
5. Rookie draft pick positions can be predicted based on team needs
6. User will check tool multiple times as draft approaches
7. Franchise tag decisions finalized by March 7
8. Tool accuracy improves as user provides more data (rankings, overrides)

## Dependencies

### Internal Dependencies
- Existing roster page salary calculations
- Draft predictor logic for draft picks
- MFL salary averages data (2025)
- Team configuration (config.json)
- League rules (rules.html)

### External Dependencies
- MFL API (player data, transactions)
- User-provided rankings (FootballGuys, FantasyPros, DLF)
- Vegas odds API (future - optional)

## Success Metrics

### Quantitative
- Tool used 10+ times before auction
- 90%+ of predicted franchise tags accurate
- Win auction on 3+ value opportunities identified
- Spend within 95% of available cap space
- Acquire 20+ players to fill roster

### Qualitative
- Tool saves 5+ hours of manual analysis
- Confidence in bidding strategy increased
- Better understanding of market dynamics
- Improved roster construction
- Win championship 🏆

## Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Rankings data incomplete | High | Medium | Support multiple sources, allow manual entry |
| Franchise tag predictions wrong | Medium | Medium | Allow easy override, show multiple scenarios |
| Price predictions inaccurate | High | Low | Use conservative ranges, weight historical data |
| MFL data structure changes | Medium | Low | Add validation, graceful fallbacks |
| Tool too complex to use | Medium | Low | Iterative testing, simplify UI |
| Mobile performance poor | Medium | Medium | Optimize calculations, lazy loading |
| Auction behavior unpredictable | Low | High | Show ranges not point estimates, educate user |

## Timeline

- **Week 1**: Requirements, design, core utilities (✅ Complete)
- **Week 2**: Data loading, franchise tag predictor, cap calculator
- **Week 3**: Rankings parser, auction price algorithm, multi-contract pricing
- **Week 4**: UI development (desktop)
- **Week 5**: UI development (mobile), testing
- **Week 6**: Refinement, optimization, documentation
- **Target Completion**: February 28, 2026
- **Buffer**: 2 weeks before auction (March 15)

## Approval

**Document Author**: Claude (AI Assistant)  
**Document Owner**: Brandon Shields  
**Version**: 1.0  
**Last Updated**: January 1, 2026  
**Status**: ✅ Approved

---

**Next Steps**:
1. Review and approve requirements
2. Create design document
3. Break down into implementation tasks
4. Begin development
