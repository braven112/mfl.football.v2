# Auction Predictor Pricing Enhancement - PRD

**Version:** 1.0
**Status:** Draft - Pending Approval
**Date:** 2026-01-10
**Author:** Claude AI Assistant

---

## Executive Summary

Enhance the auction predictor pricing algorithm to use historical salary data more effectively, add validation to prevent impossible price predictions, and redesign the contract year pricing to represent a **price range** (low to high) rather than age-based discounts.

---

## Problem Statement

### Current Issues

1. **Historical Price Integration is Incomplete**
   - Current: Uses exponential decay curves (Max/Avg/Min) derived from historical data
   - Problem: Doesn't validate predicted prices against actual historical maximums
   - Risk: May predict prices that have NEVER occurred historically (e.g., $15M for a 32-year-old RB)

2. **Contract Year Columns are Confusing**
   - Current Implementation: 1-year = base price, 5-year = discounted price (age depreciation)
   - User Expectation: Columns should represent a **PRICE RANGE** where:
     - **5-year contract** = Low end of price range (value deal, commitment discount)
     - **1-year contract** = High end of price range (premium price, flexibility)
   - Example: If a player's market value is $4-7M, then:
     - 5-year shows $4M (you're getting a value, locking them in cheap)
     - 1-year shows $7M (you're paying premium for short-term flexibility)

3. **No Validation Layer**
   - Predicted prices can exceed historical maximums without warning
   - No testing framework to flag anomalous predictions during development
   - No feedback mechanism when prices are "impossible"

---

## Goals

### Primary Goals

1. **Historical Price Validation**
   - Flag any predicted price that exceeds the historical maximum for that position/rank tier
   - Provide context: "No QB ranked #10 has ever been paid more than $X"
   - Ask developer to confirm if anomaly is intentional

2. **Redesign Contract Year Pricing as Price Ranges**
   - Shift mental model from "age discount" to "market price range"
   - 1-year contract = High end (premium for flexibility)
   - 5-year contract = Low end (discount for commitment)
   - Smooth interpolation between 1-5 years

3. **Testing & Validation Framework**
   - Automated tests to catch impossible prices
   - Flag prices exceeding historical maximums
   - Confidence scores based on historical precedent
   - Developer prompts for review of anomalous predictions

### Success Metrics

- ✅ Zero predicted prices exceed historical max without explicit approval
- ✅ Contract year columns clearly represent low→high price range
- ✅ Validation tests catch 100% of anomalous predictions
- ✅ Improved user confidence in price accuracy

---

## Detailed Requirements

### FR-1: Historical Price Baseline Integration

**Current State:**
- Historical salary curves exist: `historical-salary-curves.json`
- Contains max/avg/min exponential decay parameters by position
- Derived from 2009-2025 salary data

**Enhancement:**
```typescript
interface HistoricalPriceRange {
  position: string;
  rankTier: 'elite' | 'star' | 'starter' | 'depth'; // Elite: 1-5, Star: 6-12, Starter: 13-24, Depth: 25+
  historicalMax: number;      // Highest ever paid at this rank tier
  historicalAvg: number;      // Average price at this rank tier
  historicalMin: number;      // Lowest price at this rank tier
  sampleSize: number;         // How many data points
  yearsSpan: string;          // e.g., "2020-2025"
}
```

**Calculation Logic:**
1. Determine player's rank tier based on composite ranking
2. Retrieve historical price range for that position + rank tier
3. **Top-ranked players (Rank 1-5)**: Use **max historical prices**
4. **Mid-tier players (Rank 6-24)**: Use **average historical prices** with smooth interpolation
5. **Low-tier players (Rank 25+)**: Use **min historical prices** with smooth interpolation
6. **Smooth scaling**: Linear or exponential interpolation between tiers

**Example:**
```
Position: QB, Rank: 1 (Elite Tier)
- Historical Max: $10.8M (from curves.QB.max.basePrice)
- Historical Avg: $5.8M
- Historical Min: $1.7M
- Predicted Price: $10.8M (use max for #1 ranked)

Position: QB, Rank: 8 (Star Tier, between Elite and Starter)
- Interpolate between Max curve ($10.8M → decay) and Avg curve ($5.8M → decay)
- Predicted Price: ~$6.5M (blend of max and avg curves)

Position: QB, Rank: 32 (Depth Tier)
- Use Min curve: $1.7M with decay
- Predicted Price: ~$450K (league minimum range)
```

---

### FR-2: Redesign Contract Year Pricing as Price Ranges

**Current Implementation:**
```typescript
// Current: Age-based depreciation
oneYear: $6M      (base price)
twoYear: $5.5M    (age depreciation)
threeYear: $5M    (more depreciation)
fourYear: $4.5M
fiveYear: $4M
```

**New Implementation:**
```typescript
// New: Market price range (low to high)
fiveYear: $4M     (LOW end - value deal, commitment discount)
fourYear: $4.5M   (interpolated)
threeYear: $5M    (mid-range - equilibrium)
twoYear: $5.5M    (interpolated)
oneYear: $6M      (HIGH end - premium for flexibility)
```

**Philosophy Shift:**

| Contract Length | Old Meaning | New Meaning |
|----------------|-------------|-------------|
| **5 years** | "Age discount for long commitment" | "You're getting a VALUE - locking player in at LOW price" |
| **1 year** | "Base market price" | "You're paying PREMIUM for short-term flexibility" |

**Why This Makes Sense:**
- In real NFL/fantasy auctions, **longer contracts = lower annual salary** (team gets certainty)
- **Shorter contracts = higher annual salary** (player gets flexibility to renegotiate sooner)
- User can decide: "Do I want to pay $6M for 1 year, or lock him in at $4M for 5 years?"

**Calculation:**
```typescript
/**
 * Generate price range based on market value and scarcity
 *
 * Base Price (3-year equilibrium): $5M
 * Range Width: ±20% ($4M to $6M)
 *
 * 5-year = Base - 20% = $4M
 * 4-year = Base - 10% = $4.5M
 * 3-year = Base = $5M
 * 2-year = Base + 10% = $5.5M
 * 1-year = Base + 20% = $6M
 */
function generateContractPricing(
  player: PlayerValuation,
  basePrice: number, // This is the 3-year equilibrium price
  marketScarcity: number // Higher scarcity = wider price range
): ContractPricing {

  // Price range width (±20% default, wider for scarce positions)
  const rangePercent = 0.20 + (marketScarcity * 0.10); // 20-30% range

  const threeYear = basePrice; // Equilibrium
  const fiveYear = Math.round(basePrice * (1 - rangePercent)); // Low end
  const fourYear = Math.round(basePrice * (1 - rangePercent / 2));
  const twoYear = Math.round(basePrice * (1 + rangePercent / 2));
  const oneYear = Math.round(basePrice * (1 + rangePercent)); // High end

  return {
    oneYear,   // $6M - HIGH (premium)
    twoYear,   // $5.5M
    threeYear, // $5M - EQUILIBRIUM
    fourYear,  // $4.5M
    fiveYear,  // $4M - LOW (value)
    recommended: recommendContractLength(player, basePrice, marketScarcity)
  };
}
```

**Age Considerations:**
- Age still matters for **recommended contract length**, not price range
- Example: 32-year-old RB
  - Price range: $2M (5-year) to $3M (1-year)
  - Recommended: **1-year only** (don't commit long-term to aging RB)
  - Warning: "Avoid multi-year deals - historical decline at age 32+"

---

### FR-3: Validation & Testing Framework

**Requirement: Flag Impossible Prices**

Create validation layer that checks:
1. **Historical Maximum Validation**
   - Query historical data for position + rank tier
   - If `predictedPrice > historicalMax`, flag with warning
   - Example: "⚠️ ANOMALY: No QB ranked #10 has ever been paid more than $5.8M. Predicted: $7.2M"

2. **Age-Salary Precedent Validation**
   - Query: "Has any [position] at age [X] ever earned $[Y]?"
   - If no precedent, flag with warning
   - Example: "⚠️ NO PRECEDENT: No 32-year-old RB has earned $8M in our dataset (2009-2025)"

3. **Contract Length Validation**
   - Ensure 1-year > 2-year > 3-year > 4-year > 5-year (monotonic decrease)
   - Ensure price range is reasonable (not too wide or narrow)

**Developer Testing Mode:**
```typescript
interface PriceValidationResult {
  playerId: string;
  playerName: string;
  position: string;
  rank: number;
  age: number;

  predictedPrice: number;
  historicalMax: number;
  historicalAvg: number;
  historicalMin: number;

  validations: {
    exceedsHistoricalMax: boolean;
    exceedsMaxByPercent: number; // e.g., +45%
    hasAgePrecedent: boolean;
    hasSalaryPrecedent: boolean;
    confidence: 'high' | 'medium' | 'low';
    warnings: string[];
  };

  requiresReview: boolean; // If true, prompt developer
}
```

**Automated Test Suite:**
```typescript
describe('Auction Price Validation', () => {
  it('should never exceed historical max without explicit approval', () => {
    const players = generateMockPlayers();
    const results = calculateAllPlayerPrices(players, ...);

    results.forEach(result => {
      const validation = validatePrice(result);
      if (validation.exceedsHistoricalMax) {
        console.warn(`⚠️ REVIEW REQUIRED: ${validation.playerName}`);
        console.warn(`  Predicted: $${validation.predictedPrice}`);
        console.warn(`  Historical Max: $${validation.historicalMax}`);
        console.warn(`  Exceeds by: +${validation.validations.exceedsMaxByPercent}%`);

        // In test mode, ask developer to confirm
        const approved = askDeveloper(`Is this price realistic?`);
        expect(approved).toBe(true);
      }
    });
  });

  it('should flag prices with no age precedent', () => {
    const oldRB = { position: 'RB', age: 32, rank: 5 };
    const result = calculatePrice(oldRB);
    const validation = validateAgePrecedent(oldRB, result.price);

    if (!validation.hasAgePrecedent) {
      console.warn(`⚠️ NO PRECEDENT: 32-year-old RB at $${result.price}`);
    }
  });
});
```

---

### FR-4: Smooth Scaling Between Rank Tiers

**Current Implementation:**
- Uses blending between Max/Avg/Min curves
- Elite (1-5): Pure Max curve
- Star (6-12): Blend Max → Avg
- Starter (13-24): Pure Avg curve
- Depth (25+): Blend Avg → Min

**Enhancement:**
- Ensure smooth interpolation (no discontinuities)
- Validate that Rank 1 > Rank 2 > Rank 3 > ... > Rank 50 (monotonic)
- Test for "jumps" in pricing curves

**Example Test:**
```typescript
it('should have smooth monotonic price curve by rank', () => {
  const positions = ['QB', 'RB', 'WR', 'TE'];

  positions.forEach(pos => {
    const prices = [];
    for (let rank = 1; rank <= 50; rank++) {
      const player = { position: pos, rank, age: 26 };
      const price = calculatePrice(player).finalPrice;
      prices.push({ rank, price });
    }

    // Validate monotonic decrease
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i].price).toBeLessThanOrEqual(prices[i-1].price);
    }

    // Validate smooth transitions (no >30% jumps)
    for (let i = 1; i < prices.length; i++) {
      const priceChange = (prices[i-1].price - prices[i].price) / prices[i-1].price;
      expect(priceChange).toBeLessThan(0.30); // No >30% jumps
    }
  });
});
```

---

## UI/UX Requirements

### Display Changes

**Before (Current):**
```
Player: Patrick Mahomes (QB, Age 28, Rank #1)

Contract Options:
1 Year: $10.8M
2 Year: $10.2M (age discount)
3 Year: $9.5M (age discount)
4 Year: $8.8M (age discount)
5 Year: $8.0M (age discount)

Recommended: 4 years (prime QB)
```

**After (Enhanced):**
```
Player: Patrick Mahomes (QB, Age 28, Rank #1)

Price Range: $8.6M - $13.0M
Base Value (3-year): $10.8M
Historical Max (QB Rank 1-5): $10.8M
Confidence: HIGH ✅ (within historical range)

Contract Options (Low → High):
5 Year: $8.6M  💰 VALUE (commit long-term, save 20%)
4 Year: $9.5M
3 Year: $10.8M  📊 EQUILIBRIUM (market rate)
2 Year: $11.9M
1 Year: $13.0M  💎 PREMIUM (flexibility, +20%)

Recommended: 4-year contract at $9.5M/year
Reason: Lock in prime QB before age 32 at below-market rate

⚠️ Note: Predicted 1-year price ($13M) exceeds historical max ($10.8M) by +20%
This may indicate market inflation or bidding war scenario.
```

**Validation Warnings in UI:**
```
Player: Derrick Henry (RB, Age 32, Rank #5)

Price Range: $2.0M - $3.0M
Base Value (3-year): $2.5M

⚠️ WARNING: Age Precedent Risk
- No RB age 32+ has maintained $2.5M salary historically
- Recommend 1-year deal only
- Consider $1.5M range based on age decline

Contract Options:
5 Year: $2.0M  ❌ AVOID (no historical precedent for RB age 37)
4 Year: $2.2M  ❌ AVOID
3 Year: $2.5M  ⚠️ RISKY (ends age 35)
2 Year: $2.7M  ⚠️ CAUTION
1 Year: $3.0M  ✅ RECOMMENDED (minimize risk)
```

---

## Technical Implementation

### Phase 1: Historical Price Analysis (4 hours)
- [ ] Query all historical salary files (2020-2025)
- [ ] Build price distribution by position + rank tier
- [ ] Calculate actual max/avg/min by tier (not just curves)
- [ ] Generate `historical-price-ranges.json`:
  ```json
  {
    "QB": {
      "elite": { "max": 10800000, "avg": 8500000, "min": 6000000, "sampleSize": 23 },
      "star": { "max": 6500000, "avg": 4200000, "min": 2500000, "sampleSize": 45 },
      "starter": { "max": 3800000, "avg": 2100000, "min": 950000, "sampleSize": 67 },
      "depth": { "max": 1200000, "avg": 650000, "min": 425000, "sampleSize": 102 }
    }
  }
  ```

### Phase 2: Redesign Contract Pricing (6 hours)
- [ ] Update `generateContractPricing()` to use range-based logic
- [ ] 5-year = low end, 1-year = high end
- [ ] Remove age depreciation from price calculation
- [ ] Move age to **recommendation logic only**
- [ ] Add range width calculation (scarcity-based)

### Phase 3: Validation Layer (4 hours)
- [ ] Create `validatePredictedPrice()` function
- [ ] Check against historical maximums
- [ ] Check age-salary precedents
- [ ] Generate confidence scores
- [ ] Flag anomalies for review

### Phase 4: Testing Framework (4 hours)
- [ ] Write validation test suite
- [ ] Test monotonic price curves
- [ ] Test historical max compliance
- [ ] Test age precedent checks
- [ ] Add developer prompt mode for anomaly review

### Phase 5: UI Updates (2 hours)
- [ ] Update contract pricing display (low → high)
- [ ] Add validation warnings to player cards
- [ ] Show confidence badges (HIGH/MEDIUM/LOW)
- [ ] Add tooltips explaining price ranges

**Total Effort:** ~20 hours

---

## Design Decisions (APPROVED)

### 1. **Price Range Width** ✅

**Decision:** Fixed ±20% around base price (3-year equilibrium)
- Example: Base $5M → Range $4M (5yr) to $6M (1yr)

**Implementation:**
```typescript
const PRICE_RANGE_PERCENT = 0.20; // Fixed 20% range for all positions

const threeYear = basePrice; // Equilibrium
const fiveYear = Math.round(basePrice * (1 - PRICE_RANGE_PERCENT)); // Low end
const oneYear = Math.round(basePrice * (1 + PRICE_RANGE_PERCENT)); // High end
```

### 2. **"Impossible" Price Threshold** ✅

**Decision:** +25% over historical max triggers test failure

**Implementation:**
```typescript
if (predicted > historicalMax * 1.25) {
  throw new ValidationError(
    `⛔ PRICE EXCEEDS HISTORICAL MAX BY +25%\n` +
    `Player: ${player.name} (${player.position}, Rank ${rank})\n` +
    `Predicted: $${predicted}\n` +
    `Historical Max: $${historicalMax}\n` +
    `Exceeds by: +${((predicted/historicalMax - 1) * 100).toFixed(1)}%`
  );
}

// Warning zone: +10% to +25%
if (predicted > historicalMax * 1.10) {
  warnings.push(`⚠️ Price exceeds historical max by +${((predicted/historicalMax - 1) * 100).toFixed(1)}%`);
  confidence = 'MEDIUM';
}
```

### 3. **Age Precedent Validation** ✅

**Decision:** Strict exact age checks (no range)

**Implementation:**
```typescript
function hasAgePrecedent(position: string, age: number, salary: number): boolean {
  // Exact age match only
  const historicalSalaries = getHistoricalSalaries(position, age);

  if (historicalSalaries.length === 0) {
    return false; // No precedent for this age
  }

  const maxSalaryAtAge = Math.max(...historicalSalaries.map(s => s.salary));
  return salary <= maxSalaryAtAge * 1.25; // Allow +25% buffer
}

// Test failure if no precedent
if (!hasAgePrecedent(player.position, player.age, predictedPrice)) {
  throw new ValidationError(
    `⛔ NO AGE PRECEDENT\n` +
    `No ${player.position} at age ${player.age} has earned $${predictedPrice} (2020-2025 data)`
  );
}
```

### 4. **Historical Data Scope** ✅

**Decision:** Use 2020-2025 only (6 years, most relevant to current market)

**Implementation:**
```typescript
const HISTORICAL_YEARS = [2020, 2021, 2022, 2023, 2024, 2025];

function loadHistoricalSalaries(): PlayerSalary[] {
  const allSalaries = [];

  for (const year of HISTORICAL_YEARS) {
    const data = require(`../../data/theleague/mfl-player-salaries-${year}.json`);
    allSalaries.push(...data.players.map(p => ({ ...p, year })));
  }

  return allSalaries;
}

// Ignore pre-2020 data (too old, different market conditions)
```

### 5. **Testing Mode** ✅

**Decision:** Auto-fail tests to constantly monitor formula

**Implementation:**
```typescript
describe('Auction Price Validation - Historical Max Checks', () => {
  it('should NEVER exceed historical max by more than 25%', () => {
    const allPlayers = generateTestPlayers(); // All positions, ranks 1-50
    const results = calculateAllPlayerPrices(allPlayers, ...);

    results.forEach(({ player, price }) => {
      const historicalMax = getHistoricalMax(player.position, player.rank);
      const exceedsBy = (price / historicalMax) - 1;

      // Auto-fail if exceeds +25%
      if (exceedsBy > 0.25) {
        throw new Error(
          `VALIDATION FAILURE: ${player.name} exceeds historical max by +${(exceedsBy * 100).toFixed(1)}%\n` +
          `Predicted: $${price}, Historical Max: $${historicalMax}`
        );
      }
    });
  });

  it('should NEVER predict prices with no age precedent', () => {
    const allPlayers = generateTestPlayers();
    const results = calculateAllPlayerPrices(allPlayers, ...);

    results.forEach(({ player, price }) => {
      const hasPrecedent = hasAgePrecedent(player.position, player.age, price);

      if (!hasPrecedent) {
        throw new Error(
          `VALIDATION FAILURE: No age precedent for ${player.name}\n` +
          `No ${player.position} at age ${player.age} has earned $${price}`
        );
      }
    });
  });
});

// Run on every CI build
npm test -- auction-price-validation.test.ts
```

### 6. **Elite Rank Premium** ✅

**Decision:** Scale from +5% for rank 1 down to 0% for rank 5 (all markets)

**Implementation:**
```typescript
function calculateEliteRankPremium(rank: number): number {
  if (rank > 5) return 0; // No premium for rank 6+

  // Linear interpolation: Rank 1 = +5%, Rank 5 = 0%
  // Formula: premium = 0.05 * ((5 - rank) / 4)
  const premium = 0.05 * ((5 - rank) / 4);

  return premium;

  // Examples:
  // Rank 1: 0.05 * (4/4) = +5.0%
  // Rank 2: 0.05 * (3/4) = +3.75%
  // Rank 3: 0.05 * (2/4) = +2.5%
  // Rank 4: 0.05 * (1/4) = +1.25%
  // Rank 5: 0.05 * (0/4) = 0%
}

// Apply to historical max
const historicalMax = getHistoricalMax(position, rankTier);
const elitePremium = calculateEliteRankPremium(rank);
const adjustedMax = historicalMax * (1 + elitePremium);

// Rank 1 player can now be up to +5% above historical max
// This + 25% validation threshold = Rank 1 can be up to +30% total if justified
```

### 7. **Hybrid Tier System: Overall Rank + Positional Quality** ✅

**Decision:** Use overall rank to determine tier, then best player at position determines historical curve for all players at that position

#### Tier Classification (Overall Rank)
```typescript
function getOverallRankTier(overallRank: number): 'elite' | 'star' | 'starter' | 'depth' {
  if (overallRank <= 30) return 'elite';    // Ranks 1-30: Elite tier
  if (overallRank <= 105) return 'star';    // Ranks 31-105: Star tier (next 75)
  if (overallRank <= 149) return 'starter'; // Ranks 106-149: Starter tier
  return 'depth';                            // Ranks 150+: Depth tier
}
```

#### Historical Curve Selection (Best Player at Position)
```typescript
function selectHistoricalCurveForPosition(
  position: string,
  availablePlayers: PlayerValuation[]
): 'max' | 'avg' | 'min' {

  // Find best player available at this position
  const positionPlayers = availablePlayers
    .filter(p => p.position === position)
    .sort((a, b) => (a.compositeRank || 999) - (b.compositeRank || 999));

  if (positionPlayers.length === 0) return 'min';

  const bestPlayerAtPosition = positionPlayers[0];
  const bestPlayerTier = getOverallRankTier(bestPlayerAtPosition.compositeRank || 999);

  // Best player's tier determines curve for ALL players at this position
  if (bestPlayerTier === 'elite') {
    return 'max'; // Elite player available → MAX historical prices
  } else if (bestPlayerTier === 'star') {
    return 'avg'; // Best is Star tier → AVG historical prices
  } else {
    return 'min'; // Best is Starter/Depth → MIN historical prices
  }
}
```

#### Examples

**Scenario 1: Elite QB available**
```
Best QB: Patrick Mahomes (Overall Rank #2, Elite tier)
→ ALL QBs use MAX historical curve

QB1 (Mahomes, Rank #2): MAX curve at rank #2
QB4 (Herbert, Rank #35 Star): MAX curve at rank #35 (benefits from elite class)
```

**Scenario 2: Weak QB class (no elite QBs)**
```
Best QB: Geno Smith (Overall Rank #42, Star tier)
→ ALL QBs use AVG historical curve

QB1 (Geno, Rank #42): AVG curve at rank #42 (lower prices than elite class)
QB3 (Baker, Rank #91): AVG curve at rank #91
```

**Scenario 3: Terrible QB class (no elite or star QBs)**
```
Best QB: Jacoby Brissett (Overall Rank #127, Starter tier)
→ ALL QBs use MIN historical curve

QB1 (Brissett, Rank #127): MIN curve at rank #127 (bargain prices)
QB2 (Mac Jones, Rank #156 Depth): MIN curve at rank #156 (very cheap)
```

**Scenario 4: Elite WRs vs Weak RBs (positional strategy)**
```
Best WR: Justin Jefferson (Rank #1, Elite) → ALL WRs use MAX curve
Best RB: Miles Sanders (Rank #110, Starter) → ALL RBs use MIN curve

Result: WRs expensive, RBs cheap → "Punt RB, load up on WRs" strategy
```

#### Why This Works

1. **Overall rank prevents position bias**: A QB ranked #32 overall is NOT elite, even if he's the best QB available
2. **Positional quality matters**: If all available QBs are ranked 100+, the entire QB position is devalued in this auction
3. **Creates strategic opportunities**: Weak positional classes = bargain hunting opportunities
4. **Reflects real auction dynamics**: When elite talent is scarce at a position, prices drop across the board

---

### 8. **Tier-Based Price Floors** ✅

**Decision:** Apply price floors by tier to prevent excessive decay and keep elite players clustered together

**Problem:** Exponential decay spreads elite players too far apart
```
Current (without floors):
WR1 (Rank #1): $17.6M
WR2 (Rank #4): $10.4M (41% drop) ❌ Too much spread
WR3 (Rank #8): $5.3M (70% drop) ❌ Way too low

Desired (with floors):
WR1 (Rank #1): $17.6M
WR2 (Rank #4): $14.3M (19% drop) ✅ Tight clustering
WR3 (Rank #8): $14.3M (19% drop) ✅ All elite WRs near top
```

**Implementation:**
```typescript
/**
 * Tier-Based Price Floors
 *
 * Prevents elite players from decaying too far from historical max
 * Keeps players in same tier clustered together at appropriate price level
 */

const TIER_PRICE_FLOORS = {
  elite: 0.85,    // Elite (1-30): Cannot drop below 85% of position historical max
  star: 0.60,     // Star (31-105): Cannot drop below 60% of position historical max
  starter: 0.30,  // Starter (106-149): Cannot drop below 30% of position historical max
  depth: 0.00,    // Depth (150+): No floor, normal decay applies
};

function applyTierPriceFloor(
  calculatedPrice: number,
  overallRank: number,
  positionHistoricalMax: number
): number {

  const tier = getOverallRankTier(overallRank);
  const floorPercent = TIER_PRICE_FLOORS[tier];
  const priceFloor = positionHistoricalMax * floorPercent;

  // Return the HIGHER of: calculated price OR tier floor
  return Math.max(calculatedPrice, priceFloor);
}

// Example Usage in Price Calculation:
function calculateIntrinsicValue(player: PlayerValuation, ...): number {
  // Step 1: Get historical curve and calculate base price
  const historicalMax = getHistoricalMax(player.position, curveType);
  const curvePrice = historicalMax * Math.exp(decayRate * (rank - 1));

  // Step 2: Apply elite rank premium (ranks 1-5 only)
  const elitePremium = calculateEliteRankPremium(rank);
  const priceWithPremium = curvePrice * (1 + elitePremium);

  // Step 3: Apply tier-based price floor
  const finalPrice = applyTierPriceFloor(
    priceWithPremium,
    player.compositeRank,
    historicalMax
  );

  return finalPrice;
}
```

**Example: Elite WR Clustering**
```
Position: WR
Historical Max (MAX curve): $16.8M

WR1: Justin Jefferson (Overall Rank #1, Elite tier)
  - Curve value: $16.8M * e^(-0.1636 * 0) = $16.8M
  - Elite premium: +5%
  - Price with premium: $17.64M
  - Elite floor: $16.8M * 0.85 = $14.28M
  - Final: max($17.64M, $14.28M) = $17.64M ✅ (premium > floor)

WR2: Ja'Marr Chase (Overall Rank #4, Elite tier)
  - Curve value: $16.8M * e^(-0.1636 * 3) = $10.28M
  - Elite premium: +1.25%
  - Price with premium: $10.41M
  - Elite floor: $16.8M * 0.85 = $14.28M
  - Final: max($10.41M, $14.28M) = $14.28M ✅ (floor applied)

WR3: CeeDee Lamb (Overall Rank #8, Elite tier)
  - Curve value: $16.8M * e^(-0.1636 * 7) = $5.34M
  - Elite premium: 0% (rank > 5)
  - Price with premium: $5.34M
  - Elite floor: $16.8M * 0.85 = $14.28M
  - Final: max($5.34M, $14.28M) = $14.28M ✅ (floor applied)

WR4: Amon-Ra St. Brown (Overall Rank #35, Star tier)
  - Curve value: $16.8M * e^(-0.1636 * 34) = $0.65M
  - Elite premium: 0%
  - Price with premium: $0.65M
  - Star floor: $16.8M * 0.60 = $10.08M
  - Final: max($0.65M, $10.08M) = $10.08M ✅ (star floor applied)

Result: Elite WRs cluster at $14.3M - $17.6M (tight 19% spread)
        Star WRs cluster at $10.1M+ (clear tier separation)
```

**Benefits:**
1. **Elite clustering**: All elite players at same position price similarly (within 15-20%)
2. **Clear tier separation**: Elite ($14-18M) vs Star ($10-14M) vs Starter ($5-10M) vs Depth (<$5M)
3. **Prevents absurd decay**: Rank #30 elite player doesn't price like depth player
4. **Respects overall rank**: Tier floors based on overall rank, not positional rank

**Floor Percentages by Tier:**

| Tier | Overall Ranks | Floor (% of Position Max) | Example (WR Max $16.8M) |
|------|---------------|---------------------------|-------------------------|
| **Elite** | 1-30 | **85%** | Min $14.3M |
| **Star** | 31-105 | **60%** | Min $10.1M |
| **Starter** | 106-149 | **30%** | Min $5.0M |
| **Depth** | 150+ | **0%** (No floor) | Normal decay |

---

### 9. **Market Budget Constraint** ✅

**Decision:** Apply market-wide budget constraint to ensure predicted prices are affordable given total available cap space

**Problem:** Predicted prices must be realistic given the total money available in the market

**Concept:**
```
Total Available Cap Space (all 16 teams): $160M
Total Roster Spots to Fill (to get all teams to 22): 200 spots
Average Affordable Price: $160M / 200 = $800K per player

If we predict 10 elite players at $15M each = $150M
Then remaining 190 players must average $52K each ❌ IMPOSSIBLE (below minimum)

The market cannot sustain those elite prices - need to adjust downward
```

**Implementation:**
```typescript
/**
 * Market Budget Constraint
 *
 * Ensures total predicted prices don't exceed total available cap space
 * Prevents unrealistic pricing where elite players consume entire market
 */

interface MarketBudgetConstraint {
  totalAvailableCap: number;        // Sum of all team cap space for 2026
  totalRosterSpotsNeeded: number;   // Total players needed to fill all rosters to 22
  averageAffordablePrice: number;   // totalCap / totalSpots
  marketPressure: number;           // Multiplier to adjust prices based on scarcity
}

function calculateMarketBudgetConstraint(
  teamCapSituations: TeamCapSituation[]
): MarketBudgetConstraint {

  // Step 1: Calculate total available cap across all teams
  let totalAvailableCap = 0;
  let totalRosterSpotsNeeded = 0;

  teamCapSituations.forEach(team => {
    // Use exact cap space calculation from roster page
    // Account for: escalated salaries, dead money, draft picks, franchise tags
    const availableCap = team.projectedCapSpace2026 - team.franchiseTagCommitment;

    totalAvailableCap += availableCap;

    // Calculate roster spots to fill (target: 22 players per team)
    const currentRosterSize = team.rosterSize || 0;
    const spotsToFill = Math.max(0, 22 - currentRosterSize);
    totalRosterSpotsNeeded += spotsToFill;
  });

  // Step 2: Calculate average affordable price
  const averageAffordablePrice = totalRosterSpotsNeeded > 0
    ? totalAvailableCap / totalRosterSpotsNeeded
    : 0;

  // Step 3: Calculate market pressure
  // If average affordable price is LOW relative to historical norms → tight market (prices deflate)
  // If average affordable price is HIGH relative to historical norms → loose market (prices inflate)

  const HISTORICAL_AVERAGE_PRICE = 2_000_000; // ~$2M historical average
  const marketPressure = averageAffordablePrice / HISTORICAL_AVERAGE_PRICE;

  return {
    totalAvailableCap,
    totalRosterSpotsNeeded,
    averageAffordablePrice,
    marketPressure,
  };
}

/**
 * Apply market budget constraint to predicted price
 */
function applyMarketBudgetConstraint(
  predictedPrice: number,
  marketConstraint: MarketBudgetConstraint
): number {

  // If market pressure < 1.0 → Tight budget, need to deflate prices
  // If market pressure > 1.0 → Loose budget, prices can inflate

  if (marketConstraint.marketPressure < 0.8) {
    // Very tight market: Cap space is scarce
    // Apply stronger deflation to keep total spending within budget
    const deflationFactor = 0.7 + (marketConstraint.marketPressure * 0.25);
    return predictedPrice * deflationFactor;

  } else if (marketConstraint.marketPressure > 1.2) {
    // Very loose market: Lots of cap space available
    // Allow modest inflation
    const inflationFactor = 1.0 + ((marketConstraint.marketPressure - 1.0) * 0.1);
    return predictedPrice * Math.min(inflationFactor, 1.15); // Cap at +15%
  }

  // Normal market: No adjustment needed
  return predictedPrice;
}
```

**Example: Tight Market Scenario**
```
League State (2026):
- Total Available Cap: $120M (low, many teams against cap)
- Total Roster Spots Needed: 180 spots
- Average Affordable Price: $120M / 180 = $667K

Market Pressure: $667K / $2M = 0.33 (VERY TIGHT)

Predicted Price Before Constraint: $15M (elite WR)
Deflation Factor: 0.7 + (0.33 * 0.25) = 0.78
Adjusted Price: $15M * 0.78 = $11.7M

Result: Elite players deflate because market can't sustain high prices
        More players forced to lower prices to fit budgets
```

**Example: Loose Market Scenario**
```
League State (2026):
- Total Available Cap: $200M (high, many teams with space)
- Total Roster Spots Needed: 150 spots
- Average Affordable Price: $200M / 150 = $1.33M

Market Pressure: $1.33M / $2M = 0.67 (MODERATE)

Predicted Price Before Constraint: $8M (star RB)
No adjustment needed (market pressure in normal range 0.8-1.2)
Final Price: $8M

Result: Normal market conditions, prices stay as predicted
```

**Example: Validation Check**
```
After applying all price adjustments, validate total:

Predicted Prices for All Free Agents:
- 10 elite players @ $12M avg = $120M
- 20 star players @ $8M avg = $160M
- 50 starter players @ $3M avg = $150M
- 100 depth players @ $600K avg = $60M
Total Predicted Spend: $490M

Available Budget: $120M ❌ EXCEEDS by $370M

Action: Apply stronger market constraint multiplier
- Reduce all prices by 75% to fit budget: $490M * 0.245 = $120M
- Elite now: $12M * 0.245 = $2.94M
- Star now: $8M * 0.245 = $1.96M
- Starter now: $3M * 0.245 = $735K
- Depth now: $600K * 0.245 = $147K ❌ Below minimum

This reveals a CRITICAL ISSUE: Not enough cap space to fill all rosters
→ Flag for user: "WARNING: League cap space insufficient to fill all rosters"
```

**Integration with Existing Calculations:**
```typescript
// In calculateAllPlayerPrices():
function calculateAllPlayerPrices(
  availablePlayers: PlayerValuation[],
  teamCapSituations: TeamCapSituation[],
  factors: AuctionPriceFactors
): Map<string, PriceResult> {

  // Step 1: Calculate market budget constraint
  const marketConstraint = calculateMarketBudgetConstraint(teamCapSituations);

  // Step 2: Calculate base prices for all players (existing logic)
  const basePrices = new Map();
  for (const player of availablePlayers) {
    const basePrice = calculateIntrinsicValue(player, factors, ...);
    basePrices.set(player.id, basePrice);
  }

  // Step 3: Calculate total predicted spend
  const totalPredictedSpend = Array.from(basePrices.values()).reduce((sum, p) => sum + p, 0);

  // Step 4: If total exceeds available cap, apply constraint
  let constraintMultiplier = 1.0;
  if (totalPredictedSpend > marketConstraint.totalAvailableCap) {
    // Need to deflate all prices to fit budget
    constraintMultiplier = marketConstraint.totalAvailableCap / totalPredictedSpend;

    console.warn(
      `⚠️ MARKET CONSTRAINT APPLIED\n` +
      `Total Predicted: $${totalPredictedSpend.toLocaleString()}\n` +
      `Available Cap: $${marketConstraint.totalAvailableCap.toLocaleString()}\n` +
      `Deflating prices by ${((1 - constraintMultiplier) * 100).toFixed(1)}%`
    );
  }

  // Step 5: Apply constraint to all prices
  const finalPrices = new Map();
  for (const [playerId, basePrice] of basePrices.entries()) {
    const constrainedPrice = basePrice * constraintMultiplier;
    finalPrices.set(playerId, constrainedPrice);
  }

  return finalPrices;
}
```

**Benefits:**
1. **Realistic pricing**: Ensures total predicted spending fits available budget
2. **Market dynamics**: Accounts for league-wide cap space scarcity
3. **Early warning**: Flags when cap space is insufficient to fill rosters
4. **Proportional adjustment**: Deflates all prices proportionally to maintain relative values

**Use Existing Roster Page Logic:**
- Reuse `calculateAvailableCap()` function from roster page
- Uses same escalation rates (10% annual)
- Accounts for dead money, draft picks, franchise tags
- Consistent with what users already see on roster pages

---

## Approved Design Decisions Summary

✅ **1. Price range width:** Fixed ±20% for all positions
✅ **2. "Impossible" threshold:** +25% over historical max = test failure
✅ **3. Elite rank premium:** Scale +5% (rank 1) to 0% (rank 5)
✅ **4. Historical data scope:** 2020-2025 only (6 years)
✅ **5. Age precedent:** Strict exact age checks (no range)
✅ **6. Tier system:** Hybrid overall rank tiers (Elite: 1-30, Star: 31-105, Starter: 106-149, Depth: 150+)
✅ **7. Curve selection:** Best player at position determines curve for all players at that position (Elite→MAX, Star→AVG, Starter/Depth→MIN)
✅ **8. Tier-based price floors:** Elite 85%, Star 60%, Starter 30%, Depth 0% (prevents excessive decay)
✅ **9. Market budget constraint:** Total predicted prices cannot exceed total available cap space (proportional deflation if needed)
✅ **10. Testing mode:** Auto-fail tests on every CI build

---

## Next Steps

1. **Review this PRD** - Clarify any misunderstandings
2. **Answer open questions** - Provide guidance on design decisions
3. **Approve requirements** - Sign off on scope
4. **Begin implementation** - Start with Phase 1 (Historical Price Analysis)

**Estimated Timeline:** 3-4 days for full implementation

---

## Appendix: Example Scenarios

### Scenario 1: Elite Young Player
```
Player: Ja'Marr Chase (WR, Age 24, Rank #3)
Historical Max (WR Elite): $16.8M
Predicted Base: $15.2M (within historical range)

Price Range: $12.2M - $18.3M (±20%)
5 Year: $12.2M  💰 STEAL (lock in young star long-term)
3 Year: $15.2M  📊 MARKET RATE
1 Year: $18.3M  💎 PREMIUM (bet on continued growth)

Validation: ✅ HIGH CONFIDENCE
- Within historical range
- Strong age precedent (24-year-old WRs at $12-18M)
- Recommended: 5-year deal to maximize value
```

### Scenario 2: Aging Star with No Precedent
```
Player: Travis Kelce (TE, Age 35, Rank #2)
Historical Max (TE Elite): $8.6M
Predicted Base: $6.5M (age-adjusted)

Price Range: $5.2M - $7.8M

⚠️ VALIDATION WARNINGS:
- No TE age 35+ has earned $5M+ in dataset
- Recommend 1-year deal only
- Consider reducing to $3-4M range

Adjusted Range: $2.4M - $3.6M
1 Year: $3.6M  ✅ RECOMMENDED (prove-it deal)
2 Year: $3.1M  ⚠️ RISKY
3-5 Year: ❌ AVOID (no precedent)

Validation: ⚠️ MEDIUM CONFIDENCE
- Age precedent risk
- Recommend conservative pricing
```

### Scenario 3: Mid-Tier in Deep Market
```
Player: Tyler Lockett (WR, Age 28, Rank #18)
Historical Avg (WR Starter): $10.5M
Predicted Base: $8.2M

Market Context: 10 WRs ranked higher available (deep market)
Scarcity: LOW (many alternatives)

Price Range: $6.6M - $9.8M (±20%)
5 Year: $6.6M  💰 GOOD VALUE
3 Year: $8.2M  📊 FAIR
1 Year: $9.8M  💎 SLIGHT OVERPAY

Validation: ✅ HIGH CONFIDENCE
- Within historical range
- Deep market = value opportunities
- Strategy: Target 5-year deal, may get cheaper than predicted
```

---

**End of PRD**
