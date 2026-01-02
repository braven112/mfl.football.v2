/**
 * Auction Price Prediction Engine
 * 
 * Predicts auction prices for free agents based on:
 * - Player rankings (dynasty/redraft weighted)
 * - Available cap space across league
 * - Position scarcity
 * - Historical auction patterns
 * - Contract length preferences
 */

import type {
  PlayerValuation,
  MarketAnalysis,
  TeamCapSituation,
  AuctionPriceFactors,
  PositionScarcityAnalysis,
} from '../types/auction-predictor';

const LEAGUE_MINIMUM = 425_000;
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];

/**
 * Calculate positional scarcity for the auction market
 */
export function calculatePositionalScarcity(
  position: string,
  availablePlayers: PlayerValuation[],
  teamCapSituations: TeamCapSituation[]
): PositionScarcityAnalysis {
  // Supply: Available players at this position
  const positionPlayers = availablePlayers.filter(p => p.position === position);
  const qualityStartersAvailable = positionPlayers.filter(p => {
    return (p.compositeRank && p.compositeRank <= 100) || (p.projectedPoints && p.projectedPoints > 0);
  }).length;
  
  // Demand: Teams needing this position
  const teamsNeedingStarters = teamCapSituations.filter(team => {
    const need = team.positionalNeeds.find(n => n.position === position);
    return need && need.priority !== 'low';
  }).length;
  
  const totalDemand = teamCapSituations.reduce((sum, team) => {
    const need = team.positionalNeeds.find(n => n.position === position);
    return sum + (need?.targetAcquisitions || 0);
  }, 0);
  
  // Scarcity calculation
  const supplyDemandRatio = qualityStartersAvailable / Math.max(1, totalDemand);
  const scarcityScore = Math.max(0, Math.min(100, (1 - supplyDemandRatio) * 100));
  
  // Price impact: higher scarcity = higher multiplier
  const priceImpactMultiplier = 1 + (scarcityScore / 100) * 0.5; // Up to 1.5x
  
  return {
    position,
    currentRosteredPlayers: 0, // Would need full league data
    qualityStartersAvailable,
    expiringContracts: positionPlayers.length,
    rookiesExpected: 0, // Would need draft projection
    totalLeagueStartingSpots: 16, // 16 teams
    teamsNeedingStarters,
    averageDepthPerTeam: 0,
    scarcityScore,
    priceImpactMultiplier,
    topTierSize: positionPlayers.filter(p => p.compositeRank && p.compositeRank <= 20).length,
    replacementLevel: LEAGUE_MINIMUM,
  };
}

/**
 * Calculate base value for a player based on rankings
 */
function calculatePlayerBaseValue(
  player: PlayerValuation,
  factors: AuctionPriceFactors,
  totalAvailableCap: number,
  totalPlayers: number
): number {
  // Default: distribute cap evenly
  const averagePrice = totalAvailableCap / Math.max(1, totalPlayers);
  
  // Get weighted rank
  let weightedRank = 999;
  if (factors.dynastyWeight > 0 && player.dynastyRank) {
    weightedRank = player.dynastyRank * factors.dynastyWeight;
  }
  if (factors.redraftWeight > 0 && player.redraftRank) {
    weightedRank = weightedRank === 999 
      ? player.redraftRank * factors.redraftWeight
      : weightedRank + (player.redraftRank * factors.redraftWeight);
  }
  
  if (weightedRank === 999) {
    // No rankings available, use league minimum
    return LEAGUE_MINIMUM;
  }
  
  // Convert rank to value multiplier (better rank = higher value)
  // Rank 1 = 10x average, Rank 50 = 2x average, Rank 100 = 1x average, Rank 200 = 0.5x average
  let valueMultiplier: number;
  if (weightedRank <= 10) {
    valueMultiplier = 10 - (weightedRank - 1) * 0.6; // 10x to 4.6x
  } else if (weightedRank <= 30) {
    valueMultiplier = 4.6 - ((weightedRank - 10) / 20) * 2.6; // 4.6x to 2x
  } else if (weightedRank <= 100) {
    valueMultiplier = 2 - ((weightedRank - 30) / 70) * 1; // 2x to 1x
  } else if (weightedRank <= 200) {
    valueMultiplier = 1 - ((weightedRank - 100) / 100) * 0.5; // 1x to 0.5x
  } else {
    valueMultiplier = 0.5; // Floor at 0.5x
  }
  
  return Math.max(LEAGUE_MINIMUM, averagePrice * valueMultiplier);
}

/**
 * Apply age adjustment to price
 */
