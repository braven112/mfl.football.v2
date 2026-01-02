/**
 * Market Analyzer
 * 
 * Analyzes the auction market to identify:
 * - League-wide supply and demand dynamics
 * - Positional scarcity and price inflation
 * - Value opportunities (underpriced players)
 * - Overvalued risks (overpriced players)
 * 
 * Helps users make strategic auction decisions based on market efficiency.
 */

import type { PlayerValuation, TeamCapSituation, MarketAnalysis } from '../types/auction-predictor';
import type { PositionalNeed } from './draft-pick-cap-impact';

const SALARY_CAP = 45_000_000;
const MIN_ROSTER_SIZE = 20;

/**
 * Positional market data
 */
interface PositionalMarket {
  position: string;
  availablePlayers: number;
  qualityPlayers: number; // Top 100 overall or position-specific threshold
  topPlayerPrice: number;
  averagePrice: number;
  medianPrice: number;
  totalDemand: number; // Number of teams needing this position
  scarcityIndex: number; // demand / supply (higher = scarcer)
  inflationFactor: number; // Price multiplier due to scarcity (1.0 = normal, 1.5 = 50% inflation)
  projectedPriceRange: {
    low: number;
    high: number;
  };
}

/**
 * Value opportunity
 */
interface ValueOpportunity {
  player: PlayerValuation;
  estimatedPrice: number;
  fairValue: number;
  discount: number; // Dollar amount
  discountPercent: number;
  reason: string;
  confidence: number; // 0-1
}

/**
 * Overvalued player risk
 */
interface OvervaluedRisk {
  player: PlayerValuation;
  estimatedPrice: number;
  fairValue: number;
  premium: number; // Dollar amount
  premiumPercent: number;
  reason: string;
  riskLevel: 'moderate' | 'high' | 'severe';
}

/**
 * Calculate positional scarcity for a specific position
 */
function calculatePositionalScarcity(
  position: string,
  availablePlayers: PlayerValuation[],
  teamNeeds: Map<string, PositionalNeed[]>
): {
  scarcityIndex: number;
  inflationFactor: number;
  demand: number;
} {
  // Count how many teams need this position
  let demand = 0;
  teamNeeds.forEach(needs => {
    const positionNeed = needs.find(n => n.position === position);
    if (positionNeed && positionNeed.gap > 0) {
      demand += positionNeed.gap;
    }
  });
  
  // Count available quality players at this position
  const positionPlayers = availablePlayers.filter(p => p.position === position);
  const qualityThreshold = position === 'QB' ? 200 : 150; // QBs have lower threshold
  const qualityPlayers = positionPlayers.filter(p => 
    (p.compositeRank || 999) <= qualityThreshold
  ).length;
  
  const supply = Math.max(1, qualityPlayers); // Avoid division by zero
  
  // Calculate scarcity index (demand / supply)
  const scarcityIndex = demand / supply;
  
  // Calculate inflation factor
  // Scarcity < 0.5 = oversupply (-10% to 0%)
  // Scarcity 0.5-1.0 = balanced (0% to +10%)
  // Scarcity 1.0-2.0 = scarce (+10% to +30%)
  // Scarcity > 2.0 = very scarce (+30% to +50%)
  let inflationFactor = 1.0;
  
  if (scarcityIndex < 0.5) {
    inflationFactor = 0.90 + (scarcityIndex * 0.2); // 0.90 to 1.00
  } else if (scarcityIndex <= 1.0) {
    inflationFactor = 1.0 + ((scarcityIndex - 0.5) * 0.2); // 1.00 to 1.10
  } else if (scarcityIndex <= 2.0) {
    inflationFactor = 1.10 + ((scarcityIndex - 1.0) * 0.2); // 1.10 to 1.30
  } else {
    inflationFactor = 1.30 + (Math.min(scarcityIndex - 2.0, 1.0) * 0.2); // 1.30 to 1.50 (capped)
  }
  
  return {
    scarcityIndex,
    inflationFactor,
    demand,
  };
}

/**
 * Analyze a specific positional market
 */
