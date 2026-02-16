import { describe, it, expect } from 'vitest';
import {
  computeLeagueSummary,
  parseSalaryAdjustment,
  CATEGORY_DEFINITIONS,
  type SalaryPlayer,
  type TeamConfig,
  type DraftCapitalMap,
} from '../src/utils/league-summary-utils';
import { calculateCapCharges, SALARY_YEARS, SALARY_CAP, RESERVE_FOR_ROOKIES, TARGET_ACTIVE_COUNT } from '../src/utils/salary-calculations';

const emptyDraftCapital: DraftCapitalMap = new Map();

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makePlayer = (overrides: Partial<SalaryPlayer> = {}): SalaryPlayer => ({
  id: '1',
  name: 'Test Player',
  position: 'WR',
  salary: 1_000_000,
  franchiseId: '0001',
  status: 'ROSTER',
  contractYear: '3',
  points: 100,
  birthdate: 852076800, // Jan 1, 1997
  ...overrides,
});

const makeTeam = (overrides: Partial<TeamConfig> = {}): TeamConfig => ({
  franchiseId: '0001',
  name: 'Test Team',
  icon: '/icons/test.png',
  division: 'Central',
  ...overrides,
});

// ---------------------------------------------------------------------------
// parseSalaryAdjustment
// ---------------------------------------------------------------------------

describe('parseSalaryAdjustment', () => {
  it('parses dropped player description with salary and years', () => {
    const result = parseSalaryAdjustment({
      franchise_id: '0008',
      amount: '212500',
      description: 'Dropped Cowing, Jacob SFO WR (Salary: $425,000, Years: 5)',
    });
    expect(result.franchiseId).toBe('0008');
    expect(result.amount).toBe(212500);
    expect(result.salary).toBe(425000);
    expect(result.yearsRemaining).toBe(5);
    expect(result.yearOffset).toBe(0);
  });

  it('parses dead money carryover without salary/years', () => {
    const result = parseSalaryAdjustment({
      franchise_id: '0001',
      amount: '1576500',
      description: '2024 Dead money',
    });
    expect(result.franchiseId).toBe('0001');
    expect(result.amount).toBe(1576500);
    expect(result.salary).toBe(1576500); // falls back to amount
    expect(result.yearsRemaining).toBeUndefined();
  });

  it('handles 1-year contract drop', () => {
    const result = parseSalaryAdjustment({
      franchise_id: '0002',
      amount: '550000',
      description: 'Dropped Wilson, Russell NYG QB (Salary: $1,100,000, Years: 1)',
    });
    expect(result.salary).toBe(1100000);
    expect(result.yearsRemaining).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeLeagueSummary — cap charges match salary-calculations.ts
// ---------------------------------------------------------------------------

describe('computeLeagueSummary cap charges', () => {
  it('should produce cap space that matches calculateCapCharges() exactly', () => {
    const players: SalaryPlayer[] = [
      makePlayer({ id: '1', salary: 5_000_000, contractYear: '3', status: 'ROSTER' }),
      makePlayer({ id: '2', salary: 2_000_000, contractYear: '1', status: 'ROSTER' }),
      makePlayer({ id: '3', salary: 1_000_000, contractYear: '5', status: 'TAXI_SQUAD' }),
    ];

    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], emptyDraftCapital, teams);
    const team = result[0];

    // Build CapPlayer[] the same way the utility does
    const capPlayers = [
      { salary: 5_000_000, contractYears: 3, displayTag: 'ACTIVE' },
      { salary: 2_000_000, contractYears: 1, displayTag: 'ACTIVE' },
      { salary: 1_000_000, contractYears: 5, displayTag: 'PRACTICE' },
    ];
    const expectedCapCharges = calculateCapCharges(capPlayers);

    // Cap space = SALARY_CAP - capCharges - deadMoney(0)
    for (let i = 0; i < SALARY_YEARS.length; i++) {
      expect(team.metrics.capSpace[i]).toBeCloseTo(SALARY_CAP - expectedCapCharges[i], 0);
    }
  });

  it('should apply 10% escalation for multi-year contracts', () => {
    const players: SalaryPlayer[] = [
      makePlayer({ salary: 10_000_000, contractYear: '5', status: 'ROSTER' }),
    ];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], emptyDraftCapital, teams);
    const team = result[0];

    // Year 0: 10M, Year 1: 11M, Year 2: 12.1M, Year 3: 13.31M, Year 4: 14.641M
    expect(team.metrics.capSpace[0]).toBeCloseTo(SALARY_CAP - 10_000_000, 0);
    expect(team.metrics.capSpace[1]).toBeCloseTo(SALARY_CAP - 11_000_000, 0);
    expect(team.metrics.capSpace[2]).toBeCloseTo(SALARY_CAP - 12_100_000, 0);
  });

  it('should count taxi squad at 50% for current year, 100% for future', () => {
    const players: SalaryPlayer[] = [
      makePlayer({ salary: 2_000_000, contractYear: '3', status: 'TAXI_SQUAD' }),
    ];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], emptyDraftCapital, teams);
    const team = result[0];

    // Year 0: 2M * 50% = 1M cap hit
    expect(team.metrics.capSpace[0]).toBeCloseTo(SALARY_CAP - 1_000_000, 0);
    // Year 1: 2M * 1.10 * 100% = 2.2M cap hit
    expect(team.metrics.capSpace[1]).toBeCloseTo(SALARY_CAP - 2_200_000, 0);
  });
});

