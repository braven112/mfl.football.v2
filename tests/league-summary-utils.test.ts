import { describe, it, expect } from 'vitest';
import {
  computeLeagueSummary,
  parseSalaryAdjustment,
  CATEGORY_DEFINITIONS,
  SUMMARY_YEARS,
  type SalaryPlayer,
  type TeamConfig,
} from '../src/utils/league-summary-utils';
import { calculateCapCharges, SALARY_YEARS, SALARY_CAP, RESERVE_FOR_ROOKIES, TARGET_ACTIVE_COUNT } from '../src/utils/salary-calculations';

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
  birthdate: 852076800, // Jan 1, 1997 → ~28 years old in 2025
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
// SUMMARY_YEARS
// ---------------------------------------------------------------------------

describe('SUMMARY_YEARS', () => {
  it('should have 5 years starting from SALARY_YEARS[1]', () => {
    expect(SUMMARY_YEARS.length).toBe(5);
    expect(SUMMARY_YEARS[0]).toBe(SALARY_YEARS[1]); // 2026
    expect(SUMMARY_YEARS[4]).toBe(SALARY_YEARS[4] + 1); // 2030
  });
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
// SUMMARY_YEARS maps to original indices 1-5. Results are 5 elements.
// ---------------------------------------------------------------------------

describe('computeLeagueSummary cap charges', () => {
  it('should produce cap space that matches calculateCapCharges() for shared years', () => {
    const players: SalaryPlayer[] = [
      makePlayer({ id: '1', salary: 5_000_000, contractYear: '3', status: 'ROSTER' }),
      makePlayer({ id: '2', salary: 2_000_000, contractYear: '1', status: 'ROSTER' }),
      makePlayer({ id: '3', salary: 1_000_000, contractYear: '5', status: 'TAXI_SQUAD' }),
    ];

    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], null, teams);
    const team = result[0];

    // Build CapPlayer[] the same way the utility does
    const capPlayers = [
      { salary: 5_000_000, contractYears: 3, displayTag: 'ACTIVE' },
      { salary: 2_000_000, contractYears: 1, displayTag: 'ACTIVE' },
      { salary: 1_000_000, contractYears: 5, displayTag: 'PRACTICE' },
    ];
    const expectedCapCharges = calculateCapCharges(capPlayers);

    // SUMMARY_YEARS[si] maps to original index oi = si + 1
    // capChargesBase has 5 elements (indices 0-4)
    // Summary uses indices 1-4 for first 4 years, and 0 for year 5 (index 5)
    for (let si = 0; si < 4; si++) {
      const oi = si + 1;
      expect(team.metrics.capSpace[si]).toBeCloseTo(SALARY_CAP - expectedCapCharges[oi], 0);
    }

    // Year 5 (2030, oi=5): no contracts reach this far → cap charge = 0
    expect(team.metrics.capSpace[4]).toBeCloseTo(SALARY_CAP, 0);
  });

  it('should apply 10% escalation for multi-year contracts', () => {
    const players: SalaryPlayer[] = [
      makePlayer({ salary: 10_000_000, contractYear: '5', status: 'ROSTER' }),
    ];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], null, teams);
    const team = result[0];

    // Summary year 0 (2026) = original index 1: 10M * 1.1^1 = 11M
    // Summary year 1 (2027) = original index 2: 10M * 1.1^2 = 12.1M
    // Summary year 2 (2028) = original index 3: 10M * 1.1^3 = 13.31M
    // Summary year 3 (2029) = original index 4: 10M * 1.1^4 = 14.641M
    // Summary year 4 (2030) = original index 5: contract expired, 0
    expect(team.metrics.capSpace[0]).toBeCloseTo(SALARY_CAP - 11_000_000, 0);
    expect(team.metrics.capSpace[1]).toBeCloseTo(SALARY_CAP - 12_100_000, 0);
    expect(team.metrics.capSpace[2]).toBeCloseTo(SALARY_CAP - 13_310_000, 0);
    expect(team.metrics.capSpace[3]).toBeCloseTo(SALARY_CAP - 14_641_000, 0);
    expect(team.metrics.capSpace[4]).toBeCloseTo(SALARY_CAP, 0); // contract expired
  });

  it('should not include taxi squad 50% discount in summary (all future years)', () => {
    const players: SalaryPlayer[] = [
      makePlayer({ salary: 2_000_000, contractYear: '3', status: 'TAXI_SQUAD' }),
    ];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], null, teams);
    const team = result[0];

    // All summary years are future years → taxi counts at 100%
    // Summary year 0 (2026, oi=1): 2M * 1.1^1 * 100% = 2.2M
    expect(team.metrics.capSpace[0]).toBeCloseTo(SALARY_CAP - 2_200_000, 0);
    // Summary year 1 (2027, oi=2): 2M * 1.1^2 * 100% = 2.42M
    expect(team.metrics.capSpace[1]).toBeCloseTo(SALARY_CAP - 2_420_000, 0);
  });
});

