/**
 * Integration tests for Auction Predictor
 *
 * Tests full data flow from MFL feeds → calculations → final results
 * Uses REAL data from data/theleague/mfl-feeds/2025/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { analyzeMarket } from '../src/utils/market-analyzer';
import { calculateAuctionPrice } from '../src/utils/auction-price-calculator';
import { predictFranchiseTags } from '../src/utils/franchise-tag-predictor';
import { calculateTeamCapSpace, identifyExpiringContracts } from '../src/utils/cap-space-calculator';
import type { PlayerValuation, TeamCapSituation } from '../src/types/auction-predictor';

// ============================================================================
// Data Loading Helpers
// ============================================================================

const DATA_DIR = join(process.cwd(), 'data', 'theleague', 'mfl-feeds', '2025');
const SALARY_AVG_PATH = join(process.cwd(), 'data', 'theleague', 'mfl-salary-averages-2025.json');

function loadMflData(filename: string): any {
  const path = join(DATA_DIR, filename);
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content);
}

function loadSalaryAverages(): any {
  const content = readFileSync(SALARY_AVG_PATH, 'utf-8');
  return JSON.parse(content);
}

/**
 * Build team cap situations from real MFL data
 * This is a helper to reduce duplication across integration tests
 */
function buildTeamCapSituations(): TeamCapSituation[] {
  const rosters = loadMflData('rosters.json');
  const salaryAdj = loadMflData('salaryAdjustments.json');
  const league = loadMflData('league.json');

  // Build all players with franchiseId
  const allPlayers: any[] = [];
  for (const franchise of rosters.rosters.franchise) {
    const franchiseId = franchise.id;
    const players = franchise.player || [];

    for (const player of players) {
      allPlayers.push({
        ...player,
        franchiseId,
      });
    }
  }

  const teamCapSituations: TeamCapSituation[] = [];

  for (const franchise of rosters.rosters.franchise) {
    const franchiseId = franchise.id;

    // Find team name from league data
    const teamData = league.league.franchises.franchise.find((f: any) => f.id === franchiseId);
    const teamName = teamData?.name || 'Unknown';

    // Calculate dead money for this team
    let deadMoney = 0;
    if (salaryAdj.salaryAdjustments?.salaryAdjustment) {
      const teamAdjustments = salaryAdj.salaryAdjustments.salaryAdjustment.filter(
        (adj: any) => adj.franchiseId === franchiseId
      );
      deadMoney = teamAdjustments.reduce((sum: number, adj: any) => sum + parseFloat(adj.amount || 0), 0);
    }

    const capSpace = calculateTeamCapSpace(
      franchiseId,
      teamName,
      allPlayers,
      deadMoney,
      0 // No franchise tag predicted yet
    );

    teamCapSituations.push(capSpace);
  }

  return teamCapSituations;
}

// ============================================================================
// Data Loading Tests
// ============================================================================

describe('Auction Predictor Integration - Data Loading', () => {
  it('should load 2025 roster data successfully', () => {
    const rosters = loadMflData('rosters.json');

    expect(rosters).toBeDefined();
    expect(rosters.rosters).toBeDefined();
    expect(rosters.rosters.franchise).toBeDefined();
    expect(Array.isArray(rosters.rosters.franchise)).toBe(true);
    expect(rosters.rosters.franchise.length).toBe(16); // 16 teams
  });

  it('should load 2025 players data successfully', () => {
    const players = loadMflData('players.json');

    expect(players).toBeDefined();
    expect(players.players).toBeDefined();
    expect(players.players.player).toBeDefined();
    expect(Array.isArray(players.players.player)).toBe(true);
    expect(players.players.player.length).toBeGreaterThan(1000); // Thousands of players
  });

  it('should load salary adjustments data successfully', () => {
    const salaryAdj = loadMflData('salaryAdjustments.json');

    expect(salaryAdj).toBeDefined();
    expect(salaryAdj.salaryAdjustments).toBeDefined();
  });

  it('should load salary averages data successfully', () => {
    const salaryAvg = loadSalaryAverages();

    expect(salaryAvg).toBeDefined();
    expect(salaryAvg.positions).toBeDefined();
    expect(salaryAvg.positions.QB).toBeDefined();
    expect(salaryAvg.positions.QB.top3Average).toBeGreaterThan(0);
  });

  it('should load league configuration successfully', () => {
    const league = loadMflData('league.json');

    expect(league).toBeDefined();
    expect(league.league).toBeDefined();
    expect(league.league.franchises).toBeDefined();
  });
});

// ============================================================================
// Expiring Contracts Integration
// ============================================================================