// ---------------------------------------------------------------------------
// computeLeagueSummary — roster size and expiring contracts
// ---------------------------------------------------------------------------

describe('computeLeagueSummary roster metrics', () => {
  it('should decrease players under contract as contracts expire', () => {
    const players: SalaryPlayer[] = [
      makePlayer({ id: '1', contractYear: '1' }),
      makePlayer({ id: '2', contractYear: '2' }),
      makePlayer({ id: '3', contractYear: '3' }),
      makePlayer({ id: '4', contractYear: '4' }),
      makePlayer({ id: '5', contractYear: '5' }),
    ];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], emptyDraftCapital, teams);
    const team = result[0];

    expect(team.metrics.playersUnderContract).toEqual([5, 4, 3, 2, 1]);
  });

  it('should count expiring contracts correctly', () => {
    const players: SalaryPlayer[] = [
      makePlayer({ id: '1', contractYear: '1' }), // expires year 0
      makePlayer({ id: '2', contractYear: '1' }), // expires year 0
      makePlayer({ id: '3', contractYear: '2' }), // expires year 1
      makePlayer({ id: '4', contractYear: '5' }), // expires year 4
    ];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], emptyDraftCapital, teams);
    const team = result[0];

    // contractYear === i + 1 means expires at year i
    expect(team.metrics.expiringContracts[0]).toBe(2); // contractYear=1
    expect(team.metrics.expiringContracts[1]).toBe(1); // contractYear=2
    expect(team.metrics.expiringContracts[2]).toBe(0); // contractYear=3
    expect(team.metrics.expiringContracts[3]).toBe(0); // contractYear=4
    expect(team.metrics.expiringContracts[4]).toBe(1); // contractYear=5
  });

  it('should compute roster holes correctly', () => {
    // 10 players under contract → need 22 active → 12 holes
    const players: SalaryPlayer[] = Array.from({ length: 10 }, (_, i) =>
      makePlayer({ id: String(i), contractYear: '5' })
    );
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], emptyDraftCapital, teams);
    const team = result[0];

    expect(team.metrics.rosterHoles[0]).toBe(TARGET_ACTIVE_COUNT - 10);
  });
});

// ---------------------------------------------------------------------------
// computeLeagueSummary — age projections
// ---------------------------------------------------------------------------

describe('computeLeagueSummary age metrics', () => {
  it('should increase average age by ~1 year each projection year', () => {
    // Player born Jan 1, 1997
    const players: SalaryPlayer[] = [
      makePlayer({ contractYear: '5', birthdate: 852076800 }),
    ];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], emptyDraftCapital, teams);
    const team = result[0];

    // Ages should increase by approximately 1 year between each SALARY_YEAR
    for (let i = 1; i < SALARY_YEARS.length; i++) {
      const diff = team.metrics.avgAge[i] - team.metrics.avgAge[i - 1];
      expect(diff).toBeCloseTo(1.0, 0);
    }
  });

  it('should only average age for players still under contract', () => {
    // Young player expires after year 0, old player lasts 5 years
    const players: SalaryPlayer[] = [
      makePlayer({ id: '1', contractYear: '1', birthdate: 946684800 }), // born 2000 (young)
      makePlayer({ id: '2', contractYear: '5', birthdate: 631152000 }), // born 1990 (old)
    ];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], emptyDraftCapital, teams);
    const team = result[0];

    // Year 0: average of both players
    // Year 1+: only old player remains → age goes up
    expect(team.metrics.avgAge[1]).toBeGreaterThan(team.metrics.avgAge[0]);
  });
});

// ---------------------------------------------------------------------------
// computeLeagueSummary — positional depth
// ---------------------------------------------------------------------------

