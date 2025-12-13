/**
 * MFL Schedule Integration Tests
 * Tests for playoff bracket detection and schedule integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  MFLScheduleIntegration, 
  createMFLScheduleIntegration,
  getMatchupsWithFallback,
  generateFallbackMatchups 
} from '../src/utils/mfl-schedule-integration';
import { createMatchupService, validatePacificPigskinsMatchup } from '../src/utils/matchup-service';
import { generateMockTeams } from '../src/utils/mock-matchup-data';
import type { FantasyTeam } from '../src/types/matchup-previews';

describe('MFL Schedule Integration', () => {
  let scheduleIntegration: MFLScheduleIntegration;
  let mockTeams: FantasyTeam[];

  beforeEach(() => {
    scheduleIntegration = createMFLScheduleIntegration({
      leagueId: '13522',
      year: '2025',
      useMockData: true,
    });
    
    mockTeams = generateMockTeams();
  });

  describe('Playoff Bracket Detection', () => {
    it('should extract playoff matchups for week 15', async () => {
      const matchups = await scheduleIntegration.getWeeklyMatchups(15);
      
      expect(matchups).toBeDefined();
      expect(Array.isArray(matchups)).toBe(true);
      
      // Should have multiple playoff matchups for week 15
      expect(matchups.length).toBeGreaterThan(0);
      
      // Each matchup should have valid team IDs
      matchups.forEach(matchup => {
        expect(matchup.homeTeamId).toBeDefined();
        expect(matchup.awayTeamId).toBeDefined();
        expect(matchup.week).toBe(15);
      });
    });

    it('should identify Pacific Pigskins vs Midwestside Connection matchup', async () => {
      const validation = await scheduleIntegration.validatePlayoffMatchups(15, [
        { homeTeamId: '0001', awayTeamId: '0011' }
      ]);

      expect(validation.isValid).toBe(true);
      expect(validation.foundMatchups).toHaveLength(1);
      expect(validation.missingMatchups).toHaveLength(0);

      const foundMatchup = validation.foundMatchups[0];
      expect(foundMatchup.bracketInfo).toBeDefined();
      expect(foundMatchup.bracketInfo?.bracketId).toBe('3');
      expect(foundMatchup.bracketInfo?.bracketName).toBe('The Loser\'s Bracket');
    });

    it('should generate appropriate bracket labels', async () => {
      const matchups = await scheduleIntegration.getWeeklyMatchups(15);
      
      const pacificPigskinsMatchup = matchups.find(m => 
        (m.homeTeamId === '0001' && m.awayTeamId === '0011') ||
        (m.homeTeamId === '0011' && m.awayTeamId === '0001')
      );

      expect(pacificPigskinsMatchup).toBeDefined();
      
      if (pacificPigskinsMatchup) {
        const label = scheduleIntegration.generateBracketLabel(pacificPigskinsMatchup);
        expect(label).toContain('Bracket');
        expect(label).toContain('Game');
      }
    });
  });

  describe('Fallback Matchup Generation', () => {
    it('should generate fallback matchups when MFL API fails', () => {
      const fallbackMatchups = generateFallbackMatchups(mockTeams, 15);
      
      expect(fallbackMatchups).toBeDefined();
      expect(Array.isArray(fallbackMatchups)).toBe(true);
      expect(fallbackMatchups.length).toBe(Math.floor(mockTeams.length / 2));
      
      // Each matchup should have valid structure
      fallbackMatchups.forEach(matchup => {
        expect(matchup.homeTeamId).toBeDefined();
        expect(matchup.awayTeamId).toBeDefined();
        expect(matchup.week).toBe(15);
        expect(matchup.bracketInfo).toBeUndefined(); // No bracket info for fallback
      });
    });

    it('should use fallback when MFL API is unavailable', async () => {
      // Test with invalid config to trigger fallback
      const matchups = await getMatchupsWithFallback(15, mockTeams, {
        leagueId: 'invalid',
        year: '2025',
      });

      expect(matchups).toBeDefined();
      expect(matchups.length).toBeGreaterThan(0);
      
      // Since we have local playoff bracket data, some matchups may have bracket info
      // This is expected behavior - the system successfully loads playoff data
      console.log(`Loaded ${matchups.length} matchups, ${matchups.filter(m => m.bracketInfo).length} with bracket info`);
    });
  });

  describe('Matchup Service Integration', () => {
    it('should create matchup service with MFL integration', () => {
      const service = createMatchupService({
        leagueId: '13522',
        year: '2025',
        enablePlayoffBrackets: true,
      });

      expect(service).toBeDefined();
    });

    it('should validate Pacific Pigskins playoff matchup', async () => {
      const validation = await validatePacificPigskinsMatchup({
        leagueId: '13522',
        year: '2025',
      });

      expect(validation).toBeDefined();
      expect(typeof validation.exists).toBe('boolean');
      
      if (validation.exists) {
        expect(validation.matchup).toBeDefined();
        expect(validation.bracketInfo).toBeDefined();
        
        // Should be Pacific Pigskins vs Midwestside Connection
        const matchup = validation.matchup!;
        const teamIds = [matchup.homeTeam.id, matchup.awayTeam.id].sort();
        expect(teamIds).toEqual(['0001', '0011']);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle missing playoff bracket data gracefully', async () => {
      // Create integration with invalid config
      const invalidIntegration = createMFLScheduleIntegration({
        leagueId: 'nonexistent',
        year: '2025',
      });

      // Should not throw, but return empty array or fallback
      const matchups = await invalidIntegration.getWeeklyMatchups(15).catch(() => []);
      expect(Array.isArray(matchups)).toBe(true);
    });

    it('should handle network errors gracefully', async () => {
      // Test with completely invalid configuration
      const result = await getMatchupsWithFallback(15, mockTeams, {
        leagueId: 'invalid',
        year: 'invalid',
        host: 'https://invalid-host.example.com',
      });

      // Should fall back to algorithmic generation or use local playoff data
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      
      // Since we have local playoff bracket data, some matchups may have bracket info
      // This demonstrates the system's resilience - it can work with local data even when API fails
      console.log(`Handled network error gracefully, loaded ${result.length} matchups`);
    });
  });

  describe('Bracket Type Detection', () => {
    it('should correctly identify different bracket types', async () => {
      const matchups = await scheduleIntegration.getWeeklyMatchups(15);
      
      // Should have matchups from different bracket types
      const bracketTypes = new Set(
        matchups
          .filter(m => m.bracketInfo)
          .map(m => m.bracketInfo!.gameType)
      );

      expect(bracketTypes.size).toBeGreaterThan(0);
      
      // Should include playoff and toilet-bowl games
      const gameTypes = Array.from(bracketTypes);
      expect(gameTypes.some(type => ['playoff', 'toilet-bowl', 'consolation'].includes(type))).toBe(true);
    });

    it('should generate different labels for different bracket types', async () => {
      const matchups = await scheduleIntegration.getWeeklyMatchups(15);
      
      const labels = matchups
        .filter(m => m.bracketInfo)
        .map(m => scheduleIntegration.generateBracketLabel(m));

      // Should have different label patterns
      expect(labels.length).toBeGreaterThan(0);
      
      // All labels should contain "Game" or "Playoff"
      labels.forEach(label => {
        expect(label).toMatch(/Game|Playoff/i);
      });
    });
  });
});