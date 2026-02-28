# Salary Calculation Requirements

## Overview
The auction predictor must use **historical salary data** from our league (2020-2025) to create accurate, trustworthy price predictions. Rankings should directly map to historical salary patterns, with market dynamics applied as adjustments.

## Core Principles

1. **Rankings Determine Order** - A player ranked #5 should always be priced higher than a player ranked #50
2. **Historical Data is Ground Truth** - Use 6 years of actual auction results to establish baseline
3. **Position-Specific Curves** - Each position (QB, RB, WR, TE) has its own salary distribution
4. **Market Adjustments are Multipliers** - Scarcity and demand modify the baseline, not replace it

## Three-Step Calculation Process

### Step 1: Historical Baseline (Ground Truth)

**Data Sources:**
- `mfl-player-salaries-2020.json` through `mfl-player-salaries-2025.json`
- Focus on skill positions: QB, RB, WR, TE
- Exclude DEF and PK from main analysis (use separate simple logic)

**Process:**
1. For each year (2020-2025):
   - Sort all players by salary (highest to lowest)
   - Assign salary rank (1 = highest paid, 2 = second highest, etc.)
   - Separate by position

2. Create position-specific salary curves:
   ```
   Position: RB
   Rank 1:  Average of (2020 RB#1, 2021 RB#1, ..., 2025 RB#1)
   Rank 2:  Average of (2020 RB#2, 2021 RB#2, ..., 2025 RB#2)
   ...
   Rank 50: Average of (2020 RB#50, 2021 RB#50, ..., 2025 RB#50)
   ```

3. Generate lookup tables:
   ```javascript
   const HISTORICAL_SALARY_BY_POSITION = {
     QB: {
       1: 9_850_000,
       2: 8_200_000,
       3: 7_100_000,
       // ... through rank 50
     },
     RB: {
       1: 10_500_000,
       2: 9_800_000,
       3: 8_500_000,
       // ... through rank 50
     },
     // ... WR, TE
   };
   ```

**Interpolation for Gaps:**
- If a rank doesn't have 6 years of data (e.g., only 3 teams buy RB#25), use exponential smoothing
- Curve fitting: `salary = topSalary × e^(-k × (rank-1))` where k is derived from available data

### Step 2: Map Players to Historical Baselines

**Input:**
- Player's composite rank (from dynasty/redraft rankings)
- Player's position

**Process:**
1. Calculate composite rank: `(dynastyRank × dynastyWeight) + (redraftRank × redraftWeight)`
2. Find position rank: How many players at the same position are ranked higher?
3. Look up historical salary: `HISTORICAL_SALARY_BY_POSITION[position][positionRank]`
4. This becomes the **baseline salary** (what the market historically pays for this position/rank)

**Example:**
```
Jaylen Warren:
- Composite Rank: #82 overall
- Position: RB
- Position Rank: #16 (15 RBs ranked higher)
- Historical Baseline: HISTORICAL_SALARY_BY_POSITION['RB'][16] = $4,200,000
```

### Step 3: Market Dynamics Adjustment

**Factors that modify baseline:**

1. **Position Scarcity Multiplier** (1.0 - 1.3x)
   - Calculate: `available players at position / total teams`
   - Shallow markets (< 1.5 players per team) = 1.2x multiplier
   - Deep markets (> 2.5 players per team) = 0.95x multiplier
   
2. **Team Needs Multiplier** (1.0 - 1.2x)
   - Count teams with expiring contracts at position
   - High demand (8+ teams need position) = 1.15x multiplier
   - Low demand (< 4 teams need position) = 1.0x multiplier

3. **Championship Window Boost** (1.0 - 1.1x)
   - Teams in championship window overpay for proven talent
   - Top 5 ranked players get 1.1x if 3+ contenders need them

**Final Formula:**
```javascript
predictedSalary = baselineSalary × scarcityMultiplier × demandMultiplier × windowBoost
```

**Example:**
```
Jaylen Warren (continued):
- Baseline: $4,200,000
- RB scarcity: 1.15x (only 12 RBs available, 12 teams)
- Demand: 1.10x (8 teams need RB)
- Window boost: 1.0x (not top 5)
- Predicted: $4,200,000 × 1.15 × 1.10 × 1.0 = $5,313,000
```

## Value Calculation

**Value Score = Historical Baseline vs Market Prediction**

```javascript
intrinsicValue = baselineSalary; // What they SHOULD cost
predictedMarketPrice = baselineSalary × multipliers; // What they WILL cost
valueGap = intrinsicValue - predictedMarketPrice;
valueGapPercent = (valueGap / predictedMarketPrice) × 100;

if (valueGapPercent > 15%) classification = "Bargain"
else if (valueGapPercent > 5%) classification = "Good Value"
else if (valueGapPercent > -5%) classification = "Fair"
else if (valueGapPercent > -15%) classification = "Slight Overpay"
else classification = "Overpay"
```

