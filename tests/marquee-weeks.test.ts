import { describe, it, expect } from 'vitest';
import {
  marqueeWeeks,
  marqueePairValues,
  marqueeGamesIn,
  thanksgivingIsoDate,
  REAL_LIFE_SHARE,
} from '../src/utils/marquee-weeks.mjs';
import { marqueeContext, SCHEDULE_POLICY } from '../src/utils/schedule-plan.mjs';
import { scoreColoring, COLORING_WEIGHTS } from '../src/utils/schedule-coloring.mjs';

/**
 * Marquee weeks (commissioner, Nov 2026): Halloween and Thanksgiving carry the
 * league's best rivalries. Real-life rivals are "the most important thing, at
 * least 51% of the score"; the on-field series is the tiebreaker. A soft goal:
 * it only steers NON-division pairs, because division rivals are placed by the
 * division and bye rules and a trial that let it move them cost four division
 * games their bye-free week.
 */
describe('marquee weeks', () => {
  it('finds Halloween and Thanksgiving as NFL weeks, from the real calendar', () => {
    expect(thanksgivingIsoDate(2026)).toBe('2026-11-26');
    expect(thanksgivingIsoDate(2024)).toBe('2024-11-28');
    // 2026: Thanksgiving week is the Wednesday-start week 12; 2024 ran a week later.
    expect(marqueeWeeks(2026, 14)).toEqual({ halloween: 8, thanksgiving: 12 });
    expect(marqueeWeeks(2024, 14)).toEqual({ halloween: 9, thanksgiving: 13 });
  });

  it('drops a holiday that falls after the fantasy regular season', () => {
    expect(marqueeWeeks(2026, 10)).toEqual({ halloween: 8 });
  });

  it('a real-life rival outranks every on-field series, and the series breaks ties', () => {
    const { value } = marqueePairValues({
      realLife: [
        ['A', 'B'],
        ['A', 'C'],
      ],
      series: {
        'A-B': { games: 10, intensity: 1 },
        'A-C': { games: 10, intensity: 2 },
        'D-E': { games: 30, intensity: 5 }, // the league's most charged series, not a real-life pair
        'B-D': { games: 3, intensity: 4 }, // too few meetings to count
      },
      franchiseIds: ['A', 'B', 'C', 'D', 'E'],
    }) as unknown as { value: Record<string, number> };
    expect(REAL_LIFE_SHARE).toBeGreaterThanOrEqual(0.51);
    expect(value['A-C']).toBeGreaterThan(value['A-B']);
    expect(value['A-B']).toBeGreaterThan(value['D-E']);
    expect(value['D-E']).toBeCloseTo(1 - REAL_LIFE_SHARE);
    expect(value['B-D']).toBeUndefined();
  });

  it('the AFL list only names franchises that exist, each pair once', () => {
    const list = SCHEDULE_POLICY['afl-fantasy'].marquee.realLifeRivalries as string[][];
    const ids = new Set(Array.from({ length: 24 }, (_, i) => String(i + 1).padStart(4, '0')));
    const keys = list.map(([a, b]) => [a, b].sort().join('-'));
    for (const [a, b] of list) {
      expect(ids.has(a) && ids.has(b) && a !== b, `${a}/${b}`).toBe(true);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('steers only non-division pairs, but reports division rivals too', () => {
    const shape = {
      franchiseIds: ['A', 'B', 'C', 'D'],
      divisionOf: { A: 'N', B: 'N', C: 'S', D: 'S' },
      lastWeek: 14,
    };
    const policy = { marquee: { since: 2026, realLifeRivalries: [['A', 'B'], ['A', 'C']] } };
    const ctx = marqueeContext(policy, 2026, shape, {}, [])!;
    expect(Object.keys(ctx.value).sort()).toEqual(['A-B', 'A-C']);
    expect(Object.keys(ctx.steer)).toEqual(['A-C']);
    expect(marqueeContext(policy, 2025, shape, {}, [])).toBeNull();

    const weeks = new Map([[8, [{ away: 'A', home: 'B' }, { away: 'C', home: 'D' }]]]);
    const games = marqueeGamesIn(weeks, ctx.named, ctx);
    expect(games.map((g: any) => `${g.away}-${g.home}`)).toEqual(['A-B']);
  });

  it('the colouring term rewards a holiday week holding the steered pair', () => {
    const slots = [{ week: 8 }, { week: 9 }];
    const base = {
      divisionOf: { A: 'N', B: 'N', C: 'S', D: 'S' },
      byesFor: () => 0,
      rating: {},
      franchiseIds: ['A', 'B', 'C', 'D'],
      byeFreeWeeks: [8, 9],
      lastWeek: 14,
      doubleheaderWeeks: [],
      minRematchGap: 4,
      marquee: { weeks: new Set([8]), value: { 'A-C': 1 }, potential: 2 },
    };
    const withRival = [
      [{ away: 'A', home: 'C' }, { away: 'B', home: 'D' }],
      [{ away: 'A', home: 'D' }, { away: 'B', home: 'C' }],
    ];
    const without = [withRival[1], withRival[0]];
    const a = scoreColoring(withRival, slots, base, undefined);
    const b = scoreColoring(without, slots, base, undefined);
    expect(a.terms.marqueeRivals as number).toBeLessThan(b.terms.marqueeRivals as number);
    // No marquee context = the old weights exactly, not the old weights plus a zero.
    expect(COLORING_WEIGHTS()).not.toHaveProperty('marqueeRivals');
    expect(COLORING_WEIGHTS({ marquee: true })).toHaveProperty('marqueeRivals');
  });
});
