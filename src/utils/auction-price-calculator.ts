/**
 * Auction Price Calculator
 * 
 * Calculates predicted auction prices for players based on:
 * - Composite rankings (dynasty + redraft weighted)
 * - Market scarcity by position
 * - Team demand and cap space
 * - Player age and contract history
 * - Historical auction patterns
 */

import type { PlayerValuation, TeamCapSituation, MarketAnalysis } from '../types/auction-predictor';

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
 * Calculate auction price for a player
 */
export function calculateAuctionPrice(
  player: PlayerValuation,
  marketAnalysis: MarketAnalysis,
  dynastyWeight: number = 60 // 0-100, how much to weight dynasty vs redraft
): PriceCalculationFactors {
  
  // Step 1: Calculate composite rank if we have rankings
  const compositeRank = calculateCompositeRank(player, dynastyWeight);
  
  // Step 2: Get position baseline
  const basePrice = POSITION_BASELINES[player.position] || 2_000_000;
  
  // Step 3: Apply rank tier multiplier
  const rankMultiplier = getRankMultiplier(compositeRank, player.position);
  
  // Step 4: Apply age multiplier
  const ageMultiplier = getAgeMultiplier(player.age);
  
  // Step 5: Apply market scarcity multiplier
  const scarcityMultiplier = getScarcityMultiplier(player.position, marketAnalysis);
  
  // Step 6: Apply demand multiplier (how many teams need this position)
  const demandMultiplier = getDemandMultiplier(player.position, marketAnalysis);
  
  // Step 7: Calculate final price
  const finalPrice = Math.round(
    basePrice * 
    rankMultiplier * 
    ageMultiplier * 
    scarcityMultiplier * 
    demandMultiplier
  );
  
  // Step 8: Calculate confidence (higher confidence if we have rankings)
  const confidence = calculatePriceConfidence(player, compositeRank);
  
  return {
    basePrice,
    rankMultiplier,
    ageMultiplier,
    scarcityMultiplier,
    demandMultiplier,
    finalPrice: Math.max(finalPrice, 500_000), // Minimum $500k
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
 */
export function generateContractPricing(
  player: PlayerValuation,
  basePrice: number,
  ageMultiplier: number
): ContractPricing {
  
  const ESCALATION_RATE = 0.10; // 10% annual escalation
  
  // 1-Year Contract: Base price
  const oneYear = basePrice;
  
  // 2-Year Contract: Slight discount for commitment
  const twoYear = Math.round(basePrice * 0.95);
  
  // 3-Year Contract: Better discount
  const threeYear = Math.round(basePrice * 0.90);
  
  // 4-Year Contract: Best discount for young players
  const fourYear = Math.round(basePrice * 0.85);
  
  // 5-Year Contract: Maximum discount for elite young talent
  const fiveYear = Math.round(basePrice * 0.80);
  
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
 */
export function calculateAllPlayerPrices(
  players: PlayerValuation[],
  marketAnalysis: MarketAnalysis,
  dynastyWeight: number = 60
): Map<string, { factors: PriceCalculationFactors; contracts: ContractPricing }> {
  
  const results = new Map();
  
  for (const player of players) {
    const factors = calculateAuctionPrice(player, marketAnalysis, dynastyWeight);
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
