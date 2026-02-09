import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateAuctionPrice,
  generateContractPricing,
  calculateAllPlayerPrices,
  getPriceExplanation,
  calculatePositionalScarcity,
  DEFAULT_AUCTION_FACTORS,
  calculateEliteRankPremium,
  applyTierPriceFloor,
  getOverallRankTier,
  selectHistoricalCurveForPosition,
  type PricingModel,
} from '../src/utils/auction-price-calculator';
import type { PlayerValuation, TeamCapSituation, PositionScarcityAnalysis, AuctionPriceFactors } from '../src/types/auction-predictor';

// Mock Data

const mockFactors: AuctionPriceFactors = {

  ...DEFAULT_AUCTION_FACTORS,

  dynastyWeight: 0.6,

  redraftWeight: 0.4,

};



const mockCurves = {



  WR: {



    max: { basePrice: 20000000, decayRate: -0.15, dataPoints: 10 },



    avg: { basePrice: 12000000, decayRate: -0.20, dataPoints: 10 },



    min: { basePrice: 6000000, decayRate: -0.25, dataPoints: 10 },



  },



  RB: {



    max: { basePrice: 18000000, decayRate: -0.20, dataPoints: 10 },



    avg: { basePrice: 10000000, decayRate: -0.25, dataPoints: 10 },



    min: { basePrice: 5000000, decayRate: -0.30, dataPoints: 10 },



  },



  QB: {



    max: { basePrice: 25000000, decayRate: -0.10, dataPoints: 10 },



    avg: { basePrice: 15000000, decayRate: -0.15, dataPoints: 10 },



    min: { basePrice: 8000000, decayRate: -0.20, dataPoints: 10 },



  },

  TE: {

    max: { basePrice: 10000000, decayRate: -0.20, dataPoints: 10 },

    avg: { basePrice: 6000000, decayRate: -0.25, dataPoints: 10 },

    min: { basePrice: 3000000, decayRate: -0.30, dataPoints: 10 },

  },

  PK: {

    max: { basePrice: 1000000, decayRate: -0.10, dataPoints: 5 },

    avg: { basePrice: 500000, decayRate: -0.10, dataPoints: 5 },

    min: { basePrice: 425000, decayRate: -0.10, dataPoints: 5 },

  },

  DEF: {

    max: { basePrice: 1000000, decayRate: -0.10, dataPoints: 5 },

    avg: { basePrice: 500000, decayRate: -0.10, dataPoints: 5 },

    min: { basePrice: 425000, decayRate: -0.10, dataPoints: 5 },

  }

};



const mockScarcity: PositionScarcityAnalysis = {

  position: 'WR',

  currentRosteredPlayers: 0,

  qualityStartersAvailable: 10,

  expiringContracts: 5,

  rookiesExpected: 2,

  totalLeagueStartingSpots: 48,

  teamsNeedingStarters: 5,

  averageDepthPerTeam: 3,

  scarcityScore: 50,

  priceImpactMultiplier: 1.0,

  topTierSize: 5,

  replacementLevel: 425000

};



const mockTeamCapSituations: TeamCapSituation[] = [

  {

    franchiseId: '0001',

    teamName: 'Team 1',

    currentCapSpace: 10000000,

    projectedCapSpace2026: 15000000,

    committedSalaries: 30000000,

    deadMoney: 0,

    expiringContracts: [],

    totalExpiringValue: 0,

    franchiseTagCommitment: 0,

    availableAfterTag: 15000000,

    estimatedMinimumRosterSpend: 5000000,

    discretionarySpending: 10000000,

    positionalNeeds: [

      { position: 'WR', priority: 'critical', currentDepth: 1, targetAcquisitions: 2 },

      { position: 'RB', priority: 'medium', currentDepth: 3, targetAcquisitions: 1 }

    ]

  },

  {

    franchiseId: '0002',

    teamName: 'Team 2',

    currentCapSpace: 5000000,

    projectedCapSpace2026: 8000000,

    committedSalaries: 37000000,

    deadMoney: 0,

    expiringContracts: [],

    totalExpiringValue: 0,

    franchiseTagCommitment: 0,

    availableAfterTag: 8000000,

    estimatedMinimumRosterSpend: 2000000,

    discretionarySpending: 6000000,

    positionalNeeds: [

      { position: 'WR', priority: 'high', currentDepth: 2, targetAcquisitions: 1 },

      { position: 'QB', priority: 'critical', currentDepth: 0, targetAcquisitions: 1 }

    ]

  }

];



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

    currentSalary: 1000000,

    contractYearsRemaining: 0,

    franchiseId: null,

    isExpiring: true,

    isFranchiseTagCandidate: false,

    franchiseTagProbability: 0,

    ...overrides,

  };

}