function analyzePositionalMarket(
  position: string,
  availablePlayers: PlayerValuation[],
  teamNeeds: Map<string, PositionalNeed[]>
): PositionalMarket {
  const positionPlayers = availablePlayers.filter(p => p.position === position);
  
  // Get scarcity metrics
  const { scarcityIndex, inflationFactor, demand } = calculatePositionalScarcity(
    position,
    availablePlayers,
    teamNeeds
  );
  
  // Calculate price statistics
  const prices = positionPlayers
    .map(p => p.estimatedAuctionPrice || 0)
    .filter(p => p > 0)
    .sort((a, b) => a - b);
  
  const averagePrice = prices.length > 0
    ? prices.reduce((sum, p) => sum + p, 0) / prices.length
    : 0;
  
  const medianPrice = prices.length > 0
    ? prices[Math.floor(prices.length / 2)]
    : 0;
  
  const topPlayerPrice = prices.length > 0
    ? Math.max(...prices)
    : 0;
  
  // Quality players
  const qualityThreshold = position === 'QB' ? 200 : 150;
  const qualityPlayers = positionPlayers.filter(p => 
    (p.compositeRank || 999) <= qualityThreshold
  ).length;
  
  // Projected price range (±20% from average, adjusted for scarcity)
  const baseRange = averagePrice * 0.2;
  const projectedPriceRange = {
    low: Math.round(averagePrice - baseRange),
    high: Math.round((averagePrice + baseRange) * inflationFactor),
  };
  
  return {
    position,
    availablePlayers: positionPlayers.length,
    qualityPlayers,
    topPlayerPrice,
    averagePrice,
    medianPrice,
    totalDemand: demand,
    scarcityIndex,
    inflationFactor,
    projectedPriceRange,
  };
}

/**
 * Identify value opportunities (underpriced players)
 */
function identifyValueOpportunities(
  availablePlayers: PlayerValuation[],
  positionalMarkets: Map<string, PositionalMarket>,
  minDiscountPercent: number = 20
): ValueOpportunity[] {
  const opportunities: ValueOpportunity[] = [];
  
  availablePlayers.forEach(player => {
    const estimatedPrice = player.estimatedAuctionPrice || 0;
    
    // Calculate fair value based on multiple factors
    let fairValue = estimatedPrice;
    
    // Adjust for positional scarcity
    const market = positionalMarkets.get(player.position);
    if (market && market.inflationFactor > 1.0) {
      fairValue = estimatedPrice * market.inflationFactor;
    }
    
    // Adjust for rank (top 50 = premium, bottom = discount)
    if (player.compositeRank && player.compositeRank <= 50) {
      fairValue *= 1.1; // Top players worth 10% more
    } else if (player.compositeRank && player.compositeRank >= 150) {
      fairValue *= 0.9; // Lower-tier worth 10% less
    }
    
    // Calculate discount
    const discount = fairValue - estimatedPrice;
    const discountPercent = fairValue > 0 ? (discount / fairValue) * 100 : 0;
    
    // Only include if discount meets threshold
    if (discountPercent >= minDiscountPercent) {
      let reason = '';
      let confidence = 0.6;
      
      // Determine reason for opportunity
      if (player.age && player.age < 24) {
        reason = 'Ascending young player undervalued by market';
        confidence = 0.8;
      } else if (market && market.scarcityIndex > 1.5) {
        reason = `High demand at ${player.position} will drive price up`;
        confidence = 0.7;
      } else if (player.compositeRank && player.compositeRank <= 30) {
        reason = 'Elite talent at below-market price';
        confidence = 0.9;
      } else if (discountPercent >= 30) {
        reason = 'Significantly undervalued - market inefficiency';
        confidence = 0.7;
      } else {
        reason = 'Projected below fair market value';
        confidence = 0.6;
      }
      
      opportunities.push({
        player,
        estimatedPrice,
        fairValue,
        discount,
        discountPercent,
        reason,
        confidence,
      });
    }
  });
  
  // Sort by discount percent (best deals first)
  return opportunities.sort((a, b) => b.discountPercent - a.discountPercent);
}

/**
 * Identify overvalued players (risky overpays)
 */
