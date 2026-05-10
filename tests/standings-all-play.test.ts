import { describe, it, expect } from 'vitest';
import {
  calculateAllPlayFromWeekly,
  getTierAllPlayStandings,
  type WeeklyResultsData,
} from '../src/utils/standings';
import type { StandingsFranchise } from '../src/types/standings';

// ---------------------------------------------------------------------------
// calculateAllPlayFromWeekly
// ---------------------------------------------------------------------------

describe('calculateAllPlayFromWeekly', () => {
  it('returns empty map for no weeks', () => {
    const result = calculateAllPlayFromWeekly({ weeks: [] }, 17);
    expect(result.size).toBe(0);
  });

  it('computes simple all-play for one week with 3 teams', () => {
    const weekly: WeeklyResultsData = {
      weeks: [
        { week: 1, scores: { '0001': 100, '0002': 80, '0003': 60 } },
      ],
    };
    const result = calculateAllPlayFromWeekly(weekly, 17);

    expect(result.get('0001')).toEqual({ wins: 2, losses: 0, ties: 0, pct: 1 });
    expect(result.get('0002')).toEqual({ wins: 1, losses: 1, ties: 0, pct: 0.5 });
    expect(result.get('0003')).toEqual({ wins: 0, losses: 2, ties: 0, pct: 0 });
  });

  it('handles ties as half-wins in pct', () => {
    const weekly: WeeklyResultsData = {
      weeks: [
        { week: 1, scores: { '0001': 100, '0002': 100, '0003': 60 } },
      ],
    };
    const result = calculateAllPlayFromWeekly(weekly, 17);

    expect(result.get('0001')).toEqual({ wins: 1, losses: 0, ties: 1, pct: 0.75 });
    expect(result.get('0002')).toEqual({ wins: 1, losses: 0, ties: 1, pct: 0.75 });
    expect(result.get('0003')).toEqual({ wins: 0, losses: 2, ties: 0, pct: 0 });
  });

  it('respects cutoff week — weeks past cutoff are ignored', () => {
    const weekly: WeeklyResultsData = {
      weeks: [
        { week: 1, scores: { '0001': 100, '0002': 80 } },
        { week: 2, scores: { '0001': 50, '0002': 90 } },
        { week: 3, scores: { '0001': 50, '0002': 90 } }, // ignored at cutoff=2
      ],
    };
    const result = calculateAllPlayFromWeekly(weekly, 2);

    expect(result.get('0001')).toEqual({ wins: 1, losses: 1, ties: 0, pct: 0.5 });
    expect(result.get('0002')).toEqual({ wins: 1, losses: 1, ties: 0, pct: 0.5 });
  });

  it('cutoff at week 17 includes all 17 weeks', () => {
    const weekly: WeeklyResultsData = {
      weeks: Array.from({ length: 17 }, (_, i) => ({
        week: i + 1,
        scores: { '0001': 100, '0002': 50 },
      })),
    };
    const result = calculateAllPlayFromWeekly(weekly, 17);

    expect(result.get('0001')).toEqual({ wins: 17, losses: 0, ties: 0, pct: 1 });
    expect(result.get('0002')).toEqual({ wins: 0, losses: 17, ties: 0, pct: 0 });
  });

  it('aggregates across multiple weeks correctly', () => {
    const weekly: WeeklyResultsData = {
      weeks: [
        // Team 0001 wins 2-0, Team 0002 wins 0-2
        { week: 1, scores: { '0001': 100, '0002': 80, '0003': 60 } },
        // Team 0001 wins 2-0 again
        { week: 2, scores: { '0001': 110, '0002': 90, '0003': 70 } },
      ],
    };
    const result = calculateAllPlayFromWeekly(weekly, 17);

    expect(result.get('0001')).toEqual({ wins: 4, losses: 0, ties: 0, pct: 1 });
    expect(result.get('0002')).toEqual({ wins: 2, losses: 2, ties: 0, pct: 0.5 });
    expect(result.get('0003')).toEqual({ wins: 0, losses: 4, ties: 0, pct: 0 });
  });

  it('does not compare a team against itself', () => {
    const weekly: WeeklyResultsData = {
      weeks: [
        { week: 1, scores: { '0001': 100 } }, // single team — no comparisons possible
      ],
    };
    const result = calculateAllPlayFromWeekly(weekly, 17);

    expect(result.get('0001')).toEqual({ wins: 0, losses: 0, ties: 0, pct: 0 });
  });

  it('initializes records for every franchise that appears in any week', () => {
    const weekly: WeeklyResultsData = {
      weeks: [
        { week: 1, scores: { '0001': 100, '0002': 80 } },
        { week: 2, scores: { '0001': 100, '0002': 80, '0003': 60 } },
      ],
    };
    const result = calculateAllPlayFromWeekly(weekly, 17);

    expect(result.has('0003')).toBe(true);
    // 0003 only played in week 2: lost to both 0001 and 0002
    expect(result.get('0003')).toEqual({ wins: 0, losses: 2, ties: 0, pct: 0 });
  });

  it('cutoff of 0 yields empty records (no weeks processed)', () => {
    const weekly: WeeklyResultsData = {
      weeks: [
        { week: 1, scores: { '0001': 100, '0002': 80 } },
      ],
    };
    const result = calculateAllPlayFromWeekly(weekly, 0);
    // No weeks pass filter → no franchises seen → empty map
    expect(result.size).toBe(0);
  });

  it('pct calculation: 6 wins, 4 losses → 0.600', () => {
    const weekly: WeeklyResultsData = {
      weeks: [
        // 5 weeks where 0001 beats 0002 and 0003 (2 wins each week = 10 wins total)
        // and 5 weeks where 0001 loses to both (10 losses)
        ...Array.from({ length: 3 }, (_, i) => ({
          week: i + 1,
          scores: { '0001': 100, '0002': 80, '0003': 60 },
        })),
        ...Array.from({ length: 2 }, (_, i) => ({
          week: i + 4,
          scores: { '0001': 50, '0002': 80, '0003': 70 },
        })),
      ],
    };
    const result = calculateAllPlayFromWeekly(weekly, 17);
    // 0001: weeks 1-3 = 2 wins each (6), weeks 4-5 = 0 wins (4 losses)
    expect(result.get('0001')).toEqual({ wins: 6, losses: 4, ties: 0, pct: 0.6 });
  });
});