describe('auction-price-calculator', () => {

  describe('calculateAuctionPrice', () => {

    it('should return minimum price for player with no rankings', () => {

      const player = createMockPlayer({

        dynastyRank: undefined,

        redraftRank: undefined,

        compositeRank: undefined

      });



      const result = calculateAuctionPrice(player, mockFactors, mockScarcity, mockCurves);



      expect(result.finalPrice).toBeGreaterThanOrEqual(425_000);

      expect(result.confidence).toBe(0.8);

    });



    it('should calculate price based on dynasty rank only', () => {

      const player = createMockPlayer({

        dynastyRank: 10,

        redraftRank: undefined,

        compositeRank: undefined

      });



      // Override factors to be 100% dynasty for this test

      const factors = { ...mockFactors, dynastyWeight: 1.0, redraftWeight: 0 };

      const result = calculateAuctionPrice(player, factors, mockScarcity, mockCurves);



      expect(result.finalPrice).toBeGreaterThan(425_000);

    });



    it('should calculate price based on redraft rank only', () => {

      const player = createMockPlayer({

        dynastyRank: undefined,

        redraftRank: 15,

        compositeRank: undefined

      });



      const factors = { ...mockFactors, dynastyWeight: 0, redraftWeight: 1.0 };

      const result = calculateAuctionPrice(player, factors, mockScarcity, mockCurves);



      expect(result.finalPrice).toBeGreaterThan(425_000);

    });



    it('should calculate weighted composite rank correctly', () => {

      // Create a player where dynasty weight CHANGES position rank

      const player = createMockPlayer({

        id: 'target',

        position: 'WR',

        dynastyRank: 10,  // Good dynasty rank

        redraftRank: 40,  // Worse redraft rank

      });



      // With 100% dynasty weight: composite rank = 10

      // With 0% dynasty weight: composite rank = 40

      const result100 = calculateAuctionPrice(

        player, 

        { ...mockFactors, dynastyWeight: 1.0, redraftWeight: 0 }, 

        mockScarcity,

        mockCurves

      );

      

      const result0 = calculateAuctionPrice(

        player, 

        { ...mockFactors, dynastyWeight: 0, redraftWeight: 1.0 }, 

        mockScarcity,

        mockCurves

      );



      // Both should return valid prices

      expect(result100.finalPrice).toBeGreaterThan(425_000);

      expect(result0.finalPrice).toBeGreaterThan(425_000);



      // 100% dynasty (Rank 10) should produce HIGHER price than 0% dynasty (Rank 40)

      expect(result100.finalPrice).toBeGreaterThan(result0.finalPrice);

    });



    it('should enforce league minimum floor of $425k', () => {

      const player = createMockPlayer({

        dynastyRank: 200,

        redraftRank: 200,

      });



      const result = calculateAuctionPrice(player, mockFactors, mockScarcity, mockCurves);



      expect(result.finalPrice).toBeGreaterThanOrEqual(425_000);

    });



    it('should calculate scarcity multiplier from market analysis', () => {

      // Create scarcity object with high multiplier

      const scarceMarket = { ...mockScarcity, priceImpactMultiplier: 1.5 };

      const normalMarket = { ...mockScarcity, priceImpactMultiplier: 1.0 };

      

      const player = createMockPlayer({

        position: 'RB',

        dynastyRank: 10,

      });



      const resultScarce = calculateAuctionPrice(player, mockFactors, scarceMarket, mockCurves);

      const resultNormal = calculateAuctionPrice(player, mockFactors, normalMarket, mockCurves);



      expect(resultScarce.finalPrice).toBeGreaterThan(resultNormal.finalPrice);

    });



    it('should handle unknown positions gracefully', () => {

      // Note: TypeScript restricts position to specific strings, but we can force it for runtime test

      const player = createMockPlayer({

        position: 'PK',

        dynastyRank: 1,

      });



      const result = calculateAuctionPrice(player, mockFactors, mockScarcity, mockCurves);



      expect(result.finalPrice).toBeGreaterThanOrEqual(425_000);

    });

  });



  describe('generateContractPricing', () => {

    it('should generate all contract lengths (1-5 years)', () => {

      const player = createMockPlayer({ age: 27 });

      const basePrice = 10_000_000;



      const result = generateContractPricing(player, basePrice, 1.0);

      expect(result.threeYear).toBe(basePrice);
      expect(result.oneYear).toBe(Math.round(basePrice * 1.2));
      expect(result.fiveYear).toBe(Math.round(basePrice * 0.8));

      expect(result.twoYear).toBeGreaterThan(0);

      expect(result.threeYear).toBeGreaterThan(0);

      expect(result.fourYear).toBeGreaterThan(0);

      expect(result.fiveYear).toBeGreaterThan(0);

    });



    it('should increase prices as contracts shorten', () => {
      const player = createMockPlayer({ age: 29 });
      const basePrice = 6_000_000;

      const result = generateContractPricing(player, basePrice, 1.0);

      expect(result.fiveYear).toBeLessThan(result.fourYear);
      expect(result.fourYear).toBeLessThan(result.threeYear);
      expect(result.threeYear).toBeLessThan(result.twoYear);
      expect(result.twoYear).toBeLessThan(result.oneYear);
    });



    it('should recommend 5-year deal for young elite players', () => {

      const player = createMockPlayer({ age: 23 });

      const basePrice = 15_000_000; // Elite price



      const result = generateContractPricing(player, basePrice, 1.0);



      expect(result.recommended.years).toBe(5);

      expect(result.recommended.reason).toContain('5-year');

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

  describe('tier logic helpers', () => {
    it('should classify overall rank tiers correctly', () => {
      expect(getOverallRankTier(1)).toBe('elite');
      expect(getOverallRankTier(30)).toBe('elite');
      expect(getOverallRankTier(31)).toBe('star');
      expect(getOverallRankTier(105)).toBe('star');
      expect(getOverallRankTier(106)).toBe('starter');
      expect(getOverallRankTier(199)).toBe('starter');
      expect(getOverallRankTier(200)).toBe('depth');
    });

    it('should calculate elite rank premium', () => {
      expect(calculateEliteRankPremium(1)).toBeCloseTo(0.05);
      expect(calculateEliteRankPremium(3)).toBeCloseTo(0.025);
      expect(calculateEliteRankPremium(5)).toBe(0);
      expect(calculateEliteRankPremium(6)).toBe(0);
    });

    it('should apply tier price floors', () => {
      const max = 10_000_000;
      expect(applyTierPriceFloor(1_000_000, 1, max)).toBe(max * 0.85);
      expect(applyTierPriceFloor(1_000_000, 40, max)).toBe(max * 0.60);
      expect(applyTierPriceFloor(1_000_000, 120, max)).toBe(max * 0.30);
      expect(applyTierPriceFloor(1_000_000, 200, max)).toBe(1_000_000);
    });

    it('should select curve based on best player at position', () => {
      const factors = { ...mockFactors, dynastyWeight: 0, redraftWeight: 0 };
      const players: PlayerValuation[] = [
        createMockPlayer({ id: '1', position: 'QB', compositeRank: 10, dynastyRank: undefined, redraftRank: undefined }),
        createMockPlayer({ id: '2', position: 'QB', compositeRank: 45, dynastyRank: undefined, redraftRank: undefined }),
        createMockPlayer({ id: '3', position: 'WR', compositeRank: 160, dynastyRank: undefined, redraftRank: undefined }),
      ];

      expect(selectHistoricalCurveForPosition('QB', players, factors)).toBe('max');
      expect(selectHistoricalCurveForPosition('WR', players, factors)).toBe('min');
    });
  });



  describe('calculateAllPlayerPrices', () => {

    it('should calculate prices for all players', () => {

      const players: PlayerValuation[] = [

        createMockPlayer({ id: '1', dynastyRank: 10 }),

        createMockPlayer({ id: '2', dynastyRank: 20 }),

        createMockPlayer({ id: '3', dynastyRank: 30 }),

      ];



      const results = calculateAllPlayerPrices(players, mockTeamCapSituations, mockFactors, mockCurves);



      expect(results.size).toBe(3);

      expect(results.has('1')).toBe(true);

      expect(results.has('2')).toBe(true);

      expect(results.has('3')).toBe(true);

    });



    it('should return both factors and contracts for each player', () => {

      const players: PlayerValuation[] = [

        createMockPlayer({ id: '1', dynastyRank: 10 }),

      ];



      const results = calculateAllPlayerPrices(players, mockTeamCapSituations, mockFactors, mockCurves);

      const player1 = results.get('1');



      expect(player1).toHaveProperty('factors');

      expect(player1).toHaveProperty('contracts');

      expect(player1?.factors).toHaveProperty('finalPrice');

      expect(player1?.contracts).toHaveProperty('oneYear');

    });



    it('should handle empty player array', () => {

      const results = calculateAllPlayerPrices([], mockTeamCapSituations, mockFactors, mockCurves);



      expect(results.size).toBe(0);

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

  });



  describe('Edge Cases and Invariants', () => {

    it('should never return negative prices', () => {

      const edgeCases = [

        createMockPlayer({ dynastyRank: 999, age: 40 }),

        createMockPlayer({ dynastyRank: 200, position: 'PK' }),

        createMockPlayer({ dynastyRank: undefined, redraftRank: undefined }),

      ];



      for (const player of edgeCases) {

        const result = calculateAuctionPrice(player, mockFactors, mockScarcity, mockCurves);

        const contracts = generateContractPricing(player, result.finalPrice, 1.0);



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

        const result = calculateAuctionPrice(player, mockFactors, mockScarcity, mockCurves);



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



      // 100% dynasty weight: composite rank = 8

      // 0% dynasty weight: composite rank = 50

      const weight100 = calculateAuctionPrice(

        player, 

        { ...mockFactors, dynastyWeight: 1.0, redraftWeight: 0 }, 

        mockScarcity,

        mockCurves

      );

      

      const weight0 = calculateAuctionPrice(

        player, 

        { ...mockFactors, dynastyWeight: 0, redraftWeight: 1.0 }, 

        mockScarcity,

        mockCurves

      );



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



      // Assuming mockScarcity is WR so curve lookups work

      const result1 = calculateAuctionPrice(rank1, mockFactors, mockScarcity, mockCurves);

      const result10 = calculateAuctionPrice(rank10, mockFactors, mockScarcity, mockCurves);

      const result50 = calculateAuctionPrice(rank50, mockFactors, mockScarcity, mockCurves);



      // Rank 1 should be most expensive, rank 50 should be cheapest

      expect(result1.finalPrice).toBeGreaterThanOrEqual(result10.finalPrice);

      expect(result10.finalPrice).toBeGreaterThan(result50.finalPrice);

    });

  });

});