function identifyOvervaluedPlayers(
  availablePlayers: PlayerValuation[],
  positionalMarkets: Map<string, PositionalMarket>,
  minPremiumPercent: number = 20
): OvervaluedRisk[] {
  const risks: OvervaluedRisk[] = [];
  
  availablePlayers.forEach(player => {
    const estimatedPrice = player.estimatedAuctionPrice || 0;
    
    // Calculate fair value
    let fairValue = estimatedPrice;
    
    // Adjust for age decline
    if (player.age && player.age >= 30) {
      fairValue *= 0.85; // 15% discount for age risk
    } else if (player.age && player.age >= 28) {
      fairValue *= 0.95; // 5% discount for approaching decline
    }
    
    // Adjust for oversupply
    const market = positionalMarkets.get(player.position);
    if (market && market.scarcityIndex < 0.7) {
      fairValue *= 0.9; // 10% discount in oversupplied positions
    }
    
    // Calculate premium
    const premium = estimatedPrice - fairValue;
    const premiumPercent = fairValue > 0 ? (premium / fairValue) * 100 : 0;
    
    // Only include if premium meets threshold
    if (premiumPercent >= minPremiumPercent) {
      let reason = '';
      let riskLevel: 'moderate' | 'high' | 'severe' = 'moderate';
      
      // Determine reason and risk level
      if (player.age && player.age >= 32) {
        reason = 'Age 32+ with high decline risk';
        riskLevel = 'severe';
      } else if (player.age && player.age >= 30) {
        reason = 'Aging player with premium price - decline risk';
        riskLevel = 'high';
      } else if (market && market.scarcityIndex < 0.5) {
        reason = `Oversupply at ${player.position} - better options available`;
        riskLevel = 'moderate';
      } else if (premiumPercent >= 40) {
        reason = 'Massive overpay - name recognition premium';
        riskLevel = 'severe';
      } else if (premiumPercent >= 30) {
        reason = 'Significant overpay relative to value';
        riskLevel = 'high';
      } else {
        reason = 'Priced above fair market value';
        riskLevel = 'moderate';
      }
      
      risks.push({
        player,
        estimatedPrice,
        fairValue,
        premium,
        premiumPercent,
        reason,
        riskLevel,
      });
    }
  });
  
  // Sort by premium percent (worst overpays first)
  return risks.sort((a, b) => b.premiumPercent - a.premiumPercent);
}

/**
 * Main market analysis function
 */
export function analyzeMarket(
  availablePlayers: PlayerValuation[],
  teamCapSituations: TeamCapSituation[],
  teamPositionalNeeds: Map<string, PositionalNeed[]>
): MarketAnalysis {
  // Calculate league-wide totals
  const totalAvailableCap = teamCapSituations.reduce(
    (sum, team) => sum + Math.max(0, team.discretionarySpending),
    0
  );
  
  const totalAvailablePlayers = availablePlayers.length;
  
  const averagePlayerPrice = totalAvailablePlayers > 0
    ? totalAvailableCap / totalAvailablePlayers
    : 0;
  
  // Analyze each position
  const positions = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];
  const positionalMarkets = new Map<string, PositionalMarket>();
  
  positions.forEach(position => {
    const market = analyzePositionalMarket(
      position,
      availablePlayers,
      teamPositionalNeeds
    );
    positionalMarkets.set(position, market);
  });
  
  // Identify opportunities and risks
  const valueOpportunities = identifyValueOpportunities(
    availablePlayers,
    positionalMarkets,
    20 // 20% minimum discount
  );
  
  const overvaluedRisks = identifyOvervaluedPlayers(
    availablePlayers,
    positionalMarkets,
    20 // 20% minimum premium
  );
  
  // Calculate overall market efficiency
  const totalPrices = availablePlayers.reduce(
    (sum, p) => sum + (p.estimatedAuctionPrice || 0),
    0
  );
  
  const marketEfficiency = totalAvailableCap > 0
    ? totalPrices / totalAvailableCap
    : 1.0;
  
  // Determine expected price change
  let expectedAveragePriceChange = 0;
  if (marketEfficiency > 1.1) {
    expectedAveragePriceChange = 10; // Prices likely 10% higher (seller's market)
  } else if (marketEfficiency < 0.9) {
    expectedAveragePriceChange = -10; // Prices likely 10% lower (buyer's market)
  } else {
    expectedAveragePriceChange = 0; // Balanced market
  }
  
  // Convert positional markets map to object
  const positionalMarketsObj: { [position: string]: any } = {};
  positionalMarkets.forEach((market, position) => {
    positionalMarketsObj[position] = {
      availablePlayers: market.availablePlayers,
      averagePlayerValue: market.averagePrice,
      topPlayerValue: market.topPlayerPrice,
      totalDemand: market.totalDemand,
      scarcityIndex: market.scarcityIndex,
      projectedPriceInflation: (market.inflationFactor - 1.0) * 100, // Convert to percentage
    };
  });
  
  return {
    totalAvailableCap,
    totalAvailablePlayers,
    positionalMarkets: positionalMarketsObj,
    expectedAveragePriceChange,
    marketEfficiency,
    valueOpportunities: valueOpportunities.map(opp => ({
      player: opp.player,
      estimatedPrice: opp.estimatedPrice,
      fairValue: opp.fairValue,
      expectedDiscount: opp.discountPercent,
      reason: opp.reason,
    })),
    overvaluedRisks: overvaluedRisks.map(risk => ({
      player: risk.player,
      estimatedPrice: risk.estimatedPrice,
      fairValue: risk.fairValue,
      expectedPremium: risk.premiumPercent,
      reason: risk.reason,
    })),
  };
}