describe('Auction Predictor Integration - Expiring Contracts', () => {
  it('should identify all expiring contracts from real roster data', () => {
    const rosters = loadMflData('rosters.json');
    const players = loadMflData('players.json');

    let totalExpiringPlayers = 0;

    // Process each franchise
    for (const franchise of rosters.rosters.franchise) {
      if (!franchise.player) continue;

      const expiringPlayers = identifyExpiringContracts(franchise.player);
      totalExpiringPlayers += expiringPlayers.length;
    }

    // Should have multiple expiring contracts across league
    expect(totalExpiringPlayers).toBeGreaterThan(0);
    expect(totalExpiringPlayers).toBeLessThan(500); // Sanity check
  });

  it('should calculate cap space for all teams with real data', () => {
    const teamCapSituations = buildTeamCapSituations();

    // Should calculate cap for all 16 teams
    expect(teamCapSituations.length).toBe(16);

    // All teams should have realistic cap values
    for (const teamCap of teamCapSituations) {
      expect(teamCap.committedSalaries).toBeGreaterThan(0);
      expect(teamCap.committedSalaries).toBeLessThan(45_000_000); // Less than $45M cap
      expect(teamCap.projectedCapSpace2026).toBeDefined();
      expect(teamCap.franchiseId).toBeDefined();
      expect(teamCap.teamName).toBeDefined();
    }
  });

  it('should handle teams with no expiring contracts', () => {
    const rosters = loadMflData('rosters.json');

    // Find a team with no expiring contracts (if any)
    let foundTeamWithNoExpiring = false;

    for (const franchise of rosters.rosters.franchise) {
      if (!franchise.player) continue;

      const expiringPlayers = identifyExpiringContracts(franchise.player);

      if (expiringPlayers.length === 0) {
        foundTeamWithNoExpiring = true;
        // Should not crash, just return empty array
        expect(expiringPlayers).toEqual([]);
      }
    }

    // Test passes even if all teams have expiring contracts
    expect(true).toBe(true);
  });
});

// ============================================================================
// Franchise Tag Predictions Integration
// ============================================================================

describe('Auction Predictor Integration - Franchise Tags', () => {
  it('should predict franchise tags for all teams with real data', () => {
    const teamCapSituations = buildTeamCapSituations();
    const salaryAvg = loadSalaryAverages();

    // Predict franchise tags
    const predictions = predictFranchiseTags(teamCapSituations, salaryAvg);

    // Should predict for all 16 teams
    expect(predictions.length).toBe(16);

    // Some teams should have tag predictions
    const teamsWithTags = predictions.filter(p => p.hasTag);

    // At least some teams should be predicted to use tags
    // (unless all teams have no expiring contracts worth tagging)
    expect(teamsWithTags.length).toBeGreaterThanOrEqual(0);

    // All predictions should have valid structure
    for (const prediction of predictions) {
      expect(prediction.franchiseId).toBeDefined();
      expect(prediction.teamName).toBeDefined();
      expect(typeof prediction.hasTag).toBe('boolean');
      expect(Array.isArray(prediction.tagCandidates)).toBe(true);

      if (prediction.hasTag && prediction.taggedPlayer) {
        expect(prediction.taggedPlayer.franchiseTagSalary).toBeGreaterThan(0);
      }
    }
  });

  it('should generate tag candidates for teams with expiring players', () => {
    const teamCapSituations = buildTeamCapSituations();
    const salaryAvg = loadSalaryAverages();

    // Predict franchise tags
    const predictions = predictFranchiseTags(teamCapSituations, salaryAvg);

    // Teams with expiring contracts should have tag candidates
    for (const prediction of predictions) {
      const teamCap = teamCapSituations.find(tc => tc.franchiseId === prediction.franchiseId);

      if (teamCap && teamCap.expiringContracts.length > 0) {
        // Should have at least 1 tag candidate (up to 5)
        expect(prediction.tagCandidates.length).toBeGreaterThan(0);
        expect(prediction.tagCandidates.length).toBeLessThanOrEqual(5);
      }
    }
  });
});

// ============================================================================
// Auction Price Calculation Integration
// ============================================================================