// ---------------------------------------------------------------------------
// computeLeagueSummary — roster size and expiring contracts
// ---------------------------------------------------------------------------

describe('computeLeagueSummary roster metrics', () => {
  it('should decrease players under contract as contracts expire', () => {
    // contractYear is from the original SALARY_YEARS perspective
    // contractYear=1 → under contract only in year 0 (2025) → already expired before summary
    // contractYear=2 → under contract in years 0-1 → in summary year 0 (2026) only
    const players: SalaryPlayer[] = [
      makePlayer({ id: '1', contractYear: '1' }), // expired before summary starts
      makePlayer({ id: '2', contractYear: '2' }), // expires at summary year 0
      makePlayer({ id: '3', contractYear: '3' }), // under contract through summary year 1
      makePlayer({ id: '4', contractYear: '4' }), // under contract through summary year 2
      makePlayer({ id: '5', contractYear: '5' }), // under contract through summary year 3
    ];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], null, teams);
    const team = result[0];

    // oi=1: contractYear > 1 → players 2,3,4,5 = 4
    // oi=2: contractYear > 2 → players 3,4,5 = 3
    // oi=3: contractYear > 3 → players 4,5 = 2
    // oi=4: contractYear > 4 → player 5 = 1
    // oi=5: contractYear > 5 → none = 0
    expect(team.metrics.playersUnderContract).toEqual([4, 3, 2, 1, 0]);
  });

  it('should count expiring contracts correctly', () => {
    const players: SalaryPlayer[] = [
      makePlayer({ id: '1', contractYear: '1' }), // expired before summary
      makePlayer({ id: '2', contractYear: '2' }), // expires at summary year 0 (oi+1=2)
      makePlayer({ id: '3', contractYear: '2' }), // expires at summary year 0
      makePlayer({ id: '4', contractYear: '3' }), // expires at summary year 1 (oi+1=3)
      makePlayer({ id: '5', contractYear: '5' }), // expires at summary year 3 (oi+1=5)
    ];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], null, teams);
    const team = result[0];

    // Expiring = contractYear === oi + 1
    // si=0 (oi=1): contractYear===2 → players 2,3 = 2
    // si=1 (oi=2): contractYear===3 → player 4 = 1
    // si=2 (oi=3): contractYear===4 → none = 0
    // si=3 (oi=4): contractYear===5 → player 5 = 1
    // si=4 (oi=5): contractYear===6 → none = 0
    expect(team.metrics.expiringContracts[0]).toBe(2);
    expect(team.metrics.expiringContracts[1]).toBe(1);
    expect(team.metrics.expiringContracts[2]).toBe(0);
    expect(team.metrics.expiringContracts[3]).toBe(1);
    expect(team.metrics.expiringContracts[4]).toBe(0);
  });

  it('should compute roster holes correctly', () => {
    // 10 players with long contracts → all under contract in summary year 0
    const players: SalaryPlayer[] = Array.from({ length: 10 }, (_, i) =>
      makePlayer({ id: String(i), contractYear: '5' })
    );
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], null, teams);
    const team = result[0];

    // Summary year 0 (oi=1): contractYear=5 > 1 → all 10 under contract
    expect(team.metrics.rosterHoles[0]).toBe(TARGET_ACTIVE_COUNT - 10);
  });
});

// ---------------------------------------------------------------------------
// computeLeagueSummary — age projections
// ---------------------------------------------------------------------------

