# Auction Price Predictor - Requirements Document

## Executive Summary

Build a comprehensive auction price prediction tool to analyze the 2026 free agent market and provide data-driven insights for winning the league's free agency auction. The tool will predict franchise tag decisions, calculate available cap space, estimate player auction prices across multiple contract lengths, and identify value opportunities.

## Business Objectives

### Primary Goal
Provide accurate auction price predictions for all available free agents to maximize value and build the optimal roster within cap constraints.

### Core Principle: Never Overpay
**CRITICAL**: The fundamental strategy is to NEVER overpay for players, especially aging players on long contracts. Historical data must validate all contract recommendations to ensure we never offer a salary/length combination that has no precedent.

### Success Criteria
- Predict auction prices within ±20% accuracy for top 50 players
- Successfully identify 5+ undervalued players (market inefficiencies)
- Provide actionable recommendations for roster strategy
- Complete analysis before free agency period begins (March 15-21)
- **Never recommend contracts that exceed historical age/salary precedents**

## Age Philosophy

**When to Use Age:**
- ✅ **Contract Length Recommendations**: Age determines risk and appropriate contract length
- ✅ **Historical Validation**: Verify salary precedents for players at specific ages
- ✅ **Warning Systems**: Alert when contracts extend into decline phases

**When NOT to Use Age:**
- ❌ **Base Salary Calculation**: Dynasty rankings already factor in age/trajectory
- ❌ **Intrinsic Value**: Don't apply age multipliers to historical curve values
- ❌ **Player Ranking**: Rankings systems (DLF, FootballGuys) include age in methodology

**Rationale:**
Dynasty rankings already account for a player's age and career trajectory. A 27-year-old RB ranked #3 is ranked there BECAUSE rankers considered his age. If we then apply another age penalty to his intrinsic value, we double-count the age factor. 

However, age IS critical for contract length decisions. Historical data shows clear decline patterns:
- RBs decline sharply after age 28
- WRs/TEs decline after age 30  
- QBs maintain value until age 33

Therefore, age determines HOW LONG to sign players, not how much they're worth today.

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
- **Historical Salary Data (2020-2025)**: **CRITICAL - Used for intrinsic value calculations**
  - Source: `data/theleague/mfl-player-salaries-{year}.json` (years 2020-2025)
  - Scope: ALL player contracts, not just free agents
  - Includes: Active contracts, extensions, franchise tags, auction results
  - Purpose: Build exponential decay curves by position to establish "fair market value"
  - Analysis: 6-year averages eliminate year-to-year volatility
  - Position-specific decay coefficients derived from regression analysis
  - Example: QB rank 1 averaged $9.86M across 6 years, QB rank 5 averaged $4.76M
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

#### Auction Price Calculation - Dual Formula Approach

**CRITICAL REQUIREMENT**: The system must calculate TWO separate values for each player:

1. **Intrinsic Value (IV)**: What the player is objectively worth based on historical salary curves
2. **Predicted Market Price (PMP)**: What the player will actually cost in the auction

This enables identification of market inefficiencies (undervalued/overvalued players).

##### Formula 1: Intrinsic Value (Historical Curve-Based)

**Data Foundation:**
- Analyze ALL player salaries from 2020-2025 (not just free agents)
- Include active contracts, extensions, franchise tags, auction results
- Build position-specific exponential decay curves from historical data

