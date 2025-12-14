/**
 * Player Status Indicators Tests
 * Tests for PlayerStatusIndicator and LineupOptimizer functionality
 */

import { describe, it, expect } from 'vitest';
import { LineupOptimizer, createLineupOptimizer, analyzeLineupOptimization } from '../src/utils/lineup-optimizer';
import type { FantasyPlayer, StartingLineup, LineupOptimization } from '../src/types/matchup-previews';

describe('Player Status Indicators', () => {
  // Mock player data for testing
  const mockPlayers: FantasyPlayer[] = [
    {
      id: '1',
      name: 'Josh Allen',
      position: 'QB',
      nflTeam: 'BUF',
      fantasyTeamId: '0001',
      projectedPoints: 24.5,
      isStarting: true,
      injuryStatus: 'Healthy',
    },
    {
      id: '2',
      name: 'Christian McCaffrey',
      position: 'RB',
      nflTeam: 'SF',
      fantasyTeamId: '0001',
      projectedPoints: 18.2,
      isStarting: true,
      injuryStatus: 'Questionable',
    },
    {
      id: '3',
      name: 'Cooper Kupp',
      position: 'WR',
      nflTeam: 'LAR',
      fantasyTeamId: '0001',
      projectedPoints: 8.5,
      isStarting: true,
      injuryStatus: 'Out',
    },
    {
      id: '4',
      name: 'Tyreek Hill',
      position: 'WR',
      nflTeam: 'MIA',
      fantasyTeamId: '0001',
      projectedPoints: 16.8,
      isStarting: false,
      injuryStatus: 'Healthy',
    },
    {
      id: '5',
      name: 'Jonathan Taylor',
      position: 'RB',
      nflTeam: 'IND',
      fantasyTeamId: '0001',
      projectedPoints: 0,
      isStarting: false,
      injuryStatus: 'IR', // Mock data for testing - real implementation uses MFL API
      isIReligible: true,
    },
  ];

  const mockStartingLineup: StartingLineup = {
    teamId: '0001',
    week: 15,
    positions: {
      QB: [mockPlayers[0]], // Josh Allen
      RB: [mockPlayers[1]], // Christian McCaffrey
      WR: [mockPlayers[2]], // Cooper Kupp (Out)
      TE: [],
      FLEX: [],
      K: [],
      DEF: [],
    },
    bench: [mockPlayers[3], mockPlayers[4]], // Tyreek Hill, Jonathan Taylor
    totalProjected: 51.2,
    optimizationOpportunities: [],
  };

  describe('LineupOptimizer', () => {
    it('should create a LineupOptimizer instance', () => {
      const optimizer = createLineupOptimizer('13522', '2025');
      expect(optimizer).toBeInstanceOf(LineupOptimizer);
    });

    it('should detect injury warnings for starting players', () => {
      const optimizer = createLineupOptimizer();
      const optimizations = optimizer.analyzeRoster(mockPlayers, mockStartingLineup);
      
      const injuryWarnings = optimizations.filter(opt => opt.type === 'injury_warning');
      expect(injuryWarnings).toHaveLength(1);
      expect(injuryWarnings[0].startingPlayer.name).toBe('Cooper Kupp');
      expect(injuryWarnings[0].severity).toBe('high');
    });

    it('should detect IR eligible players (NFL IR only)', () => {
      const optimizer = createLineupOptimizer();
      const optimizations = optimizer.analyzeRoster(mockPlayers, mockStartingLineup);
      
      const irEligible = optimizations.filter(opt => opt.type === 'ir_eligible');
      expect(irEligible).toHaveLength(1);
      expect(irEligible[0].startingPlayer.name).toBe('Jonathan Taylor');
      expect(irEligible[0].startingPlayer.injuryStatus).toBe('IR'); // Must be on NFL IR
    });

    it('should detect bench upgrades', () => {
      const optimizer = createLineupOptimizer();
      const optimizations = optimizer.analyzeRoster(mockPlayers, mockStartingLineup);
      
      const benchUpgrades = optimizations.filter(opt => opt.type === 'bench_upgrade');
      expect(benchUpgrades.length).toBeGreaterThan(0);
      
      // Should suggest Tyreek Hill over Cooper Kupp
      const kupUpgrade = benchUpgrades.find(opt => 
        opt.startingPlayer.name === 'Cooper Kupp' && 
        opt.suggestedPlayer?.name === 'Tyreek Hill'
      );
      expect(kupUpgrade).toBeDefined();
      expect(kupUpgrade?.pointsDifference).toBeCloseTo(8.3, 1);
    });

    it('should calculate optimization severity correctly', () => {
      const optimizer = createLineupOptimizer();
      const optimizations = optimizer.analyzeRoster(mockPlayers, mockStartingLineup);
      
      // Medium severity for 8.3 point difference (5-9.9 points = medium)
      const mediumSeverityUpgrade = optimizations.find(opt => 
        opt.type === 'bench_upgrade' && opt.pointsDifference && opt.pointsDifference > 8
      );
      expect(mediumSeverityUpgrade?.severity).toBe('medium');
      
      // Test high severity with a player that has 10+ point difference
      const highPointPlayer: FantasyPlayer = {
        ...mockPlayers[3],
        projectedPoints: 25.0, // 25.0 - 8.5 = 16.5 point difference
      };
      const playersWithHighDiff = [...mockPlayers.slice(0, 3), highPointPlayer, mockPlayers[4]];
      const highSeverityOptimizations = optimizer.analyzeRoster(playersWithHighDiff, mockStartingLineup);
      
      const highSeverityUpgrade = highSeverityOptimizations.find(opt => 
        opt.type === 'bench_upgrade' && opt.pointsDifference && opt.pointsDifference >= 10
      );
      expect(highSeverityUpgrade?.severity).toBe('high');
    });

    it('should prioritize critical issues', () => {
      const optimizer = createLineupOptimizer();
      const optimizations = optimizer.analyzeRoster(mockPlayers, mockStartingLineup);
      
      expect(optimizer.hasCriticalIssues(optimizations)).toBe(true);
      
      const analysisOptimizations = optimizer.getAnalysisOptimizations(optimizations);
      expect(analysisOptimizations.length).toBeGreaterThan(0);
      
      // Injury warnings should come first
      expect(analysisOptimizations[0].type).toBe('injury_warning');
    });

    it('should generate optimization summary', () => {
      const optimizer = createLineupOptimizer();
      const optimizations = optimizer.analyzeRoster(mockPlayers, mockStartingLineup);
      
      const summary = optimizer.getOptimizationSummary(optimizations);
      expect(summary.totalIssues).toBeGreaterThan(0);
      expect(summary.injuryWarnings).toBe(1);
      expect(summary.irEligible).toBe(1);
      expect(summary.benchUpgrades).toBeGreaterThan(0);
    });

    it('should calculate bench upgrades for individual players', () => {
      const optimizer = createLineupOptimizer();
      
      // Cooper Kupp should have an upgrade available (Tyreek Hill)
      const kupUpgrade = optimizer.calculateBenchUpgrade(mockPlayers[2], mockPlayers);
      expect(kupUpgrade.hasUpgrade).toBe(true);
      expect(kupUpgrade.upgradePlayer?.name).toBe('Tyreek Hill');
      expect(kupUpgrade.pointsDifference).toBeCloseTo(8.3, 1);
      
      // Josh Allen (healthy starter) should not have an upgrade
      const allenUpgrade = optimizer.calculateBenchUpgrade(mockPlayers[0], mockPlayers);
      expect(allenUpgrade.hasUpgrade).toBe(false);
    });
  });

  describe('Quick Analysis Function', () => {
    it('should provide quick lineup analysis', () => {
      const optimizations = analyzeLineupOptimization(mockPlayers, mockStartingLineup);
      
      expect(optimizations.length).toBeGreaterThan(0);
      expect(optimizations.some(opt => opt.type === 'injury_warning')).toBe(true);
      expect(optimizations.some(opt => opt.type === 'bench_upgrade')).toBe(true);
      expect(optimizations.some(opt => opt.type === 'ir_eligible')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty rosters gracefully', () => {
      const optimizer = createLineupOptimizer();
      const emptyLineup: StartingLineup = {
        teamId: '0001',
        week: 15,
        positions: { QB: [], RB: [], WR: [], TE: [], FLEX: [], K: [], DEF: [] },
        bench: [],
        totalProjected: 0,
        optimizationOpportunities: [],
      };
      
      const optimizations = optimizer.analyzeRoster([], emptyLineup);
      expect(optimizations).toHaveLength(0);
    });

    it('should handle players without projections', () => {
      const playersWithoutProjections = mockPlayers.map(p => ({
        ...p,
        projectedPoints: undefined,
      }));
      
      const optimizer = createLineupOptimizer();
      const optimizations = optimizer.analyzeRoster(playersWithoutProjections, mockStartingLineup);
      
      // Should still detect injury warnings
      const injuryWarnings = optimizations.filter(opt => opt.type === 'injury_warning');
      expect(injuryWarnings.length).toBeGreaterThan(0);
      
      // Should not detect bench upgrades without projections
      const benchUpgrades = optimizations.filter(opt => opt.type === 'bench_upgrade');
      expect(benchUpgrades).toHaveLength(0);
    });

    it('should handle all healthy players', () => {
      const healthyPlayers = mockPlayers.map(p => ({
        ...p,
        injuryStatus: 'Healthy' as const,
        isIReligible: false,
      }));
      
      const optimizer = createLineupOptimizer();
      const optimizations = optimizer.analyzeRoster(healthyPlayers, mockStartingLineup);
      
      // Should not have injury warnings
      const injuryWarnings = optimizations.filter(opt => opt.type === 'injury_warning');
      expect(injuryWarnings).toHaveLength(0);
      
      // Should not have IR eligible players
      const irEligible = optimizations.filter(opt => opt.type === 'ir_eligible');
      expect(irEligible).toHaveLength(0);
      
      // May still have bench upgrades
      const benchUpgrades = optimizations.filter(opt => opt.type === 'bench_upgrade');
      expect(benchUpgrades.length).toBeGreaterThanOrEqual(0);
    });

    it('should NOT consider Out players as IR eligible (The League rule)', () => {
      const playersWithOutStatus = mockPlayers.map(p => ({
        ...p,
        injuryStatus: p.name === 'Jonathan Taylor' ? 'Out' as const : p.injuryStatus,
        isIReligible: false, // Out players are not IR eligible in The League
      }));
      
      const optimizer = createLineupOptimizer();
      const optimizations = optimizer.analyzeRoster(playersWithOutStatus, mockStartingLineup);
      
      // Should have injury warnings for Out players
      const injuryWarnings = optimizations.filter(opt => opt.type === 'injury_warning');
      expect(injuryWarnings.length).toBeGreaterThan(0);
      
      // Should NOT have IR eligible players (Out is not IR eligible)
      const irEligible = optimizations.filter(opt => opt.type === 'ir_eligible');
      expect(irEligible).toHaveLength(0);
    });
  });
});