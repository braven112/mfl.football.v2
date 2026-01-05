import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateAuctionPrice,
  generateContractPricing,
  calculateAllPlayerPrices,
  getPriceExplanation,
  type PricingModel,
} from '../src/utils/auction-price-calculator';
import type { PlayerValuation, MarketAnalysis } from '../src/types/auction-predictor';

// Mock market analysis data
const mockMarketAnalysis: MarketAnalysis = {
  totalCapSpace: 500_000_000,
  totalFreeAgents: 200,
  averageCapPerTeam: 31_250_000,
  positionalMarkets: {
    QB: {
      position: 'QB',
      availablePlayers: 15,
      totalDemand: 12,
      scarcityIndex: 0.8,
      avgPrice: 8_000_000,
      topPrice: 25_000_000,
      valueOpportunities: [],
      overvaluedPlayers: [],
    },
    RB: {
      position: 'RB',
      availablePlayers: 40,
      totalDemand: 48,
      scarcityIndex: 1.2,
      avgPrice: 5_000_000,
      topPrice: 15_000_000,
      valueOpportunities: [],
      overvaluedPlayers: [],
    },
    WR: {
      position: 'WR',
      availablePlayers: 60,
      totalDemand: 72,
      scarcityIndex: 1.2,
      avgPrice: 6_000_000,
      topPrice: 20_000_000,
      valueOpportunities: [],
      overvaluedPlayers: [],
    },
    TE: {
      position: 'TE',
      availablePlayers: 20,
      totalDemand: 24,
      scarcityIndex: 1.2,
      avgPrice: 4_000_000,
      topPrice: 12_000_000,
      valueOpportunities: [],
      overvaluedPlayers: [],
    },
  },
  valueOpportunities: [],
  overvaluedPlayers: [],
};

// Helper function to create mock player
function createMockPlayer(overrides: Partial<PlayerValuation> = {}): PlayerValuation {
  return {
    id: '12345',
    name: 'Test Player',
    position: 'WR',
    team: 'TEST',
    age: 27,
    experience: 5,
    dynastyRank: 20,
    redraftRank: 25,
    compositeRank: 22,
    ...overrides,
  };
}

