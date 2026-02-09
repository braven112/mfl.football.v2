# Auction Predictor Pricing Enhancement - Implementation Tasks

**Status:** Ready for Implementation
**Estimated Total Effort:** 18-22 hours
**Target Completion:** 3-4 days

---

## Phase 1: Historical Price Analysis & Data Generation (6 hours)

### Task 1.1: Build Historical Salary Aggregator (2 hours)
**File:** `src/scripts/analyze-historical-salaries.ts`

**Requirements:**
- Load salary data from 2020-2025 (6 years only)
- Parse player salaries by position, age, and rank
- Calculate actual max/avg/min by position + rank tier

**Deliverables:**
```typescript
interface HistoricalSalaryData {
  position: string;
  age: number;
  salary: number;
  year: number;
  playerId: string;
  playerName: string;
  rank?: number; // If available in source data
}

function loadHistoricalSalaries(): HistoricalSalaryData[] {
  const YEARS = [2020, 2021, 2022, 2023, 2024, 2025];
  const allSalaries: HistoricalSalaryData[] = [];

  for (const year of YEARS) {
    const filePath = `../../data/theleague/mfl-player-salaries-${year}.json`;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    data.players.forEach(player => {
      allSalaries.push({
        position: player.position,
        age: calculateAge(player.birthdate, year),
        salary: player.salary,
        year,
        playerId: player.id,
        playerName: player.name,
      });
    });
  }

  return allSalaries;
}
```

**Testing:**
- ✅ Verify all 6 years load successfully
- ✅ Validate data structure (no missing fields)
- ✅ Count total players per year (~400-500 expected)

---

### Task 1.2: Generate Historical Price Ranges by Tier (3 hours)
**File:** `src/scripts/generate-historical-price-ranges.ts`

**Requirements:**
- Group salaries by position + rank tier (Elite/Star/Starter/Depth)
- Calculate max/avg/min for each tier
- Generate age-specific salary precedents

**Deliverables:**
```typescript
interface HistoricalPriceRange {
  position: string;
  tier: 'elite' | 'star' | 'starter' | 'depth';
  rankRange: [number, number]; // e.g., [1, 5] for elite
  max: number;
  avg: number;
  min: number;
  sampleSize: number;
  yearsSpan: string; // "2020-2025"
}

interface AgeSalaryPrecedent {
  position: string;
  age: number;
  maxSalary: number;
  avgSalary: number;
  sampleSize: number;
  playerExamples: string[]; // Top 3 player names at this age
}

// Generate output files
const priceRanges = calculatePriceRanges(salaries);
const agePrecedents = calculateAgePrecedents(salaries);

fs.writeFileSync('data/theleague/historical-price-ranges.json',
  JSON.stringify(priceRanges, null, 2));

fs.writeFileSync('data/theleague/age-salary-precedents.json',
  JSON.stringify(agePrecedents, null, 2));
```

**Output Example:**
```json
{
  "QB": {
    "elite": {
      "tier": "elite",
      "rankRange": [1, 5],
      "max": 10764554,
      "avg": 8200000,
      "min": 6000000,
      "sampleSize": 23,
      "yearsSpan": "2020-2025"
    },
    "star": {
      "tier": "star",
      "rankRange": [6, 12],
      "max": 6500000,
      "avg": 4200000,
      "min": 2500000,
      "sampleSize": 45,
      "yearsSpan": "2020-2025"
    }
  }
}
```

**Testing:**
- ✅ Verify sample sizes are reasonable (>10 per tier)
- ✅ Validate max > avg > min for all tiers
- ✅ Check for missing positions or tiers

---

### Task 1.3: Run Analysis Script & Commit Data (1 hour)
**Commands:**
```bash
npm run analyze:historical-salaries
# Generates:
# - data/theleague/historical-price-ranges.json
# - data/theleague/age-salary-precedents.json

git add data/theleague/historical-price-ranges.json
git add data/theleague/age-salary-precedents.json
git commit -m "feat: add historical price ranges and age precedents (2020-2025)"
```

**Validation:**
- ✅ Files generated successfully
- ✅ JSON is valid and formatted
- ✅ File sizes reasonable (<100KB each)

---

## Phase 2: Update Pricing Algorithm (6 hours)

### Task 2.1: Add Tier Classification and Curve Selection (2 hours)
**File:** `src/utils/auction-price-calculator.ts`

**Requirements:**
- Classify players by overall rank tier (Elite/Star/Starter/Depth)
- Determine best player at each position
- Select historical curve based on best player's tier