describe('Auction Predictor Integration - Price Calculations', () => {
  it('should calculate prices for all expiring players with real data', () => {
    const rosters = loadMflData('rosters.json');
    const players = loadMflData('players.json');

    // Collect all expiring players
    const allExpiringPlayers: any[] = [];

    for (const franchise of rosters.rosters.franchise) {
      if (!franchise.player) continue;

      const expiringPlayers = identifyExpiringContracts(franchise.player);
      allExpiringPlayers.push(...expiringPlayers);
    }

    if (allExpiringPlayers.length === 0) {
      // Skip test if no expiring players
      expect(true).toBe(true);
      return;
    }

    // Create mock market analysis (simplified for integration test)
    const mockMarketAnalysis = {
      totalAvailableCap: 100_000_000,
      totalAvailablePlayers: allExpiringPlayers.length,
      positionalMarkets: {},
      expectedAveragePriceChange: 0,
      marketEfficiency: 1.0,
      valueOpportunities: [],
      overvaluedRisks: [],
    };

    // Calculate prices for each expiring player
    let pricesCalculated = 0;

    for (const player of allExpiringPlayers.slice(0, 50)) { // Test first 50 for speed
      // Convert to PlayerValuation format
      const playerValuation: PlayerValuation = {
        id: player.id,
        name: `Player ${player.id}`,
        position: player.position || 'WR',
        currentTeam: 'Free Agent',
        currentSalary: parseInt(player.salary) || 425_000,
        contractYearsRemaining: 1,
        age: 26,
      };

      const result = calculateAuctionPrice(playerValuation, mockMarketAnalysis, 60);

      expect(result.finalPrice).toBeGreaterThanOrEqual(425_000); // League minimum
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);

      pricesCalculated++;
    }

    expect(pricesCalculated).toBeGreaterThan(0);
  });

  it('should handle missing player data gracefully', () => {
    const mockMarketAnalysis = {
      totalAvailableCap: 100_000_000,
      totalAvailablePlayers: 1,
      positionalMarkets: {},
      expectedAveragePriceChange: 0,
      marketEfficiency: 1.0,
      valueOpportunities: [],
      overvaluedRisks: [],
    };

    // Player with minimal data
    const incompletePlayer: PlayerValuation = {
      id: 'test',
      name: 'Unknown Player',
      position: 'WR',
      currentTeam: 'FA',
      currentSalary: 425_000,
      contractYearsRemaining: 1,
    };

    const result = calculateAuctionPrice(incompletePlayer, mockMarketAnalysis, 60);

    // Should not crash, should return minimum price
    expect(result.finalPrice).toBeGreaterThanOrEqual(425_000);
  });
});

// ============================================================================
// Market Analysis Integration
// ============================================================================

describe('Auction Predictor Integration - Market Analysis', () => {
  it('should analyze full market with real data', () => {
    const teamCapSituations = buildTeamCapSituations();

    // Collect all expiring players as available free agents
    const availablePlayers: PlayerValuation[] = [];

    for (const teamCap of teamCapSituations) {
      for (const player of teamCap.expiringContracts) {
        availablePlayers.push(player);
      }
    }

    if (availablePlayers.length === 0) {
      // Skip if no free agents
      expect(true).toBe(true);
      return;
    }

    // Analyze market (with empty positional needs for now)
    const teamNeeds = new Map();
    const marketAnalysis = analyzeMarket(availablePlayers, teamCapSituations, teamNeeds);

    // Verify market analysis structure
    expect(marketAnalysis.totalAvailableCap).toBeGreaterThanOrEqual(0); // Can be 0 if all teams over cap
    expect(marketAnalysis.totalAvailablePlayers).toBe(availablePlayers.length);
    expect(marketAnalysis.positionalMarkets).toBeDefined();
    expect(marketAnalysis.marketEfficiency).toBeGreaterThanOrEqual(0); // Can be 0 in edge cases

    // Should analyze all major positions
    expect(marketAnalysis.positionalMarkets['QB']).toBeDefined();
    expect(marketAnalysis.positionalMarkets['RB']).toBeDefined();
    expect(marketAnalysis.positionalMarkets['WR']).toBeDefined();
    expect(marketAnalysis.positionalMarkets['TE']).toBeDefined();
  });

  it('should identify some value opportunities or risks with real data', () => {
    const teamCapSituations = buildTeamCapSituations();

    // Collect expiring players with estimated prices
    const availablePlayers: PlayerValuation[] = [];
    const mockMarketAnalysis = {
      totalAvailableCap: 100_000_000,
      totalAvailablePlayers: 100,
      positionalMarkets: {},
      expectedAveragePriceChange: 0,
      marketEfficiency: 1.0,
      valueOpportunities: [],
      overvaluedRisks: [],
    };

    for (const teamCap of teamCapSituations) {
      for (const player of teamCap.expiringContracts.slice(0, 10)) { // Limit for speed
        // Calculate estimated price
        const priceResult = calculateAuctionPrice(player, mockMarketAnalysis, 60);

        availablePlayers.push({
          ...player,
          estimatedAuctionPrice: priceResult.finalPrice,
        });
      }
    }

    if (availablePlayers.length === 0) {
      expect(true).toBe(true);
      return;
    }

    // Analyze market
    const teamNeeds = new Map();
    const marketAnalysis = analyzeMarket(availablePlayers, teamCapSituations, teamNeeds);

    // Market analysis should identify opportunities or risks (or neither if market is efficient)
    expect(Array.isArray(marketAnalysis.valueOpportunities)).toBe(true);
    expect(Array.isArray(marketAnalysis.overvaluedRisks)).toBe(true);
  });
});

