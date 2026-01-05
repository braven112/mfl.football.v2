/**
 * Auction Price Predictor Types
 * 
 * Comprehensive type definitions for predicting auction prices in the upcoming
 * free agency period, including franchise tag predictions and market analysis.
 */

export interface PlayerValuation {
  // Player Identity
  id: string;
  name: string;
  position: 'QB' | 'RB' | 'WR' | 'TE' | 'PK' | 'DEF';
  team: string; // NFL team
  
  // Current Contract Status
  currentSalary: number;
  contractYearsRemaining: number;
  franchiseId: string | null; // null if free agent
  
  // Player Value Metrics
  dynastyRank?: number; // From external rankings (FantasyPros, DLF)
  redraftRank?: number; // From external rankings
  compositeRank?: number; // Calculated weighted average
  projectedPoints?: number; // Season projection
  age: number;
  experience: number;
  
  // Contract & Tag Status
  isExpiring: boolean; // Contract expires this offseason
  isFranchiseTagCandidate: boolean;
  franchiseTagProbability: number; // 0-1
  franchiseTagSalary?: number; // If tagged, this would be salary
  
  // Auction Predictions
  estimatedAuctionPrice?: number;
  priceConfidenceRange?: {
    low: number;
    high: number;
    confidence: number; // 0-1
  };
  
  // Market Context
  positionalScarcity?: number; // 0-1, higher = more scarce
  demandScore?: number; // How many teams need this position
  
  // Historical Data
  historicalAuctionPrices?: number[];
  lastAuctionPrice?: number;
  lastAuctionYear?: number;
}

export interface FranchiseTagPrediction {
  franchiseId: string;
  teamName: string;
  
  // Tag Status
  hasTag: boolean; // Each team gets one
  taggedPlayer: PlayerValuation | null;
  
  // Candidates
  tagCandidates: Array<{
    player: PlayerValuation;
    score: number; // Algorithm score for likelihood
    reasons: string[]; // Why this player might be tagged
  }>;
  
  // Manual Override
  isManualOverride: boolean;
  manuallyTaggedPlayerId?: string;
}

export interface TeamCapSituation {
  franchiseId: string;
  teamName: string;
  rosterSize?: number;
  
  // Current Cap
  currentCapSpace: number; // As of end of 2025 season
  
  // 2026 Projections
  projectedCapSpace2026: number; // After salary escalations
  committedSalaries: number; // Players under contract
  deadMoney: number; // Released players
  
  // Contract Expirations
  expiringContracts: PlayerValuation[];
  totalExpiringValue: number;
  
  // Franchise Tag Impact
  franchiseTagCommitment: number; // If they use tag
  availableAfterTag: number; // Cap space after potential tag
  
  // Free Agency Needs
  estimatedMinimumRosterSpend: number; // To fill roster to 20
  discretionarySpending: number; // Above minimum
  
  // Positional Needs
  positionalNeeds: {
    position: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    currentDepth: number;
    targetAcquisitions: number;
  }[];
}

export interface MarketAnalysis {
  // Total Market
  totalAvailableCap: number; // Sum of all team cap space
  totalAvailablePlayers: number; // Players entering auction
  
  // By Position
  positionalMarkets: {
    [position: string]: {
      availablePlayers: number;
      averagePlayerValue: number;
      topPlayerValue: number;
      totalDemand: number; // How many teams need this position
      scarcityIndex: number; // demand / supply
      projectedPriceInflation: number; // % above normal
    };
  };
  
  // Price Trends
  expectedAveragePriceChange: number; // % vs last year
  marketEfficiency: number; // How competitive is bidding
  
  // Opportunities
  valueOpportunities: Array<{
    player: PlayerValuation;
    estimatedPrice: number;
    fairValue: number;
    expectedDiscount: number; // % below fair value
    reason: string;
  }>;
  
  overvaluedRisks: Array<{
    player: PlayerValuation;
    estimatedPrice: number;
    fairValue: number;
    expectedPremium: number; // % above fair value
    reason: string;
  }>;
}

export interface AuctionPriceFactors {
  // Input Rankings
  dynastyWeight: number; // 0-1, slider controlled
  redraftWeight: number; // 0-1, slider controlled
  
  // Contract Length Preference
  preferredContractLength: number; // 1-5 years
  contractLengthImpact: number; // How much length affects price
  
  // Market Conditions
  inflationFactor: number; // Overall market inflation
  positionalPremiums: { [position: string]: number };
  
  // Risk Tolerance
  ageDiscountCurve: { [age: number]: number }; // Discount for older players
  injuryRiskDiscount: number;
  
  // Historical Patterns
  useHistoricalData: boolean;
  historicalWeight: number; // 0-1
}

export interface AuctionSimulation {
  id: string;
  name: string;
  createdAt: Date;
  
  // Configuration
  factors: AuctionPriceFactors;
  franchiseTagOverrides: Map<string, string>; // franchiseId -> playerId
  
  // Results
  playerPredictions: PlayerValuation[];
  marketAnalysis: MarketAnalysis;
  teamCapSituations: TeamCapSituation[];
  franchiseTagPredictions: FranchiseTagPrediction[];
  
  // Comparison
  comparisonToBaseline?: {
    priceDifferences: Map<string, number>; // playerId -> price delta
    marketImpact: string;
  };
}

export interface PlayerRankingImport {
  source: 'fantasypros' | 'dynastyleaguefootball' | 'custom' | 'sleeper';
  rankingType: 'dynasty' | 'redraft';
  importDate: Date;
  
  rankings: Array<{
    rank: number;
    playerId?: string; // MFL ID if matched
    playerName: string;
    position: string;
    team: string;
    tier?: number;
    notes?: string;
    matched: boolean; // Successfully matched to MFL player
  }>;
}

export interface HistoricalAuctionData {
  year: number;
  playerId: string;
  playerName: string;
  position: string;
  
  // Auction Details
  winningBid: number;
  contractYears: number;
  winningTeam: string;
  
  // Competition
  numberOfBidders: number;
  secondHighestBid?: number;
  
  // Context
  playerAge: number;
  prevYearPoints?: number;
  prevYearRank?: number;
}

export interface ContractEscalation {
  playerId: string;
  baseYear: number;
  baseSalary: number;
  contractYears: number;
  
  // Escalation Schedule (10% annual)
  yearlySchedule: Array<{
    year: number;
    salary: number;
    capHit: number;
  }>;
  
  totalContractValue: number;
  averageAnnualValue: number;
}

export interface PositionScarcityAnalysis {
  position: string;
  
  // Supply
  currentRosteredPlayers: number;
  qualityStartersAvailable: number; // Players worth starting
  expiringContracts: number;
  rookiesExpected: number; // From upcoming draft
  
  // Demand
  totalLeagueStartingSpots: number; // Sum of max starters at position
  teamsNeedingStarters: number;
  averageDepthPerTeam: number;
  
  // Analysis
  scarcityScore: number; // 0-100
  priceImpactMultiplier: number; // How much scarcity inflates price
  topTierSize: number; // How many "elite" players
  replacementLevel: number; // Minimum viable player threshold
}