**Calculation:**
```
Step 1: Calculate Position Rank
  // Rank player among ALL players at their position based on composite rank
  position_rank = rank_within_position(player, composite_rank)

Step 2: Apply Historical Exponential Decay Formula
  // Use 6-year historical average curves (2020-2025)
  intrinsic_value = top_salary × e^(-k × (position_rank - 1))
  
  Where:
    QB:  top_salary = $9.86M, k = 0.1492 (steep drop after elite tier)
    RB:  top_salary = $10.03M, k = 0.0971 (gradual decline)
    WR:  top_salary = $10.16M, k = 0.0931 (gradual decline)
    TE:  top_salary = $10.27M, k = 0.2059 (very steep, high scarcity)

Step 3: Apply Age Adjustment
  // **IMPORTANT**: Dynasty rankings already account for age/trajectory
  // DO NOT apply age multiplier to intrinsic value calculation
  // Age is ONLY used for contract length recommendations
  
  // Age adjustments removed from base salary calculation
  // intrinsic_value remains unadjusted by age
  
  intrinsic_value = historical_curve_value  // No age multiplier

Step 4: Contract Length Adjustment (Age-Based)
  // **CRITICAL**: Age determines contract length risk, not base value
  // Core Principle: NEVER overpay for aging players on long contracts
  
  // Historical decline ages by position (from 2020-2025 data analysis):
  Position | Prime Years | Decline Start | Steep Decline | Avoid Long Contracts
  ---------|-------------|---------------|---------------|--------------------
  QB       | 26-32       | 33            | 36+           | Age 33+
  RB       | 23-27       | 28            | 30+           | Age 28+  
  WR       | 24-29       | 30            | 32+           | Age 30+
  TE       | 25-29       | 30            | 32+           | Age 30+
  
  // Contract length discounts based on age risk
  // Steeper discounts = less total commitment to aging players
  
  FOR each contract_length (1-5 years):
    
    // Calculate end-of-contract age
    final_age = current_age + contract_length
    
    // Determine if player enters/exceeds decline phase during contract
    if (position == 'QB'):
      decline_start = 33
      steep_decline = 36
    else if (position == 'RB'):
      decline_start = 28
      steep_decline = 30
    else: // WR/TE
      decline_start = 30
      steep_decline = 32
    
    // Apply discount based on decline risk
    if final_age < decline_start:
      // Safe contract - player in prime throughout
      discount = 1.00 (no discount)
      
    else if final_age < steep_decline:
      // Moderate risk - player enters decline phase
      years_in_decline = final_age - decline_start + 1
      discount_per_year = 0.15  // 15% annual decline value
      discount = 1.00 - (years_in_decline × discount_per_year)
      
    else:
      // High risk - player in steep decline phase
      years_in_steep = final_age - steep_decline + 1
      discount_per_year = 0.25  // 25% annual decline value
      discount = 1.00 - (years_in_steep × discount_per_year)
    
    // Floor at minimum contract value (never less than 40% of intrinsic value)
    discount = max(discount, 0.40)
    
    contract_price[contract_length] = intrinsic_value × discount

Final Output:
  intrinsic_value = historical_curve_value  // Age NOT applied to base value
  contract_prices = {
    1_year: intrinsic_value × age_discount[1],
    2_year: intrinsic_value × age_discount[2],
    3_year: intrinsic_value × age_discount[3],
    4_year: intrinsic_value × age_discount[4],
    5_year: intrinsic_value × age_discount[5]
  }

**Example Contract Recommendations:**

Player A: Elite RB, Age 27, Rank 3 at position
  Intrinsic Value: $6.67M (no age penalty applied to base value)
  Current Age: 27 (in prime)
  Decline Start: 28
  
  Contract Options:
    1-year: $6.67M × 1.00 = $6.67M ✅ RECOMMENDED (stays in prime)
    2-year: $6.67M × 0.85 = $5.67M ⚠️  CAUTION (age 29, 1 year in decline)
    3-year: $6.67M × 0.70 = $4.67M ❌ AVOID (age 30, 2 years in decline)
    4-year: $6.67M × 0.55 = $3.67M ❌ AVOID (age 31, steep decline)
    5-year: $6.67M × 0.40 = $2.67M ❌ AVOID (age 32, steep decline)
  
  Recommendation: "1-year deal recommended - player entering decline phase at age 28"
  Warning: "Never pay $6.67M/year for a 30-year-old RB - no historical precedent"

Player B: Prime QB, Age 28, Rank 5 at position
  Intrinsic Value: $5.43M (no age penalty applied to base value)
  Current Age: 28 (in prime)
  Decline Start: 33
  
  Contract Options:
    1-year: $5.43M × 1.00 = $5.43M
    2-year: $5.43M × 1.00 = $5.43M
    3-year: $5.43M × 1.00 = $5.43M
    4-year: $5.43M × 1.00 = $5.43M ✅ RECOMMENDED (age 32, still prime)
    5-year: $5.43M × 0.85 = $4.62M ⚠️ CAUTION (age 33, 1 year in decline)
  
  Recommendation: "4-year deal recommended - maximize prime years before decline"

Player C: Young WR, Age 24, Rank 8 at position
  Intrinsic Value: $5.30M (no age penalty applied to base value)
  Current Age: 24 (entering prime)
  Decline Start: 30
  
  Contract Options:
    1-year: $5.30M × 1.00 = $5.30M
    2-year: $5.30M × 1.00 = $5.30M
    3-year: $5.30M × 1.00 = $5.30M
    4-year: $5.30M × 1.00 = $5.30M
    5-year: $5.30M × 1.00 = $5.30M ✅ RECOMMENDED (age 29, entire prime locked in)
  
  Recommendation: "5-year deal recommended - lock in entire prime at today's price"

Player D: Aging TE, Age 31, Rank 10 at position
  Intrinsic Value: $1.61M (no age penalty applied to base value)
  Current Age: 31 (in decline)
  Decline Start: 30 (already past)
  Steep Decline: 32
  
  Contract Options:
    1-year: $1.61M × 0.85 = $1.37M ✅ RECOMMENDED (minimize risk)
    2-year: $1.61M × 0.60 = $0.96M ⚠️ CAUTION (age 33, steep decline)
    3-year: $1.61M × 0.40 = $0.64M ❌ AVOID (age 34, steep decline)
    4-year: $1.61M × 0.40 = $0.64M ❌ AVOID (worthless by end)
    5-year: $1.61M × 0.40 = $0.64M ❌ AVOID (worthless by end)
  
  Recommendation: "1-year deal only - already past prime, steep decline imminent"
  Warning: "Historical data shows TEs age 32+ rarely maintain value"

**Age Risk Warnings by Position:**

RB Age Warnings:
  Age 26-27: "Prime RB years - consider 2-3 year deals max"
  Age 28-29: "WARNING: Decline phase starting - 1-2 year deals only"
  Age 30+:   "CRITICAL: Steep decline risk - 1 year deals only, heavy discount required"
  
QB Age Warnings:
  Age 26-32: "Prime QB years - 4-5 year deals safe"
  Age 33-35: "Decline phase - 2-3 year deals max, monitor performance"
  Age 36+:   "WARNING: Historical cliff - 1 year deals only"

WR/TE Age Warnings:
  Age 24-29: "Prime years - 3-5 year deals safe"
  Age 30-31: "Decline starting - 2-3 year deals max"
  Age 32+:   "WARNING: Steep decline - 1 year deals only"

**Historical Validation Requirements:**

Before recommending any contract, validate against historical data:

FOR each contract recommendation:
  query_historical_data = find_players(
    position = player.position,
    age_range = (player.age, player.age + contract_length),
    salary_range = (contract_price × 0.8, contract_price × 1.2)
  )
  
  if query_historical_data.count == 0:
    warning = "⚠️ NO HISTORICAL PRECEDENT - No {position} age {final_age} has earned ${contract_price}M"
    confidence = "LOW"
    recommendation = "AVOID - unproven contract structure"
  
  else if query_historical_data.count < 3:
    warning = "⚠️ LIMITED PRECEDENT - Only {count} {position}s age {final_age} at this salary"
    confidence = "MEDIUM"
    
  else:
    confidence = "HIGH"

Example Historical Validation:
  Contract: 5-year, $6M/year for 28-year-old RB (ends at age 33)
  
  Historical Query:
    Position: RB
    Age Range: 28-33
    Salary Range: $4.8M - $7.2M
    
    Results: 0 players found
    
    Warning: "⚠️ NO HISTORICAL PRECEDENT - No RB has maintained $6M salary through age 33"
    Recommendation: "AVOID - Historical data shows RBs decline sharply after 28"
    Alternative: "Consider 1-year $6M deal, reevaluate annually"
```

