/**
 * The constraint list is the one place that says what outranks what, and three
 * surfaces read it — the reveal page, the admin panel, Schefter's fact sheet.
 * These tests pin the properties those surfaces depend on: the order is
 * monotonic by tier, every hard rule names its enforcer, and the bye split
 * arithmetic tells a forced bye-week division game apart from a chosen one.
 */
import { describe, expect, it } from 'vitest';
import {
  CONSTRAINT_TIERS,
  TIER_LABEL,
  describeDivisionByeSplit,
  divisionByeSplit,
  scheduleConstraints,
} from '../src/utils/schedule-constraints.mjs';

describe('scheduleConstraints', () => {
  for (const crossConference of [true, false]) {
    describe(crossConference ? 'league with a cross-conference round' : 'league without one', () => {
      const list = scheduleConstraints({ crossConference });

      it('ranks 1..n with no gaps', () => {
        expect(list.map((c) => c.rank)).toEqual(list.map((_, i) => i + 1));
      });

      it('never lets a weaker tier outrank a stronger one', () => {
        const seen = list.map((c) => CONSTRAINT_TIERS.indexOf(c.tier));
        expect(seen).not.toContain(-1);
        expect([...seen]).toEqual([...seen].sort((a, b) => a - b));
      });

      it('gives every tier a label the UI can print', () => {
        for (const c of list) expect(TIER_LABEL[c.tier], `no label for tier ${c.tier}`).toBeTruthy();
      });

      it('names what enforces every format and hard rule', () => {
        for (const c of list) {
          if (c.tier === 'format' || c.tier === 'hard') expect(c.enforcedBy, c.rule).toBeTruthy();
        }
      });

      it('says something in both fields, on every rule', () => {
        for (const c of list) {
          expect(c.rule.length, `rank ${c.rank}`).toBeGreaterThan(20);
          expect(c.why.length, `rank ${c.rank}`).toBeGreaterThan(20);
        }
      });

      it('opens on the format and closes on the exact post-pass', () => {
        expect(list[0].tier).toBe('format');
        expect(list.at(-1)!.tier).toBe('exact');
      });
    });
  }

  it('only mentions the cross-conference game for a league that plays one', () => {
    const withCross = JSON.stringify(scheduleConstraints({ crossConference: true }));
    const without = JSON.stringify(scheduleConstraints({ crossConference: false }));
    expect(withCross).toMatch(/cross-conference/i);
    expect(without).not.toMatch(/cross-conference/i);
  });
});

describe('divisionByeSplit', () => {
  // The AFL 2026 reveal: the format leaves nowhere else to put 36 of them.
  it('calls the AFL’s bye-week division games forced, and reports 30%', () => {
    const split = divisionByeSplit({ total: 120, byeFree: 84, ceiling: 84 })!;
    expect(split).toMatchObject({ onByes: 36, percent: 30, forced: 36, chosen: 0, atCeiling: true });
    expect(describeDivisionByeSplit(split)).toBe('all 36 forced by the format — the floor, not a miss');
  });

  // The League 2026: its ceiling is the whole schedule, so the 8 in Week 14
  // are bought, not forced — the price of ending the season on rivalry games.
  it('calls The League’s bye-week division games a choice, and reports 17%', () => {
    const split = divisionByeSplit({ total: 48, byeFree: 40, ceiling: 48 })!;
    expect(split).toMatchObject({ onByes: 8, percent: 17, forced: 0, chosen: 8, atCeiling: false });
    expect(describeDivisionByeSplit(split)).toBe('8 spent on the all-division finish');
  });

  it('splits a season that is both forced and spending', () => {
    const split = divisionByeSplit({ total: 120, byeFree: 72, ceiling: 84 })!;
    expect(split).toMatchObject({ onByes: 48, forced: 36, chosen: 12 });
    expect(describeDivisionByeSplit(split)).toBe(
      '36 forced by the format, 12 spent on the all-division finish',
    );
  });

  it('has a clean sentence for a season with none at all', () => {
    const split = divisionByeSplit({ total: 48, byeFree: 48, ceiling: 48 })!;
    expect(split.onByes).toBe(0);
    expect(describeDivisionByeSplit(split)).toBe('not one of them lands on an NFL bye week');
  });

  // Reveals locked before the denominator was recorded must render the
  // bye-free count alone rather than a percentage of undefined.
  it('returns null without a denominator', () => {
    expect(divisionByeSplit({ total: undefined, byeFree: 84, ceiling: 84 })).toBeNull();
    expect(describeDivisionByeSplit(null)).toBeNull();
  });
});