**Implementation:**
```typescript
/**
 * Tier Classification based on Overall Rank
 */
export function getOverallRankTier(overallRank: number): 'elite' | 'star' | 'starter' | 'depth' {
  if (overallRank <= 30) return 'elite';    // Ranks 1-30: Elite tier
  if (overallRank <= 105) return 'star';    // Ranks 31-105: Star tier (next 75)
  if (overallRank <= 149) return 'starter'; // Ranks 106-149: Starter tier
  return 'depth';                            // Ranks 150+: Depth tier
}

/**
 * Historical Curve Selection based on Best Player at Position
 *
 * If best QB is Elite tier → ALL QBs use MAX curve
 * If best QB is Star tier → ALL QBs use AVG curve
 * If best QB is Starter/Depth tier → ALL QBs use MIN curve
 */
export function selectHistoricalCurveForPosition(
  position: string,
  availablePlayers: PlayerValuation[]
): 'max' | 'avg' | 'min' {

  // Find best player available at this position
  const positionPlayers = availablePlayers
    .filter(p => p.position === position)
    .sort((a, b) => (a.compositeRank || 999) - (b.compositeRank || 999));

  if (positionPlayers.length === 0) return 'min'; // No players → minimum curve

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

/**
 * Calculate positional metadata
 */
export function getPositionalMetadata(
  player: PlayerValuation,
  availablePlayers: PlayerValuation[]
): {
  playerTier: 'elite' | 'star' | 'starter' | 'depth';
  bestAtPosition: PlayerValuation;
  bestPlayerTier: 'elite' | 'star' | 'starter' | 'depth';
  curveType: 'max' | 'avg' | 'min';
} {
  const playerTier = getOverallRankTier(player.compositeRank || 999);

  const positionPlayers = availablePlayers
    .filter(p => p.position === player.position)
    .sort((a, b) => (a.compositeRank || 999) - (b.compositeRank || 999));

  const bestAtPosition = positionPlayers[0] || player;
  const bestPlayerTier = getOverallRankTier(bestAtPosition.compositeRank || 999);
  const curveType = selectHistoricalCurveForPosition(player.position, availablePlayers);

  return { playerTier, bestAtPosition, bestPlayerTier, curveType };
}
```

**Testing:**
```typescript
describe('Tier Classification', () => {
  it('should classify ranks 1-30 as elite', () => {
    expect(getOverallRankTier(1)).toBe('elite');
    expect(getOverallRankTier(15)).toBe('elite');
    expect(getOverallRankTier(30)).toBe('elite');
  });

  it('should classify ranks 31-105 as star', () => {
    expect(getOverallRankTier(31)).toBe('star');
    expect(getOverallRankTier(68)).toBe('star');
    expect(getOverallRankTier(105)).toBe('star');
  });

  it('should classify ranks 106-149 as starter', () => {
    expect(getOverallRankTier(106)).toBe('starter');
    expect(getOverallRankTier(127)).toBe('starter');
    expect(getOverallRankTier(149)).toBe('starter');
  });

  it('should classify ranks 150+ as depth', () => {
    expect(getOverallRankTier(150)).toBe('depth');
    expect(getOverallRankTier(200)).toBe('depth');
  });
});

describe('Curve Selection', () => {
  it('should use MAX curve when best QB is elite tier', () => {
    const players = [
      { id: '1', position: 'QB', compositeRank: 2 },  // Elite QB
      { id: '2', position: 'QB', compositeRank: 35 }, // Star QB
      { id: '3', position: 'QB', compositeRank: 120 }, // Starter QB
    ];

    const curve = selectHistoricalCurveForPosition('QB', players);
    expect(curve).toBe('max'); // Best QB is Elite → MAX curve for all QBs
  });

  it('should use AVG curve when best QB is star tier', () => {
    const players = [
      { id: '1', position: 'QB', compositeRank: 42 }, // Star QB (best available)
      { id: '2', position: 'QB', compositeRank: 91 }, // Star QB
      { id: '3', position: 'QB', compositeRank: 120 }, // Starter QB
    ];

    const curve = selectHistoricalCurveForPosition('QB', players);
    expect(curve).toBe('avg'); // Best QB is Star → AVG curve
  });

  it('should use MIN curve when best QB is starter/depth tier', () => {
    const players = [
      { id: '1', position: 'QB', compositeRank: 127 }, // Starter QB (best available)
      { id: '2', position: 'QB', compositeRank: 156 }, // Depth QB
    ];

    const curve = selectHistoricalCurveForPosition('QB', players);
    expect(curve).toBe('min'); // Best QB is Starter → MIN curve
  });

  it('should allow different curves for different positions', () => {
    const players = [
      { id: '1', position: 'WR', compositeRank: 1 },   // Elite WR
      { id: '2', position: 'RB', compositeRank: 110 }, // Starter RB (best at position)
    ];

    expect(selectHistoricalCurveForPosition('WR', players)).toBe('max');
    expect(selectHistoricalCurveForPosition('RB', players)).toBe('min');
    // Result: WRs expensive, RBs cheap → positional strategy
  });
});
```