**Purpose:**
- Represents player's "fair market value" based on historical patterns
- Independent of current market conditions
- Used as baseline for identifying value opportunities

##### Formula 2: Predicted Market Price (Market-Based)

**Market Analysis Inputs:**

The predicted market price must account for auction dynamics and competitive bidding behavior. Key inputs required:

1. **Auction Pool Size**
   - Total players available (after franchise tags)
   - Total roster spots to fill across all teams
   - Expected number of players actually bid on (historically ~60-70% of pool)

2. **Positional Depth Analysis**
   - Count elite players (top 10 composite rank) at each position
   - Count quality starters (top 24 composite rank) at each position
   - Calculate depth ratio: `elite_available / teams_needing_position`
   
   **Depth Classifications:**
   ```
   Deep Position:     5+ elite players available, depth_ratio > 0.6
   Moderate Depth:    3-4 elite players available, depth_ratio 0.3-0.6
   Shallow Position:  1-2 elite players available, depth_ratio < 0.3
   ```
   
   **Key Assumption:** Deep positions = more value opportunities (competition spreads demand)
   **Key Assumption:** Shallow positions = bidding wars (demand concentrates on few players)

3. **Team Needs Aggregation**
   - Identify each team's top 3 positional needs (based on roster gaps)
   - Count total teams with "critical need" at each position
   - Calculate need intensity: `teams_with_critical_need / total_teams`
   
   **Example Scenarios:**
   ```
   Scenario A: High Demand, Shallow Supply (DANGER ZONE)
     Position: RB
     Elite Available: 1 player (Bijan Robinson)
     Teams with RB Need: 4 teams
     Depth Ratio: 0.25 (shallow)
     Expected Outcome: Bidding war, price inflates 50-100% above intrinsic value
   
   Scenario B: Low Demand, Deep Supply (VALUE ZONE)
     Position: WR
     Elite Available: 8 players
     Teams with WR Need: 5 teams
     Depth Ratio: 1.6 (deep)
     Expected Outcome: Buyers market, prices at or below intrinsic value
   
   Scenario C: Balanced Market
     Position: QB
     Elite Available: 3 players
     Teams with QB Need: 3 teams
     Depth Ratio: 1.0 (moderate)
     Expected Outcome: Fair pricing, slight premium (+5-10%)
   ```