function applyAgeAdjustment(
  baseValue: number,
  age: number,
  factors: AuctionPriceFactors
): number {
  const ageDiscount = factors.ageDiscountCurve[age] || 0;
  return baseValue * (1 - ageDiscount);
}

/**
 * Apply positional scarcity adjustment
 */
function applyScarcityAdjustment(
  baseValue: number,
  scarcityAnalysis: PositionScarcityAnalysis
): number {
  return baseValue * scarcityAnalysis.priceImpactMultiplier;
}

/**
 * Apply contract length preference adjustment
 */
function applyContractLengthAdjustment(
  baseValue: number,
  preferredLength: number,
  factors: AuctionPriceFactors
): number {
  // Longer contracts typically command premium in dynasty
  // But short contracts give flexibility
  
  if (preferredLength >= 4) {
    // Long-term contracts: emphasize dynasty rankings more
    return baseValue * (1 + factors.contractLengthImpact * 0.2);
  } else if (preferredLength <= 2) {
    // Short-term contracts: emphasize redraft rankings more
    return baseValue * (1 - factors.contractLengthImpact * 0.1);
  }
  
  return baseValue; // 3-year contracts: neutral
}

/**
 * Predict auction price for a single player
 */
export function predictPlayerAuctionPrice(
  player: PlayerValuation,
  factors: AuctionPriceFactors,
  totalAvailableCap: number,
  totalPlayers: number,
  scarcityAnalysis: PositionScarcityAnalysis,
  historicalData?: number[]
): PlayerValuation {
  // Step 1: Calculate base value from rankings
  let estimatedPrice = calculatePlayerBaseValue(
    player,
    factors,
    totalAvailableCap,
    totalPlayers
  );
  
  // Step 2: Apply age adjustment
  estimatedPrice = applyAgeAdjustment(estimatedPrice, player.age, factors);
  
  // Step 3: Apply positional scarcity
  estimatedPrice = applyScarcityAdjustment(estimatedPrice, scarcityAnalysis);
  
  // Step 4: Apply contract length preference
  estimatedPrice = applyContractLengthAdjustment(
    estimatedPrice,
    factors.preferredContractLength,
    factors
  );
  
  // Step 5: Apply market inflation
  estimatedPrice = estimatedPrice * (1 + factors.inflationFactor);
  
  // Step 6: Apply positional premiums
  const positionPremium = factors.positionalPremiums[player.position] || 0;
  estimatedPrice = estimatedPrice * (1 + positionPremium);
  
  // Step 7: Incorporate historical data if available
  if (factors.useHistoricalData && historicalData && historicalData.length > 0) {
    const historicalAvg = historicalData.reduce((a, b) => a + b, 0) / historicalData.length;
    estimatedPrice = (estimatedPrice * (1 - factors.historicalWeight)) + 
                     (historicalAvg * factors.historicalWeight);
  }
  
  // Round to nearest $50k
  estimatedPrice = Math.round(estimatedPrice / 50000) * 50000;
  
  // Ensure minimum price
  estimatedPrice = Math.max(LEAGUE_MINIMUM, estimatedPrice);
  
  // Calculate confidence range
  const volatility = 0.25; // 25% standard deviation
  const confidenceRange = {
    low: Math.round(estimatedPrice * (1 - volatility)),
    high: Math.round(estimatedPrice * (1 + volatility)),
    confidence: historicalData && historicalData.length > 2 ? 0.8 : 0.6,
  };
  
  return {
    ...player,
    estimatedAuctionPrice: estimatedPrice,
    priceConfidenceRange: confidenceRange,
    positionalScarcity: scarcityAnalysis.scarcityScore / 100,
  };
}

/**
 * Predict auction prices for all free agents
 */
export function predictAllAuctionPrices(
  availablePlayers: PlayerValuation[],
  teamCapSituations: TeamCapSituation[],
  factors: AuctionPriceFactors,
  historicalDataMap?: Map<string, number[]>
): PlayerValuation[] {
  // Calculate total available cap
  const totalAvailableCap = teamCapSituations.reduce(
    (sum, team) => sum + team.discretionarySpending,
    0
  );
  
  // Calculate scarcity for each position
  const scarcityByPosition = new Map<string, PositionScarcityAnalysis>();
  for (const position of POSITIONS) {
    const scarcity = calculatePositionalScarcity(
      position,
      availablePlayers,
      teamCapSituations
    );
    scarcityByPosition.set(position, scarcity);
  }
  
  // Predict price for each player
  const predictedPlayers = availablePlayers.map(player => {
    const scarcity = scarcityByPosition.get(player.position)!;
    const historicalData = historicalDataMap?.get(player.id);
    
    return predictPlayerAuctionPrice(
      player,
      factors,
      totalAvailableCap,
      availablePlayers.length,
      scarcity,
      historicalData
    );
  });
  
  // Sort by estimated price (highest first)
  return predictedPlayers.sort((a, b) => {
    const priceA = a.estimatedAuctionPrice || 0;
    const priceB = b.estimatedAuctionPrice || 0;
    return priceB - priceA;
  });
}