---

### Task 2.2: Add Tier-Based Price Floors (1.5 hours)
**File:** `src/utils/auction-price-calculator.ts`

**Requirements:**
- Apply price floors by tier to prevent excessive decay
- Elite (1-30): 85% of historical max
- Star (31-105): 60% of historical max
- Starter (106-149): 30% of historical max
- Depth (150+): No floor (0%)

**Implementation:**
```typescript
/**
 * Tier-Based Price Floors
 *
 * Prevents elite players from decaying too far from position historical max
 * Ensures players in same tier cluster together at appropriate price level
 */

export const TIER_PRICE_FLOORS = {
  elite: 0.85,    // Cannot drop below 85% of position max
  star: 0.60,     // Cannot drop below 60% of position max
  starter: 0.30,  // Cannot drop below 30% of position max
  depth: 0.00,    // No floor, normal decay
};

export function applyTierPriceFloor(
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

// Update calculateIntrinsicValue to apply floor:
function calculateIntrinsicValue(
  player: PlayerValuation,
  factors: AuctionPriceFactors,
  curvesSource?: Record<string, PositionCurves>
): number {

  // Step 1: Get historical curve and calculate base price
  const normalizedPos = player.position?.toUpperCase();
  const positionCurves = curvesSource ? curvesSource[normalizedPos] : curves[normalizedPos];

  const curveType = selectHistoricalCurveForPosition(player.position, availablePlayers);
  const curve = positionCurves[curveType]; // max, avg, or min

  // Calculate price from exponential decay
  const rank = player.compositeRank || 999;
  const curvePrice = curve.basePrice * Math.exp(curve.decayRate * (rank - 1));

  // Step 2: Apply elite rank premium (ranks 1-5 only)
  const elitePremium = calculateEliteRankPremium(rank);
  const priceWithPremium = curvePrice * (1 + elitePremium);

  // Step 3: Apply tier-based price floor
  const historicalMax = positionCurves.max.basePrice; // Always use max as floor reference
  const finalPrice = applyTierPriceFloor(
    priceWithPremium,
    rank,
    historicalMax
  );

  return Math.max(LEAGUE_MINIMUM, finalPrice);
}
```

**Testing:**
```typescript
describe('Tier-Based Price Floors', () => {
  it('should apply 85% floor for elite tier players', () => {
    const historicalMax = 16_800_000; // WR max
    const calculatedPrice = 5_000_000; // Low due to decay
    const rank = 8; // Elite tier

    const result = applyTierPriceFloor(calculatedPrice, rank, historicalMax);

    const expectedFloor = historicalMax * 0.85; // $14.28M
    expect(result).toBe(expectedFloor);
    expect(result).toBeGreaterThan(calculatedPrice); // Floor was applied
  });

  it('should NOT apply floor if calculated price already above floor', () => {
    const historicalMax = 16_800_000;
    const calculatedPrice = 17_640_000; // High price (rank 1 with premium)
    const rank = 1; // Elite tier

    const result = applyTierPriceFloor(calculatedPrice, rank, historicalMax);

    expect(result).toBe(calculatedPrice); // Price unchanged (already above floor)
  });

  it('should apply 60% floor for star tier players', () => {
    const historicalMax = 16_800_000;
    const calculatedPrice = 650_000; // Very low due to decay
    const rank = 35; // Star tier

    const result = applyTierPriceFloor(calculatedPrice, rank, historicalMax);

    const expectedFloor = historicalMax * 0.60; // $10.08M
    expect(result).toBe(expectedFloor);
  });

  it('should apply 30% floor for starter tier players', () => {
    const historicalMax = 16_800_000;
    const calculatedPrice = 2_000_000;
    const rank = 120; // Starter tier

    const result = applyTierPriceFloor(calculatedPrice, rank, historicalMax);

    const expectedFloor = historicalMax * 0.30; // $5.04M
    expect(result).toBe(expectedFloor);
  });

  it('should NOT apply floor for depth tier players', () => {
    const historicalMax = 16_800_000;
    const calculatedPrice = 500_000; // Low price, normal decay
    const rank = 200; // Depth tier

    const result = applyTierPriceFloor(calculatedPrice, rank, historicalMax);

    expect(result).toBe(calculatedPrice); // No floor applied (depth tier has 0% floor)
  });

  it('should cluster elite WRs together', () => {
    const wrMax = 16_800_000;

    // Simulate 3 elite WRs with different decay prices
    const wr1 = applyTierPriceFloor(17_640_000, 1, wrMax); // $17.64M (above floor)
    const wr2 = applyTierPriceFloor(10_410_000, 4, wrMax); // $10.41M → floored to $14.28M
    const wr3 = applyTierPriceFloor(5_340_000, 8, wrMax);  // $5.34M → floored to $14.28M

    expect(wr1).toBe(17_640_000); // Rank 1 with premium
    expect(wr2).toBe(14_280_000); // Floored at 85%
    expect(wr3).toBe(14_280_000); // Floored at 85%

    // Verify tight clustering (all within 19% of max)
    const spread = (wr1 - wr3) / wr1;
    expect(spread).toBeLessThan(0.20); // Less than 20% spread
  });
});
```