4. **Team Cap Space Distribution**
   - Identify teams with surplus cap (>$10M available after draft)
   - Teams with surplus cap are more likely to overpay
   - Teams with limited cap (<$5M) create bargain opportunities (others avoid competition)

**Calculation:**
```
Step 1: Start with Intrinsic Value
  base_price = intrinsic_value

Step 2: Calculate Positional Depth Multiplier
  elite_count = count_elite_at_position(position, composite_rank <= 10)
  teams_needing = count_teams_with_critical_need(position)
  depth_ratio = elite_count / teams_needing
  
  if depth_ratio < 0.3:  // Shallow (1 elite, 4 teams need)
    depth_multiplier = 1.5 to 2.0  // Severe scarcity premium
  else if depth_ratio < 0.6:  // Moderate (3 elite, 5 teams need)
    depth_multiplier = 1.2 to 1.5  // Scarcity premium
  else if depth_ratio < 1.0:  // Balanced (4 elite, 5 teams need)
    depth_multiplier = 1.1 to 1.2  // Slight premium
  else:  // Deep (8 elite, 5 teams need)
    depth_multiplier = 0.9 to 1.1  // Value zone

Step 3: Calculate Player-Specific Competition Factor
  // Within position, top players attract disproportionate attention
  position_rank_at_position = rank_within_position(player)
  
  if position_rank <= 3 AND depth_ratio < 0.5:
    // Elite scarcity: Top 3 in shallow market
    competition_factor = 1.3 to 1.6
  else if position_rank <= 10 AND depth_ratio < 1.0:
    // Quality scarcity: Top 10 in balanced/shallow market
    competition_factor = 1.1 to 1.3
  else:
    // Normal competition
    competition_factor = 1.0 to 1.1

Step 4: Apply Team Need Inflation
  // Teams with critical positional need will overbid
  teams_desperate_for_position = count_teams_with_high_need(position)
  teams_with_cap = count_teams_with_available_cap(min_threshold = $5M)
  
  // More desperate teams = higher prices
  demand_multiplier = 1.0 + (teams_desperate × 0.05) + (teams_with_cap × 0.03)
  
  // Cap at reasonable inflation
  demand_multiplier = min(demand_multiplier, 1.5)

Step 5: Apply Market Inflation Factor
  // Historical auction data shows 10-15% inflation vs intrinsic value
  // Competitive bidding drives prices above "fair value"
  
  // Adjust by market heat (ratio of buyers to available elite players)
  total_buyers = count_teams_with_cap(min_threshold = $3M)
  total_elite_players = count_players(composite_rank <= 24)
  buyer_to_player_ratio = total_buyers / total_elite_players
  
  if buyer_to_player_ratio > 1.2:  // More buyers than quality players
    market_inflation = 1.15
  else if buyer_to_player_ratio > 1.0:
    market_inflation = 1.10
  else:
    market_inflation = 1.05  // Buyers market

Step 6: Franchise Tag Risk Premium
  // Top 5 at position may be tagged, reducing supply further
  if position_rank <= 5 and franchise_tag_likelihood > 50%:
    tag_premium = 1.15 to 1.25

Final Output:
  predicted_market_price = intrinsic_value × 
                          depth_multiplier × 
                          competition_factor ×
                          demand_multiplier × 
                          market_inflation × 
                          tag_premium
```