/**
 * Get market summary for display
 */
export function getMarketSummary(analysis: MarketAnalysis): {
  totalCapAvailable: string;
  totalPlayers: number;
  avgPricePerPlayer: string;
  marketType: 'seller' | 'buyer' | 'balanced';
  topOpportunities: number;
  topRisks: number;
  scarcestPosition: string;
  oversuppliedPosition: string;
} {
  const avgPrice = analysis.totalAvailablePlayers > 0
    ? analysis.totalAvailableCap / analysis.totalAvailablePlayers
    : 0;
  
  let marketType: 'seller' | 'buyer' | 'balanced' = 'balanced';
  if (analysis.marketEfficiency > 1.1) {
    marketType = 'seller'; // More demand than supply
  } else if (analysis.marketEfficiency < 0.9) {
    marketType = 'buyer'; // More supply than demand
  }
  
  // Find scarcest and oversupplied positions
  let scarcestPosition = 'N/A';
  let maxScarcity = 0;
  let oversuppliedPosition = 'N/A';
  let minScarcity = 999;
  
  Object.entries(analysis.positionalMarkets).forEach(([position, market]) => {
    if (market.scarcityIndex > maxScarcity) {
      maxScarcity = market.scarcityIndex;
      scarcestPosition = position;
    }
    if (market.scarcityIndex < minScarcity) {
      minScarcity = market.scarcityIndex;
      oversuppliedPosition = position;
    }
  });
  
  return {
    totalCapAvailable: `$${(analysis.totalAvailableCap / 1_000_000).toFixed(1)}M`,
    totalPlayers: analysis.totalAvailablePlayers,
    avgPricePerPlayer: `$${(avgPrice / 1_000_000).toFixed(2)}M`,
    marketType,
    topOpportunities: analysis.valueOpportunities.length,
    topRisks: analysis.overvaluedRisks.length,
    scarcestPosition,
    oversuppliedPosition,
  };
}

/**
 * Get position-specific advice
 */
export function getPositionAdvice(
  position: string,
  analysis: MarketAnalysis
): {
  scarcityLevel: 'abundant' | 'balanced' | 'scarce' | 'very-scarce';
  advice: string;
  expectedPriceChange: string;
} {
  const market = analysis.positionalMarkets[position];
  
  if (!market) {
    return {
      scarcityLevel: 'balanced',
      advice: 'No market data available for this position',
      expectedPriceChange: '0%',
    };
  }
  
  let scarcityLevel: 'abundant' | 'balanced' | 'scarce' | 'very-scarce';
  let advice = '';
  
  if (market.scarcityIndex < 0.7) {
    scarcityLevel = 'abundant';
    advice = `Plenty of ${position}s available. Be patient and target value. Don't overpay.`;
  } else if (market.scarcityIndex < 1.3) {
    scarcityLevel = 'balanced';
    advice = `${position} market is balanced. Fair prices expected. Lock in your targets early.`;
  } else if (market.scarcityIndex < 2.0) {
    scarcityLevel = 'scarce';
    advice = `${position} is scarce. Expect competitive bidding. Have backup targets ready.`;
  } else {
    scarcityLevel = 'very-scarce';
    advice = `CRITICAL SHORTAGE at ${position}! Prices will be inflated. Consider pivoting strategy or overpaying for top talent.`;
  }
  
  const expectedPriceChange = `${market.projectedPriceInflation >= 0 ? '+' : ''}${market.projectedPriceInflation.toFixed(0)}%`;
  
  return {
    scarcityLevel,
    advice,
    expectedPriceChange,
  };
}

/**
 * Export types for external use
 */
export type {
  PositionalMarket,
  ValueOpportunity,
  OvervaluedRisk,
};