/**
 * Generate comprehensive market analysis
 */
export function generateMarketAnalysis(
  predictedPlayers: PlayerValuation[],
  teamCapSituations: TeamCapSituation[]
): MarketAnalysis {
  const totalAvailableCap = teamCapSituations.reduce(
    (sum, team) => sum + team.discretionarySpending,
    0
  );
  
  // Calculate positional markets
  const positionalMarkets: MarketAnalysis['positionalMarkets'] = {};
  
  for (const position of POSITIONS) {
    const positionPlayers = predictedPlayers.filter(p => p.position === position);
    
    if (positionPlayers.length === 0) {
      continue;
    }
    
    const prices = positionPlayers.map(p => p.estimatedAuctionPrice || LEAGUE_MINIMUM);
    const averagePrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const topPrice = Math.max(...prices);
    
    // Count teams needing this position
    const demandCount = teamCapSituations.filter(team => {
      const need = team.positionalNeeds.find(n => n.position === position);
      return need && need.targetAcquisitions > 0;
    }).length;
    
    const scarcityIndex = demandCount / Math.max(1, positionPlayers.length);
    
    positionalMarkets[position] = {
      availablePlayers: positionPlayers.length,
      averagePlayerValue: averagePrice,
      topPlayerValue: topPrice,
      totalDemand: demandCount,
      scarcityIndex,
      projectedPriceInflation: scarcityIndex > 1 ? (scarcityIndex - 1) * 0.5 : 0,
    };
  }
  
  // Find value opportunities (players priced below their ranking)
  const allPrices = predictedPlayers.map(p => p.estimatedAuctionPrice || LEAGUE_MINIMUM);
  const medianPrice = allPrices.sort((a, b) => a - b)[Math.floor(allPrices.length / 2)];
  
  const valueOpportunities = predictedPlayers
    .filter(p => {
      if (!p.compositeRank || !p.estimatedAuctionPrice) return false;
      const expectedPrice = medianPrice * (100 / p.compositeRank);
      return p.estimatedAuctionPrice < expectedPrice * 0.8;
    })
    .slice(0, 10)
    .map(p => ({
      player: p,
      estimatedPrice: p.estimatedAuctionPrice!,
      fairValue: medianPrice * (100 / (p.compositeRank || 100)),
      expectedDiscount: 0.2,
      reason: 'Ranked higher than market price suggests',
    }));
  
  const overvaluedRisks = predictedPlayers
    .filter(p => {
      if (!p.compositeRank || !p.estimatedAuctionPrice) return false;
      const expectedPrice = medianPrice * (100 / p.compositeRank);
      return p.estimatedAuctionPrice > expectedPrice * 1.2;
    })
    .slice(0, 10)
    .map(p => ({
      player: p,
      estimatedPrice: p.estimatedAuctionPrice!,
      fairValue: medianPrice * (100 / (p.compositeRank || 100)),
      expectedPremium: 0.2,
      reason: 'Market price exceeds ranking value',
    }));
  
  return {
    totalAvailableCap,
    totalAvailablePlayers: predictedPlayers.length,
    positionalMarkets,
    expectedAveragePriceChange: 0.05, // Would compare to historical
    marketEfficiency: 0.75, // Would calculate from variance
    valueOpportunities,
    overvaluedRisks,
  };
}

/**
 * Default auction price factors
 */
export const DEFAULT_AUCTION_FACTORS: AuctionPriceFactors = {
  dynastyWeight: 0.6,
  redraftWeight: 0.4,
  preferredContractLength: 3,
  contractLengthImpact: 0.15,
  inflationFactor: 0.05,
  positionalPremiums: {
    QB: 0.1,
    RB: 0.05,
    WR: 0,
    TE: -0.05,
    PK: -0.2,
    DEF: -0.15,
  },
  ageDiscountCurve: {
    22: 0,
    23: 0,
    24: 0,
    25: 0,
    26: 0.02,
    27: 0.05,
    28: 0.08,
    29: 0.12,
    30: 0.18,
    31: 0.25,
    32: 0.35,
    33: 0.45,
    34: 0.55,
  },
  injuryRiskDiscount: 0.15,
  useHistoricalData: true,
  historicalWeight: 0.3,
};