**Example: Deep vs Shallow Position Impact**

```
Player A: WR Ranked #8 Overall (Deep Position)
  Intrinsic Value: $5.30M (WR rank 8, historical curve)
  Elite WRs Available: 10 players
  Teams Needing WR: 6 teams
  Depth Ratio: 1.67 (DEEP - buyers market)
  
  Calculation:
    depth_multiplier = 1.0 (deep position, no scarcity premium)
    competition_factor = 1.05 (top 10 but plenty available)
    demand_multiplier = 1.33 (6 teams need × 0.05 + cap factor)
    market_inflation = 1.10
    tag_premium = 1.0 (not top 5)
    
  Predicted Market Price: $5.30M × 1.0 × 1.05 × 1.33 × 1.10 × 1.0 = $8.16M
  Value Gap: +$2.86M (+54%)
  Classification: OVERPAY - but expected in competitive auction
  
  Strategy: Wait for late auction, prices may drop as teams fill needs

Player B: RB Ranked #12 Overall (Shallow Position)  
  Intrinsic Value: $3.44M (RB rank 12, historical curve)
  Elite RBs Available: 2 players (shallow year)
  Teams Needing RB: 7 teams
  Depth Ratio: 0.29 (SHALLOW - extreme scarcity)
  
  Calculation:
    depth_multiplier = 1.8 (severe scarcity, only 2 elite available)
    competition_factor = 1.4 (top tier in shallow market)
    demand_multiplier = 1.56 (7 teams desperate × 0.05 + cap factor)
    market_inflation = 1.15 (hot market)
    tag_premium = 1.0 (not top 5 overall)
    
  Predicted Market Price: $3.44M × 1.8 × 1.4 × 1.56 × 1.15 × 1.0 = $15.28M
  Value Gap: +$11.84M (+344%)
  Classification: EXTREME AVOID - market panic pricing
  
  Strategy: Do NOT bid. Let desperate teams overpay, find value elsewhere

Player C: QB Ranked #10 Overall (Balanced Position)
  Intrinsic Value: $2.57M (QB rank 10, historical curve)
  Elite QBs Available: 4 players
  Teams Needing QB: 4 teams
  Depth Ratio: 1.0 (BALANCED - fair market)
  
  Calculation:
    depth_multiplier = 1.15 (slight scarcity)
    competition_factor = 1.1 (top 10, balanced supply)
    demand_multiplier = 1.32 (4 teams need × 0.05 + cap factor)
    market_inflation = 1.10
    tag_premium = 1.0
    
  Predicted Market Price: $2.57M × 1.15 × 1.1 × 1.32 × 1.10 × 1.0 = $4.52M
  Value Gap: +$1.95M (+76%)
  Classification: FAIR VALUE - reasonable market pricing
  
  Strategy: Good target if QB is critical need, price justified by demand
```

**Purpose:**
- Predicts actual auction winning bid based on market dynamics
- Accounts for position-specific supply/demand imbalances
- Identifies which positions will have bidding wars vs bargains
- Used for budget planning and bid limits

##### Value Analysis & Recommendations

**Calculate Value Differential:**
```
value_gap = predicted_market_price - intrinsic_value
value_gap_pct = (value_gap / intrinsic_value) × 100

Classifications:
  Excellent Value:  value_gap_pct < -15%  (market undervalues by >15%)
  Good Value:       value_gap_pct -15% to -5%
  Fair Value:       value_gap_pct -5% to +5%
  Slight Overpay:   value_gap_pct +5% to +15%
  Significant Overpay: value_gap_pct +15% to +30%
  Avoid:            value_gap_pct > +30%  (market overvalues by >30%)
```

