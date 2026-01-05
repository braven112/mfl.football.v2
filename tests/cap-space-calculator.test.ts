import { describe, it, expect } from 'vitest';
import {
  calculateEscalatedSalary,
  generateContractSchedule,
  calculate2026CapHit,
  calculateFranchiseTagSalary,
  identifyExpiringContracts,
  calculateTeamCapSpace,
  calculateLeagueWideCapSpace,
  loadDeadMoney,
} from '../src/utils/cap-space-calculator';

const SALARY_CAP = 45_000_000;
const LEAGUE_MINIMUM = 425_000;
const ANNUAL_ESCALATION = 0.10;

// Mock salary averages
const mockSalaryAverages = {
  positions: {
    QB: { top3Average: 25_000_000 },
    RB: { top3Average: 12_000_000 },
    WR: { top3Average: 18_000_000 },
    TE: { top3Average: 11_000_000 },
  },
};

// Helper: Create mock roster player
function createMockRosterPlayer(overrides: any = {}) {
  return {
    id: '12345',
    name: 'Test Player',
    position: 'WR',
    salary: 5_000_000,
    contractYear: '3',
    franchiseId: '0001',
    status: 'ROSTER' as const,
    team: 'TEST',
    age: 27,
    ...overrides,
  };
}

describe('cap-space-calculator', () => {
  describe('calculateEscalatedSalary', () => {
    it('should return base salary for year 0', () => {
      const baseSalary = 10_000_000;
      const escalated = calculateEscalatedSalary(baseSalary, 0);

      expect(escalated).toBe(baseSalary);
    });

    it('should escalate 10% per year', () => {
      const baseSalary = 10_000_000;

      const year1 = calculateEscalatedSalary(baseSalary, 1);
      const year2 = calculateEscalatedSalary(baseSalary, 2);
      const year3 = calculateEscalatedSalary(baseSalary, 3);

      expect(year1).toBe(11_000_000); // 10M * 1.10
      expect(year2).toBe(12_100_000); // 10M * 1.10^2
      expect(year3).toBe(13_310_000); // 10M * 1.10^3
    });

    it('should round to nearest integer', () => {
      const baseSalary = 1_234_567;
      const escalated = calculateEscalatedSalary(baseSalary, 1);

      expect(Number.isInteger(escalated)).toBe(true);
    });

    it('should handle very small salaries', () => {
      const minSalary = LEAGUE_MINIMUM;
      const escalated = calculateEscalatedSalary(minSalary, 1);

      expect(escalated).toBe(Math.round(LEAGUE_MINIMUM * 1.10));
    });

    it('should handle very large salaries', () => {
      const hugeSalary = 50_000_000;
      const escalated = calculateEscalatedSalary(hugeSalary, 5);

      expect(escalated).toBeGreaterThan(hugeSalary);
      expect(escalated).toBe(Math.round(hugeSalary * Math.pow(1.10, 5)));
    });
  });

  describe('generateContractSchedule', () => {
    it('should generate correct number of years', () => {
      const schedule = generateContractSchedule('player1', 10_000_000, 3, 2026);

      expect(schedule.yearlySchedule).toHaveLength(3);
      expect(schedule.contractYears).toBe(3);
    });

    it('should escalate salary each year', () => {
      const baseSalary = 10_000_000;
      const schedule = generateContractSchedule('player1', baseSalary, 3, 2026);

      expect(schedule.yearlySchedule[0].salary).toBe(baseSalary);
      expect(schedule.yearlySchedule[1].salary).toBe(11_000_000);
      expect(schedule.yearlySchedule[2].salary).toBe(12_100_000);
    });

    it('should set correct years', () => {
      const schedule = generateContractSchedule('player1', 10_000_000, 3, 2026);

      expect(schedule.yearlySchedule[0].year).toBe(2026);
      expect(schedule.yearlySchedule[1].year).toBe(2027);
      expect(schedule.yearlySchedule[2].year).toBe(2028);
    });

    it('should calculate total contract value', () => {
      const baseSalary = 10_000_000;
      const schedule = generateContractSchedule('player1', baseSalary, 3, 2026);

      // 10M + 11M + 12.1M = 33.1M
      expect(schedule.totalContractValue).toBe(33_100_000);
    });

    it('should calculate average annual value', () => {
      const baseSalary = 10_000_000;
      const schedule = generateContractSchedule('player1', baseSalary, 3, 2026);

      // 33.1M / 3 = ~11.03M
      expect(schedule.averageAnnualValue).toBe(Math.round(33_100_000 / 3));
    });

    it('should set cap hit equal to salary', () => {
      const schedule = generateContractSchedule('player1', 10_000_000, 3, 2026);

      schedule.yearlySchedule.forEach(year => {
        expect(year.capHit).toBe(year.salary);
      });
    });

    it('should handle 1-year contracts', () => {
      const schedule = generateContractSchedule('player1', 5_000_000, 1, 2026);

      expect(schedule.yearlySchedule).toHaveLength(1);
      expect(schedule.totalContractValue).toBe(5_000_000);
      expect(schedule.averageAnnualValue).toBe(5_000_000);
    });

    it('should handle 5-year contracts', () => {
      const schedule = generateContractSchedule('player1', 10_000_000, 5, 2026);

      expect(schedule.yearlySchedule).toHaveLength(5);
      expect(schedule.yearlySchedule[4].salary).toBe(calculateEscalatedSalary(10_000_000, 4));
    });
  });

  describe('calculate2026CapHit', () => {
    it('should return 0 for expiring contracts (1 year remaining)', () => {
      const capHit = calculate2026CapHit(10_000_000, 1, 'ROSTER');

      expect(capHit).toBe(0);
    });

    it('should escalate salary 10% for active contracts', () => {
      const currentSalary = 10_000_000;
      const capHit = calculate2026CapHit(currentSalary, 2, 'ROSTER');

      expect(capHit).toBe(11_000_000); // 10M * 1.10
    });

    it('should apply 50% discount for taxi squad', () => {
      const currentSalary = 10_000_000;
      const capHit = calculate2026CapHit(currentSalary, 2, 'TAXI_SQUAD');

      expect(capHit).toBe(Math.round(11_000_000 * 0.5)); // (10M * 1.10) * 0.5
    });

    it('should treat injured reserve same as roster', () => {
      const currentSalary = 10_000_000;
      const rosterHit = calculate2026CapHit(currentSalary, 2, 'ROSTER');
      const irHit = calculate2026CapHit(currentSalary, 2, 'INJURED_RESERVE');

      expect(irHit).toBe(rosterHit);
    });

    it('should handle multi-year contracts', () => {
      const currentSalary = 5_000_000;
      const threeYearHit = calculate2026CapHit(currentSalary, 3, 'ROSTER');
      const fiveYearHit = calculate2026CapHit(currentSalary, 5, 'ROSTER');

      // Both should escalate same amount (only 1 year escalation)
      expect(threeYearHit).toBe(fiveYearHit);
      expect(threeYearHit).toBe(Math.round(5_000_000 * 1.10));
    });

    it('should return 0 for already expired contracts', () => {
      const capHit = calculate2026CapHit(10_000_000, 0, 'ROSTER');

      expect(capHit).toBe(0);
    });
  });

  describe('calculateFranchiseTagSalary', () => {
    it('should return top3Average for known positions', () => {
      expect(calculateFranchiseTagSalary('QB', mockSalaryAverages)).toBe(25_000_000);
      expect(calculateFranchiseTagSalary('RB', mockSalaryAverages)).toBe(12_000_000);
      expect(calculateFranchiseTagSalary('WR', mockSalaryAverages)).toBe(18_000_000);
      expect(calculateFranchiseTagSalary('TE', mockSalaryAverages)).toBe(11_000_000);
    });

    it('should return league minimum for unknown positions', () => {
      const pkTag = calculateFranchiseTagSalary('PK', mockSalaryAverages);
      const defTag = calculateFranchiseTagSalary('DEF', mockSalaryAverages);

      expect(pkTag).toBe(LEAGUE_MINIMUM);
      expect(defTag).toBe(LEAGUE_MINIMUM);
    });

    it('should round to nearest integer', () => {
      const tag = calculateFranchiseTagSalary('QB', mockSalaryAverages);

      expect(Number.isInteger(tag)).toBe(true);
    });
  });

  describe('identifyExpiringContracts', () => {
    it('should identify players with 1 year remaining', () => {
      const players = [
        createMockRosterPlayer({ id: '1', contractYear: '1' }),
        createMockRosterPlayer({ id: '2', contractYear: '2' }),
        createMockRosterPlayer({ id: '3', contractYear: '1' }),
      ];

      const expiring = identifyExpiringContracts(players);

      expect(expiring).toHaveLength(2);
      expect(expiring.map(p => p.id)).toEqual(expect.arrayContaining(['1', '3']));
    });

    it('should return empty array when no expiring contracts', () => {
      const players = [
        createMockRosterPlayer({ contractYear: '2' }),
        createMockRosterPlayer({ contractYear: '3' }),
      ];

      const expiring = identifyExpiringContracts(players);

      expect(expiring).toHaveLength(0);
    });

    it('should handle empty player array', () => {
      const expiring = identifyExpiringContracts([]);

      expect(expiring).toHaveLength(0);
    });

    it('should parse contract year as integer', () => {
      const players = [
        createMockRosterPlayer({ contractYear: '01' }), // Leading zero
        createMockRosterPlayer({ contractYear: '1' }),
      ];

      const expiring = identifyExpiringContracts(players);

      expect(expiring).toHaveLength(2);
    });
  });

  describe('calculateTeamCapSpace', () => {
    it('should calculate correct projected cap space', () => {
      const players = [
        createMockRosterPlayer({
          franchiseId: '0001',
          salary: 10_000_000,
          contractYear: '2', // Not expiring
        }),
        createMockRosterPlayer({
          franchiseId: '0001',
          salary: 5_000_000,
          contractYear: '3',
        }),
      ];

      const capSituation = calculateTeamCapSpace('0001', 'Test Team', players, 0, 0);

      // Committed: (10M * 1.10) + (5M * 1.10) = 11M + 5.5M = 16.5M
      // Available: 45M - 16.5M = 28.5M
      expect(capSituation.committedSalaries).toBe(16_500_000);
      expect(capSituation.projectedCapSpace2026).toBe(28_500_000);
    });

    it('should exclude expiring contracts from commitments', () => {
      const players = [
        createMockRosterPlayer({
          franchiseId: '0001',
          salary: 10_000_000,
          contractYear: '1', // Expiring
        }),
        createMockRosterPlayer({
          franchiseId: '0001',
          salary: 5_000_000,
          contractYear: '2', // Not expiring
        }),
      ];

      const capSituation = calculateTeamCapSpace('0001', 'Test Team', players, 0, 0);

      // Only 5M contract counts (escalated to 5.5M)
      expect(capSituation.committedSalaries).toBe(5_500_000);
    });

    it('should include dead money in commitments', () => {
      const players = [
        createMockRosterPlayer({
          franchiseId: '0001',
          salary: 5_000_000,
          contractYear: '2',
        }),
      ];

      const deadMoney = 3_000_000;
      const capSituation = calculateTeamCapSpace('0001', 'Test Team', players, deadMoney, 0);

      // Committed: 5.5M + 3M dead = 8.5M
      // Available: 45M - 8.5M = 36.5M
      expect(capSituation.projectedCapSpace2026).toBe(36_500_000);
    });

    it('should include franchise tag in commitments', () => {
      const players = [
        createMockRosterPlayer({
          franchiseId: '0001',
          salary: 5_000_000,
          contractYear: '2',
        }),
      ];

      const tagSalary = 18_000_000;
      const capSituation = calculateTeamCapSpace('0001', 'Test Team', players, 0, tagSalary);

      // Committed: 5.5M + 18M tag = 23.5M
      // Available: 45M - 23.5M = 21.5M
      expect(capSituation.projectedCapSpace2026).toBe(21_500_000);
    });

    it('should identify expiring contracts', () => {
      const players = [
        createMockRosterPlayer({
          franchiseId: '0001',
          id: 'exp1',
          contractYear: '1',
        }),
        createMockRosterPlayer({
          franchiseId: '0001',
          id: 'exp2',
          contractYear: '1',
        }),
      ];

      const capSituation = calculateTeamCapSpace('0001', 'Test Team', players, 0, 0);

      expect(capSituation.expiringContracts).toHaveLength(2);
      expect(capSituation.expiringContracts.map(p => p.id)).toEqual(['exp1', 'exp2']);
    });

    it('should calculate discretionary spending', () => {
      const players = [
        createMockRosterPlayer({
          franchiseId: '0001',
          salary: 5_000_000,
          contractYear: '2',
        }),
      ];

      const capSituation = calculateTeamCapSpace('0001', 'Test Team', players, 0, 0);

      // Cap space: 45M - 5.5M = 39.5M
      // Current roster: 1 player (+ 0 tagged)
      // Min roster: 20
      // Spots to fill: 19
      // Min spend: 19 * 425k = 8.075M
      // Discretionary: 39.5M - 8.075M = 31.425M
      expect(capSituation.discretionarySpending).toBe(31_425_000);
    });

    it('should calculate positional needs', () => {
      const players = [
        createMockRosterPlayer({
          franchiseId: '0001',
          position: 'QB',
          contractYear: '2',
        }),
        createMockRosterPlayer({
          franchiseId: '0001',
          position: 'WR',
          contractYear: '2',
        }),
      ];

      const capSituation = calculateTeamCapSpace('0001', 'Test Team', players, 0, 0);

      expect(capSituation.positionalNeeds).toBeDefined();
      expect(capSituation.positionalNeeds.length).toBeGreaterThan(0);

      // Should have critical needs for most positions
      const rbNeed = capSituation.positionalNeeds.find(n => n.position === 'RB');
      expect(rbNeed?.priority).toBe('critical'); // Needs 6 RBs, has 0
    });

    it('should handle taxi squad players with 50% cap hit', () => {
      const players = [
        createMockRosterPlayer({
          franchiseId: '0001',
          salary: 10_000_000,
          contractYear: '2',
          status: 'TAXI_SQUAD',
        }),
      ];

      const capSituation = calculateTeamCapSpace('0001', 'Test Team', players, 0, 0);

      // Taxi squad: (10M * 1.10) * 0.5 = 5.5M
      expect(capSituation.committedSalaries).toBe(5_500_000);
    });

    it('should only include players from specified team', () => {
      const players = [
        createMockRosterPlayer({
          franchiseId: '0001',
          salary: 5_000_000,
          contractYear: '2',
        }),
        createMockRosterPlayer({
          franchiseId: '0002', // Different team
          salary: 10_000_000,
          contractYear: '2',
        }),
      ];

      const capSituation = calculateTeamCapSpace('0001', 'Test Team', players, 0, 0);

      // Should only count 5M player
      expect(capSituation.committedSalaries).toBe(5_500_000);
    });

    it('should handle negative cap space', () => {
      const players = [
        createMockRosterPlayer({
          franchiseId: '0001',
          salary: 30_000_000,
          contractYear: '2',
        }),
        createMockRosterPlayer({
          franchiseId: '0001',
          salary: 20_000_000,
          contractYear: '2',
        }),
      ];

      const capSituation = calculateTeamCapSpace('0001', 'Test Team', players, 0, 0);

      // Committed: (30M + 20M) * 1.10 = 55M
      // Cap space: 45M - 55M = -10M
      expect(capSituation.projectedCapSpace2026).toBeLessThan(0);
      expect(capSituation.discretionarySpending).toBe(0); // Capped at 0
    });
  });

  describe('calculateLeagueWideCapSpace', () => {
    it('should calculate cap space for all teams', () => {
      const teams = [
        { franchiseId: '0001', name: 'Team 1' },
        { franchiseId: '0002', name: 'Team 2' },
      ];

      const players = [
        createMockRosterPlayer({ franchiseId: '0001', salary: 5_000_000, contractYear: '2' }),
        createMockRosterPlayer({ franchiseId: '0002', salary: 10_000_000, contractYear: '2' }),
      ];

      const deadMoney = new Map([['0001', 1_000_000]]);

      const result = calculateLeagueWideCapSpace(players, deadMoney, mockSalaryAverages, teams);

      expect(result.teamCapSituations).toHaveLength(2);
      expect(result.teamCapSituations[0].franchiseId).toBe('0001');
      expect(result.teamCapSituations[1].franchiseId).toBe('0002');
    });

    it('should calculate total available cap', () => {
      const teams = [
        { franchiseId: '0001', name: 'Team 1' },
        { franchiseId: '0002', name: 'Team 2' },
      ];

      const players = [
        createMockRosterPlayer({ franchiseId: '0001', salary: 5_000_000, contractYear: '2' }),
        createMockRosterPlayer({ franchiseId: '0002', salary: 5_000_000, contractYear: '2' }),
      ];

      const deadMoney = new Map();

      const result = calculateLeagueWideCapSpace(players, deadMoney, mockSalaryAverages, teams);

      // Each team has same discretionary spending, sum them
      const total = result.teamCapSituations.reduce((sum, t) => sum + t.discretionarySpending, 0);
      expect(result.totalAvailableCap).toBe(total);
    });

    it('should calculate average cap per team', () => {
      const teams = [
        { franchiseId: '0001', name: 'Team 1' },
        { franchiseId: '0002', name: 'Team 2' },
      ];

      const players: any[] = [];
      const deadMoney = new Map();

      const result = calculateLeagueWideCapSpace(players, deadMoney, mockSalaryAverages, teams);

      expect(result.averageCapPerTeam).toBe(result.totalAvailableCap / 2);
    });

    it('should handle teams with no dead money', () => {
      const teams = [{ franchiseId: '0001', name: 'Team 1' }];
      const players: any[] = [];
      const deadMoney = new Map(); // Empty

      const result = calculateLeagueWideCapSpace(players, deadMoney, mockSalaryAverages, teams);

      expect(result.teamCapSituations[0].deadMoney).toBe(0);
    });
  });

  describe('loadDeadMoney', () => {
    it('should aggregate dead money by franchise', () => {
      const adjustments = [
        { franchiseId: '0001', amount: 1_000_000, description: 'Cut Player A' },
        { franchiseId: '0001', amount: 500_000, description: 'Cut Player B' },
        { franchiseId: '0002', amount: 2_000_000, description: 'Cut Player C' },
      ];

      const deadMoney = loadDeadMoney(adjustments);

      expect(deadMoney.get('0001')).toBe(1_500_000);
      expect(deadMoney.get('0002')).toBe(2_000_000);
    });

    it('should handle empty adjustments', () => {
      const deadMoney = loadDeadMoney([]);

      expect(deadMoney.size).toBe(0);
    });

    it('should handle single adjustment', () => {
      const adjustments = [
        { franchiseId: '0001', amount: 3_000_000, description: 'Cut' },
      ];

      const deadMoney = loadDeadMoney(adjustments);

      expect(deadMoney.get('0001')).toBe(3_000_000);
    });

    it('should return Map object', () => {
      const adjustments = [
        { franchiseId: '0001', amount: 1_000_000, description: 'Cut' },
      ];

      const deadMoney = loadDeadMoney(adjustments);

      expect(deadMoney).toBeInstanceOf(Map);
    });
  });

  describe('Edge Cases and Invariants', () => {
    it('should never produce negative discretionary spending', () => {
      const players = [
        createMockRosterPlayer({
          franchiseId: '0001',
          salary: 50_000_000, // Huge salary
          contractYear: '2',
        }),
      ];

      const capSituation = calculateTeamCapSpace('0001', 'Test Team', players, 0, 0);

      expect(capSituation.discretionarySpending).toBeGreaterThanOrEqual(0);
    });

    it('should handle teams with maximum roster size', () => {
      const players = Array.from({ length: 22 }, (_, i) =>
        createMockRosterPlayer({
          franchiseId: '0001',
          id: `player${i}`,
          salary: 1_000_000,
          contractYear: '2',
        })
      );

      const capSituation = calculateTeamCapSpace('0001', 'Test Team', players, 0, 0);

      // Should have 0 spots to fill
      expect(capSituation.estimatedMinimumRosterSpend).toBe(0);
    });

    it('should handle all players expiring', () => {
      const players = [
        createMockRosterPlayer({ franchiseId: '0001', contractYear: '1' }),
        createMockRosterPlayer({ franchiseId: '0001', contractYear: '1' }),
      ];

      const capSituation = calculateTeamCapSpace('0001', 'Test Team', players, 0, 0);

      expect(capSituation.committedSalaries).toBe(0);
      expect(capSituation.projectedCapSpace2026).toBe(SALARY_CAP);
      expect(capSituation.expiringContracts).toHaveLength(2);
    });

    it('should round all monetary values to integers', () => {
      const players = [
        createMockRosterPlayer({
          franchiseId: '0001',
          salary: 1_234_567,
          contractYear: '2',
        }),
      ];

      const capSituation = calculateTeamCapSpace('0001', 'Test Team', players, 0, 0);

      expect(Number.isInteger(capSituation.committedSalaries)).toBe(true);
      expect(Number.isInteger(capSituation.projectedCapSpace2026)).toBe(true);
      expect(Number.isInteger(capSituation.discretionarySpending)).toBe(true);
    });
  });
});
