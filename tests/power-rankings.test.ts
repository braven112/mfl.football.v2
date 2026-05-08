import { describe, it, expect } from 'vitest';
// @ts-expect-error — sibling .mjs module, no .d.ts
import {
  parseStreak,
  rollingAvgPF,
  computeRankings,
  attachTrend,
// @ts-expect-error — sibling .mjs module, no .d.ts
} from '../scripts/generate-power-rankings.mjs';

describe('parseStreak', () => {
  it('parses W and L streaks', () => {
    expect(parseStreak('W3')).toEqual({ type: 'W', length: 3 });
    expect(parseStreak('L5')).toEqual({ type: 'L', length: 5 });
  });
  it('handles empty / malformed strings', () => {
    expect(parseStreak('')).toEqual({ type: null, length: 0 });
    expect(parseStreak(undefined as any)).toEqual({ type: null, length: 0 });
    expect(parseStreak('foo')).toEqual({ type: null, length: 0 });
  });
});

describe('rollingAvgPF', () => {
  const weekly = {
    weeks: [
      { week: 1, scores: { '0001': 100, '0002': 80 } },
      { week: 2, scores: { '0001': 110, '0002': 90 } },
      { week: 3, scores: { '0001': 120, '0002': 70 } },
      { week: 4, scores: { '0001': 90,  '0002': 60 } },
      { week: 5, scores: { '0001': 130, '0002': 100 } },
    ],
  };

  it('averages the last 3 completed weeks', () => {
    // Through week 5: 90 + 130 = (120+90+130)/3 = 113.33
    expect(rollingAvgPF(weekly, '0001', 5, 3)).toBeCloseTo(113.33, 1);
  });
  it('respects the throughWeek cap', () => {
    // Through week 3: weeks 1+2+3 → (100+110+120)/3 = 110
    expect(rollingAvgPF(weekly, '0001', 3, 3)).toBeCloseTo(110, 5);
  });
  it('returns null with no completed weeks', () => {
    expect(rollingAvgPF(weekly, '0099', 5, 3)).toBeNull();
  });
});

describe('computeRankings', () => {
  // Synthetic two-team league
  const teams = new Map<string, any>([
    ['0001', { franchiseId: '0001', name: 'Alpha', division: 'A' }],
    ['0002', { franchiseId: '0002', name: 'Beta',  division: 'A' }],
  ]);
  const standingsByFid = new Map<string, any>([
    ['0001', { id: '0001', h2hpct: '.800', all_play_pct: '.700', avgpf: '120.0' }],
    ['0002', { id: '0002', h2hpct: '.200', all_play_pct: '.300', avgpf: '95.0' }],
  ]);
  const weeklyResults = {
    weeks: [
      { week: 1, scores: { '0001': 130, '0002': 90 } },
      { week: 2, scores: { '0001': 110, '0002': 95 } },
      { week: 3, scores: { '0001': 125, '0002': 80 } },
    ],
  };
  const schedule = { schedule: { weeklySchedule: [] } };

  it('ranks the better team #1', () => {
    const ranked = computeRankings({ teams, standingsByFid, weeklyResults, schedule, week: 3 });
    expect(ranked[0].fid).toBe('0001');
    expect(ranked[1].fid).toBe('0002');
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
  });

  it('uses rolling-3wk PPG, record %, and all-play % in the composite', () => {
    const ranked = computeRankings({ teams, standingsByFid, weeklyResults, schedule, week: 3 });
    // Top team should have a substantially higher composite score
    expect(ranked[0].composite).toBeGreaterThan(ranked[1].composite);
    // The rolling-3wk PPG should match (130+110+125)/3 = 121.67 for top team
    expect(ranked[0].rolling3Ppg).toBeCloseTo(121.67, 1);
  });
});

describe('attachTrend', () => {
  const current = [
    { rank: 1, fid: '0001' },
    { rank: 2, fid: '0002' },
    { rank: 3, fid: '0003' },
  ];
  it('returns flat trends when there is no previous issue', () => {
    const out = attachTrend(current, null);
    expect(out.every((r: any) => r.trend === 'flat' && r.previousRank == null)).toBe(true);
  });

  it('marks risers, fallers, and steady', () => {
    const previous = {
      week: 4,
      rankings: [
        { rank: 1, franchiseId: '0002' },
        { rank: 2, franchiseId: '0001' },
        { rank: 3, franchiseId: '0003' },
      ],
    };
    const out = attachTrend(current, previous);
    expect(out[0]).toMatchObject({ fid: '0001', previousRank: 2, trend: 'up' });   // 2→1
    expect(out[1]).toMatchObject({ fid: '0002', previousRank: 1, trend: 'down' }); // 1→2
    expect(out[2]).toMatchObject({ fid: '0003', previousRank: 3, trend: 'flat' });
  });
});