---

### Task 2.3: Add Elite Rank Premium (0.5 hours)
**File:** `src/utils/auction-price-calculator.ts`

**Requirements:**
- Scale +5% for rank 1 down to 0% for rank 5
- Apply before tier floor calculation

**Implementation:**
```typescript
export function calculateEliteRankPremium(rank: number): number {
  if (rank > 5) return 0;

  // Linear interpolation: Rank 1 = +5%, Rank 5 = 0%
  const premium = 0.05 * ((5 - rank) / 4);
  return premium;
}

// Usage in calculateIntrinsicValue:
const historicalMax = getHistoricalMax(position, rankTier);
const elitePremium = calculateEliteRankPremium(rank);
const adjustedMax = historicalMax * (1 + elitePremium);
```

**Testing:**
```typescript
it('should calculate elite rank premium correctly', () => {
  expect(calculateEliteRankPremium(1)).toBeCloseTo(0.05); // +5%
  expect(calculateEliteRankPremium(2)).toBeCloseTo(0.0375); // +3.75%
  expect(calculateEliteRankPremium(3)).toBeCloseTo(0.025); // +2.5%
  expect(calculateEliteRankPremium(4)).toBeCloseTo(0.0125); // +1.25%
  expect(calculateEliteRankPremium(5)).toBe(0); // 0%
  expect(calculateEliteRankPremium(6)).toBe(0); // No premium
});
```

---

### Task 2.4: Redesign Contract Pricing (Price Ranges) (3 hours)
**File:** `src/utils/auction-price-calculator.ts`

**Requirements:**
- Remove age depreciation from contract pricing
- Implement fixed ±20% price range
- 5-year = low end, 1-year = high end

**Current Implementation (DELETE):**
```typescript
// OLD: Age-based depreciation
const twoYear = Math.round(basePrice * (1 - getAgeDepreciation(currentAge, 2)));
const threeYear = Math.round(basePrice * (1 - getAgeDepreciation(currentAge, 3)));
```

**New Implementation (REPLACE WITH):**
```typescript
const PRICE_RANGE_PERCENT = 0.20; // Fixed ±20%

export function generateContractPricing(
  player: PlayerValuation,
  basePrice: number, // This is the 3-year equilibrium price
  ageMultiplier: number // Only used for recommendations, NOT pricing
): ContractPricing {

  // 3-year = equilibrium (market rate)
  const threeYear = basePrice;

  // 5-year = low end (commitment discount)
  const fiveYear = Math.round(basePrice * (1 - PRICE_RANGE_PERCENT));

  // 4-year = interpolated
  const fourYear = Math.round(basePrice * (1 - PRICE_RANGE_PERCENT / 2));

  // 2-year = interpolated
  const twoYear = Math.round(basePrice * (1 + PRICE_RANGE_PERCENT / 2));

  // 1-year = high end (flexibility premium)
  const oneYear = Math.round(basePrice * (1 + PRICE_RANGE_PERCENT));

  // Recommended contract length based on age (NOT price)
  const recommended = recommendContractLength(player, basePrice, ageMultiplier);

  return {
    oneYear,   // $6M - HIGH (premium)
    twoYear,   // $5.5M
    threeYear, // $5M - EQUILIBRIUM
    fourYear,  // $4.5M
    fiveYear,  // $4M - LOW (value)
    recommended,
  };
}
```

**Update Recommendation Logic (Age-Based):**
```typescript
function recommendContractLength(
  player: PlayerValuation,
  basePrice: number,
  ageMultiplier: number
): { years: number; price: number; reason: string } {

  const age = player.age;
  const position = player.position;

  // Age-based recommendations (NOT price-based)

  // Young elite: Lock up long-term
  if (age <= 25 && basePrice >= 10_000_000) {
    return {
      years: 5,
      price: prices.fiveYear,
      reason: 'Young elite talent - maximize long-term value at discounted rate',
    };
  }

  // Young valuable: 4-year deal
  if (age <= 26 && basePrice >= 5_000_000) {
    return {
      years: 4,
      price: prices.fourYear,
      reason: 'Young and productive - lock in 4 years before prime at value price',
    };
  }

  // Prime age: 3-year equilibrium
  if (age >= 27 && age <= 29) {
    return {
      years: 3,
      price: prices.threeYear,
      reason: 'Prime years - 3-year deal balances value and risk',
    };
  }

  // Aging: 2-year max
  if (age >= 30 && age <= 31) {
    return {
      years: 2,
      price: prices.twoYear,
      reason: 'Aging player - limit risk with 2-year deal',
    };
  }

  // Veterans: 1-year only
  if (age >= 32) {
    return {
      years: 1,
      price: prices.oneYear,
      reason: 'Veteran - 1-year prove-it deal minimizes risk',
    };
  }

  // Default
  return {
    years: 3,
    price: prices.threeYear,
    reason: 'Standard 3-year contract at market equilibrium',
  };
}
```

