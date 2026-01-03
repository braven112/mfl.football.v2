/**
 * Auction Price Calculator
 *
 * Calculates predicted auction prices for players based on:
 * - Composite rankings (dynasty + redraft weighted)
 * - Market scarcity by position
 * - Team demand and cap space
 * - Player age and contract history
 * - Historical auction patterns (2020-2025)
 *
 * PRICING MODELS:
 * - 'max': Highest salary each rank has ever commanded (bullish market)
 * - 'average': Average salary since 2020 (balanced market)
 * - 'min': Lowest salary each rank has commanded (bearish market)
 */

import type { PlayerValuation, TeamCapSituation, MarketAnalysis } from '../types/auction-predictor';
import historicalCurves from '../../data/theleague/historical-salary-curves.json';

export type PricingModel = 'min' | 'average' | 'max';

// Position-specific baseline salaries (in millions)
const POSITION_BASELINES: Record<string, number> = {
  QB: 8_000_000,   // Top QBs command premium
  RB: 5_000_000,   // RBs valuable but shorter shelf life
  WR: 6_000_000,   // WRs most consistent value
  TE: 4_000_000,   // TEs less valuable in most leagues
  PK: 500_000,     // Kickers minimal value
  DEF: 500_000,    // Defenses minimal value
};

// Position-specific rank tiers with multipliers
const RANK_TIER_MULTIPLIERS = {
  elite: { threshold: 12, multiplier: 2.5 },      // Top 12: 2.5x baseline
  high: { threshold: 24, multiplier: 2.0 },       // 13-24: 2.0x baseline
  mid: { threshold: 48, multiplier: 1.5 },        // 25-48: 1.5x baseline
  low: { threshold: 100, multiplier: 1.0 },       // 49-100: 1.0x baseline
  replacement: { threshold: 999, multiplier: 0.5 } // 100+: 0.5x baseline
};

// Age impact on pricing
const AGE_MULTIPLIERS = {
  young: { max: 25, multiplier: 1.15 },      // <26: 15% premium (upside)
  prime: { max: 29, multiplier: 1.0 },       // 26-29: No adjustment
  aging: { max: 31, multiplier: 0.85 },      // 30-31: 15% discount
  veteran: { max: 99, multiplier: 0.65 },    // 32+: 35% discount
};

export interface ContractPricing {
  oneYear: number;
  twoYear: number;
  threeYear: number;
  fourYear: number;
  fiveYear: number;
  recommended: {
    years: number;
    price: number;
    reason: string;
  };
}

export interface PriceCalculationFactors {
  basePrice: number;
  rankMultiplier: number;
  ageMultiplier: number;
  scarcityMultiplier: number;
  demandMultiplier: number;
  finalPrice: number;
  confidence: number;
}

/**
 * Look up historical salary for a position/rank combination
 * @param position - Player position (QB, RB, WR, TE)
 * @param rank - Position rank (1-based)
 * @param model - Pricing model: 'min', 'average', or 'max'
 */
function getHistoricalSalary(position: string, rank: number, model: PricingModel = 'average'): number {
  // Get curves for this position
  const positionCurves = historicalCurves.curves[position as keyof typeof historicalCurves.curves];

  if (!positionCurves) {
    // Fallback for positions without historical data (PK, DEF)
    return 500_000;
  }

  // Cap rank at 50 (historical data limit)
  const lookupRank = Math.min(rank, 50);

  // Get exact match if available
  const rankData = positionCurves[lookupRank.toString() as keyof typeof positionCurves];
  if (rankData && typeof rankData === 'object' && 'average' in rankData) {
    // Select the appropriate value based on pricing model
    if (model === 'max' && 'max' in rankData) {
      return rankData.max as number;
    } else if (model === 'min' && 'min' in rankData) {
      return rankData.min as number;
    } else {
      return rankData.average;
    }
  }

  // For ranks > 50, extrapolate from rank 50
  const rank50Data = positionCurves['50' as keyof typeof positionCurves];
  if (rank > 50 && rank50Data && typeof rank50Data === 'object' && 'average' in rank50Data) {
    // Decay beyond rank 50 at 5% per rank down to league minimum
    let baseValue: number;
    if (model === 'max' && 'max' in rank50Data) {
      baseValue = rank50Data.max as number;
    } else if (model === 'min' && 'min' in rank50Data) {
      baseValue = rank50Data.min as number;
    } else {
      baseValue = rank50Data.average;
    }

    const decayFactor = Math.exp(-0.05 * (rank - 50));
    return Math.max(baseValue * decayFactor, 425_000);
  }

  // Fallback
  return 425_000;
}