describe('computeLeagueSummary age metrics', () => {
  it('should increase average age by ~1 year each projection year', () => {
    // Player born Jan 1, 1997 with 5-year contract (under contract through oi=4)
    const players: SalaryPlayer[] = [
      makePlayer({ contractYear: '5', birthdate: 852076800 }),
    ];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], null, teams);
    const team = result[0];

    // Ages should increase by approximately 1 year between each summary year
    // Player is under contract for summary years 0-3 (oi 1-4)
    for (let si = 1; si < 4; si++) {
      const diff = team.metrics.avgAge[si] - team.metrics.avgAge[si - 1];
      expect(diff).toBeCloseTo(1.0, 0);
    }
  });

  it('should only average age for players still under contract', () => {
    // Short-contract player expires before summary, long-contract player persists
    const players: SalaryPlayer[] = [
      makePlayer({ id: '1', contractYear: '2', birthdate: 946684800 }), // born 2000 (young), expires at oi=1
      makePlayer({ id: '2', contractYear: '5', birthdate: 631152000 }), // born 1990 (old), lasts to oi=4
    ];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], null, teams);
    const team = result[0];

    // Summary year 0 (oi=1): both under contract (contractYear > 1)
    // Summary year 1 (oi=2): only old player remains (contractYear=2 NOT > 2)
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
      makePlayer({ id: '2', position: 'RB', contractYear: '2' }), // under contract at oi=1, gone at oi=2
      makePlayer({ id: '3', position: 'RB', contractYear: '4' }),
      makePlayer({ id: '4', position: 'WR', contractYear: '3' }), // under contract at oi=1,2, gone at oi=3
    ];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], null, teams);
    const team = result[0];

    // Summary year 0 (oi=1): QB=1, RB=2, WR=1
    expect(team.positionalDepth[0].QB).toBe(1);
    expect(team.positionalDepth[0].RB).toBe(2);
    expect(team.positionalDepth[0].WR).toBe(1);

    // Summary year 1 (oi=2): RB with contractYear=2 gone (2 NOT > 2)
    expect(team.positionalDepth[1].RB).toBe(1);

    // Summary year 2 (oi=3): WR with contractYear=3 gone (3 NOT > 3)
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
        contractYear: i < 5 ? '2' : '5', // top 5 are 2-year (expire at oi=1), rest are 5-year
      })
    );
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], null, teams);
    const team = result[0];

    // Summary year 0 (oi=1): all under contract (contractYear > 1) → 10 of top 10
    expect(team.metrics.topPlayerRetention[0]).toBe(10);

    // Summary year 1 (oi=2): top 5 expired (contractYear=2 NOT > 2), only 5 of top 10 remain
    expect(team.metrics.topPlayerRetention[1]).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// computeLeagueSummary — draft capital
// ---------------------------------------------------------------------------

describe('computeLeagueSummary draft capital', () => {
  it('should return 3 picks for years 1-4 (standard allocation)', () => {
    const teams = [makeTeam()];
    const result = computeLeagueSummary([], [], null, teams);
    const team = result[0];

    expect(team.metrics.draftCapital[1]).toBe(3);
    expect(team.metrics.draftCapital[2]).toBe(3);
    expect(team.metrics.draftCapital[3]).toBe(3);
    expect(team.metrics.draftCapital[4]).toBe(3);
  });

  it('should use actual pick count from futureDraftPicks for year 0 (first summary year)', () => {
    const draftYear = SUMMARY_YEARS[0]; // e.g., 2026
    const futureDraftPicksData = {
      futureDraftPicks: {
        franchise: [
          {
            id: '0001',
            futureDraftPick: [
              { year: String(draftYear), round: '1', originalPickFor: '0001' },
              { year: String(draftYear), round: '2', originalPickFor: '0001' },
              { year: String(draftYear), round: '2', originalPickFor: '0005' }, // traded pick
              { year: String(draftYear), round: '3', originalPickFor: '0001' },
            ],
          },
        ],
      },
    };
    const teams = [makeTeam()];
    const result = computeLeagueSummary([], [], futureDraftPicksData, teams);
    const team = result[0];

    expect(team.metrics.draftCapital[0]).toBe(4); // has 4 picks for first summary year
  });
});

// ---------------------------------------------------------------------------
// computeLeagueSummary — edge cases
// ---------------------------------------------------------------------------

describe('computeLeagueSummary edge cases', () => {
  it('should handle a team with no players', () => {
    const teams = [makeTeam()];
    const result = computeLeagueSummary([], [], null, teams);
    const team = result[0];

    expect(team.metrics.capSpace[0]).toBe(SALARY_CAP);
    expect(team.metrics.playersUnderContract[0]).toBe(0);
    expect(team.metrics.avgAge[0]).toBe(0);
    expect(team.metrics.rosterHoles[0]).toBe(TARGET_ACTIVE_COUNT);
    expect(team.metrics.topPlayerRetention[0]).toBe(0);
  });

  it('should handle all 1-year contracts (all expired before summary starts)', () => {
    const players: SalaryPlayer[] = Array.from({ length: 5 }, (_, i) =>
      makePlayer({ id: String(i), contractYear: '1' })
    );
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], null, teams);
    const team = result[0];

    // contractYear=1 means under contract only at oi=0 (2025)
    // By summary year 0 (oi=1), all expired
    expect(team.metrics.playersUnderContract[0]).toBe(0);
    expect(team.metrics.playersUnderContract[1]).toBe(0);
  });

  it('should produce 5 elements per metric (matching SUMMARY_YEARS length)', () => {
    const players: SalaryPlayer[] = [makePlayer({ contractYear: '5' })];
    const teams = [makeTeam()];
    const result = computeLeagueSummary(players, [], null, teams);
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
    const result = computeLeagueSummary(players, [], null, teams);

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