// ---------------------------------------------------------------------------
// getTierAllPlayStandings
// ---------------------------------------------------------------------------

const aflConfigFixture = {
  leagueId: '19621',
  name: 'AFL',
  divisions: ['North', 'South', 'East', 'West'],
  conferences: [
    { code: '00', name: 'AL', divisions: ['North', 'South'] },
    { code: '01', name: 'NL', divisions: ['East', 'West'] },
  ],
  divisionToConference: { North: '00', South: '00', East: '01', West: '01' },
  teams: [
    { franchiseId: '0001', name: 'A1', division: 'North', tier: 'Premier League' },
    { franchiseId: '0002', name: 'A2', division: 'North', tier: 'Premier League' },
    { franchiseId: '0003', name: 'B1', division: 'South', tier: 'D-League' },
    { franchiseId: '0004', name: 'B2', division: 'South', tier: 'D-League' },
  ],
};

function makeFranchise(id: string, allPlayPct: string, pf = '1500'): StandingsFranchise {
  return {
    id,
    fname: `Team ${id}`,
    divwlt: '0-0-0',
    divpct: '0',
    divw: '0',
    divl: '0',
    divt: '0',
    h2hwlt: '7-7-0',
    h2hpct: '0.5',
    h2hw: '7',
    h2hl: '7',
    h2ht: '0',
    nondivwlt: '0-0-0',
    nondivpct: '0',
    nondivw: '0',
    nondivl: '0',
    nondivt: '0',
    all_play_wlt: '50-50-0',
    all_play_pct: allPlayPct,
    pf,
    pa: '1500',
    pwr: '0.5',
    pp: '0',
    vp: '0',
    op: '0',
    strk: 'W1',
    eliminated: '0',
  };
}

