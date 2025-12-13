/**
 * Tests for matchup routing utilities
 * Validates URL routing, parameter parsing, and navigation functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseMatchupParams,
  generateMatchupUrl,
  findMatchupByTeamId,
  findMatchupById,
  getDefaultMatchup,
  resolveCurrentMatchup,
  validateMatchupParams,
  MatchupNavigationState,
} from '../src/utils/matchup-routing';
import { generateMockMatchups } from '../src/utils/mock-matchup-data';
import type { Matchup } from '../src/types/matchup-previews';

describe('Matchup Routing Utils', () => {
  let mockMatchups: Matchup[];

  beforeEach(() => {
    // Mock window and location for URL generation tests
    // @ts-ignore
    global.window = {
      location: {
        origin: 'https://example.com',
        href: 'https://example.com/theleague/matchup-preview',
      },
      history: {
        replaceState: vi.fn(),
      },
    };
    
    mockMatchups = generateMockMatchups(15);
  });

  describe('parseMatchupParams', () => {
    it('should parse matchup ID from URL', () => {
      const url = new URL('https://example.com/test?matchup=matchup-1&week=15');
      const params = parseMatchupParams(url);
      
      expect(params.matchupId).toBe('matchup-1');
      expect(params.week).toBe(15);
    });

    it('should parse team ID from URL', () => {
      const url = new URL('https://example.com/test?team=0001&week=15');
      const params = parseMatchupParams(url);
      
      expect(params.teamId).toBe('0001');
      expect(params.week).toBe(15);
    });

    it('should handle missing parameters', () => {
      const url = new URL('https://example.com/test');
      const params = parseMatchupParams(url);
      
      expect(params.matchupId).toBeUndefined();
      expect(params.teamId).toBeUndefined();
      expect(params.week).toBeUndefined();
    });

    it('should handle invalid week parameter', () => {
      const url = new URL('https://example.com/test?week=invalid');
      const params = parseMatchupParams(url);
      
      expect(params.week).toBeUndefined();
    });
  });

  describe('generateMatchupUrl', () => {
    it('should generate URL with matchup ID', () => {
      const url = generateMatchupUrl('/theleague/matchup-preview', {
        matchupId: 'matchup-1',
        week: 15,
      });
      
      expect(url).toContain('matchup=matchup-1');
      expect(url).toContain('week=15');
    });

    it('should generate URL with team ID', () => {
      const url = generateMatchupUrl('/theleague/matchup-preview', {
        teamId: '0001',
        week: 15,
      });
      
      expect(url).toContain('team=0001');
      expect(url).toContain('week=15');
    });

    it('should handle empty parameters', () => {
      const url = generateMatchupUrl('/theleague/matchup-preview', {});
      
      expect(url).toBe('https://example.com/theleague/matchup-preview');
    });
  });

  describe('findMatchupByTeamId', () => {
    it('should find matchup by home team ID', () => {
      const matchup = findMatchupByTeamId(mockMatchups, '0001');
      
      expect(matchup).toBeDefined();
      expect(matchup?.homeTeam.id === '0001' || matchup?.awayTeam.id === '0001').toBe(true);
    });

    it('should find matchup by away team ID', () => {
      const matchup = findMatchupByTeamId(mockMatchups, '0002');
      
      expect(matchup).toBeDefined();
      expect(matchup?.homeTeam.id === '0002' || matchup?.awayTeam.id === '0002').toBe(true);
    });

    it('should return undefined for non-existent team', () => {
      const matchup = findMatchupByTeamId(mockMatchups, 'non-existent');
      
      expect(matchup).toBeUndefined();
    });
  });

  describe('findMatchupById', () => {
    it('should find matchup by ID', () => {
      const matchup = findMatchupById(mockMatchups, 'matchup-1');
      
      expect(matchup).toBeDefined();
      expect(matchup?.id).toBe('matchup-1');
    });

    it('should return undefined for non-existent matchup', () => {
      const matchup = findMatchupById(mockMatchups, 'non-existent');
      
      expect(matchup).toBeUndefined();
    });
  });

  describe('getDefaultMatchup', () => {
    it('should return first matchup when sorted chronologically', () => {
      const defaultMatchup = getDefaultMatchup(mockMatchups);
      
      expect(defaultMatchup).toBeDefined();
      expect(defaultMatchup?.id).toBe('matchup-1');
    });

    it('should return undefined for empty matchups array', () => {
      const defaultMatchup = getDefaultMatchup([]);
      
      expect(defaultMatchup).toBeUndefined();
    });
  });

  describe('resolveCurrentMatchup', () => {
    it('should prioritize matchup ID over team ID', () => {
      const matchup = resolveCurrentMatchup(mockMatchups, {
        matchupId: 'matchup-2',
        teamId: '0001',
      });
      
      expect(matchup?.id).toBe('matchup-2');
    });

    it('should use team ID when matchup ID is not found', () => {
      const matchup = resolveCurrentMatchup(mockMatchups, {
        matchupId: 'non-existent',
        teamId: '0001',
      });
      
      expect(matchup?.homeTeam.id === '0001' || matchup?.awayTeam.id === '0001').toBe(true);
    });

    it('should fall back to default matchup', () => {
      const matchup = resolveCurrentMatchup(mockMatchups, {
        matchupId: 'non-existent',
        teamId: 'non-existent',
      });
      
      expect(matchup?.id).toBe('matchup-1');
    });
  });

  describe('validateMatchupParams', () => {
    it('should validate correct parameters', () => {
      const result = validateMatchupParams({
        matchupId: 'matchup-1',
        teamId: '0001',
        week: 15,
      });
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid week', () => {
      const result = validateMatchupParams({
        week: 25,
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Week must be between 1 and 18');
    });

    it('should reject empty matchup ID', () => {
      const result = validateMatchupParams({
        matchupId: '',
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Matchup ID must be a non-empty string');
    });

    it('should reject empty team ID', () => {
      const result = validateMatchupParams({
        teamId: '   ',
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Team ID must be a non-empty string');
    });
  });

  describe('MatchupNavigationState', () => {
    let navigationState: MatchupNavigationState;

    beforeEach(() => {
      navigationState = new MatchupNavigationState(mockMatchups, 15);
    });

    it('should initialize from URL', () => {
      const url = new URL('https://example.com/test?matchup=matchup-2');
      const matchup = navigationState.initializeFromUrl(url);
      
      expect(matchup?.id).toBe('matchup-2');
    });

    it('should switch to matchup by ID', () => {
      const success = navigationState.switchToMatchup('matchup-3');
      
      expect(success).toBe(true);
      expect(navigationState.getCurrentMatchup()?.id).toBe('matchup-3');
    });

    it('should fail to switch to non-existent matchup', () => {
      const success = navigationState.switchToMatchup('non-existent');
      
      expect(success).toBe(false);
    });

    it('should switch to team matchup', () => {
      const success = navigationState.switchToTeam('0003');
      
      expect(success).toBe(true);
      const currentMatchup = navigationState.getCurrentMatchup();
      expect(
        currentMatchup?.homeTeam.id === '0003' || currentMatchup?.awayTeam.id === '0003'
      ).toBe(true);
    });

    it('should get available matchups', () => {
      const matchups = navigationState.getAvailableMatchups();
      
      expect(matchups).toEqual(mockMatchups);
    });

    it('should generate shareable URL', () => {
      navigationState.switchToMatchup('matchup-2');
      const url = navigationState.getShareableUrl();
      
      expect(url).toContain('matchup=matchup-2');
      expect(url).toContain('week=15');
    });
  });
});