**Testing:**
```typescript
it('should generate price range with 5-year < 1-year', () => {
  const player = { age: 26, position: 'WR' };
  const basePrice = 5_000_000;
  const contracts = generateContractPricing(player, basePrice, 1.0);

  expect(contracts.fiveYear).toBe(4_000_000); // -20%
  expect(contracts.fourYear).toBe(4_500_000); // -10%
  expect(contracts.threeYear).toBe(5_000_000); // Equilibrium
  expect(contracts.twoYear).toBe(5_500_000); // +10%
  expect(contracts.oneYear).toBe(6_000_000); // +20%

  // Validate monotonic increase
  expect(contracts.fiveYear).toBeLessThan(contracts.fourYear);
  expect(contracts.fourYear).toBeLessThan(contracts.threeYear);
  expect(contracts.threeYear).toBeLessThan(contracts.twoYear);
  expect(contracts.twoYear).toBeLessThan(contracts.oneYear);
});

it('should recommend based on age, not price', () => {
  const youngElite = { age: 24, position: 'WR' };
  const basePrice = 12_000_000;
  const contracts = generateContractPricing(youngElite, basePrice, 1.0);

  expect(contracts.recommended.years).toBe(5);
  expect(contracts.recommended.reason).toContain('Young elite');

  const veteran = { age: 33, position: 'RB' };
  const contractsVet = generateContractPricing(veteran, basePrice, 0.6);

  expect(contractsVet.recommended.years).toBe(1);
  expect(contractsVet.recommended.reason).toContain('Veteran');
});
```

---

## Phase 3: Validation Layer (4 hours)

### Task 3.1: Create Validation Functions (2 hours)
**File:** `src/utils/auction-price-validation.ts` (NEW)

**Requirements:**
- Load historical price ranges and age precedents
- Validate predicted prices against historical max
- Check age-salary precedents
- Generate warnings and confidence scores

**Implementation:**
```typescript
import historicalRanges from '../../data/theleague/historical-price-ranges.json';
import agePrecedents from '../../data/theleague/age-salary-precedents.json';

export interface PriceValidationResult {
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
    exceedsMaxByPercent: number;
    hasAgePrecedent: boolean;
    confidence: 'high' | 'medium' | 'low';
    warnings: string[];
    errors: string[];
  };

  requiresReview: boolean;
}

export function validatePredictedPrice(
  player: PlayerValuation,
  predictedPrice: number
): PriceValidationResult {

  const warnings: string[] = [];
  const errors: string[] = [];

  // Get historical max for position + rank tier
  const tier = getRankTier(player.compositeRank || 999);
  const historicalData = historicalRanges[player.position][tier];

  const historicalMax = historicalData.max;
  const historicalAvg = historicalData.avg;
  const historicalMin = historicalData.min;

  // Check #1: Historical Max Validation
  const elitePremium = calculateEliteRankPremium(player.compositeRank || 999);
  const adjustedMax = historicalMax * (1 + elitePremium);
  const exceedsBy = (predictedPrice / adjustedMax) - 1;

  let exceedsHistoricalMax = false;
  if (exceedsBy > 0.25) {
    // FATAL: Exceeds by >25%
    errors.push(
      `⛔ EXCEEDS HISTORICAL MAX BY +${(exceedsBy * 100).toFixed(1)}%\n` +
      `Historical Max: $${adjustedMax.toLocaleString()}\n` +
      `Predicted: $${predictedPrice.toLocaleString()}`
    );
    exceedsHistoricalMax = true;
  } else if (exceedsBy > 0.10) {
    // WARNING: Exceeds by 10-25%
    warnings.push(
      `⚠️ Price exceeds historical max by +${(exceedsBy * 100).toFixed(1)}%`
    );
    exceedsHistoricalMax = true;
  }

  // Check #2: Age Precedent Validation
  const hasAgePrecedent = checkAgePrecedent(
    player.position,
    player.age,
    predictedPrice
  );

  if (!hasAgePrecedent) {
    errors.push(
      `⛔ NO AGE PRECEDENT\n` +
      `No ${player.position} at age ${player.age} has earned $${predictedPrice.toLocaleString()} (2020-2025)`
    );
  }

  // Confidence Score
  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (errors.length > 0) {
    confidence = 'low';
  } else if (warnings.length > 0) {
    confidence = 'medium';
  }

  return {
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    rank: player.compositeRank || 999,
    age: player.age,
    predictedPrice,
    historicalMax: adjustedMax,
    historicalAvg,
    historicalMin,
    validations: {
      exceedsHistoricalMax,
      exceedsMaxByPercent: exceedsBy,
      hasAgePrecedent,
      confidence,
      warnings,
      errors,
    },
    requiresReview: errors.length > 0,
  };
}

function checkAgePrecedent(
  position: string,
  age: number,
  salary: number
): boolean {
  const precedent = agePrecedents[position]?.[age];

  if (!precedent) {
    return false; // No data for this age
  }

  // Allow +25% buffer over historical max at this age
  return salary <= precedent.maxSalary * 1.25;
}

function getRankTier(rank: number): 'elite' | 'star' | 'starter' | 'depth' {
  if (rank <= 5) return 'elite';
  if (rank <= 12) return 'star';
  if (rank <= 24) return 'starter';
  return 'depth';
}
```

