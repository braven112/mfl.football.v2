/**
 * Unit tests for market-analyzer.ts
 *
 * Tests market analysis utilities:
 * - Positional scarcity calculations
 * - Market analysis (supply/demand dynamics)
 * - Value opportunity identification
 * - Overvalued player detection
 * - Market summary generation
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeMarket,
  getMarketSummary,
  getPositionAdvice
} from '../src/utils/market-analyzer';
import type {
  PlayerValuation,
  TeamCapSituation,
  MarketAnalysis
} from '../src/types/auction-predictor';
import type { PositionalNeed } from '../src/utils/draft-pick-cap-impact';

// ============================================================================
// Mock Data Helpers
// ============================================================================

function createMockPlayer(overrides: Partial<PlayerValuation> = {}): PlayerValuation {
  return {
    id: 'player1',
    name: 'Test Player',
    position: 'WR',
    currentTeam: 'Team A',
    currentSalary: 5_000_000,
    contractYearsRemaining: 1,
    estimatedAuctionPrice: 8_000_000,
    age: 26,
    compositeRank: 50,
    ...overrides,
  };
}

function createMockTeamCap(overrides: Partial<TeamCapSituation> = {}): TeamCapSituation {
  return {
    franchiseId: '0001',
    teamName: 'Test Team',
    totalSalaryCap: 45_000_000,
    currentSalaryCommitted: 35_000_000,
    projectedCapSpace2026: 10_000_000,
    discretionarySpending: 8_000_000,
    expiringContracts: [],
    draftPickCapImpact: 500_000,
    deadMoney: 1_000_000,
    projectedFranchiseTagCost: 0,
    ...overrides,
  };
}

function createMockPositionalNeed(
  position: string,
  gap: number
): PositionalNeed {
  return {
    position,
    gap,
    priority: gap > 2 ? 'high' : gap > 1 ? 'medium' : 'low',
  };
}

// ============================================================================
// analyzeMarket() Tests
// ============================================================================

describe('analyzeMarket', () => {
  it('should calculate total available cap and players correctly', () => {
    const players = [
      createMockPlayer({ id: '1', estimatedAuctionPrice: 5_000_000 }),
      createMockPlayer({ id: '2', estimatedAuctionPrice: 7_000_000 }),
      createMockPlayer({ id: '3', estimatedAuctionPrice: 3_000_000 }),
    ];

    const teamCaps = [
      createMockTeamCap({ discretionarySpending: 10_000_000 }),
      createMockTeamCap({ discretionarySpending: 8_000_000 }),
      createMockTeamCap({ discretionarySpending: 12_000_000 }),
    ];

    const teamNeeds = new Map<string, PositionalNeed[]>();

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    expect(result.totalAvailablePlayers).toBe(3);
    expect(result.totalAvailableCap).toBe(30_000_000);
  });

  it('should ignore negative cap space when calculating total available cap', () => {
    const players = [createMockPlayer()];

    const teamCaps = [
      createMockTeamCap({ discretionarySpending: 10_000_000 }),
      createMockTeamCap({ discretionarySpending: -5_000_000 }), // Negative cap
      createMockTeamCap({ discretionarySpending: 8_000_000 }),
    ];

    const teamNeeds = new Map<string, PositionalNeed[]>();

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    // Should only sum positive cap space
    expect(result.totalAvailableCap).toBe(18_000_000);
  });

  it('should analyze positional markets for all major positions', () => {
    const players = [
      createMockPlayer({ id: '1', position: 'QB', estimatedAuctionPrice: 20_000_000 }),
      createMockPlayer({ id: '2', position: 'RB', estimatedAuctionPrice: 10_000_000 }),
      createMockPlayer({ id: '3', position: 'WR', estimatedAuctionPrice: 15_000_000 }),
      createMockPlayer({ id: '4', position: 'TE', estimatedAuctionPrice: 8_000_000 }),
      createMockPlayer({ id: '5', position: 'PK', estimatedAuctionPrice: 500_000 }),
      createMockPlayer({ id: '6', position: 'DEF', estimatedAuctionPrice: 1_000_000 }),
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 100_000_000 })];
    const teamNeeds = new Map<string, PositionalNeed[]>();

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    expect(result.positionalMarkets).toHaveProperty('QB');
    expect(result.positionalMarkets).toHaveProperty('RB');
    expect(result.positionalMarkets).toHaveProperty('WR');
    expect(result.positionalMarkets).toHaveProperty('TE');
    expect(result.positionalMarkets).toHaveProperty('PK');
    expect(result.positionalMarkets).toHaveProperty('DEF');
  });

  it('should calculate positional market statistics correctly', () => {
    const players = [
      createMockPlayer({ id: '1', position: 'WR', estimatedAuctionPrice: 10_000_000 }),
      createMockPlayer({ id: '2', position: 'WR', estimatedAuctionPrice: 8_000_000 }),
      createMockPlayer({ id: '3', position: 'WR', estimatedAuctionPrice: 6_000_000 }),
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];
    const teamNeeds = new Map<string, PositionalNeed[]>();

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    const wrMarket = result.positionalMarkets['WR'];

    expect(wrMarket.availablePlayers).toBe(3);
    expect(wrMarket.topPlayerValue).toBe(10_000_000);
    expect(wrMarket.averagePlayerValue).toBe(8_000_000); // (10M + 8M + 6M) / 3
  });

  it('should detect seller market (high demand)', () => {
    // Create scenario where total estimated prices > available cap
    const players = [
      createMockPlayer({ id: '1', estimatedAuctionPrice: 30_000_000 }),
      createMockPlayer({ id: '2', estimatedAuctionPrice: 25_000_000 }),
    ];

    const teamCaps = [
      createMockTeamCap({ discretionarySpending: 20_000_000 }), // Total: 20M
    ];

    const teamNeeds = new Map<string, PositionalNeed[]>();

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    // Market efficiency > 1.1 = seller's market
    expect(result.marketEfficiency).toBeGreaterThan(1.1);
    expect(result.expectedAveragePriceChange).toBe(10);
  });

  it('should detect buyer market (high supply)', () => {
    // Create scenario where total estimated prices < available cap
    const players = [
      createMockPlayer({ id: '1', estimatedAuctionPrice: 5_000_000 }),
      createMockPlayer({ id: '2', estimatedAuctionPrice: 3_000_000 }),
    ];

    const teamCaps = [
      createMockTeamCap({ discretionarySpending: 50_000_000 }), // Much more cap than prices
    ];

    const teamNeeds = new Map<string, PositionalNeed[]>();

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    // Market efficiency < 0.9 = buyer's market
    expect(result.marketEfficiency).toBeLessThan(0.9);
    expect(result.expectedAveragePriceChange).toBe(-10);
  });

  it('should detect balanced market', () => {
    const players = [
      createMockPlayer({ id: '1', estimatedAuctionPrice: 10_000_000 }),
      createMockPlayer({ id: '2', estimatedAuctionPrice: 8_000_000 }),
    ];

    const teamCaps = [
      createMockTeamCap({ discretionarySpending: 18_000_000 }), // Matches total prices
    ];

    const teamNeeds = new Map<string, PositionalNeed[]>();

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    // Market efficiency ~1.0 = balanced
    expect(result.marketEfficiency).toBeGreaterThanOrEqual(0.9);
    expect(result.marketEfficiency).toBeLessThanOrEqual(1.1);
    expect(result.expectedAveragePriceChange).toBe(0);
  });

  it('should calculate scarcity index based on demand vs supply', () => {
    const players = [
      createMockPlayer({ id: '1', position: 'QB', compositeRank: 10 }), // Quality player
      createMockPlayer({ id: '2', position: 'QB', compositeRank: 250 }), // Not quality
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];

    // 5 teams need 1 QB each = 5 demand, 1 quality supply
    const teamNeeds = new Map<string, PositionalNeed[]>();
    for (let i = 1; i <= 5; i++) {
      teamNeeds.set(`team${i}`, [createMockPositionalNeed('QB', 1)]);
    }

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    const qbMarket = result.positionalMarkets['QB'];

    // Scarcity = demand / supply = 5 / 1 = 5.0
    expect(qbMarket.scarcityIndex).toBeGreaterThan(2.0); // Very scarce
  });

  it('should apply inflation factor for scarce positions', () => {
    const players = [
      createMockPlayer({ id: '1', position: 'RB', compositeRank: 20, estimatedAuctionPrice: 10_000_000 }),
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];

    // High demand for RBs
    const teamNeeds = new Map<string, PositionalNeed[]>();
    for (let i = 1; i <= 5; i++) {
      teamNeeds.set(`team${i}`, [createMockPositionalNeed('RB', 2)]);
    }

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    const rbMarket = result.positionalMarkets['RB'];

    // High scarcity should result in positive price inflation
    expect(rbMarket.projectedPriceInflation).toBeGreaterThan(0);
  });

  it('should apply deflation factor for oversupplied positions', () => {
    const players = [
      createMockPlayer({ id: '1', position: 'WR', compositeRank: 20, estimatedAuctionPrice: 10_000_000 }),
      createMockPlayer({ id: '2', position: 'WR', compositeRank: 30, estimatedAuctionPrice: 8_000_000 }),
      createMockPlayer({ id: '3', position: 'WR', compositeRank: 40, estimatedAuctionPrice: 7_000_000 }),
      createMockPlayer({ id: '4', position: 'WR', compositeRank: 50, estimatedAuctionPrice: 6_000_000 }),
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];

    // Low demand for WRs (only 1 team needs 1 WR)
    const teamNeeds = new Map<string, PositionalNeed[]>();
    teamNeeds.set('team1', [createMockPositionalNeed('WR', 1)]);

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    const wrMarket = result.positionalMarkets['WR'];

    // Low scarcity (demand=1, supply=4) should result in negative price inflation
    expect(wrMarket.projectedPriceInflation).toBeLessThan(0);
  });
});

// ============================================================================
// Value Opportunities Tests
// ============================================================================

describe('Value Opportunities', () => {
  it('should identify young undervalued players as value opportunities', () => {
    const players = [
      createMockPlayer({
        id: '1',
        position: 'WR',
        age: 23, // Young
        compositeRank: 40,
        estimatedAuctionPrice: 5_000_000,
      }),
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];

    const teamNeeds = new Map<string, PositionalNeed[]>();
    // Create high demand to inflate fair value
    for (let i = 1; i <= 5; i++) {
      teamNeeds.set(`team${i}`, [createMockPositionalNeed('WR', 2)]);
    }

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    // Should identify as value opportunity (young + market will drive price up)
    expect(result.valueOpportunities.length).toBeGreaterThan(0);

    const opportunity = result.valueOpportunities[0];
    expect(opportunity.player.id).toBe('1');
    expect(opportunity.reason).toContain('young');
  });

  it('should identify elite players below market price as opportunities', () => {
    const players = [
      createMockPlayer({
        id: '1',
        position: 'QB',
        compositeRank: 15, // Elite (< 30)
        estimatedAuctionPrice: 15_000_000,
      }),
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];

    const teamNeeds = new Map<string, PositionalNeed[]>();
    // Create scarcity
    for (let i = 1; i <= 3; i++) {
      teamNeeds.set(`team${i}`, [createMockPositionalNeed('QB', 1)]);
    }

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    expect(result.valueOpportunities.length).toBeGreaterThan(0);

    const opportunity = result.valueOpportunities[0];
    expect(opportunity.player.compositeRank).toBeLessThan(30);
  });

  it('should not identify value opportunities if discount < 20%', () => {
    const players = [
      createMockPlayer({
        id: '1',
        position: 'WR',
        compositeRank: 100, // Not elite
        estimatedAuctionPrice: 8_000_000,
      }),
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];

    const teamNeeds = new Map<string, PositionalNeed[]>();
    // Balanced market
    teamNeeds.set('team1', [createMockPositionalNeed('WR', 1)]);

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    // No significant discount, no opportunities
    expect(result.valueOpportunities.length).toBe(0);
  });

  it('should sort value opportunities by discount percent (best first)', () => {
    const players = [
      createMockPlayer({
        id: '1',
        position: 'WR',
        age: 23,
        compositeRank: 25, // Elite
        estimatedAuctionPrice: 5_000_000,
      }),
      createMockPlayer({
        id: '2',
        position: 'WR',
        age: 24,
        compositeRank: 40,
        estimatedAuctionPrice: 6_000_000,
      }),
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];

    const teamNeeds = new Map<string, PositionalNeed[]>();
    // High demand
    for (let i = 1; i <= 5; i++) {
      teamNeeds.set(`team${i}`, [createMockPositionalNeed('WR', 2)]);
    }

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    if (result.valueOpportunities.length > 1) {
      // First opportunity should have higher discount than second
      expect(result.valueOpportunities[0].expectedDiscount).toBeGreaterThanOrEqual(
        result.valueOpportunities[1].expectedDiscount
      );
    }
  });
});

// ============================================================================
// Overvalued Risks Tests
// ============================================================================

describe('Overvalued Risks', () => {
  it('should identify aging players as overvalued risks', () => {
    const players = [
      createMockPlayer({
        id: '1',
        position: 'RB',
        age: 32, // Old
        compositeRank: 50,
        estimatedAuctionPrice: 10_000_000,
      }),
      // Add more RBs to create oversupply which compounds the overvaluation
      createMockPlayer({ id: '2', position: 'RB', compositeRank: 60 }),
      createMockPlayer({ id: '3', position: 'RB', compositeRank: 70 }),
      createMockPlayer({ id: '4', position: 'RB', compositeRank: 80 }),
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];

    const teamNeeds = new Map<string, PositionalNeed[]>();
    // Low demand for RB (only 1 team needs 1 RB)
    teamNeeds.set('team1', [createMockPositionalNeed('RB', 1)]);

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    // Should identify as overvalued (age 32+ = 15% discount + oversupply = 10% discount = 25% total premium)
    expect(result.overvaluedRisks.length).toBeGreaterThan(0);

    const risk = result.overvaluedRisks[0];
    expect(risk.player.id).toBe('1');
    expect(risk.reason).toContain('Age');
  });

  it('should identify players in oversupplied positions as risks', () => {
    const players = [
      createMockPlayer({
        id: '1',
        position: 'TE',
        compositeRank: 100,
        estimatedAuctionPrice: 8_000_000,
      }),
      createMockPlayer({ id: '2', position: 'TE', compositeRank: 50 }),
      createMockPlayer({ id: '3', position: 'TE', compositeRank: 60 }),
      createMockPlayer({ id: '4', position: 'TE', compositeRank: 70 }),
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];

    const teamNeeds = new Map<string, PositionalNeed[]>();
    // Low demand (only 1 team needs 1 TE)
    teamNeeds.set('team1', [createMockPositionalNeed('TE', 1)]);

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    // Oversupplied market should create overvalued risks
    const teMarket = result.positionalMarkets['TE'];
    expect(teMarket.scarcityIndex).toBeLessThan(1.0);
  });

  it('should not identify overvalued risks if premium < 20%', () => {
    const players = [
      createMockPlayer({
        id: '1',
        position: 'WR',
        age: 26, // Prime age
        compositeRank: 50,
        estimatedAuctionPrice: 8_000_000,
      }),
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];

    const teamNeeds = new Map<string, PositionalNeed[]>();
    teamNeeds.set('team1', [createMockPositionalNeed('WR', 1)]);

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    // Prime age, balanced market = no overvalued risk
    expect(result.overvaluedRisks.length).toBe(0);
  });

  it('should sort overvalued risks by premium percent (worst first)', () => {
    const players = [
      createMockPlayer({
        id: '1',
        position: 'WR',
        age: 33, // Very old
        compositeRank: 50,
        estimatedAuctionPrice: 10_000_000,
      }),
      createMockPlayer({
        id: '2',
        position: 'WR',
        age: 30, // Aging
        compositeRank: 50,
        estimatedAuctionPrice: 8_000_000,
      }),
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];

    const teamNeeds = new Map<string, PositionalNeed[]>();
    teamNeeds.set('team1', [createMockPositionalNeed('WR', 1)]);

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    if (result.overvaluedRisks.length > 1) {
      // First risk should have higher premium than second (age 33 > age 30)
      expect(result.overvaluedRisks[0].expectedPremium).toBeGreaterThanOrEqual(
        result.overvaluedRisks[1].expectedPremium
      );
    }
  });
});

// ============================================================================
// getMarketSummary() Tests
// ============================================================================

describe('getMarketSummary', () => {
  it('should format market summary correctly', () => {
    const mockAnalysis: MarketAnalysis = {
      totalAvailableCap: 50_000_000,
      totalAvailablePlayers: 100,
      positionalMarkets: {
        QB: {
          availablePlayers: 20,
          averagePlayerValue: 5_000_000,
          topPlayerValue: 15_000_000,
          totalDemand: 10,
          scarcityIndex: 0.5,
          projectedPriceInflation: 5,
        },
        WR: {
          availablePlayers: 40,
          averagePlayerValue: 3_000_000,
          topPlayerValue: 10_000_000,
          totalDemand: 30,
          scarcityIndex: 0.75,
          projectedPriceInflation: 8,
        },
      },
      expectedAveragePriceChange: 0,
      marketEfficiency: 1.0,
      valueOpportunities: [
        {
          player: createMockPlayer({ id: '1' }),
          estimatedPrice: 5_000_000,
          fairValue: 7_000_000,
          expectedDiscount: 28.5,
          reason: 'Test'
        },
      ],
      overvaluedRisks: [
        {
          player: createMockPlayer({ id: '2' }),
          estimatedPrice: 10_000_000,
          fairValue: 7_000_000,
          expectedPremium: 42.8,
          reason: 'Test'
        },
      ],
    };

    const summary = getMarketSummary(mockAnalysis);

    expect(summary.totalCapAvailable).toBe('$50.0M');
    expect(summary.totalPlayers).toBe(100);
    expect(summary.avgPricePerPlayer).toBe('$0.50M');
    expect(summary.marketType).toBe('balanced');
    expect(summary.topOpportunities).toBe(1);
    expect(summary.topRisks).toBe(1);
  });

  it('should identify seller market type correctly', () => {
    const mockAnalysis: MarketAnalysis = {
      totalAvailableCap: 10_000_000,
      totalAvailablePlayers: 50,
      positionalMarkets: {},
      expectedAveragePriceChange: 10,
      marketEfficiency: 1.5, // > 1.1 = seller's market
      valueOpportunities: [],
      overvaluedRisks: [],
    };

    const summary = getMarketSummary(mockAnalysis);

    expect(summary.marketType).toBe('seller');
  });

  it('should identify buyer market type correctly', () => {
    const mockAnalysis: MarketAnalysis = {
      totalAvailableCap: 100_000_000,
      totalAvailablePlayers: 50,
      positionalMarkets: {},
      expectedAveragePriceChange: -10,
      marketEfficiency: 0.5, // < 0.9 = buyer's market
      valueOpportunities: [],
      overvaluedRisks: [],
    };

    const summary = getMarketSummary(mockAnalysis);

    expect(summary.marketType).toBe('buyer');
  });

  it('should identify scarcest and oversupplied positions', () => {
    const mockAnalysis: MarketAnalysis = {
      totalAvailableCap: 50_000_000,
      totalAvailablePlayers: 100,
      positionalMarkets: {
        QB: {
          availablePlayers: 10,
          averagePlayerValue: 5_000_000,
          topPlayerValue: 15_000_000,
          totalDemand: 20,
          scarcityIndex: 2.0, // Scarcest
          projectedPriceInflation: 20,
        },
        WR: {
          availablePlayers: 50,
          averagePlayerValue: 3_000_000,
          topPlayerValue: 10_000_000,
          totalDemand: 10,
          scarcityIndex: 0.2, // Oversupplied
          projectedPriceInflation: -10,
        },
      },
      expectedAveragePriceChange: 0,
      marketEfficiency: 1.0,
      valueOpportunities: [],
      overvaluedRisks: [],
    };

    const summary = getMarketSummary(mockAnalysis);

    expect(summary.scarcestPosition).toBe('QB');
    expect(summary.oversuppliedPosition).toBe('WR');
  });
});

// ============================================================================
// getPositionAdvice() Tests
// ============================================================================

describe('getPositionAdvice', () => {
  it('should advise "abundant" for scarcity < 0.7', () => {
    const mockAnalysis: MarketAnalysis = {
      totalAvailableCap: 50_000_000,
      totalAvailablePlayers: 100,
      positionalMarkets: {
        WR: {
          availablePlayers: 50,
          averagePlayerValue: 3_000_000,
          topPlayerValue: 10_000_000,
          totalDemand: 10,
          scarcityIndex: 0.5, // < 0.7 = abundant
          projectedPriceInflation: -5,
        },
      },
      expectedAveragePriceChange: 0,
      marketEfficiency: 1.0,
      valueOpportunities: [],
      overvaluedRisks: [],
    };

    const advice = getPositionAdvice('WR', mockAnalysis);

    expect(advice.scarcityLevel).toBe('abundant');
    expect(advice.advice).toContain('Plenty of');
    expect(advice.expectedPriceChange).toBe('-5%');
  });

  it('should advise "balanced" for scarcity 0.7-1.3', () => {
    const mockAnalysis: MarketAnalysis = {
      totalAvailableCap: 50_000_000,
      totalAvailablePlayers: 100,
      positionalMarkets: {
        RB: {
          availablePlayers: 30,
          averagePlayerValue: 4_000_000,
          topPlayerValue: 12_000_000,
          totalDemand: 25,
          scarcityIndex: 1.0, // 0.7-1.3 = balanced
          projectedPriceInflation: 0,
        },
      },
      expectedAveragePriceChange: 0,
      marketEfficiency: 1.0,
      valueOpportunities: [],
      overvaluedRisks: [],
    };

    const advice = getPositionAdvice('RB', mockAnalysis);

    expect(advice.scarcityLevel).toBe('balanced');
    expect(advice.advice).toContain('balanced');
    expect(advice.expectedPriceChange).toBe('+0%');
  });

  it('should advise "scarce" for scarcity 1.3-2.0', () => {
    const mockAnalysis: MarketAnalysis = {
      totalAvailableCap: 50_000_000,
      totalAvailablePlayers: 100,
      positionalMarkets: {
        TE: {
          availablePlayers: 20,
          averagePlayerValue: 3_500_000,
          topPlayerValue: 11_000_000,
          totalDemand: 30,
          scarcityIndex: 1.5, // 1.3-2.0 = scarce
          projectedPriceInflation: 15,
        },
      },
      expectedAveragePriceChange: 0,
      marketEfficiency: 1.0,
      valueOpportunities: [],
      overvaluedRisks: [],
    };

    const advice = getPositionAdvice('TE', mockAnalysis);

    expect(advice.scarcityLevel).toBe('scarce');
    expect(advice.advice).toContain('scarce');
    expect(advice.expectedPriceChange).toBe('+15%');
  });

  it('should advise "very-scarce" for scarcity >= 2.0', () => {
    const mockAnalysis: MarketAnalysis = {
      totalAvailableCap: 50_000_000,
      totalAvailablePlayers: 100,
      positionalMarkets: {
        QB: {
          availablePlayers: 10,
          averagePlayerValue: 8_000_000,
          topPlayerValue: 20_000_000,
          totalDemand: 25,
          scarcityIndex: 2.5, // >= 2.0 = very-scarce
          projectedPriceInflation: 30,
        },
      },
      expectedAveragePriceChange: 0,
      marketEfficiency: 1.0,
      valueOpportunities: [],
      overvaluedRisks: [],
    };

    const advice = getPositionAdvice('QB', mockAnalysis);

    expect(advice.scarcityLevel).toBe('very-scarce');
    expect(advice.advice).toContain('CRITICAL SHORTAGE');
    expect(advice.expectedPriceChange).toBe('+30%');
  });

  it('should handle missing position data gracefully', () => {
    const mockAnalysis: MarketAnalysis = {
      totalAvailableCap: 50_000_000,
      totalAvailablePlayers: 100,
      positionalMarkets: {},
      expectedAveragePriceChange: 0,
      marketEfficiency: 1.0,
      valueOpportunities: [],
      overvaluedRisks: [],
    };

    const advice = getPositionAdvice('QB', mockAnalysis);

    expect(advice.scarcityLevel).toBe('balanced');
    expect(advice.advice).toContain('No market data available');
    expect(advice.expectedPriceChange).toBe('0%');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty player list', () => {
    const players: PlayerValuation[] = [];
    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];
    const teamNeeds = new Map<string, PositionalNeed[]>();

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    expect(result.totalAvailablePlayers).toBe(0);
    expect(result.valueOpportunities).toHaveLength(0);
    expect(result.overvaluedRisks).toHaveLength(0);
  });

  it('should handle zero available cap space', () => {
    const players = [createMockPlayer({ estimatedAuctionPrice: 5_000_000 })];
    const teamCaps = [createMockTeamCap({ discretionarySpending: 0 })];
    const teamNeeds = new Map<string, PositionalNeed[]>();

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    expect(result.totalAvailableCap).toBe(0);
    expect(result.marketEfficiency).toBe(1.0); // Fallback to 1.0 when cap = 0
  });

  it('should handle players with no estimated price', () => {
    const players = [
      createMockPlayer({
        id: '1',
        position: 'WR',
        estimatedAuctionPrice: undefined,
      }),
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];
    const teamNeeds = new Map<string, PositionalNeed[]>();

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    // Should handle gracefully without crashing
    expect(result.totalAvailablePlayers).toBe(1);
  });

  it('should handle players with no composite rank', () => {
    const players = [
      createMockPlayer({
        id: '1',
        position: 'WR',
        compositeRank: undefined,
        estimatedAuctionPrice: 5_000_000,
      }),
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];
    const teamNeeds = new Map<string, PositionalNeed[]>();

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    // Should handle gracefully (treated as rank 999 for quality threshold)
    expect(result.totalAvailablePlayers).toBe(1);
  });

  it('should handle all teams with negative cap space', () => {
    const players = [createMockPlayer({ estimatedAuctionPrice: 5_000_000 })];
    const teamCaps = [
      createMockTeamCap({ discretionarySpending: -10_000_000 }),
      createMockTeamCap({ discretionarySpending: -5_000_000 }),
    ];
    const teamNeeds = new Map<string, PositionalNeed[]>();

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    expect(result.totalAvailableCap).toBe(0); // All negative = 0 total
  });

  it('should handle extreme scarcity (demand >> supply)', () => {
    const players = [
      createMockPlayer({ id: '1', position: 'QB', compositeRank: 10 }),
    ];

    const teamCaps = [createMockTeamCap({ discretionarySpending: 50_000_000 })];

    // All 16 teams need 2 QBs = 32 demand, 1 supply
    const teamNeeds = new Map<string, PositionalNeed[]>();
    for (let i = 1; i <= 16; i++) {
      teamNeeds.set(`team${i}`, [createMockPositionalNeed('QB', 2)]);
    }

    const result = analyzeMarket(players, teamCaps, teamNeeds);

    const qbMarket = result.positionalMarkets['QB'];

    // Should handle extreme scarcity (cap inflation factor at 1.50 max)
    expect(qbMarket.scarcityIndex).toBeGreaterThan(10);
    expect(qbMarket.projectedPriceInflation).toBeLessThanOrEqual(50); // Capped at 50%
  });
});