/**
 * Calculate auction price for a player using HISTORICAL CURVE MODEL
 * Uses actual 2020-2025 auction data to determine pricing
 * @param player - Player to value
 * @param marketAnalysis - Market analysis data
 * @param dynastyWeight - 0-100, how much to weight dynasty vs redraft
 * @param allPlayers - All players for position rank calculation
 * @param pricingModel - 'min', 'average', or 'max' pricing curve
 */
export function calculateAuctionPrice(
  player: PlayerValuation,
  marketAnalysis: MarketAnalysis,
  dynastyWeight: number = 60,
  allPlayers?: PlayerValuation[],
  pricingModel: PricingModel = 'average'
): PriceCalculationFactors {
  
  // Step 1: Calculate composite rank if we have rankings
  const compositeRank = calculateCompositeRank(player, dynastyWeight);
  
  // If no rank, use minimum pricing
  if (!compositeRank) {
    return {
      basePrice: 500_000,
      rankMultiplier: 1.0,
      ageMultiplier: 1.0,
      scarcityMultiplier: 1.0,
      demandMultiplier: 1.0,
      finalPrice: 500_000,
      confidence: 0.3,
    };
  }
  
  // Step 2: Calculate position rank (how many at this position are ranked higher)
  let positionRank = 1;
  if (allPlayers) {
    const playersAtPosition = allPlayers
      .filter(p => p.position === player.position)
      .map(p => {
        const rank = calculateCompositeRank(p, dynastyWeight);
        return { id: p.id, rank: rank || 999 };
      })
      .filter(p => p.rank < 999)
      .sort((a, b) => a.rank - b.rank);
    
    positionRank = playersAtPosition.findIndex(p => p.id === player.id) + 1;
    if (positionRank === 0) positionRank = 99; // Not found = deep backup
  }
  
  // Step 3: PURE HISTORICAL PRICING - Use actual 2020-2025 auction data directly
  // Simply look up this player's position rank and use the historical curve
  // NO hybrid weighting, NO scarcity multipliers - just the raw historical data
  let baseSalary = getHistoricalSalary(player.position, positionRank, pricingModel);

  // Floor at league minimum
  baseSalary = Math.max(baseSalary, 425_000);

  // For reporting purposes, calculate what the scarcity multiplier would be
  const scarcityMultiplier = getScarcityMultiplier(player.position, marketAnalysis);
  
  const finalPrice = Math.round(baseSalary);
  
  // Calculate confidence (higher for historical data)
  const confidence = compositeRank ? 0.90 : 0.50;
  
  return {
    basePrice: baseSalary,
    rankMultiplier: 1.0, // Already baked into hybrid calculation
    ageMultiplier: 1.0,  // Dynasty rankings already account for age
    scarcityMultiplier,
    demandMultiplier: 1.0,
    finalPrice,
    confidence,
  };
}

/**
 * Calculate composite rank from dynasty and redraft rankings
 */
function calculateCompositeRank(player: PlayerValuation, dynastyWeight: number): number | null {
  const { dynastyRank, redraftRank } = player;
  
  // If we have both rankings, calculate weighted average
  if (dynastyRank && redraftRank) {
    const dynastyFactor = dynastyWeight / 100;
    const redraftFactor = 1 - dynastyFactor;
    return Math.round((dynastyRank * dynastyFactor) + (redraftRank * redraftFactor));
  }
  
  // If we only have dynasty rank
  if (dynastyRank) return dynastyRank;
  
  // If we only have redraft rank
  if (redraftRank) return redraftRank;
  
  // No rankings available
  return null;
}

/**
 * Get rank tier multiplier
 */
function getRankMultiplier(rank: number | null, position: string): number {
  // If no rank, use mid-tier as default
  if (rank === null) {
    return RANK_TIER_MULTIPLIERS.mid.multiplier;
  }
  
  // Adjust thresholds for QB (only 1 starter per team)
  const adjustedRank = position === 'QB' ? rank : rank;
  
  if (adjustedRank <= RANK_TIER_MULTIPLIERS.elite.threshold) {
    return RANK_TIER_MULTIPLIERS.elite.multiplier;
  } else if (adjustedRank <= RANK_TIER_MULTIPLIERS.high.threshold) {
    return RANK_TIER_MULTIPLIERS.high.multiplier;
  } else if (adjustedRank <= RANK_TIER_MULTIPLIERS.mid.threshold) {
    return RANK_TIER_MULTIPLIERS.mid.multiplier;
  } else if (adjustedRank <= RANK_TIER_MULTIPLIERS.low.threshold) {
    return RANK_TIER_MULTIPLIERS.low.multiplier;
  } else {
    return RANK_TIER_MULTIPLIERS.replacement.multiplier;
  }
}

/**
 * Get age multiplier
 */
