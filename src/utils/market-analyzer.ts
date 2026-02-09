import type { 
    MarketAnalysis, 
    PlayerValuation, 
    TeamCapSituation,
    PositionScarcityAnalysis
  } from '../types/auction-predictor';
  
  import { calculatePositionalScarcity } from './auction-price-calculator';
  
  /**
   * Generates a comprehensive analysis of the free agent market
   */
  export function analyzeMarket(
    availablePlayers: PlayerValuation[],
    teamCapSituations: TeamCapSituation[]
  ): MarketAnalysis {
    
    // 1. Calculate League Totals
    const totalAvailableCap = teamCapSituations.reduce(
      (sum, team) => sum + team.discretionarySpending, 
      0
    );
  
    const totalPlayers = availablePlayers.length;
    const averagePricePerPlayer = totalPlayers > 0 ? totalAvailableCap / totalPlayers : 0;
  
    // 2. Positional Analysis
    const positionalMarkets: Record<string, any> = {};
    const positions = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];
  
    for (const position of positions) {
      const scarcity = calculatePositionalScarcity(position, availablePlayers, teamCapSituations);
      
      const positionPlayers = availablePlayers.filter(p => p.position === position);
      const prices = positionPlayers.map(p => p.estimatedAuctionPrice || 0);
      const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
      const topPrice = prices.length > 0 ? Math.max(...prices) : 0;
  
      positionalMarkets[position] = {
        availablePlayers: positionPlayers.length,
        averagePlayerValue: avgPrice,
        topPlayerValue: topPrice,
        totalDemand: scarcity.teamsNeedingStarters, // Or calculate total targetAcquisitions
        scarcityIndex: scarcity.scarcityScore / 100, // Normalized 0-1
        projectedPriceInflation: scarcity.priceImpactMultiplier - 1
      };
    }
  
    // 3. Identify Opportunities & Risks
    // Find players where Estimated Price < Intrinsic Value (Good Deal)
    // Intrinsic Value is roughly based on Rank. 
    // We assume the input `availablePlayers` already has `estimatedAuctionPrice` calculated.
    
    const valueOpportunities = availablePlayers
      .filter(p => {
         // Heuristic: If market price is significantly lower than rank-implied value
         // We need a proxy for "Fair Value" if it's not explicitly on the object
         // For now, we assume fairValue ~ estimatedPrice / (1 + inflation)
         
         // A better check: Compare this player's price to the average price of players 
         // with similar rank (+/- 5 spots)
         return false; // TODO: Implement robust value detection once Fair Value is separated
      })
      .slice(0, 10)
      .map(p => ({
        player: p,
        estimatedPrice: p.estimatedAuctionPrice || 0,
        fairValue: 0, // Placeholder
        expectedDiscount: 0,
        reason: "Value logic pending"
      }));
  
      const overvaluedPlayers = availablePlayers
      .slice(0, 10) // Placeholder
      .map(p => ({
        player: p,
        estimatedPrice: p.estimatedAuctionPrice || 0,
        fairValue: 0,
        expectedPremium: 0,
        reason: "Risk logic pending"
      }));
  
    return {
      totalAvailableCap,
      totalAvailablePlayers: totalPlayers,
      averagePricePerPlayer, // Missing in interface? Added to return object
      positionalMarkets,
      valueOpportunities,
      overvaluedRisks: overvaluedPlayers,
      expectedAveragePriceChange: 0,
      marketEfficiency: 0
    };
  }
  
  export function getMarketSummary(analysis: MarketAnalysis): string {
    const scarcePositions = Object.entries(analysis.positionalMarkets)
      .filter(([_, data]) => data.scarcityIndex > 0.6) // Threshold for "Scarce"
      .map(([pos]) => pos);
      
    if (scarcePositions.length === 0) return "Balanced Market";
    return `High demand for ${scarcePositions.join(', ')}`;
  }
  
  export function getPositionAdvice(position: string, analysis: MarketAnalysis): string {
    const market = analysis.positionalMarkets[position];
    if (!market) return "No data";
  
    if (market.scarcityIndex > 0.7) return "🔥 SEVERE SHORTAGE - Expect to overpay";
    if (market.scarcityIndex > 0.5) return "⚠️ Competitive - Bid aggressively early";
    if (market.scarcityIndex < 0.3) return "✅ Buyers Market - Wait for deals";
    return "⚖️ Balanced - Fair prices expected";
  }