---

### Task 3.2: Integrate Validation into Price Calculator (1 hour)
**File:** `src/utils/auction-price-calculator.ts`

**Requirements:**
- Run validation after calculating prices
- Attach validation results to price output
- Throw errors in test mode

**Implementation:**
```typescript
export function calculateAllPlayerPrices(
  availablePlayers: PlayerValuation[],
  teamCapSituations: TeamCapSituation[],
  factors: AuctionPriceFactors,
  options?: { validatePrices?: boolean }
): Map<string, {
  factors: PriceCalculationFactors;
  contracts: ContractPricing;
  validation?: PriceValidationResult;
}> {

  // ... existing calculation logic ...

  const results = new Map();

  for (const player of players) {
    const factorsResult = calculateAuctionPrice(player, factors, scarcity);
    const contracts = generateContractPricing(player, factorsResult.finalPrice, factorsResult.ageMultiplier);

    let validation: PriceValidationResult | undefined;

    // Run validation if enabled
    if (options?.validatePrices) {
      validation = validatePredictedPrice(player, factorsResult.finalPrice);

      // In test mode, throw errors
      if (validation.validations.errors.length > 0) {
        throw new Error(
          `PRICE VALIDATION FAILURE for ${player.name}:\n` +
          validation.validations.errors.join('\n')
        );
      }
    }

    results.set(player.id, { factors: factorsResult, contracts, validation });
  }

  return results;
}
```

---

### Task 3.3: Add Validation Test Suite (1 hour)
**File:** `tests/auction-price-validation.test.ts` (NEW)

**Requirements:**
- Test historical max compliance
- Test age precedent checks
- Test monotonic price curves
- Auto-fail on violations

**Implementation:**
```typescript
import { describe, it, expect } from 'vitest';
import { calculateAllPlayerPrices, DEFAULT_AUCTION_FACTORS } from '../src/utils/auction-price-calculator';
import { validatePredictedPrice } from '../src/utils/auction-price-validation';

describe('Auction Price Validation - Auto-Fail Tests', () => {

  it('should NEVER exceed historical max by more than 25%', () => {
    const testPlayers = generateComprehensiveTestPlayers();

    // Enable validation
    const results = calculateAllPlayerPrices(
      testPlayers,
      mockTeamCapSituations,
      DEFAULT_AUCTION_FACTORS,
      { validatePrices: true }
    );

    // Should throw if any price exceeds +25%
    // If we reach here, all prices passed validation
    expect(results.size).toBeGreaterThan(0);
  });

  it('should NEVER predict prices with no age precedent', () => {
    const testPlayers = generateComprehensiveTestPlayers();

    const results = calculateAllPlayerPrices(
      testPlayers,
      mockTeamCapSituations,
      DEFAULT_AUCTION_FACTORS,
      { validatePrices: true }
    );

    // Check each result has age precedent
    results.forEach((result, playerId) => {
      expect(result.validation?.validations.hasAgePrecedent).toBe(true);
    });
  });

  it('should have monotonic price decrease by rank', () => {
    const positions = ['QB', 'RB', 'WR', 'TE'];

    positions.forEach(pos => {
      const players = [];
      for (let rank = 1; rank <= 50; rank++) {
        players.push({
          id: `${pos}-${rank}`,
          name: `Test ${pos} ${rank}`,
          position: pos,
          compositeRank: rank,
          age: 26,
        });
      }

      const results = calculateAllPlayerPrices(players, mockTeamCapSituations, DEFAULT_AUCTION_FACTORS);

      // Validate monotonic decrease
      let prevPrice = Infinity;
      players.forEach(player => {
        const result = results.get(player.id);
        const price = result.factors.finalPrice;

        expect(price).toBeLessThanOrEqual(prevPrice);
        prevPrice = price;
      });
    });
  });

  it('should have smooth price transitions (no >30% jumps)', () => {
    const qbs = [];
    for (let rank = 1; rank <= 30; rank++) {
      qbs.push({
        id: `QB-${rank}`,
        name: `QB ${rank}`,
        position: 'QB',
        compositeRank: rank,
        age: 27,
      });
    }

    const results = calculateAllPlayerPrices(qbs, mockTeamCapSituations, DEFAULT_AUCTION_FACTORS);

    let prevPrice = results.get('QB-1').factors.finalPrice;

    for (let rank = 2; rank <= 30; rank++) {
      const currentPrice = results.get(`QB-${rank}`).factors.finalPrice;
      const priceChange = (prevPrice - currentPrice) / prevPrice;

      // No single rank should drop price by >30%
      expect(priceChange).toBeLessThan(0.30);

      prevPrice = currentPrice;
    }
  });
});

function generateComprehensiveTestPlayers(): PlayerValuation[] {
  const positions = ['QB', 'RB', 'WR', 'TE'];
  const players = [];

  positions.forEach(pos => {
    for (let rank = 1; rank <= 50; rank++) {
      // Vary ages realistically
      const age = 22 + Math.floor(rank / 5); // Age 22-32

      players.push({
        id: `${pos}-${rank}`,
        name: `Test ${pos} ${rank}`,
        position: pos,
        compositeRank: rank,
        age,
        dynastyRank: rank,
        redraftRank: rank,
      });
    }
  });

  return players;
}
```

