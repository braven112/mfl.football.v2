import { describe, it, expect } from 'vitest';
import {
  calculateFranchiseTagScore,
  predictFranchiseTags,
  applyFranchiseTagOverride,
  getAvailableFreeAgents,
  calculateTagOverrideImpact,
} from '../src/utils/franchise-tag-predictor';
import type {
  PlayerValuation,
  TeamCapSituation,
  FranchiseTagPrediction,
} from '../src/types/auction-predictor';

// Mock salary averages for franchise tag calculations
const mockSalaryAverages = {
  positions: {
    QB: { top3Average: 25_000_000 },
    RB: { top3Average: 12_000_000 },
    WR: { top3Average: 18_000_000 },
    TE: { top3Average: 11_000_000 },
  },
};

// Helper: Create mock player
function createMockPlayer(overrides: Partial<PlayerValuation> = {}): PlayerValuation {
  return {
    id: '12345',
    name: 'Test Player',
    position: 'WR',
    team: 'TEST',
    age: 27,
    experience: 5,
    currentSalary: 5_000_000,
    contractYearsRemaining: 1,
    compositeRank: 25,
    positionalScarcity: 0.5,
    ...overrides,
  };
}

// Helper: Create mock team cap situation
function createMockTeamCap(overrides: Partial<TeamCapSituation> = {}): TeamCapSituation {
  return {
    franchiseId: '0001',
    teamName: 'Test Team',
    projectedCapSpace2026: 50_000_000,
    currentCommitments: 150_000_000,
    discretionarySpending: 25_000_000,
    expiringContracts: [],
    draftPickCommitments: 5_000_000,
    positionalNeeds: ['WR', 'RB'],
    championshipWindow: 'contending',
    ...overrides,
  };
}