**Example Scenarios:**

See detailed examples in "Formula 2: Predicted Market Price" section above, including:
- **Deep Position (WR)**: 10 elite available, 6 teams need → Value zone, but still +54% overpay
- **Shallow Position (RB)**: 2 elite available, 7 teams need → Extreme avoid, +344% overpay  
- **Balanced Position (QB)**: 4 elite available, 4 teams need → Fair value, +76% justified premium

**Additional Examples by Value Classification:**

```
Excellent Value Example:
  Player: Aging TE (Rank 15 at position)
  Intrinsic Value: $0.57M
  Market Factors: Deep TE class, only 2 teams need TE, late auction timing
  Predicted Market Price: $0.45M
  Value Gap: -$0.12M (-21%)
  Strategy: TARGET - Market undervalues due to age concerns, but still productive

Good Value Example:
  Player: Mid-tier WR (Rank 18 at position)  
  Intrinsic Value: $2.09M
  Market Factors: 10 WRs available, most teams filled WR need early
  Predicted Market Price: $1.85M
  Value Gap: -$0.24M (-11%)
  Strategy: STRONG TARGET - Get starter-quality WR at discount

Avoid Example:
  Player: Elite RB in shallow class (Rank 1 at position)
  Intrinsic Value: $10.03M
  Market Factors: Only elite RB available, 5 desperate teams, high cap space
  Predicted Market Price: $18.50M  
  Value Gap: +$8.47M (+84%)
  Strategy: AVOID - Let desperate teams battle, punt RB position or draft rookies
```

**UI Display Requirements:**
- Show BOTH values side-by-side for every player
- Color-code value gap (green = value, red = overpay)
- Sortable by value gap % to find best opportunities
- Filter to show only "Good Value" or better players
- Warning badges for "Avoid" tier players

**Strategic Use Cases:**
1. **Bargain Hunting**: Sort by most negative value_gap_pct
2. **Budget Planning**: Use predicted_market_price for max bids
3. **Avoid Overpays**: Filter out players with value_gap_pct > 15%
4. **Target List**: Build list of players where PMP ≈ IV (fair deals)
5. **Position Strategy**: Identify which positions are "value zones" vs "danger zones"
   - **Value Zone Positions**: Deep supply, low demand → Target these positions
   - **Danger Zone Positions**: Shallow supply, high demand → Avoid or pivot to draft

**Key Market Dynamics Principles:**

1. **Depth Creates Value**
   - Positions with many elite players (top 10 ranked) spread demand
   - Competition dilutes across multiple quality options
   - Prices tend toward intrinsic value or below
   - **Strategy**: Target deep positions for better value

2. **Scarcity Creates Panic**
   - Positions with 1-2 elite players concentrate demand
   - Teams with critical need enter bidding wars
   - Prices inflate 50-200% above intrinsic value
   - **Strategy**: Avoid shallow positions unless you can dominate early

3. **Auction Timing Matters**
   - Early auction: Prices inflated by FOMO and full budgets
   - Mid auction: Prices stabilize as needs partially filled
   - Late auction: Bargains emerge as cap space depletes
   - **Strategy**: Be patient in deep positions, aggressive in shallow positions

4. **Team Needs Drive Irrational Bids**
   - Teams with 1 critical need will overpay drastically
   - Teams with multiple needs spread budget more rationally  
   - Teams with surplus cap ($10M+) less price-sensitive
   - **Strategy**: Track which teams are desperate vs rational buyers

5. **Supply/Demand Ratio Formula**
   ```
   Market Efficiency = Elite Players Available / Teams Needing Position
   
   > 1.5  = Efficient market (value zone)
   1.0-1.5 = Balanced market (fair pricing)
   0.5-1.0 = Inefficient market (moderate overpay)
   < 0.5  = Panic market (extreme overpay)
   ```

Composite Rank = (dynasty_rank × dynasty_weight) + (redraft_rank × redraft_weight)
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