---

## Phase 4: UI Updates (2 hours)

### Task 4.1: Update Contract Pricing Display (1 hour)
**File:** `src/pages/theleague/auction-predictor.astro`

**Requirements:**
- Show price range label (Low → High)
- Add value indicators (💰 VALUE, 📊 EQUILIBRIUM, 💎 PREMIUM)
- Display validation warnings

**Implementation:**
```astro
<div class="contract-options">
  <h4>Price Range: ${formatPrice(contracts.fiveYear)} - ${formatPrice(contracts.oneYear)}</h4>

  <div class="price-breakdown">
    <div class="price-row">
      <span class="years">5 Year</span>
      <span class="price">${formatPrice(contracts.fiveYear)}</span>
      <span class="badge value">💰 VALUE</span>
      <span class="description">Commit long-term, save 20%</span>
    </div>

    <div class="price-row">
      <span class="years">4 Year</span>
      <span class="price">${formatPrice(contracts.fourYear)}</span>
    </div>

    <div class="price-row equilibrium">
      <span class="years">3 Year</span>
      <span class="price">${formatPrice(contracts.threeYear)}</span>
      <span class="badge">📊 EQUILIBRIUM</span>
      <span class="description">Market rate</span>
    </div>

    <div class="price-row">
      <span class="years">2 Year</span>
      <span class="price">${formatPrice(contracts.twoYear)}</span>
    </div>

    <div class="price-row">
      <span class="years">1 Year</span>
      <span class="price">${formatPrice(contracts.oneYear)}</span>
      <span class="badge premium">💎 PREMIUM</span>
      <span class="description">Flexibility, +20%</span>
    </div>
  </div>

  {validation && validation.validations.warnings.length > 0 && (
    <div class="validation-warnings">
      {validation.validations.warnings.map(warning => (
        <div class="warning">{warning}</div>
      ))}
    </div>
  )}

  <div class="recommendation">
    <strong>Recommended:</strong> {contracts.recommended.years}-year contract at ${formatPrice(contracts.recommended.price)}/year
    <br />
    <em>{contracts.recommended.reason}</em>
  </div>
</div>
```

---

### Task 4.2: Add Validation Badges (1 hour)
**File:** `src/pages/theleague/auction-predictor.astro`

**Requirements:**
- Show confidence badges (HIGH/MEDIUM/LOW)
- Display historical max context
- Show age precedent warnings

