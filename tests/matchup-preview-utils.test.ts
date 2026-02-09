import { describe, it, expect } from 'vitest';
import {
  calculateOptimizationSeverity,
  generateOptimizationMessage,
  generateInjuryWarningMessage,
  generateIREligibilityMessage,
  shouldIncludeInAnalysis,
  sortOptimizationsByPriority,
  getCriticalLineupIssues,
  formatPlayerDisplay,
  getTimeSlotFromGameTime,
  generateLineupActionUrl,
  isGameDay,
  getCurrentNFLWeek,
} from '../src/utils/matchup-preview-utils';
import type { FantasyPlayer, LineupOptimization } from '../src/types/matchup-previews';

describe('Matchup Preview Utils', () => {
  describe('calculateOptimizationSeverity', () => {
    it('should return high severity for large point differences', () => {
      expect(calculateOptimizationSeverity(15)).toBe('high');
      expect(calculateOptimizationSeverity(10)).toBe('high');
    });

    it('should return medium severity for moderate point differences', () => {
      expect(calculateOptimizationSeverity(7)).toBe('medium');
      expect(calculateOptimizationSeverity(5)).toBe('medium');
    });

    it('should return low severity for small point differences', () => {
      expect(calculateOptimizationSeverity(3)).toBe('low');
      expect(calculateOptimizationSeverity(1)).toBe('low');
    });
  });

  describe('generateOptimizationMessage', () => {
    it('should generate correct optimization message', () => {
      const startingPlayer: FantasyPlayer = {
        id: '1',
        name: 'Player A',
        position: 'RB',
        nflTeam: 'SF',
        fantasyTeamId: '0001',
        isStarting: true,
        injuryStatus: 'Healthy',
      };

      const suggestedPlayer: FantasyPlayer = {
        id: '2',
        name: 'Player B',
        position: 'RB',
        nflTeam: 'KC',
        fantasyTeamId: '0001',
        isStarting: false,
        injuryStatus: 'Healthy',
      };

      const message = generateOptimizationMessage(startingPlayer, suggestedPlayer, 5.7);
      expect(message).toBe('Consider starting Player B (RB) over Player A (+5.7 projected points)');
    });
  });

  describe('generateInjuryWarningMessage', () => {
    it('should generate correct injury warning message', () => {
      const player: FantasyPlayer = {
        id: '1',
        name: 'Injured Player',
        position: 'WR',
        nflTeam: 'DAL',
        fantasyTeamId: '0001',
        isStarting: true,
        injuryStatus: 'Doubtful',
      };

      const message = generateInjuryWarningMessage(player);
      expect(message).toBe('Injured Player (WR) is doubtful and currently starting');
    });

    it('should handle IR status correctly', () => {
      const player: FantasyPlayer = {
        id: '1',
        name: 'IR Player',
        position: 'QB',
        nflTeam: 'BUF',
        fantasyTeamId: '0001',
        isStarting: true,
        injuryStatus: 'IR',
      };

      const message = generateInjuryWarningMessage(player);
      expect(message).toBe('IR Player (QB) is on IR and currently starting');
    });
  });

  describe('generateIREligibilityMessage', () => {
    it('should generate correct IR eligibility message', () => {
      const player: FantasyPlayer = {
        id: '1',
        name: 'Out Player',
        position: 'TE',
        nflTeam: 'MIA',
        fantasyTeamId: '0001',
        isStarting: false,
        injuryStatus: 'Out',
      };

      const message = generateIREligibilityMessage(player);
      expect(message).toBe('Out Player (TE) is Out and eligible for IR');
    });
  });

  describe('shouldIncludeInAnalysis', () => {
    it('should include high severity optimizations', () => {
      const optimization: LineupOptimization = {
        type: 'bench_upgrade',
        severity: 'high',
        startingPlayer: {} as FantasyPlayer,
        message: 'Test',
        includeInAnalysis: false,
      };

      expect(shouldIncludeInAnalysis(optimization)).toBe(true);
    });

    it('should include injury warnings', () => {
      const optimization: LineupOptimization = {
        type: 'injury_warning',
        severity: 'low',
        startingPlayer: {} as FantasyPlayer,
        message: 'Test',
        includeInAnalysis: false,
      };

      expect(shouldIncludeInAnalysis(optimization)).toBe(true);
    });

    it('should include IR eligible players', () => {
      const optimization: LineupOptimization = {
        type: 'ir_eligible',
        severity: 'medium',
        startingPlayer: {} as FantasyPlayer,
        message: 'Test',
        includeInAnalysis: false,
      };

      expect(shouldIncludeInAnalysis(optimization)).toBe(true);
    });

    it('should exclude low severity bench upgrades', () => {
      const optimization: LineupOptimization = {
        type: 'bench_upgrade',
        severity: 'low',
        startingPlayer: {} as FantasyPlayer,
        message: 'Test',
        includeInAnalysis: false,
      };

      expect(shouldIncludeInAnalysis(optimization)).toBe(false);
    });
  });

  describe('sortOptimizationsByPriority', () => {
    it('should sort optimizations by type and severity', () => {
      const optimizations: LineupOptimization[] = [
        {
          type: 'bench_upgrade',
          severity: 'high',
          startingPlayer: {} as FantasyPlayer,
          message: 'Bench upgrade',
          includeInAnalysis: false,
          pointsDifference: 8,
        },
        {
          type: 'injury_warning',
          severity: 'medium',
          startingPlayer: {} as FantasyPlayer,
          message: 'Injury warning',
          includeInAnalysis: false,
        },
        {
          type: 'ir_eligible',
          severity: 'low',
          startingPlayer: {} as FantasyPlayer,
          message: 'IR eligible',
          includeInAnalysis: false,
        },
      ];

      const sorted = sortOptimizationsByPriority(optimizations);
      
      expect(sorted[0].type).toBe('injury_warning');
      expect(sorted[1].type).toBe('ir_eligible');
      expect(sorted[2].type).toBe('bench_upgrade');
    });
  });

  describe('getCriticalLineupIssues', () => {
    it('should separate injured starters from significant upgrades', () => {
      const optimizations: LineupOptimization[] = [
        {
          type: 'injury_warning',
          severity: 'high',
          startingPlayer: {} as FantasyPlayer,
          message: 'Injury',
          includeInAnalysis: false,
        },
        {
          type: 'bench_upgrade',
          severity: 'high',
          startingPlayer: {} as FantasyPlayer,
          message: 'Upgrade',
          includeInAnalysis: false,
          pointsDifference: 12,
        },
        {
          type: 'ir_eligible',
          severity: 'medium',
          startingPlayer: {} as FantasyPlayer,
          message: 'IR',
          includeInAnalysis: false,
        },
      ];

      const { injuredStarters, significantUpgrades } = getCriticalLineupIssues(optimizations);
      
      expect(injuredStarters).toHaveLength(2);
      expect(injuredStarters[0].type).toBe('injury_warning');
      expect(injuredStarters[1].type).toBe('ir_eligible');
      
      expect(significantUpgrades).toHaveLength(1);
      expect(significantUpgrades[0].type).toBe('bench_upgrade');
    });
  });

  describe('formatPlayerDisplay', () => {
    it('should format player name with position', () => {
      const player: FantasyPlayer = {
        id: '1',
        name: 'Test Player',
        position: 'QB',
        nflTeam: 'SF',
        fantasyTeamId: '0001',
        isStarting: true,
        injuryStatus: 'Healthy',
      };

      expect(formatPlayerDisplay(player)).toBe('Test Player (QB)');
    });
  });

  describe('getTimeSlotFromGameTime', () => {
    it('should return early for morning games', () => {
      const morningGame = new Date('2025-01-01T13:00:00Z'); // 1 PM UTC (8 AM PT)
      expect(getTimeSlotFromGameTime(morningGame)).toBe('early');
    });

    it('should return late for afternoon games', () => {
      const afternoonGame = new Date('2025-01-01T21:00:00Z'); // 9 PM UTC (2 PM PT)
      expect(getTimeSlotFromGameTime(afternoonGame)).toBe('late');
    });
  });

  describe('generateLineupActionUrl', () => {
    it('should generate correct MFL lineup URL', () => {
      const url = generateLineupActionUrl('13522', '0001', '2025');
      expect(url).toBe('https://www22.myfantasyleague.com/2025/options?L=13522&F=0001&O=07');
    });
  });

  describe('isGameDay', () => {
    it('should return true for Sunday', () => {
      const sunday = new Date('2025-01-13'); // A Sunday (Jan 13, 2025)
      expect(isGameDay(sunday)).toBe(true);
    });

    it('should return true for Monday', () => {
      const monday = new Date('2025-01-14'); // A Monday (Jan 14, 2025)
      expect(isGameDay(monday)).toBe(true);
    });

    it('should return false for other days', () => {
      const tuesday = new Date('2025-01-15'); // A Tuesday (Jan 15, 2025)
      expect(isGameDay(tuesday)).toBe(false);
    });
  });

  describe('getCurrentNFLWeek', () => {
    it('should return a valid NFL week', () => {
      const week = getCurrentNFLWeek();
      expect(week).toBeGreaterThanOrEqual(1);
      expect(week).toBeLessThanOrEqual(18);
    });

    it('should handle specific dates correctly', () => {
      const earlySeasonDate = new Date('2025-09-15'); // Mid-September
      const week = getCurrentNFLWeek(earlySeasonDate);
      expect(week).toBeGreaterThanOrEqual(1);
      expect(week).toBeLessThanOrEqual(5);
    });
  });
});