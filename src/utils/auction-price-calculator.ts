/**
 * Auction Price Calculator
 * 
 * Predicts auction prices for free agents based on:
 * - Player rankings (dynasty/redraft weighted)
 * - Historical Salary Curves (Max/Avg/Min)
 * - Available cap space across league
 * - Position scarcity
 * - Contract length preferences
 */

import type {
    PlayerValuation,
    MarketAnalysis,
    TeamCapSituation,
    AuctionPriceFactors,
    PositionScarcityAnalysis,
  } from '../types/auction-predictor';
import historicalCurves from '../../data/theleague/historical-salary-curves.json';
  
  const LEAGUE_MINIMUM = 425_000;
  const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];
  
  export interface HistoricalCurveParameters {
    basePrice: number;
    decayRate: number;
    dataPoints?: number;
  }
  
  export interface PositionCurves {
    max: HistoricalCurveParameters;
    avg: HistoricalCurveParameters;
    min: HistoricalCurveParameters;
  }

  // Cast JSON data to typed interface
  const curves = historicalCurves as unknown as Record<string, PositionCurves>;
  
  // Re-export types for consumers
  export type PricingModel = 'min' | 'average' | 'max';

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
    rankMultiplier: number; // Deprecated/Baked-in
    ageMultiplier: number;
    scarcityMultiplier: number;
    demandMultiplier: number; // Deprecated/Baked-in
    finalPrice: number;
    confidence: number;
  }

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
      // Heuristic for "Quality": Top 30 at pos or has significant projected points
      return (p.compositeRank && p.compositeRank <= 100) || (p.projectedPoints && p.projectedPoints > 100);
    }).length;
    
    // Demand: Teams needing this position
    const teamsNeedingStarters = teamCapSituations.filter(team => {
      // Safety check for test mocks
      if (!team.positionalNeeds) return false;
      const need = team.positionalNeeds.find(n => n.position === position);
      return need && (need.priority === 'critical' || need.priority === 'high');
    }).length;
    
    const totalDemand = teamCapSituations.reduce((sum, team) => {
      if (!team.positionalNeeds) return sum;
      const need = team.positionalNeeds.find(n => n.position === position);
      return sum + (need?.targetAcquisitions || 0);
    }, 0);
    
    // Scarcity Calculation
    const supplyDemandRatio = Math.max(1, totalDemand) / Math.max(1, qualityStartersAvailable);
    const scarcityScore = Math.min(100, Math.max(0, (supplyDemandRatio - 0.5) * 66));
    
    // Price Multiplier
    const priceImpactMultiplier = 0.9 + (scarcityScore / 100) * 0.6;
    
    return {
      position,
      currentRosteredPlayers: 0,
      qualityStartersAvailable,
      expiringContracts: positionPlayers.length,
      rookiesExpected: 0,
      totalLeagueStartingSpots: 16,
      teamsNeedingStarters,
      averageDepthPerTeam: 0,
      scarcityScore,
      priceImpactMultiplier,
      topTierSize: positionPlayers.filter(p => p.compositeRank && p.compositeRank <= 20).length,
      replacementLevel: LEAGUE_MINIMUM,
    };
  }
  
  /**
   * Calculate Intrinsic Value using Historical Salary Curves
   * Selects Max/Avg/Min curve based on Player Quality
   */
  function calculateIntrinsicValue(
    player: PlayerValuation,
    factors: AuctionPriceFactors,
    curvesSource?: Record<string, PositionCurves>
  ): number {
    // 1. Determine Rank
    let rank = 100;
    if (factors.dynastyWeight > 0 && player.dynastyRank) {
       if (factors.redraftWeight === 0) rank = player.dynastyRank;
       else if (player.redraftRank) {
         rank = (player.dynastyRank * factors.dynastyWeight) + (player.redraftRank * factors.redraftWeight);
       }
    } else if (player.redraftRank) {
      rank = player.redraftRank;
    } else if (player.compositeRank) {
      rank = player.compositeRank;
    }
  
    // 2. Get Curves for Position
    // Use injected source or global import
    const positionCurves = curvesSource ? curvesSource[player.position] : curves[player.position];
    
    if (!positionCurves) {
      // Fallback logic
      return Math.max(LEAGUE_MINIMUM, 10000000 - (rank * 200000));
    }
  
    // 3. Determine Curve Interpolation based on Quality
    // Elite (Rank 1-5) -> Max Curve
    // Star (Rank 6-12) -> Blend Max/Avg
    // Starter (Rank 13-24) -> Avg Curve
    // Depth (Rank 25+) -> Blend Avg/Min
    
    let curveA: HistoricalCurveParameters;
    let curveB: HistoricalCurveParameters;
    let blendFactor = 0; // 0 = Pure Curve A, 1 = Pure Curve B
  
    if (rank <= 5) {
        // Pure Elite
        curveA = positionCurves.max;
        curveB = positionCurves.max;
        blendFactor = 0;
    } else if (rank <= 12) {
        // Sliding from Max to Avg
        curveA = positionCurves.max;
        curveB = positionCurves.avg;
        blendFactor = (rank - 5) / 7; // 0 at rank 5, 1 at rank 12
    } else if (rank <= 24) {
        // Pure Avg
        curveA = positionCurves.avg;
        curveB = positionCurves.avg;
        blendFactor = 0;
    } else {
        // Sliding from Avg to Min
        curveA = positionCurves.avg;
        curveB = positionCurves.min;
        blendFactor = Math.min(1, (rank - 24) / 20); // 1 at rank 44
    }
  
    // 4. Calculate Exponential Decay for both curves
    const priceA = curveA.basePrice * Math.exp(curveA.decayRate * (rank - 1));
    const priceB = curveB.basePrice * Math.exp(curveB.decayRate * (rank - 1));
    
    // 5. Blend Prices
    const intrinsicValue = (priceA * (1 - blendFactor)) + (priceB * blendFactor);
    
    return Math.max(LEAGUE_MINIMUM, intrinsicValue);
  }
  
  /**
   * Apply age adjustment to price (Risk Discount)
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
   * Calculate/Predict auction price for a single player
   * (Renamed from predictPlayerAuctionPrice to match old export)
   */
  export function calculateAuctionPrice(
    player: PlayerValuation,
    // Note: Signature changed from old version. Consumers need to pass factors/scarcity.
    // Old signature: (player, marketAnalysis, dynastyWeight, allPlayers, pricingModel)
    // New signature needs to adapt or we keep the new one and fix consumers.
    // Let's adapt the inputs to support the test/legacy usage if possible, or force update.
    // Actually, let's keep the NEW signature for internal logic, but export a wrapper if needed.
    // But for now, let's stick to the NEW robust signature and update consumers.
    factors: AuctionPriceFactors,
    scarcityAnalysis: PositionScarcityAnalysis,
    curvesSource?: Record<string, PositionCurves>
  ): PriceCalculationFactors { // Returns Factors object to match old interface
    
    // Step 1: Intrinsic Value (Historical Norms based on Rank + Quality Curve)
    let intrinsicValue = calculateIntrinsicValue(player, factors, curvesSource);
    
    // Step 2: Market Adjustments
    let predictedPrice = applyAgeAdjustment(intrinsicValue, player.age, factors);
    
    // Scarcity Impact
    predictedPrice = predictedPrice * scarcityAnalysis.priceImpactMultiplier;
    
    // Inflation
    predictedPrice = predictedPrice * (1 + factors.inflationFactor);
    
    // Positional Premiums
    const positionPremium = factors.positionalPremiums[player.position] || 0;
    predictedPrice = predictedPrice * (1 + positionPremium);
    
    // Rounding
    if (predictedPrice < 2000000) {
        predictedPrice = Math.round(predictedPrice / 25000) * 25000;
    } else {
        predictedPrice = Math.round(predictedPrice / 50000) * 50000;
    }
    
    predictedPrice = Math.max(LEAGUE_MINIMUM, predictedPrice);
    
    // Confidence
    const confidence = 0.8; // High confidence with multi-curve model
    
    return {
      basePrice: intrinsicValue,
      rankMultiplier: 1.0, // Baked into intrinsic
      ageMultiplier: (1 - (factors.ageDiscountCurve[player.age] || 0)),
      scarcityMultiplier: scarcityAnalysis.priceImpactMultiplier,
      demandMultiplier: 1.0, // Baked into scarcity
      finalPrice: predictedPrice,
      confidence
    };
  }
  
  /**
   * Batch calculate prices for all players
   * (Renamed from predictAllAuctionPrices)
   */
  export function calculateAllPlayerPrices(
    availablePlayers: PlayerValuation[],
    teamCapSituations: TeamCapSituation[],
    factors: AuctionPriceFactors,
    curvesSource?: Record<string, PositionCurves>
  ): Map<string, { factors: PriceCalculationFactors; contracts: ContractPricing }> {
    
    const scarcityByPosition = new Map<string, PositionScarcityAnalysis>();
    for (const position of POSITIONS) {
      const scarcity = calculatePositionalScarcity(
        position,
        availablePlayers,
        teamCapSituations
      );
      scarcityByPosition.set(position, scarcity);
    }
    
    const results = new Map();

    // Sort first for consistency
    const players = [...availablePlayers].sort((a, b) => (a.compositeRank || 999) - (b.compositeRank || 999));

    for (const player of players) {
      const scarcity = scarcityByPosition.get(player.position)!;
      
      const factorsResult = calculateAuctionPrice(
        player,
        factors,
        scarcity,
        curvesSource
      );

      const contracts = generateContractPricing(player, factorsResult.finalPrice, factorsResult.ageMultiplier);

      results.set(player.id, { factors: factorsResult, contracts });
    }
    
    return results;
  }
  
  export const DEFAULT_AUCTION_FACTORS: AuctionPriceFactors = {
    dynastyWeight: 0.6,
    redraftWeight: 0.4,
    preferredContractLength: 3,
    contractLengthImpact: 0.15,
    inflationFactor: 0.05,
    positionalPremiums: {
      QB: 0.0,
      RB: 0.05,
      WR: 0,
      TE: 0,
      PK: -0.2,
      DEF: -0.15,
    },
    ageDiscountCurve: {
      22: 0, 23: 0, 24: 0, 25: 0, 
      26: 0.0, 27: 0.05, 
      28: 0.10, 29: 0.15, 
      30: 0.25, 31: 0.35, 
      32: 0.45, 33: 0.55, 
      34: 0.65, 35: 0.75,
      36: 0.85
    },
    injuryRiskDiscount: 0.15,
    useHistoricalData: true,
    historicalWeight: 1.0,
  };

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