function getAgeMultiplier(age: number): number {
  if (age <= AGE_MULTIPLIERS.young.max) {
    return AGE_MULTIPLIERS.young.multiplier;
  } else if (age <= AGE_MULTIPLIERS.prime.max) {
    return AGE_MULTIPLIERS.prime.multiplier;
  } else if (age <= AGE_MULTIPLIERS.aging.max) {
    return AGE_MULTIPLIERS.aging.multiplier;
  } else {
    return AGE_MULTIPLIERS.veteran.multiplier;
  }
}

/**
 * Get scarcity multiplier from market analysis
 */
function getScarcityMultiplier(position: string, marketAnalysis: MarketAnalysis): number {
  const positionMarket = marketAnalysis.positionalMarkets[position];
  
  if (!positionMarket) {
    return 1.0; // No adjustment if no data
  }
  
  // Scarcity index from market analysis (demand / supply)
  const scarcityIndex = positionMarket.scarcityIndex || 1.0;
  
  // High scarcity (>1.5) = premium pricing
  // Low scarcity (<0.8) = discount pricing
  if (scarcityIndex >= 1.5) return 1.3;
  if (scarcityIndex >= 1.2) return 1.15;
  if (scarcityIndex >= 1.0) return 1.0;
  if (scarcityIndex >= 0.8) return 0.9;
  return 0.8;
}

/**
 * Get demand multiplier from market analysis
 */
function getDemandMultiplier(position: string, marketAnalysis: MarketAnalysis): number {
  const positionMarket = marketAnalysis.positionalMarkets[position];
  
  if (!positionMarket) {
    return 1.0; // No adjustment if no data
  }
  
  const supply = positionMarket.availablePlayers || 1;
  const demand = positionMarket.totalDemand || 1;
  
  // More demand relative to supply = higher prices
  const demandRatio = demand / Math.max(supply, 1);
  
  // Convert to multiplier (0.7 to 1.4)
  // High demand ratio = higher prices
  if (demandRatio > 1.5) return 1.4;
  if (demandRatio > 1.2) return 1.2;
  if (demandRatio > 0.8) return 1.0;
  if (demandRatio > 0.5) return 0.85;
  return 0.7;
}

/**
 * Calculate confidence in price prediction
 */
function calculatePriceConfidence(player: PlayerValuation, compositeRank: number | null): number {
  let confidence = 0.5; // Start at 50%
  
  // Boost confidence if we have rankings
  if (compositeRank !== null) {
    confidence += 0.3; // +30% for having rankings
  }
  
  // Boost confidence for established players
  if (player.experience && player.experience >= 3) {
    confidence += 0.1; // +10% for experience
  }
  
  // Boost confidence if we have historical auction data
  if (player.lastAuctionPrice) {
    confidence += 0.1; // +10% for historical data
  }
  
  return Math.min(confidence, 1.0); // Cap at 100%
}

/**
 * Generate multi-year contract pricing options
 * 
 * PHILOSOPHY: The basePrice represents a 3-year contract value (market equilibrium).
 * - Longer deals = discount (buying stability, accepting floor)
 * - Shorter deals = premium (betting on upside, prove-it deals)
 */
export function generateContractPricing(
  player: PlayerValuation,
  basePrice: number,
  ageMultiplier: number
): ContractPricing {

  // 1-year price = base historical price
  const oneYear = basePrice;

  // Multi-year contracts depreciate based on age decay
  // Players get older and less valuable over time
  const currentAge = player.age;

  // Calculate age-based depreciation for each contract year
  // Younger players depreciate slower, older players depreciate faster
  const getAgeDepreciation = (age: number, years: number): number => {
    // Annual depreciation rates by age bracket
    let annualDecay: number;

    if (age <= 24) {
      annualDecay = 0.02; // 2% per year (still improving/prime ahead)
    } else if (age <= 27) {
      annualDecay = 0.05; // 5% per year (entering prime)
    } else if (age <= 29) {
      annualDecay = 0.08; // 8% per year (prime but aging)
    } else if (age <= 31) {
      annualDecay = 0.12; // 12% per year (declining)
    } else {
      annualDecay = 0.18; // 18% per year (steep decline)
    }

    // Position-specific adjustments
    if (player.position === 'RB') {
      annualDecay *= 1.5; // RBs age faster
    } else if (player.position === 'QB') {
      annualDecay *= 0.7; // QBs age slower
    }

    // Calculate total depreciation over contract length
    // Use exponential decay: value = basePrice * (1 - decay)^years
    const totalDepreciation = 1 - Math.pow(1 - annualDecay, years);
    return totalDepreciation;
  };

  // Apply age depreciation to multi-year deals
  const twoYear = Math.round(basePrice * (1 - getAgeDepreciation(currentAge, 2)));
  const threeYear = Math.round(basePrice * (1 - getAgeDepreciation(currentAge, 3)));
  const fourYear = Math.round(basePrice * (1 - getAgeDepreciation(currentAge, 4)));
  const fiveYear = Math.round(basePrice * (1 - getAgeDepreciation(currentAge, 5)));
  
  // Recommend contract length based on age and value
  const recommended = recommendContractLength(
    player.age,
    basePrice,
    { oneYear, twoYear, threeYear, fourYear, fiveYear }
  );
  
  return {
    oneYear,
    twoYear,
    threeYear,
    fourYear,
    fiveYear,
    recommended,
  };
}