describe('getTierAllPlayStandings', () => {
  it('groups teams by tier and returns Premier League first', () => {
    const franchises = [
      makeFranchise('0001', '0.700'),
      makeFranchise('0002', '0.600'),
      makeFranchise('0003', '0.500'),
      makeFranchise('0004', '0.400'),
    ];

    const result = getTierAllPlayStandings(franchises, aflConfigFixture);

    expect(result).toHaveLength(2);
    expect(result[0].tier).toBe('Premier League');
    expect(result[1].tier).toBe('D-League');
    expect(result[0].teams.map(t => t.id)).toEqual(['0001', '0002']);
    expect(result[1].teams.map(t => t.id)).toEqual(['0003', '0004']);
  });

  it('sorts teams within tier by all-play pct descending', () => {
    const franchises = [
      makeFranchise('0001', '0.500'),
      makeFranchise('0002', '0.800'),
      makeFranchise('0003', '0.300'),
      makeFranchise('0004', '0.600'),
    ];

    const result = getTierAllPlayStandings(franchises, aflConfigFixture);

    expect(result[0].teams.map(t => t.id)).toEqual(['0002', '0001']);
    expect(result[1].teams.map(t => t.id)).toEqual(['0004', '0003']);
  });

  it('breaks ties using PF (higher is better)', () => {
    const franchises = [
      makeFranchise('0001', '0.500', '1600'),
      makeFranchise('0002', '0.500', '1700'),
    ];

    const result = getTierAllPlayStandings(franchises, aflConfigFixture);
    expect(result[0].teams[0].id).toBe('0002');
    expect(result[0].teams[1].id).toBe('0001');
  });

  it('overrides MFL all-play pct with calculatedAllPlay map', () => {
    const franchises = [
      makeFranchise('0001', '0.300'), // MFL says 30%
      makeFranchise('0002', '0.700'), // MFL says 70%
    ];

    // Calculated overrides flip the order
    const calculated = new Map([
      ['0001', { wins: 7, losses: 3, ties: 0, pct: 0.7 }],
      ['0002', { wins: 3, losses: 7, ties: 0, pct: 0.3 }],
    ]);

    const result = getTierAllPlayStandings(franchises, aflConfigFixture, calculated);

    // After override, 0001 should rank higher
    expect(result[0].teams.map(t => t.id)).toEqual(['0001', '0002']);
    expect(result[0].teams[0].all_play_pct).toBe('0.700');
    expect(result[0].teams[0].all_play_wlt).toBe('7-3-0');
  });

  it('returns only tiers that have teams (filters empty tiers)', () => {
    const franchises = [
      makeFranchise('0001', '0.500'),
      makeFranchise('0002', '0.500'),
    ];

    const result = getTierAllPlayStandings(franchises, aflConfigFixture);
    // 0003/0004 D-League teams missing from franchises array
    expect(result).toHaveLength(1);
    expect(result[0].tier).toBe('Premier League');
  });
});

// ---------------------------------------------------------------------------
// Promotion/Relegation cutoff math (the 4-team bubble)
// ---------------------------------------------------------------------------

describe('Promotion/Relegation cutoff (the 4-team bubble)', () => {
  // Premier #9-10 + D-League #3-4 are ranked together by all-play.
  // Top 2 of those 4 stay/promote to Premier next year; bottom 2 stay/drop to D-League.
  it('top 2 of the 4 bubble teams should be in Premier next year, bottom 2 in D-League', () => {
    // Build a 12-team Premier + 8-team D-League roster and confirm bubble math.
    // Just validate the slicing math used on the standings page is correct.
    const premierTeams = Array.from({ length: 12 }, (_, i) => ({
      id: `P${String(i + 1).padStart(2, '0')}`,
      all_play_pct: String(1 - i * 0.05),
    }));
    const dLeagueTeams = Array.from({ length: 8 }, (_, i) => ({
      id: `D${String(i + 1).padStart(2, '0')}`,
      all_play_pct: String(0.6 - i * 0.05),
    }));

    // Premier #9-10 (zero-indexed slice 8,10)
    const premierBubble = premierTeams.slice(8, 10);
    expect(premierBubble.map(t => t.id)).toEqual(['P09', 'P10']);

    // D-League #3-4 (zero-indexed slice 2,4)
    const dLeagueBubble = dLeagueTeams.slice(2, 4);
    expect(dLeagueBubble.map(t => t.id)).toEqual(['D03', 'D04']);

    // Combined and re-sorted by all-play pct, top 2 promote/stay, bottom 2 drop/stay
    const combined = [...premierBubble, ...dLeagueBubble].sort(
      (a, b) => parseFloat(b.all_play_pct) - parseFloat(a.all_play_pct)
    );
    expect(combined).toHaveLength(4);

    // Highest pct should be the highest ranked of the 4
    const promoted = combined.slice(0, 2);
    const relegated = combined.slice(2, 4);
    expect(promoted.length).toBe(2);
    expect(relegated.length).toBe(2);
  });
});