**Implementation:**
```astro
<div class="player-card">
  <div class="player-header">
    <h3>{player.name}</h3>
    <span class="position">{player.position}</span>
    <span class="age">Age {player.age}</span>
    <span class="rank">Rank #{player.compositeRank}</span>

    {validation && (
      <span class={`confidence-badge ${validation.validations.confidence}`}>
        {validation.validations.confidence.toUpperCase()} CONFIDENCE
      </span>
    )}
  </div>

  <div class="price-info">
    <div class="predicted-price">
      <strong>Predicted:</strong> ${formatPrice(factors.finalPrice)}
    </div>
    <div class="historical-context">
      Historical Max ({player.position} Rank {getRankTier(player.compositeRank)}):
      ${formatPrice(validation.historicalMax)}
    </div>
  </div>

  {validation && validation.validations.warnings.length > 0 && (
    <div class="age-warnings">
      <h4>⚠️ Age Risk Warnings</h4>
      {validation.validations.warnings.map(warning => (
        <p class="warning-text">{warning}</p>
      ))}
    </div>
  )}

  <!-- Contract pricing table here -->
</div>

<style>
  .confidence-badge {
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: bold;
  }

  .confidence-badge.high {
    background-color: #22c55e;
    color: white;
  }

  .confidence-badge.medium {
    background-color: #f59e0b;
    color: white;
  }

  .confidence-badge.low {
    background-color: #ef4444;
    color: white;
  }

  .price-row.equilibrium {
    background-color: #f0f9ff;
    border-left: 3px solid #3b82f6;
  }

  .badge.value {
    background-color: #dcfce7;
    color: #16a34a;
  }

  .badge.premium {
    background-color: #fef3c7;
    color: #d97706;
  }
</style>
```

---

## Phase 5: Documentation & Testing (2 hours)

### Task 5.1: Update AUCTION_PREDICTOR_REQUIREMENTS.md (30 min)
**File:** `AUCTION_PREDICTOR_REQUIREMENTS.md`

**Updates:**
- Document price range philosophy
- Update contract pricing formulas
- Add validation requirements

---

### Task 5.2: Write Integration Tests (1 hour)
**File:** `tests/auction-predictor-integration.test.ts`

**Test Scenarios:**
- End-to-end price calculation with validation
- Verify all positions have valid historical data
- Test edge cases (very young, very old, extreme ranks)

---

### Task 5.3: Manual Testing Checklist (30 min)

**Checklist:**
- [ ] Load auction predictor page
- [ ] Verify price ranges display correctly (5-year < 1-year)
- [ ] Check validation badges appear
- [ ] Test with different dynasty/redraft weights
- [ ] Verify recommendations make sense
- [ ] Check edge cases (rank 1, rank 50, age 22, age 35)
- [ ] Confirm no console errors
- [ ] Mobile responsive check

---

## Acceptance Criteria

### Must Have (MVP)
- ✅ Historical price ranges generated from 2020-2025 data
- ✅ Contract years show price range (5-year = low, 1-year = high)
- ✅ Elite rank premium (rank 1 = +5% down to rank 5 = 0%)
- ✅ Relative ranking within free agent pool
- ✅ Validation auto-fails tests if price exceeds +25% historical max
- ✅ Age precedent validation with auto-fail
- ✅ UI shows price ranges clearly
- ✅ Confidence badges displayed

### Nice to Have (Post-MVP)
- 🔲 Export validation report to CSV
- 🔲 Historical price trend charts (6-year view)
- 🔲 Age distribution visualization
- 🔲 "Similar players" comparison

---

## Testing Strategy

### Unit Tests
- ✅ `calculateEliteRankPremium()`
- ✅ `calculateRelativePositionRanking()`
- ✅ `generateContractPricing()` - price range logic
- ✅ `validatePredictedPrice()`
- ✅ `checkAgePrecedent()`

### Integration Tests
- ✅ Full price calculation pipeline with validation
- ✅ Historical data loading
- ✅ Edge case scenarios (very young, very old, extreme ranks)

### Validation Tests (Auto-Fail)
- ✅ Historical max compliance (+25% threshold)
- ✅ Age precedent checks (strict exact age)
- ✅ Monotonic price curves by rank
- ✅ Smooth price transitions (no >30% jumps)

### Manual Testing
- ✅ UI displays correctly
- ✅ Price ranges make sense
- ✅ Recommendations are age-appropriate
- ✅ Validation warnings appear for edge cases

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Historical data has gaps | Fallback to existing curves if insufficient sample size |
| Validation too strict | Allow +25% buffer, can adjust threshold if needed |
| Age precedent missing | Generate warnings instead of hard errors for sample size < 3 |
| Price ranges too wide/narrow | Fixed 20% range, can adjust based on feedback |
| Tests fail on edge cases | Comprehensive test player generation covering all scenarios |

---

## Rollout Plan

### Phase 1: Backend (No UI Changes)
1. Generate historical data files
2. Update pricing calculator
3. Add validation layer
4. All tests passing

### Phase 2: UI Updates
5. Update contract pricing display
6. Add validation badges
7. Manual testing

### Phase 3: Launch
8. Commit all changes
9. Deploy to production
10. Monitor for issues

---

## Success Metrics

- ✅ All validation tests passing (0 failures)
- ✅ Price predictions within +25% of historical max
- ✅ 100% age precedent coverage (or explicit warnings)
- ✅ Contract pricing is monotonic (5yr < 4yr < 3yr < 2yr < 1yr)
- ✅ User feedback: "Price ranges make more sense now"

---

**Ready to begin implementation?** Start with Phase 1, Task 1.1!