## Implementation Files

### Data Generation Script
**Location:** `scripts/generate-historical-salary-curves.mjs`

**Purpose:** 
- Analyze 2020-2025 salary data
- Generate position-specific lookup tables
- Output to `data/theleague/historical-salary-curves.json`

**Run:** Before each auction season to update with latest year

### Pricing Calculator
**Location:** `src/utils/auction-price-calculator.ts`

**Functions:**
- `loadHistoricalCurves()` - Load lookup tables
- `getBaselineSalary(position, positionRank)` - Step 2
- `calculateMarketMultipliers(player, market)` - Step 3
- `calculateAuctionPrice(player, market)` - Combines all steps

### Contract Pricing: Risk/Reward Spectrum

**Philosophy:** Longer contracts = lower annual cost (buying stability), Shorter contracts = higher cost (betting on upside)

**The baseline salary from historical curves represents a 3-YEAR CONTRACT value.**

**Contract Length Multipliers:**
- **5-year**: 0.75x (25% discount) - Locking in long-term, accepting floor
- **4-year**: 0.85x (15% discount) - Good value for proven players
- **3-year**: 1.0x (BASELINE) - Market equilibrium, most common
- **2-year**: 1.15x (15% premium) - Paying for flexibility
- **1-year**: 1.35x (35% premium) - Betting on breakout/upside, prove-it deal

**Example: Jaylen Warren (RB #16, baseline $2.5M for 3-year)**
- 5-year: $2.5M × 0.75 = **$1.88M/year** (secure but could be a bargain if he breaks out)
- 4-year: $2.5M × 0.85 = **$2.13M/year** 
- 3-year: $2.5M × 1.0 = **$2.50M/year** (historical average)
- 2-year: $2.5M × 1.15 = **$2.88M/year**
- 1-year: $2.5M × 1.35 = **$3.38M/year** (betting he's actually RB #10-12 talent)

**Example: Saquon Barkley (RB #1, baseline $10M for 3-year)**
- 5-year: $10M × 0.75 = **$7.5M/year** (elite long-term lock)
- 3-year: $10M × 1.0 = **$10M/year** (proven superstar)
- 1-year: $10M × 1.35 = **$13.5M/year** (paying massive premium for championship push)

**Age-based recommendations:**
- Elite young (age ≤ 25, baseline > $8M): Recommend 5-year (lock them up)
- Young productive (age ≤ 26, baseline > $4M): Recommend 4-year (secure prime years)
- Prime (age 27-29): Recommend 3-year (standard deal)
- Aging (age 30-31): Recommend 2-year (limit risk)
- Veteran (age 32+): Recommend 1-year (prove-it only)

**Why this works:**
1. **Sellers want short deals** - If you think your rank #50 player is actually top-20, you want 1-year to prove it
2. **Buyers want long deals** - If you think rank #20 is fair value, lock 5 years before he proves you right
3. **Market tension** - The auction finds equilibrium between risk appetites
4. **Upside premium** - 1-year deals cost more because you're betting they outperform their ranking

## Validation & Testing

**Test Cases:**
1. Top RB (rank #1) should be $10M+
2. Elite WR (rank #5) should be $8M-10M
3. Mid-tier RB (rank #25) should be $3M-4M
4. Backup player (rank #100) should be $1M-2M
5. Deep backup (rank #150+) should be near minimum ($425K)

**Regression Test:**
- Take 2024 actual auction results
- Run predictions using 2020-2023 data only
- Compare predicted vs actual
- Target: 80%+ within 20% of actual price

## Data Files Required

```
data/theleague/
├── mfl-player-salaries-2020.json
├── mfl-player-salaries-2021.json
├── mfl-player-salaries-2022.json
├── mfl-player-salaries-2023.json
├── mfl-player-salaries-2024.json
├── mfl-player-salaries-2025.json
└── historical-salary-curves.json (generated)
```

## Future Enhancements

1. **Injury History Discount** - Players with 2+ recent injuries get 0.85-0.95x multiplier
2. **Breakout Rookie Bonus** - First-year players in top 20 get 1.1x (hype factor)
3. **Contract Year Premium** - Players in final year get 1.05x (proven they can play)
4. **Playoff Performance Boost** - Recent playoff success adds 1.05x for contenders

---

## Summary

**Simple, Trustworthy, Data-Driven:**
1. Historical data (2020-2025) creates baseline curves per position
2. Rankings map directly to these proven salary patterns  
3. Market dynamics (scarcity, demand) adjust predictions ±20%
4. Value analysis compares "should cost" vs "will cost"

This grounds the entire application in **real auction behavior** rather than theoretical formulas.
