import { describe, it, expect } from 'vitest';
// @ts-expect-error — sibling .mjs module, no .d.ts
import {
  parseStreak,
  computePeckingOrder,
  attachTrend,
  avgMargin,
  describeMethodology,
  PECKING_ORDER_WEIGHTS,
// @ts-expect-error — sibling .mjs module, no .d.ts
} from '../scripts/lib/pecking-order-math.mjs';
// @ts-expect-error — sibling .mjs module, no .d.ts
import { rollingAvgPF } from '../scripts/lib/team-strength.mjs';

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
    // Through week 5: (120+90+130)/3 = 113.33
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

describe('avgMargin', () => {
  it('computes season point differential per game', () => {
    // 3-0: pf 360, pa 300 over 3 games → +20/game
    expect(avgMargin({ h2hw: '3', h2hl: '0', h2ht: '0', pf: '360', pa: '300' })).toBeCloseTo(20, 5);
  });
  it('is negative for outscored teams', () => {
    expect(avgMargin({ h2hw: '1', h2hl: '3', h2ht: '0', pf: '380', pa: '420' })).toBeCloseTo(-10, 5);
  });
  it('returns null with zero games played', () => {
    expect(avgMargin({ h2hw: '0', h2hl: '0', h2ht: '0', pf: '0', pa: '0' })).toBeNull();
    expect(avgMargin(undefined)).toBeNull();
  });
});

describe('PECKING_ORDER_WEIGHTS', () => {
  it('sums to 1.0', () => {
    const total = Object.values(PECKING_ORDER_WEIGHTS as Record<string, number>)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it('is described by the methodology string (kept in sync mechanically)', () => {
    const text = describeMethodology();
    expect(text).toContain('35% recent form');
    expect(text).toContain('25% record');
    expect(text).toContain('20% all-play %');
    expect(text).toContain('10% season PPG');
    expect(text).toContain('10% avg margin');
  });
});

describe('computePeckingOrder', () => {
  // Synthetic two-team league
  const franchiseIds = ['0001', '0002'];
  const standingsByFid = new Map<string, any>([
    ['0001', { id: '0001', h2hpct: '.800', all_play_pct: '.700', avgpf: '120.0', h2hw: '4', h2hl: '1', h2ht: '0', pf: '600', pa: '500' }],
    ['0002', { id: '0002', h2hpct: '.200', all_play_pct: '.300', avgpf: '95.0',  h2hw: '1', h2hl: '4', h2ht: '0', pf: '475', pa: '575' }],
  ]);
  const weeklyResults = {
    weeks: [
      { week: 1, scores: { '0001': 130, '0002': 90 } },
      { week: 2, scores: { '0001': 110, '0002': 95 } },
      { week: 3, scores: { '0001': 125, '0002': 80 } },
    ],
  };

  it('ranks the better team #1', () => {
    const ranked = computePeckingOrder({ franchiseIds, standingsByFid, weeklyResults, week: 3 });
    expect(ranked[0].fid).toBe('0001');
    expect(ranked[1].fid).toBe('0002');
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
  });

  it('carries rolling-3wk PPG and margin metrics on each row', () => {
    const ranked = computePeckingOrder({ franchiseIds, standingsByFid, weeklyResults, week: 3 });
    expect(ranked[0].composite).toBeGreaterThan(ranked[1].composite);
    // (130+110+125)/3 = 121.67 for the top team
    expect(ranked[0].rolling3Ppg).toBeCloseTo(121.67, 1);
    // Margin: (600-500)/5 = +20 for top team; (475-575)/5 = -20 for bottom
    expect(ranked[0].avgMargin).toBeCloseTo(20, 5);
    expect(ranked[1].avgMargin).toBeCloseTo(-20, 5);
  });

  it('weights every component into the composite', () => {
    const ranked = computePeckingOrder({ franchiseIds, standingsByFid, weeklyResults, week: 3 });
    const top = ranked[0];
    const W = PECKING_ORDER_WEIGHTS;
    const expected =
      W.form * top.formScore +
      W.record * top.recordScore +
      W.allPlay * top.allPlayScore +
      W.seasonPpg * top.seasonPpgScore +
      W.margin * top.marginScore;
    expect(top.composite).toBeCloseTo(expected, 8);
  });

  it('margin separates two teams with identical records and PPG', () => {
    // Same record, all-play, and identical weekly scoring — only margin differs.
    const fids = ['0003', '0004'];
    const standings = new Map<string, any>([
      ['0003', { id: '0003', h2hpct: '.500', all_play_pct: '.500', avgpf: '100.0', h2hw: '2', h2hl: '2', h2ht: '0', pf: '400', pa: '360' }],
      ['0004', { id: '0004', h2hpct: '.500', all_play_pct: '.500', avgpf: '100.0', h2hw: '2', h2hl: '2', h2ht: '0', pf: '400', pa: '440' }],
    ]);
    const weekly = {
      weeks: [
        { week: 1, scores: { '0003': 100, '0004': 100 } },
        { week: 2, scores: { '0003': 100, '0004': 100 } },
      ],
    };
    const ranked = computePeckingOrder({ franchiseIds: fids, standingsByFid: standings, weeklyResults: weekly, week: 2 });
    expect(ranked[0].fid).toBe('0003'); // +10/game margin beats -10/game
    expect(ranked[1].fid).toBe('0004');
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