describe('computeLeagueSummary positional depth', () => {
  it('should track position counts across years', () => {
    const players: SalaryPlayer[] = [
      makePlayer({ id: '1', position: 'QB', contractYear: '5' }),
      makePlayer({ id: '2', position: 'RB', contractYear: '1' }),
      makePlayer({ id: '3', position: 'RB', contractYear: '3' }),
      makePlayer({ id: '4', position: 'WR', contractYear: '2' }),
    ];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], emptyDraftCapital, teams);
    const team = result[0];

    // Year 0: QB=1, RB=2, WR=1
    expect(team.positionalDepth[0].QB).toBe(1);
    expect(team.positionalDepth[0].RB).toBe(2);
    expect(team.positionalDepth[0].WR).toBe(1);

    // Year 1: RB with contractYear=1 is gone
    expect(team.positionalDepth[1].RB).toBe(1);

    // Year 2: WR with contractYear=2 is gone
    expect(team.positionalDepth[2].WR).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeLeagueSummary — top player retention
// ---------------------------------------------------------------------------

describe('computeLeagueSummary top player retention', () => {
  it('should count top-10 scorers still under contract', () => {
    const players: SalaryPlayer[] = Array.from({ length: 15 }, (_, i) =>
      makePlayer({
        id: String(i),
        points: 150 - i * 10,
        contractYear: i < 5 ? '1' : '5', // top 5 are 1-year, rest are 5-year
      })
    );
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], emptyDraftCapital, teams);
    const team = result[0];

    // Year 0: all 10 top scorers under contract
    expect(team.metrics.topPlayerRetention[0]).toBe(10);

    // Year 1: top 5 expired (contractYear=1), only 5 of top 10 remain
    expect(team.metrics.topPlayerRetention[1]).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// computeLeagueSummary — draft capital
// ---------------------------------------------------------------------------

describe('computeLeagueSummary draft capital', () => {
  it('should return 3 picks for years 1-4 (standard allocation)', () => {
    const teams = [makeTeam()];
    const result = computeLeagueSummary([], [], emptyDraftCapital, teams);
    const team = result[0];

    expect(team.metrics.draftCapital[1]).toBe(3);
    expect(team.metrics.draftCapital[2]).toBe(3);
    expect(team.metrics.draftCapital[3]).toBe(3);
    expect(team.metrics.draftCapital[4]).toBe(3);
  });

  it('should use actual pick count from draft capital map for year 0', () => {
    const draftCapital: DraftCapitalMap = new Map([
      ['0001', {
        total: 4,
        byRound: new Map([[1, 1], [2, 2], [3, 1]]),
      }],
    ]);
    const teams = [makeTeam()];
    const result = computeLeagueSummary([], [], draftCapital, teams);
    const team = result[0];

    expect(team.metrics.draftCapital[0]).toBe(4); // has 4 picks for current year
  });
});

// ---------------------------------------------------------------------------
// computeLeagueSummary — edge cases
// ---------------------------------------------------------------------------

describe('computeLeagueSummary edge cases', () => {
  it('should handle a team with no players', () => {
    const teams = [makeTeam()];
    const result = computeLeagueSummary([], [], emptyDraftCapital, teams);
    const team = result[0];

    expect(team.metrics.capSpace[0]).toBe(SALARY_CAP);
    expect(team.metrics.playersUnderContract[0]).toBe(0);
    expect(team.metrics.avgAge[0]).toBe(0);
    expect(team.metrics.rosterHoles[0]).toBe(TARGET_ACTIVE_COUNT);
    expect(team.metrics.topPlayerRetention[0]).toBe(0);
  });

  it('should handle all 1-year contracts (everything expires after year 0)', () => {
    const players: SalaryPlayer[] = Array.from({ length: 5 }, (_, i) =>
      makePlayer({ id: String(i), contractYear: '1' })
    );
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], emptyDraftCapital, teams);
    const team = result[0];

    expect(team.metrics.playersUnderContract[0]).toBe(5);
    expect(team.metrics.playersUnderContract[1]).toBe(0);
    expect(team.metrics.playersUnderContract[2]).toBe(0);
  });

  it('should produce 5 elements per metric (matching SALARY_YEARS length)', () => {
    const players: SalaryPlayer[] = [makePlayer({ contractYear: '5' })];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], emptyDraftCapital, teams);
    const team = result[0];

    expect(team.metrics.capSpace.length).toBe(5);
    expect(team.metrics.deadMoney.length).toBe(5);
    expect(team.metrics.playersUnderContract.length).toBe(5);
    expect(team.metrics.avgAge.length).toBe(5);
    expect(team.positionalDepth.length).toBe(5);
    expect(team.positionalSpend.length).toBe(5);
  });

  it('should handle multiple teams independently', () => {
    const players: SalaryPlayer[] = [
      makePlayer({ id: '1', franchiseId: '0001', salary: 10_000_000 }),
      makePlayer({ id: '2', franchiseId: '0002', salary: 5_000_000 }),
    ];
    const teams = [
      makeTeam({ franchiseId: '0001', name: 'Team A' }),
      makeTeam({ franchiseId: '0002', name: 'Team B' }),
    ];
    const result = computeLeagueSummary(players, [], emptyDraftCapital, teams);

    expect(result[0].metrics.capSpace[0]).not.toBe(result[1].metrics.capSpace[0]);
    expect(result[0].franchiseId).toBe('0001');
    expect(result[1].franchiseId).toBe('0002');
  });
});

// ---------------------------------------------------------------------------
// CATEGORY_DEFINITIONS
// ---------------------------------------------------------------------------

describe('CATEGORY_DEFINITIONS', () => {
  it('should have 14 categories total', () => {
    expect(CATEGORY_DEFINITIONS.length).toBe(14);
  });

  it('should have 5 milestone 1 categories', () => {
    const m1 = CATEGORY_DEFINITIONS.filter((c) => c.milestone === 1);
    expect(m1.length).toBe(5);
  });

  it('should have 9 milestone 2 categories', () => {
    const m2 = CATEGORY_DEFINITIONS.filter((c) => c.milestone === 2);
    expect(m2.length).toBe(9);
  });

  it('should have unique IDs', () => {
    const ids = CATEGORY_DEFINITIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