describe('franchise-tag-predictor', () => {
  describe('calculateFranchiseTagScore', () => {
    it('should calculate base score for typical player', () => {
      const player = createMockPlayer({
        compositeRank: 20,
        currentSalary: 8_000_000,
        age: 27,
        positionalScarcity: 0.6,
      });

      const teamCap = createMockTeamCap({
        projectedCapSpace2026: 50_000_000,
        discretionarySpending: 30_000_000,
      });

      const tagSalary = 18_000_000; // WR tag
      const score = calculateFranchiseTagScore(player, tagSalary, teamCap);

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should give higher scores to elite players (rank <= 20)', () => {
      const elitePlayer = createMockPlayer({ compositeRank: 10 });
      const goodPlayer = createMockPlayer({ compositeRank: 40 });

      const teamCap = createMockTeamCap();
      const tagSalary = 18_000_000;

      const eliteScore = calculateFranchiseTagScore(elitePlayer, tagSalary, teamCap);
      const goodScore = calculateFranchiseTagScore(goodPlayer, tagSalary, teamCap);

      expect(eliteScore).toBeGreaterThan(goodScore);
    });

    it('should boost score for underpaid players (salary < 70% of tag)', () => {
      const underpaidPlayer = createMockPlayer({
        currentSalary: 10_000_000, // < 70% of 18M tag
        compositeRank: 25,
      });

      const fairlyPaidPlayer = createMockPlayer({
        currentSalary: 16_000_000, // ~90% of 18M tag
        compositeRank: 25,
      });

      const teamCap = createMockTeamCap();
      const tagSalary = 18_000_000;

      const underpaidScore = calculateFranchiseTagScore(underpaidPlayer, tagSalary, teamCap);
      const fairScore = calculateFranchiseTagScore(fairlyPaidPlayer, tagSalary, teamCap);

      expect(underpaidScore).toBeGreaterThan(fairScore);
    });

    it('should penalize overpaid players (salary > 120% of tag)', () => {
      const overpaidPlayer = createMockPlayer({
        currentSalary: 24_000_000, // > 120% of 18M tag
        compositeRank: 25,
      });

      const fairlyPaidPlayer = createMockPlayer({
        currentSalary: 16_000_000,
        compositeRank: 25,
      });

      const teamCap = createMockTeamCap();
      const tagSalary = 18_000_000;

      const overpaidScore = calculateFranchiseTagScore(overpaidPlayer, tagSalary, teamCap);
      const fairScore = calculateFranchiseTagScore(fairlyPaidPlayer, tagSalary, teamCap);

      expect(overpaidScore).toBeLessThan(fairScore);
    });

    it('should boost score for young players (age <= 26)', () => {
      const youngPlayer = createMockPlayer({ age: 24, compositeRank: 25 });
      const primePlayer = createMockPlayer({ age: 28, compositeRank: 25 });

      const teamCap = createMockTeamCap();
      const tagSalary = 18_000_000;

      const youngScore = calculateFranchiseTagScore(youngPlayer, tagSalary, teamCap);
      const primeScore = calculateFranchiseTagScore(primePlayer, tagSalary, teamCap);

      expect(youngScore).toBeGreaterThan(primeScore);
    });

    it('should penalize older players (age >= 30)', () => {
      const oldPlayer = createMockPlayer({ age: 32, compositeRank: 25 });
      const primePlayer = createMockPlayer({ age: 27, compositeRank: 25 });

      const teamCap = createMockTeamCap();
      const tagSalary = 18_000_000;

      const oldScore = calculateFranchiseTagScore(oldPlayer, tagSalary, teamCap);
      const primeScore = calculateFranchiseTagScore(primePlayer, tagSalary, teamCap);

      expect(oldScore).toBeLessThan(primeScore);
    });

    it('should boost score for scarce positions', () => {
      const scarcePlayer = createMockPlayer({
        positionalScarcity: 0.9,
        compositeRank: 25,
      });

      const commonPlayer = createMockPlayer({
        positionalScarcity: 0.3,
        compositeRank: 25,
      });

      const teamCap = createMockTeamCap();
      const tagSalary = 18_000_000;

      const scarceScore = calculateFranchiseTagScore(scarcePlayer, tagSalary, teamCap);
      const commonScore = calculateFranchiseTagScore(commonPlayer, tagSalary, teamCap);

      expect(scarceScore).toBeGreaterThan(commonScore);
    });

    it('should boost score for teams with cap flexibility', () => {
      const flexibleCap = createMockTeamCap({
        projectedCapSpace2026: 60_000_000,
        discretionarySpending: 40_000_000, // >50% flexibility
      });

      const tightCap = createMockTeamCap({
        projectedCapSpace2026: 60_000_000,
        discretionarySpending: 10_000_000, // <20% flexibility
      });

      const player = createMockPlayer({ compositeRank: 25 });
      const tagSalary = 18_000_000;

      const flexScore = calculateFranchiseTagScore(player, tagSalary, flexibleCap);
      const tightScore = calculateFranchiseTagScore(player, tagSalary, tightCap);

      expect(flexScore).toBeGreaterThan(tightScore);
    });

    it('should handle player without composite rank', () => {
      const playerNoRank = createMockPlayer({ compositeRank: undefined });
      const teamCap = createMockTeamCap();
      const tagSalary = 18_000_000;

      const score = calculateFranchiseTagScore(playerNoRank, tagSalary, teamCap);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should normalize scores to 0-100 range', () => {
      // Test extremes
      const superElite = createMockPlayer({
        compositeRank: 1,
        currentSalary: 1_000_000,
        age: 22,
        positionalScarcity: 1.0,
      });

      const teamWithCap = createMockTeamCap({
        projectedCapSpace2026: 80_000_000,
        discretionarySpending: 60_000_000,
      });

      const tagSalary = 25_000_000;
      const score = calculateFranchiseTagScore(superElite, tagSalary, teamWithCap);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('predictFranchiseTags', () => {
    it('should return empty tag for team with no expiring contracts', () => {
      const teamCap = createMockTeamCap({
        franchiseId: '0001',
        teamName: 'No Expirations',
        expiringContracts: [],
      });

      const predictions = predictFranchiseTags([teamCap], mockSalaryAverages);

      expect(predictions).toHaveLength(1);
      expect(predictions[0].hasTag).toBe(false);
      expect(predictions[0].taggedPlayer).toBeNull();
      expect(predictions[0].tagCandidates).toHaveLength(0);
    });

    it('should predict tag for team with high-value expiring player', () => {
      const elitePlayer = createMockPlayer({
        id: 'elite1',
        compositeRank: 5,
        position: 'WR',
        currentSalary: 8_000_000,
        age: 25,
      });

      const teamCap = createMockTeamCap({
        franchiseId: '0002',
        expiringContracts: [elitePlayer],
        discretionarySpending: 30_000_000,
        projectedCapSpace2026: 50_000_000,
      });

      const predictions = predictFranchiseTags([teamCap], mockSalaryAverages);

      expect(predictions).toHaveLength(1);
      expect(predictions[0].hasTag).toBe(true);
      expect(predictions[0].taggedPlayer?.id).toBe('elite1');
      expect(predictions[0].tagCandidates.length).toBeGreaterThan(0);
    });

    it('should choose best candidate when multiple players expiring', () => {
      const elitePlayer = createMockPlayer({
        id: 'elite',
        compositeRank: 8,
        currentSalary: 6_000_000,
        age: 24,
        positionalScarcity: 0.8,
      });

      const goodPlayer = createMockPlayer({
        id: 'good',
        compositeRank: 30,
        currentSalary: 8_000_000,
        age: 28,
        positionalScarcity: 0.4,
      });

      const teamCap = createMockTeamCap({
        expiringContracts: [goodPlayer, elitePlayer],
        projectedCapSpace2026: 60_000_000,
        discretionarySpending: 35_000_000, // Good cap flexibility
      });

      const predictions = predictFranchiseTags([teamCap], mockSalaryAverages);

      expect(predictions[0].hasTag).toBe(true);
      expect(predictions[0].taggedPlayer?.id).toBe('elite');
    });

    it('should not tag if best candidate score is below threshold (< 50)', () => {
      const lowValuePlayer = createMockPlayer({
        compositeRank: 80,
        currentSalary: 20_000_000, // Overpaid
        age: 33, // Old
        positionalScarcity: 0.2, // Not scarce
      });

      const teamCap = createMockTeamCap({
        expiringContracts: [lowValuePlayer],
        discretionarySpending: 5_000_000, // Low cap
        projectedCapSpace2026: 30_000_000,
      });

      const predictions = predictFranchiseTags([teamCap], mockSalaryAverages);

      expect(predictions[0].hasTag).toBe(false);
    });

    it('should return top 5 candidates sorted by score', () => {
      const players = Array.from({ length: 10 }, (_, i) =>
        createMockPlayer({
          id: `player${i}`,
          compositeRank: (i + 1) * 10,
        })
      );

      const teamCap = createMockTeamCap({
        expiringContracts: players,
      });

      const predictions = predictFranchiseTags([teamCap], mockSalaryAverages);

      expect(predictions[0].tagCandidates).toHaveLength(5);

      // Verify sorted by score (descending)
      const scores = predictions[0].tagCandidates.map(c => c.score);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
      }
    });

    it('should handle player rankings from external source', () => {
      const player = createMockPlayer({
        id: 'rankedPlayer',
        dynastyRank: undefined, // No rank initially
        redraftRank: undefined,
      });

      const teamCap = createMockTeamCap({
        expiringContracts: [player],
      });

      const rankings = new Map([
        ['rankedPlayer', { dynastyRank: 12, redraftRank: 15 }],
      ]);

      const predictions = predictFranchiseTags([teamCap], mockSalaryAverages, rankings);

      // Should enhance player with rankings
      expect(predictions[0].tagCandidates[0].player.dynastyRank).toBe(12);
      expect(predictions[0].tagCandidates[0].player.compositeRank).toBe(12);
    });

    it('should set isManualOverride to false for automatic predictions', () => {
      const teamCap = createMockTeamCap({
        expiringContracts: [createMockPlayer()],
      });

      const predictions = predictFranchiseTags([teamCap], mockSalaryAverages);

      expect(predictions[0].isManualOverride).toBe(false);
    });
  });

  describe('applyFranchiseTagOverride', () => {
    const basePredictions: FranchiseTagPrediction[] = [
      {
        franchiseId: '0001',
        teamName: 'Team 1',
        hasTag: true,
        taggedPlayer: createMockPlayer({ id: 'auto-tagged' }),
        tagCandidates: [],
        isManualOverride: false,
      },
      {
        franchiseId: '0002',
        teamName: 'Team 2',
        hasTag: false,
        taggedPlayer: null,
        tagCandidates: [],
        isManualOverride: false,
      },
    ];

    const allPlayers = [
      createMockPlayer({ id: 'auto-tagged' }),
      createMockPlayer({ id: 'manual-tag', position: 'QB' }),
      createMockPlayer({ id: 'other-player' }),
    ];

    it('should override tag for specified team', () => {
      const overridden = applyFranchiseTagOverride(
        basePredictions,
        '0001',
        'manual-tag',
        allPlayers,
        mockSalaryAverages
      );

      const team1 = overridden.find(p => p.franchiseId === '0001');
      expect(team1?.hasTag).toBe(true);
      expect(team1?.taggedPlayer?.id).toBe('manual-tag');
      expect(team1?.isManualOverride).toBe(true);
    });

    it('should not affect other teams', () => {
      const overridden = applyFranchiseTagOverride(
        basePredictions,
        '0001',
        'manual-tag',
        allPlayers,
        mockSalaryAverages
      );

      const team2 = overridden.find(p => p.franchiseId === '0002');
      expect(team2?.hasTag).toBe(false);
      expect(team2?.isManualOverride).toBe(false);
    });

    it('should remove tag when playerId is null', () => {
      const overridden = applyFranchiseTagOverride(
        basePredictions,
        '0001',
        null,
        allPlayers,
        mockSalaryAverages
      );

      const team1 = overridden.find(p => p.franchiseId === '0001');
      expect(team1?.hasTag).toBe(false);
      expect(team1?.taggedPlayer).toBeNull();
      expect(team1?.isManualOverride).toBe(true);
    });

    it('should calculate franchise tag salary for overridden player', () => {
      const overridden = applyFranchiseTagOverride(
        basePredictions,
        '0001',
        'manual-tag',
        allPlayers,
        mockSalaryAverages
      );

      const team1 = overridden.find(p => p.franchiseId === '0001');
      expect(team1?.taggedPlayer?.franchiseTagSalary).toBe(mockSalaryAverages.positions.QB.top3Average);
    });

    it('should handle player not found gracefully', () => {
      const overridden = applyFranchiseTagOverride(
        basePredictions,
        '0001',
        'nonexistent-player',
        allPlayers,
        mockSalaryAverages
      );

      const team1 = overridden.find(p => p.franchiseId === '0001');
      // Should remain unchanged
      expect(team1?.taggedPlayer?.id).toBe('auto-tagged');
      expect(team1?.isManualOverride).toBe(false);
    });
  });

  describe('getAvailableFreeAgents', () => {
    it('should return all players when no tags', () => {
      const players = [
        createMockPlayer({ id: '1' }),
        createMockPlayer({ id: '2' }),
        createMockPlayer({ id: '3' }),
      ];

      const predictions: FranchiseTagPrediction[] = [
        {
          franchiseId: '0001',
          teamName: 'Team 1',
          hasTag: false,
          taggedPlayer: null,
          tagCandidates: [],
          isManualOverride: false,
        },
      ];

      const freeAgents = getAvailableFreeAgents(players, predictions);

      expect(freeAgents).toHaveLength(3);
    });

    it('should exclude tagged players', () => {
      const players = [
        createMockPlayer({ id: '1' }),
        createMockPlayer({ id: '2' }),
        createMockPlayer({ id: '3' }),
      ];

      const predictions: FranchiseTagPrediction[] = [
        {
          franchiseId: '0001',
          teamName: 'Team 1',
          hasTag: true,
          taggedPlayer: players[1], // Tag player 2
          tagCandidates: [],
          isManualOverride: false,
        },
      ];

      const freeAgents = getAvailableFreeAgents(players, predictions);

      expect(freeAgents).toHaveLength(2);
      expect(freeAgents.find(p => p.id === '2')).toBeUndefined();
      expect(freeAgents.find(p => p.id === '1')).toBeDefined();
      expect(freeAgents.find(p => p.id === '3')).toBeDefined();
    });

    it('should handle multiple teams with tags', () => {
      const players = [
        createMockPlayer({ id: '1' }),
        createMockPlayer({ id: '2' }),
        createMockPlayer({ id: '3' }),
        createMockPlayer({ id: '4' }),
      ];

      const predictions: FranchiseTagPrediction[] = [
        {
          franchiseId: '0001',
          teamName: 'Team 1',
          hasTag: true,
          taggedPlayer: players[0],
          tagCandidates: [],
          isManualOverride: false,
        },
        {
          franchiseId: '0002',
          teamName: 'Team 2',
          hasTag: true,
          taggedPlayer: players[2],
          tagCandidates: [],
          isManualOverride: false,
        },
      ];

      const freeAgents = getAvailableFreeAgents(players, predictions);

      expect(freeAgents).toHaveLength(2);
      expect(freeAgents.map(p => p.id)).toEqual(expect.arrayContaining(['2', '4']));
    });
  });

  describe('calculateTagOverrideImpact', () => {
    const allPlayers = [
      createMockPlayer({ id: '1', position: 'WR' }),
      createMockPlayer({ id: '2', position: 'WR' }),
      createMockPlayer({ id: '3', position: 'RB' }),
    ];

    it('should detect players added to market', () => {
      const baseline: FranchiseTagPrediction[] = [
        {
          franchiseId: '0001',
          teamName: 'Team 1',
          hasTag: true,
          taggedPlayer: allPlayers[0], // WR1 tagged in baseline
          tagCandidates: [],
          isManualOverride: false,
        },
      ];

      const override: FranchiseTagPrediction[] = [
        {
          franchiseId: '0001',
          teamName: 'Team 1',
          hasTag: false,
          taggedPlayer: null, // No tag in override
          tagCandidates: [],
          isManualOverride: true,
        },
      ];

      const impact = calculateTagOverrideImpact(baseline, override, allPlayers);

      expect(impact.playersAddedToMarket).toHaveLength(1);
      expect(impact.playersAddedToMarket[0].id).toBe('1');
    });

    it('should detect players removed from market', () => {
      const baseline: FranchiseTagPrediction[] = [
        {
          franchiseId: '0001',
          teamName: 'Team 1',
          hasTag: false,
          taggedPlayer: null,
          tagCandidates: [],
          isManualOverride: false,
        },
      ];

      const override: FranchiseTagPrediction[] = [
        {
          franchiseId: '0001',
          teamName: 'Team 1',
          hasTag: true,
          taggedPlayer: allPlayers[1], // WR2 tagged in override
          tagCandidates: [],
          isManualOverride: true,
        },
      ];

      const impact = calculateTagOverrideImpact(baseline, override, allPlayers);

      expect(impact.playersRemovedFromMarket).toHaveLength(1);
      expect(impact.playersRemovedFromMarket[0].id).toBe('2');
    });

    it('should handle no changes', () => {
      const baseline: FranchiseTagPrediction[] = [
        {
          franchiseId: '0001',
          teamName: 'Team 1',
          hasTag: true,
          taggedPlayer: allPlayers[0],
          tagCandidates: [],
          isManualOverride: false,
        },
      ];

      const override: FranchiseTagPrediction[] = [
        {
          franchiseId: '0001',
          teamName: 'Team 1',
          hasTag: true,
          taggedPlayer: allPlayers[0], // Same player tagged
          tagCandidates: [],
          isManualOverride: false,
        },
      ];

      const impact = calculateTagOverrideImpact(baseline, override, allPlayers);

      expect(impact.playersAddedToMarket).toHaveLength(0);
      expect(impact.playersRemovedFromMarket).toHaveLength(0);
    });
  });
});