describe('auction-price-calculator', () => {
  describe('calculateAuctionPrice', () => {
    it('should return minimum price for player with no rankings', () => {
      const player = createMockPlayer({
        dynastyRank: undefined,
        redraftRank: undefined,
      });

      const result = calculateAuctionPrice(player, mockMarketAnalysis, 60);

      expect(result.finalPrice).toBe(500_000);
      expect(result.confidence).toBe(0.3);
    });

    it('should calculate price based on dynasty rank only', () => {
      const player = createMockPlayer({
        dynastyRank: 10,
        redraftRank: undefined,
      });

      const result = calculateAuctionPrice(player, mockMarketAnalysis, 60);

      expect(result.finalPrice).toBeGreaterThan(425_000);
      expect(result.confidence).toBe(0.9);
    });

    it('should calculate price based on redraft rank only', () => {
      const player = createMockPlayer({
        dynastyRank: undefined,
        redraftRank: 15,
      });

      const result = calculateAuctionPrice(player, mockMarketAnalysis, 60);

      expect(result.finalPrice).toBeGreaterThan(425_000);
      expect(result.confidence).toBe(0.9);
    });

    it('should calculate weighted composite rank correctly', () => {
      // Create a player where dynasty weight CHANGES position rank
      const player = createMockPlayer({
        id: 'target',
        position: 'WR',
        dynastyRank: 10,  // Good dynasty rank
        redraftRank: 40,  // Worse redraft rank
      });

      const allPlayers = [
        createMockPlayer({ id: '1', position: 'WR', dynastyRank: 5, redraftRank: 5 }),   // Always WR1
        createMockPlayer({ id: '2', position: 'WR', dynastyRank: 20, redraftRank: 20 }), // Always between
        player, // Position varies based on weight
      ];

      // With 100% dynasty weight: target has composite rank 10 (WR2 position rank)
      // With 0% dynasty weight: target has composite rank 40 (WR3 position rank)
      const result100 = calculateAuctionPrice(player, mockMarketAnalysis, 100, allPlayers);
      const result0 = calculateAuctionPrice(player, mockMarketAnalysis, 0, allPlayers);

      // Both should return valid prices
      expect(result100.finalPrice).toBeGreaterThan(425_000);
      expect(result0.finalPrice).toBeGreaterThan(425_000);

      // 100% dynasty should produce HIGHER price (better position rank)
      expect(result100.finalPrice).toBeGreaterThan(result0.finalPrice);
    });

    it('should respect pricing model (min, average, max)', () => {
      const player = createMockPlayer({
        dynastyRank: 10,
        position: 'QB',
      });

      const minPrice = calculateAuctionPrice(player, mockMarketAnalysis, 60, undefined, 'min');
      const avgPrice = calculateAuctionPrice(player, mockMarketAnalysis, 60, undefined, 'average');
      const maxPrice = calculateAuctionPrice(player, mockMarketAnalysis, 60, undefined, 'max');

      expect(minPrice.finalPrice).toBeLessThanOrEqual(avgPrice.finalPrice);
      expect(avgPrice.finalPrice).toBeLessThanOrEqual(maxPrice.finalPrice);
    });

    it('should enforce league minimum floor of $425k', () => {
      const player = createMockPlayer({
        dynastyRank: 200,
        redraftRank: 200,
      });

      const result = calculateAuctionPrice(player, mockMarketAnalysis, 60);

      expect(result.finalPrice).toBeGreaterThanOrEqual(425_000);
    });

    it('should calculate scarcity multiplier from market analysis', () => {
      const player = createMockPlayer({
        position: 'RB',
        dynastyRank: 10,
      });

      const result = calculateAuctionPrice(player, mockMarketAnalysis, 60);

      // RB has scarcityIndex of 1.2 in mock data
      expect(result.scarcityMultiplier).toBeGreaterThan(1.0);
    });

    it('should handle unknown positions gracefully', () => {
      const player = createMockPlayer({
        position: 'PK',
        dynastyRank: 1,
      });

      const result = calculateAuctionPrice(player, mockMarketAnalysis, 60);

      // Should still return a valid price (likely minimum)
      expect(result.finalPrice).toBeGreaterThanOrEqual(425_000);
      expect(result).toHaveProperty('confidence');
    });

    it('should calculate position rank when allPlayers provided', () => {
      const allPlayers: PlayerValuation[] = [
        createMockPlayer({ id: '1', position: 'WR', dynastyRank: 5 }),
        createMockPlayer({ id: '2', position: 'WR', dynastyRank: 10 }),
        createMockPlayer({ id: '3', position: 'WR', dynastyRank: 15 }),
        createMockPlayer({ id: '4', position: 'QB', dynastyRank: 8 }),
      ];

      const player = allPlayers[1]; // WR with dynastyRank 10 (2nd best WR)

      const result = calculateAuctionPrice(player, mockMarketAnalysis, 60, allPlayers);

      expect(result.finalPrice).toBeGreaterThan(425_000);
    });

    it('should handle edge case: rank exactly at 50', () => {
      const player = createMockPlayer({
        dynastyRank: 50,
        position: 'WR',
      });

      const result = calculateAuctionPrice(player, mockMarketAnalysis, 60);

      expect(result.finalPrice).toBeGreaterThanOrEqual(425_000);
    });

    it('should handle edge case: rank greater than 50', () => {
      const player = createMockPlayer({
        dynastyRank: 75,
        position: 'WR',
      });

      const result = calculateAuctionPrice(player, mockMarketAnalysis, 60);

      // Should use extrapolation from rank 50 with decay
      expect(result.finalPrice).toBeGreaterThanOrEqual(425_000);
    });
  });

  describe('generateContractPricing', () => {
    it('should generate all contract lengths (1-5 years)', () => {
      const player = createMockPlayer({ age: 27 });
      const basePrice = 10_000_000;

      const result = generateContractPricing(player, basePrice, 1.0);

      expect(result.oneYear).toBe(basePrice);
      expect(result.twoYear).toBeGreaterThan(0);
      expect(result.threeYear).toBeGreaterThan(0);
      expect(result.fourYear).toBeGreaterThan(0);
      expect(result.fiveYear).toBeGreaterThan(0);
    });

    it('should apply age depreciation to multi-year contracts', () => {
      const youngPlayer = createMockPlayer({ age: 24 });
      const oldPlayer = createMockPlayer({ age: 32 });
      const basePrice = 10_000_000;

      const youngContracts = generateContractPricing(youngPlayer, basePrice, 1.0);
      const oldContracts = generateContractPricing(oldPlayer, basePrice, 1.0);

      // Young player's 5-year deal should be closer to base price (less depreciation)
      // Old player's 5-year deal should be much lower (more depreciation)
      expect(youngContracts.fiveYear).toBeGreaterThan(oldContracts.fiveYear);
    });

    it('should depreciate RBs faster than QBs', () => {
      const rb = createMockPlayer({ age: 27, position: 'RB' });
      const qb = createMockPlayer({ age: 27, position: 'QB' });
      const basePrice = 10_000_000;

      const rbContracts = generateContractPricing(rb, basePrice, 1.0);
      const qbContracts = generateContractPricing(qb, basePrice, 1.0);

      // QB should depreciate slower, so 5-year deal should be higher
      expect(qbContracts.fiveYear).toBeGreaterThan(rbContracts.fiveYear);
    });

    it('should recommend 5-year deal for young elite players', () => {
      const player = createMockPlayer({ age: 23 });
      const basePrice = 15_000_000; // Elite price

      const result = generateContractPricing(player, basePrice, 1.0);

      expect(result.recommended.years).toBe(5);
      expect(result.recommended.reason).toContain('5-year');
    });

    it('should recommend 4-year deal for young valuable players', () => {
      const player = createMockPlayer({ age: 25 });
      const basePrice = 8_000_000;

      const result = generateContractPricing(player, basePrice, 1.0);

      expect(result.recommended.years).toBe(4);
      expect(result.recommended.reason).toContain('4');
    });

    it('should recommend 3-year deal for prime age players', () => {
      const player = createMockPlayer({ age: 28 });
      const basePrice = 10_000_000;

      const result = generateContractPricing(player, basePrice, 1.0);

      expect(result.recommended.years).toBe(3);
      expect(result.recommended.reason).toContain('3');
    });

    it('should recommend 2-year deal for aging players', () => {
      const player = createMockPlayer({ age: 30 });
      const basePrice = 8_000_000;

      const result = generateContractPricing(player, basePrice, 1.0);

      expect(result.recommended.years).toBe(2);
      expect(result.recommended.reason).toContain('2');
    });

    it('should recommend 1-year deal for veterans', () => {
      const player = createMockPlayer({ age: 34 });
      const basePrice = 5_000_000;

      const result = generateContractPricing(player, basePrice, 1.0);

      expect(result.recommended.years).toBe(1);
      expect(result.recommended.reason).toContain('1-year');
    });

    it('should ensure all prices are positive', () => {
      const player = createMockPlayer({ age: 35 });
      const basePrice = 1_000_000;

      const result = generateContractPricing(player, basePrice, 1.0);

      expect(result.oneYear).toBeGreaterThan(0);
      expect(result.twoYear).toBeGreaterThan(0);
      expect(result.threeYear).toBeGreaterThan(0);
      expect(result.fourYear).toBeGreaterThan(0);
      expect(result.fiveYear).toBeGreaterThan(0);
    });
  });

  describe('calculateAllPlayerPrices', () => {
    it('should calculate prices for all players', () => {
      const players: PlayerValuation[] = [
        createMockPlayer({ id: '1', dynastyRank: 10 }),
        createMockPlayer({ id: '2', dynastyRank: 20 }),
        createMockPlayer({ id: '3', dynastyRank: 30 }),
      ];

      const results = calculateAllPlayerPrices(players, mockMarketAnalysis, 60);

      expect(results.size).toBe(3);
      expect(results.has('1')).toBe(true);
      expect(results.has('2')).toBe(true);
      expect(results.has('3')).toBe(true);
    });

    it('should return both factors and contracts for each player', () => {
      const players: PlayerValuation[] = [
        createMockPlayer({ id: '1', dynastyRank: 10 }),
      ];

      const results = calculateAllPlayerPrices(players, mockMarketAnalysis, 60);
      const player1 = results.get('1');

      expect(player1).toHaveProperty('factors');
      expect(player1).toHaveProperty('contracts');
      expect(player1?.factors).toHaveProperty('finalPrice');
      expect(player1?.contracts).toHaveProperty('oneYear');
    });

    it('should respect pricing model for batch calculation', () => {
      const players: PlayerValuation[] = [
        createMockPlayer({ id: '1', dynastyRank: 10 }),
      ];

      const minResults = calculateAllPlayerPrices(players, mockMarketAnalysis, 60, 'min');
      const avgResults = calculateAllPlayerPrices(players, mockMarketAnalysis, 60, 'average');
      const maxResults = calculateAllPlayerPrices(players, mockMarketAnalysis, 60, 'max');

      const minPrice = minResults.get('1')?.factors.finalPrice || 0;
      const avgPrice = avgResults.get('1')?.factors.finalPrice || 0;
      const maxPrice = maxResults.get('1')?.factors.finalPrice || 0;

      expect(minPrice).toBeLessThanOrEqual(avgPrice);
      expect(avgPrice).toBeLessThanOrEqual(maxPrice);
    });

    it('should handle empty player array', () => {
      const results = calculateAllPlayerPrices([], mockMarketAnalysis, 60);

      expect(results.size).toBe(0);
    });

    it('should calculate position ranks correctly within batch', () => {
      const players: PlayerValuation[] = [
        createMockPlayer({ id: '1', position: 'WR', dynastyRank: 5 }),
        createMockPlayer({ id: '2', position: 'WR', dynastyRank: 10 }),
        createMockPlayer({ id: '3', position: 'QB', dynastyRank: 8 }),
      ];

      const results = calculateAllPlayerPrices(players, mockMarketAnalysis, 60);

      // Player 1 should be WR1 (highest price)
      // Player 2 should be WR2 (lower price)
      const wr1Price = results.get('1')?.factors.finalPrice || 0;
      const wr2Price = results.get('2')?.factors.finalPrice || 0;

      expect(wr1Price).toBeGreaterThan(wr2Price);
    });
  });

  describe('getPriceExplanation', () => {
    it('should generate explanation lines', () => {
      const player = createMockPlayer({ age: 27, position: 'WR' });
      const factors = {
        basePrice: 10_000_000,
        rankMultiplier: 1.5,
        ageMultiplier: 1.0,
        scarcityMultiplier: 1.2,
        demandMultiplier: 1.1,
        finalPrice: 12_000_000,
        confidence: 0.85,
      };

      const explanation = getPriceExplanation(factors, player);

      expect(explanation).toBeInstanceOf(Array);
      expect(explanation.length).toBeGreaterThan(0);
      expect(explanation.some(line => line.includes('Base'))).toBe(true);
      expect(explanation.some(line => line.includes('Final price'))).toBe(true);
    });

    it('should include rank adjustment when rankMultiplier != 1.0', () => {
      const player = createMockPlayer();
      const factors = {
        basePrice: 10_000_000,
        rankMultiplier: 1.5,
        ageMultiplier: 1.0,
        scarcityMultiplier: 1.0,
        demandMultiplier: 1.0,
        finalPrice: 15_000_000,
        confidence: 0.85,
      };

      const explanation = getPriceExplanation(factors, player);

      expect(explanation.some(line => line.includes('Rank adjustment'))).toBe(true);
    });

    it('should include age adjustment when ageMultiplier != 1.0', () => {
      const player = createMockPlayer({ age: 23 });
      const factors = {
        basePrice: 10_000_000,
        rankMultiplier: 1.0,
        ageMultiplier: 1.15,
        scarcityMultiplier: 1.0,
        demandMultiplier: 1.0,
        finalPrice: 11_500_000,
        confidence: 0.85,
      };

      const explanation = getPriceExplanation(factors, player);

      expect(explanation.some(line => line.includes('Age 23'))).toBe(true);
    });

    it('should include scarcity adjustment when scarcityMultiplier != 1.0', () => {
      const player = createMockPlayer();
      const factors = {
        basePrice: 10_000_000,
        rankMultiplier: 1.0,
        ageMultiplier: 1.0,
        scarcityMultiplier: 1.3,
        demandMultiplier: 1.0,
        finalPrice: 13_000_000,
        confidence: 0.85,
      };

      const explanation = getPriceExplanation(factors, player);

      expect(explanation.some(line => line.includes('scarcity'))).toBe(true);
    });

    it('should show confidence percentage', () => {
      const player = createMockPlayer();
      const factors = {
        basePrice: 10_000_000,
        rankMultiplier: 1.0,
        ageMultiplier: 1.0,
        scarcityMultiplier: 1.0,
        demandMultiplier: 1.0,
        finalPrice: 10_000_000,
        confidence: 0.75,
      };

      const explanation = getPriceExplanation(factors, player);

      expect(explanation.some(line => line.includes('75% confidence'))).toBe(true);
    });
  });

  describe('Edge Cases and Invariants', () => {
    it('should never return negative prices', () => {
      const edgeCases = [
        createMockPlayer({ dynastyRank: 999, age: 40 }),
        createMockPlayer({ dynastyRank: 200, position: 'PK' }),
        createMockPlayer({ dynastyRank: undefined, redraftRank: undefined }),
      ];

      for (const player of edgeCases) {
        const result = calculateAuctionPrice(player, mockMarketAnalysis, 60);
        const contracts = generateContractPricing(player, result.finalPrice, result.ageMultiplier);

        expect(result.finalPrice).toBeGreaterThan(0);
        expect(contracts.oneYear).toBeGreaterThan(0);
        expect(contracts.fiveYear).toBeGreaterThan(0);
      }
    });

    it('should always return confidence between 0 and 1', () => {
      const players = [
        createMockPlayer({ dynastyRank: 1 }),
        createMockPlayer({ dynastyRank: undefined, redraftRank: undefined }),
        createMockPlayer({ dynastyRank: 100 }),
      ];

      for (const player of players) {
        const result = calculateAuctionPrice(player, mockMarketAnalysis, 60);

        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('should handle dynasty weight edge cases (0 and 100)', () => {
      const player = createMockPlayer({
        id: 'target',
        position: 'RB',
        dynastyRank: 8,   // Good dynasty rank
        redraftRank: 50,  // Poor redraft rank
      });

      // Create other players for position rank calculation
      const allPlayers = [
        createMockPlayer({ id: '1', position: 'RB', dynastyRank: 3, redraftRank: 3 }),   // Always RB1
        createMockPlayer({ id: '2', position: 'RB', dynastyRank: 15, redraftRank: 15 }), // Always middle
        player, // Position rank changes with weight
      ];

      // 100% dynasty weight: composite rank = 8 (RB2 position rank)
      // 0% dynasty weight: composite rank = 50 (RB3 position rank)
      const weight100 = calculateAuctionPrice(player, mockMarketAnalysis, 100, allPlayers);
      const weight0 = calculateAuctionPrice(player, mockMarketAnalysis, 0, allPlayers);

      // Both should return valid prices
      expect(weight100.finalPrice).toBeGreaterThan(425_000);
      expect(weight0.finalPrice).toBeGreaterThan(425_000);

      // 100% dynasty weight gives better position rank = higher price
      expect(weight100.finalPrice).toBeGreaterThan(weight0.finalPrice);
    });

    it('should maintain price ordering for different ranks', () => {
      const rank1 = createMockPlayer({ id: '1', dynastyRank: 1, position: 'WR' });
      const rank10 = createMockPlayer({ id: '2', dynastyRank: 10, position: 'WR' });
      const rank50 = createMockPlayer({ id: '3', dynastyRank: 50, position: 'WR' });

      const allPlayers = [rank1, rank10, rank50];

      const result1 = calculateAuctionPrice(rank1, mockMarketAnalysis, 60, allPlayers);
      const result10 = calculateAuctionPrice(rank10, mockMarketAnalysis, 60, allPlayers);
      const result50 = calculateAuctionPrice(rank50, mockMarketAnalysis, 60, allPlayers);

      // Rank 1 should be most expensive, rank 50 should be cheapest
      expect(result1.finalPrice).toBeGreaterThan(result10.finalPrice);
      expect(result10.finalPrice).toBeGreaterThan(result50.finalPrice);
    });
  });
});