- **All Players View (Free Agents + Contracted Players)**
  - **Toggle/Filter**: Switch between "Free Agents Only" (default) and "All Players in League"
  - **Purpose**: Compare existing contracts vs projected auction prices to identify value opportunities
  
  **When Viewing All Players:**
  - Display current rostered players alongside free agents
  - Show **dual salary columns**:
    1. **Current Contract**: Player's actual 2025 salary
    2. **Future Escalated Salary**: Projected 2026+ salaries with 10% annual escalation
  
  **Contract Display Logic:**
  ```
  Example: Player has 4-year contract signed in 2024 at $5M/year
  
  Current Salary (2025): $5.5M (Year 2 of contract, 10% escalation from Year 1)
  
  Future Contract Years (showing 10% annual increases):
    Year 1 (2026): $6.05M  (current + 10%)
    Year 2 (2027): $6.66M  (Year 1 + 10%)
    Year 3 (2028): $7.33M  (Year 2 + 10%)
    Year 4 (2029): N/A     (contract expires before this)
    Year 5 (2030): N/A
  ```
  
  **Use Cases:**
  - **Identify Cut Candidates**: See which contracted players have escalated salaries exceeding their projected auction value
    - Example: 30-year-old RB with $8M escalated salary in Year 3, but auction predictor shows intrinsic value of only $3M → Cut candidate
  - **Extension Planning**: See which team rosters have good value contracts
  - **Trade Target Analysis**: Identify undervalued players on other rosters
  - **Market Comparison**: Compare free agent auction prices vs extension costs
  
  **UI Requirements:**
  - Visual indicator to distinguish contracted players from free agents (e.g., badge, row background)
  - Contract years shown as "N/A" or grayed out after contract expiration
  - Tooltip showing: "Contract expires after 2028 season"
  - Sortable by current salary and future salaries
  - Filter by contract status: "All", "Free Agents", "Under Contract", "Expiring 2026"
  
  **Data Requirements:**
  - Access to player contract info (contract length, signing year, original salary)
  - Contract year tracking (which year of the contract they're currently in)
  - Team/franchise assignment for rostered players
  
  **Value Analysis Integration:**
  - Compare contracted players' escalated salaries vs intrinsic value
  - Flag contracts that exceed historical curve (potential cuts)
  - Highlight bargain contracts (player value >> escalated salary)

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

---

## Phase 3: Live Auction Integration

### Feature: Real-Time Auction Price Tracking

**Status**: 📋 Planned (Auction: March 15-21, 2026)

#### Overview
Integrate live auction data from MFL API to track real-time bid prices during the actual 2026 free agency auction. This enables users to compare predicted prices against actual market behavior and identify value opportunities as the auction progresses.

#### User Story
**As a** league owner during the live auction  
**I want to** see real-time auction prices compared to my predicted values  
**So that** I can identify when players are undervalued/overvalued and make informed bidding decisions

#### Functional Requirements

**FR-3.1: MFL Auction API Integration**
- Identify and document the correct MFL API endpoint for live auction data
  - Endpoint: `/export?TYPE=auctionResults&L={leagueId}&APIKEY={key}&JSON=1`
  - Returns: Current auction state, winning bids, active player, bid amounts
- Parse auction results to extract:
  - Player ID
  - Current bid amount
  - Winning bidder (team ID)
  - Bid timestamp
  - Auction status (active, closed, upcoming)

**FR-3.2: Client-Side Live Polling**
- Poll MFL auction API every **60 seconds** for updates
- Update UI with new auction prices without page refresh
- Display timestamp of last successful update
- Similar implementation to live scoring feature

**FR-3.3: Activity Detection & Auto-Pause**
- Detect user inactivity after:
  - 5 minutes of no mouse movement
  - 5 minutes of no keyboard input
  - Browser tab not visible/focused
- When inactive:
  - Stop polling MFL API automatically
  - Display prominent message: "Live auction tracking paused due to inactivity"
  - Show "Resume Live Auction Tracking" button
- When activity resumes:
  - User can click button to restart polling
  - Immediately fetch latest auction data
  - Resume 60-second polling cycle

**FR-3.4: Price Comparison Display**
- For each player in auction:
  - Show predicted price (from our algorithm)
  - Show current/final auction price (from MFL)
  - Calculate and display variance:
    - Green badge: "VALUE" (actual < predicted - 15%)
    - Blue badge: "FAIR" (within ±15% of predicted)
    - Yellow badge: "PREMIUM" (actual > predicted + 15%, < +30%)
    - Red badge: "AVOID" (actual > predicted + 30%)
  - Show bid history if available

**FR-3.5: Auction Progress Tracking**
- Display auction statistics:
  - Total players sold / remaining
  - Average sale price by position
  - Total cap spent across league
  - Remaining cap space per team
- Highlight players that sold for significant value/premium

**FR-3.6: Value Alerts**
- Visual/audio alert when:
  - Player sells below predicted price (value opportunity missed)
  - Similar player to your targets sells (price discovery)
  - Specific players you marked as "watch" come up for bid

#### Technical Requirements

**TR-3.1: Polling Architecture**
- Use `setInterval` for 60-second polling
- Implement exponential backoff on API errors
- Maximum 3 retry attempts before showing error state
- Clear interval on component unmount

**TR-3.2: Activity Detection**
```javascript
// Track last activity timestamp
let lastActivity = Date.now();
let pollInterval;
let isPolling = false;

// Activity listeners
['mousemove', 'keydown', 'click', 'scroll'].forEach(event => {
  window.addEventListener(event, () => lastActivity = Date.now());
});

// Check activity every 30 seconds
setInterval(() => {
  if (Date.now() - lastActivity > 300000) { // 5 min
    pausePolling();
  }
}, 30000);
```

**TR-3.3: API Response Caching**
- Cache last successful response
- Show cached data if API fails
- Indicate data staleness in UI

**TR-3.4: Performance Optimization**
- Only update DOM elements that changed
- Debounce UI updates if multiple auctions active
- Lazy load player images/details

#### UI/UX Requirements

**UI-3.1: Live Auction View**
- New tab in auction predictor: "Live Auction"
- Split view:
  - Left: Current/upcoming players with predictions
  - Right: Recently sold players with variances
- Sticky header showing:
  - Live status indicator (🔴 LIVE / ⏸️ PAUSED)
  - Last update timestamp
  - Auto-refresh toggle
  - Pause/Resume button

**UI-3.2: Pause State UI**
```
┌─────────────────────────────────────┐
│  ⏸️ Live Auction Tracking Paused    │
│                                     │
│  Paused due to 5 minutes of         │
│  inactivity to conserve resources.  │
│                                     │
│  [▶ Resume Live Tracking]           │
│                                     │
│  Last update: 3:24 PM (6 min ago)   │
└─────────────────────────────────────┘
```

**UI-3.3: Player Card Updates**
- Animate price changes (flash green/red)
- Show "SOLD" badge on completed auctions
- Gray out players that are no longer available
- Bold/highlight players currently being bid on

#### API Research Required

**Action Items for MFL API Discovery:**
1. Test MFL auction endpoints in dev environment
2. Document response structure for:
   - Live auction state
   - Completed auction results
   - Historical auction data (if available)
3. Identify rate limits and authentication requirements
4. Test behavior during off-season (March pre-auction)
5. Create mock auction data for development/testing

**Known MFL API Endpoints to Research:**
- `/export?TYPE=auctionResults`
- `/export?TYPE=transactions` (may include auction data)
- `/export?TYPE=league` (may have auction status)
- MFL API documentation review needed

#### Testing Strategy

**Pre-Auction Testing (Jan-Feb)**
- Mock MFL auction responses
- Test polling behavior with simulated data
- Verify inactivity detection works correctly
- Ensure UI performs well with 100+ players

**Live Auction Testing (March 15-21)**
- Monitor API during actual auction
- Verify real-time updates accuracy
- Test pause/resume during live auction
- Gather user feedback for future improvements

#### Success Criteria
- ✅ API polling works reliably during 6-hour auction
- ✅ Activity detection pauses polling correctly
- ✅ Price comparisons help identify 3+ value opportunities
- ✅ Zero performance issues during live auction
- ✅ User can quickly resume tracking after pause

#### Future Enhancements (Post-Auction)
- Browser notifications for watched players
- Export auction results to CSV for analysis
- Historical auction price charts
- Multi-year auction trend analysis
- SMS/email alerts for specific players

---

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