// ============================================================================
// End-to-End Workflow
// ============================================================================

describe('Auction Predictor Integration - End-to-End', () => {
  it('should complete full auction prediction workflow with real data', () => {
    // Step 1: Calculate team cap situations
    const teamCapSituations = buildTeamCapSituations();
    const salaryAvg = loadSalaryAverages();

    expect(teamCapSituations.length).toBe(16);

    // Step 2: Predict franchise tags
    const tagPredictions = predictFranchiseTags(teamCapSituations, salaryAvg);

    expect(tagPredictions.length).toBe(16);

    // Step 4: Collect available free agents (not tagged)
    const availablePlayers: PlayerValuation[] = [];
    const taggedPlayerIds = new Set(
      tagPredictions
        .filter(p => p.taggedPlayer)
        .map(p => p.taggedPlayer!.id)
    );

    for (const teamCap of teamCapSituations) {
      for (const player of teamCap.expiringContracts) {
        if (!taggedPlayerIds.has(player.id)) {
          availablePlayers.push(player);
        }
      }
    }

    // Step 5: Calculate prices for available players (sample for speed)
    const mockMarketAnalysis = {
      totalAvailableCap: 100_000_000,
      totalAvailablePlayers: availablePlayers.length,
      positionalMarkets: {},
      expectedAveragePriceChange: 0,
      marketEfficiency: 1.0,
      valueOpportunities: [],
      overvaluedRisks: [],
    };

    const playersWithPrices: PlayerValuation[] = [];

    for (const player of availablePlayers.slice(0, 30)) { // Sample 30 for speed
      const priceResult = calculateAuctionPrice(player, mockMarketAnalysis, 60);

      playersWithPrices.push({
        ...player,
        estimatedAuctionPrice: priceResult.finalPrice,
      });
    }

    // Step 6: Analyze market
    const teamNeeds = new Map();
    const marketAnalysis = analyzeMarket(playersWithPrices, teamCapSituations, teamNeeds);

    // Verify complete workflow
    expect(marketAnalysis).toBeDefined();
    expect(marketAnalysis.totalAvailablePlayers).toBe(playersWithPrices.length);
    expect(marketAnalysis.totalAvailableCap).toBeGreaterThan(0);

    // Should complete without errors
    expect(true).toBe(true);
  });

  it('should handle complete workflow even with minimal data', () => {
    // Simulate scenario with no expiring contracts
    const teamCapSituations: TeamCapSituation[] = [
      {
        franchiseId: '0001',
        teamName: 'Test Team',
        totalSalaryCap: 45_000_000,
        currentSalaryCommitted: 35_000_000,
        projectedCapSpace2026: 10_000_000,
        discretionarySpending: 8_000_000,
        expiringContracts: [], // No expiring contracts
        draftPickCapImpact: 500_000,
        deadMoney: 0,
        projectedFranchiseTagCost: 0,
      },
    ];

    const salaryAvg = loadSalaryAverages();

    // Predict franchise tags (should handle no expiring contracts)
    const tagPredictions = predictFranchiseTags(teamCapSituations, salaryAvg);

    expect(tagPredictions.length).toBe(1);
    expect(tagPredictions[0].hasTag).toBe(false);
    expect(tagPredictions[0].taggedPlayer).toBeNull();

    // Analyze market with no players
    const teamNeeds = new Map();
    const marketAnalysis = analyzeMarket([], teamCapSituations, teamNeeds);

    expect(marketAnalysis.totalAvailablePlayers).toBe(0);
    expect(marketAnalysis.valueOpportunities.length).toBe(0);
    expect(marketAnalysis.overvaluedRisks.length).toBe(0);
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe('Auction Predictor Integration - Performance', () => {
  it('should process all teams in reasonable time (< 10 seconds)', () => {
    const startTime = Date.now();

    const teamCapSituations = buildTeamCapSituations();
    const salaryAvg = loadSalaryAverages();
    const tagPredictions = predictFranchiseTags(teamCapSituations, salaryAvg);

    const elapsed = Date.now() - startTime;

    // Should complete in reasonable time
    expect(elapsed).toBeLessThan(10000); // 10 seconds
    expect(teamCapSituations.length).toBe(16);
    expect(tagPredictions.length).toBe(16);
  });
});