/**
 * Recommend optimal contract length
 */
function recommendContractLength(
  age: number,
  basePrice: number,
  prices: Omit<ContractPricing, 'recommended'>
): { years: number; price: number; reason: string } {
  
  // Young elite players: Lock up long-term
  if (age <= 25 && basePrice >= 10_000_000) {
    return {
      years: 5,
      price: prices.fiveYear,
      reason: 'Young elite talent - maximize long-term value with 5-year deal',
    };
  }
  
  // Young valuable players: 4-year deal
  if (age <= 26 && basePrice >= 5_000_000) {
    return {
      years: 4,
      price: prices.fourYear,
      reason: 'Young and productive - lock in 4 years before prime',
    };
  }
  
  // Prime age players: 3-year sweet spot
  if (age >= 27 && age <= 29) {
    return {
      years: 3,
      price: prices.threeYear,
      reason: 'Prime years - 3-year deal balances value and risk',
    };
  }
  
  // Aging players: 2-year max
  if (age >= 30 && age <= 31) {
    return {
      years: 2,
      price: prices.twoYear,
      reason: 'Aging player - limit risk with 2-year deal',
    };
  }
  
  // Veterans: 1-year prove-it deals
  if (age >= 32) {
    return {
      years: 1,
      price: prices.oneYear,
      reason: 'Veteran - 1-year prove-it deal minimizes risk',
    };
  }
  
  // Default to 3-year
  return {
    years: 3,
    price: prices.threeYear,
    reason: 'Standard 3-year contract offers balanced value',
  };
}

/**
 * Batch calculate prices for all players
 * @param players - All players to value
 * @param marketAnalysis - Market analysis data
 * @param dynastyWeight - 0-100, how much to weight dynasty vs redraft
 * @param pricingModel - 'min', 'average', or 'max' pricing curve
 */
export function calculateAllPlayerPrices(
  players: PlayerValuation[],
  marketAnalysis: MarketAnalysis,
  dynastyWeight: number = 60,
  pricingModel: PricingModel = 'average'
): Map<string, { factors: PriceCalculationFactors; contracts: ContractPricing }> {

  const results = new Map();

  for (const player of players) {
    // Pass all players so we can calculate position rank
    const factors = calculateAuctionPrice(player, marketAnalysis, dynastyWeight, players, pricingModel);
    const contracts = generateContractPricing(player, factors.finalPrice, factors.ageMultiplier);

    results.set(player.id, { factors, contracts });
  }

  return results;
}

/**
 * Get price breakdown explanation for UI
 */
export function getPriceExplanation(factors: PriceCalculationFactors, player: PlayerValuation): string[] {
  const explanations: string[] = [];
  
  explanations.push(`Base ${player.position} salary: $${(factors.basePrice / 1_000_000).toFixed(1)}M`);
  
  if (factors.rankMultiplier !== 1.0) {
    const pct = ((factors.rankMultiplier - 1) * 100).toFixed(0);
    const direction = factors.rankMultiplier > 1 ? '+' : '';
    explanations.push(`Rank adjustment: ${direction}${pct}% (${factors.rankMultiplier}x)`);
  }
  
  if (factors.ageMultiplier !== 1.0) {
    const pct = ((factors.ageMultiplier - 1) * 100).toFixed(0);
    const direction = factors.ageMultiplier > 1 ? '+' : '';
    explanations.push(`Age ${player.age} adjustment: ${direction}${pct}% (${factors.ageMultiplier}x)`);
  }
  
  if (factors.scarcityMultiplier !== 1.0) {
    const pct = ((factors.scarcityMultiplier - 1) * 100).toFixed(0);
    const direction = factors.scarcityMultiplier > 1 ? '+' : '';
    explanations.push(`Market scarcity: ${direction}${pct}% (${factors.scarcityMultiplier.toFixed(2)}x)`);
  }
  
  if (factors.demandMultiplier !== 1.0) {
    const pct = ((factors.demandMultiplier - 1) * 100).toFixed(0);
    const direction = factors.demandMultiplier > 1 ? '+' : '';
    explanations.push(`Team demand: ${direction}${pct}% (${factors.demandMultiplier.toFixed(2)}x)`);
  }
  
  explanations.push(`Final price: $${(factors.finalPrice / 1_000_000).toFixed(2)}M (${(factors.confidence * 100).toFixed(0)}% confidence)`);
  
  return explanations;
}
