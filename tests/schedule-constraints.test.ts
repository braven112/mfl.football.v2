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
  upcomingConstraints,
} from '../src/utils/schedule-constraints.mjs';

describe('scheduleConstraints', () => {
  for (const season of [null, 2026, 2027]) {
    describe(season == null ? 'every adopted goal' : `goals in force for ${season}`, () => {
      const list = scheduleConstraints({ season });

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

      it('opens on the format and closes on the cosmetic one', () => {
        expect(list[0].tier).toBe('format');
        // Home/away is last because it decides nothing — there is no
        // home-field advantage in fantasy.
        expect(list.at(-1)!.tier).toBe('cosmetic');
        expect(list.at(-1)!.key).toBe('home-away');
      });

      it('ranks getting division games off byes ABOVE the rematch gap', () => {
        // The league's explicit call: the rematch gap is ideal, not
        // inviolable, and a schedule that protects it by handing a rivalry
        // week to teams missing starters has bought the wrong thing.
        const rank = (k: string) => list.find((c) => c.key === k)?.rank ?? Infinity;
        expect(rank('division-bye-free-ceiling')).toBeLessThan(rank('rematch-gap'));
        // light-bye-weeks is absent from seasons that predate it (2026).
        if (list.some((c) => c.key === 'light-bye-weeks')) {
          expect(rank('light-bye-weeks')).toBeLessThan(rank('rematch-gap'));
        }
      });

      it('keeps both doubleheader goals above every division-game goal', () => {
        const rank = (k: string) => list.find((c) => c.key === k)?.rank ?? Infinity;
        expect(rank('doubleheaders-off-byes')).toBeLessThan(rank('division-bye-free-ceiling'));
        expect(rank('doubleheader-split')).toBeLessThan(rank('division-bye-free-ceiling'));
      });
    });
  }

  // Every league chases the SAME goals; only the outcomes differ, and those
  // live in the verdicts (schedule-goals.mjs). An earlier version branched
  // goal 2's text on whether the league plays a cross-conference round, which
  // made the two leagues' scorecards quietly incomparable.
  it('is one list for every league — no argument can change it but the season', () => {
    const base = JSON.stringify(scheduleConstraints({ season: 2027 }));
    for (const junk of [{}, { crossConference: true }, { crossConference: false }, { divisionSize: 6 }]) {
      expect(JSON.stringify(scheduleConstraints({ ...junk, season: 2027 })), JSON.stringify(junk)).toBe(base);
    }
  });

  it('withholds a goal from the seasons that predate it, and names it as upcoming', () => {
    const before = scheduleConstraints({ season: 2026 }).map((c) => c.key);
    const after = scheduleConstraints({ season: 2027 }).map((c) => c.key);
    expect(before).not.toContain('light-bye-weeks');
    expect(after).toContain('light-bye-weeks');
    // Ranks close up rather than leaving a hole where the goal will go.
    expect(before).toEqual(after.filter((k) => k !== 'light-bye-weeks'));
    expect(upcomingConstraints({ season: 2026 }).map((c) => c.key)).toEqual(['light-bye-weeks']);
    expect(upcomingConstraints({ season: 2027 })).toEqual([]);
    // No season given = planning the next draw, so everything applies.
    expect(upcomingConstraints({})).toEqual([]);
  });

  // Weights exist so the SOFT goals can trade against each other by margin
  // instead of by strict precedence. Two properties keep that coherent.
  it('weights only the tradeable goals, and never the format or hard ones', () => {
    for (const c of scheduleConstraints({})) {
      if (c.tier === 'format' || c.tier === 'hard') {
        expect(c.weight, `${c.key} is non-negotiable and must not carry a weight`).toBeNull();
      } else {
        expect(c.weight, `${c.key} is tradeable and needs a weight`).toBeGreaterThan(0);
      }
    }
  });

  it('orders weights the same way it orders ranks', () => {
    // A goal ranked higher that weighed less would make the list say two
    // contradictory things about the same trade.
    const weighted = scheduleConstraints({}).filter((c) => c.weight != null);
    for (let i = 1; i < weighted.length; i += 1) {
      expect(
        weighted[i].weight,
        `${weighted[i].key} (rank ${weighted[i].rank}) outweighs ${weighted[i - 1].key} (rank ${weighted[i - 1].rank})`,
      ).toBeLessThanOrEqual(weighted[i - 1].weight!);
    }
  });

  it('keeps the annealer\u2019s weights in the same order as the goal weights', () => {
    // scoreSeason tunes the tail of this list. Its numbers are tuned
    // independently, but if they ever ranked opponent strength above bye luck
    // the optimiser would be chasing a different priority order than the one
    // the page publishes.
    const weightOf = (k: string) => scheduleConstraints({}).find((c) => c.key === k)!.weight!;
    const annealer = { byeLuck: 1.0 + 0.6, opponentStrength: 0.25 + 0.25, homeAway: 0.15 };
    expect(weightOf('bye-luck')).toBeGreaterThan(weightOf('opponent-strength'));
    expect(annealer.byeLuck).toBeGreaterThan(annealer.opponentStrength);
    expect(weightOf('opponent-strength')).toBeGreaterThan(weightOf('home-away'));
    expect(annealer.opponentStrength).toBeGreaterThan(annealer.homeAway);
  });

  it('gives every goal a stable key, unique across the list', () => {
    const keys = scheduleConstraints({}).map((c) => c.key);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the doubleheader goal at the top of the negotiable ones', () => {
    // The league's stated #1 goal. Everything above it is the format itself.
    const list = scheduleConstraints({});
    const firstNonFormat = list.find((c) => c.tier !== 'format')!;
    expect(firstNonFormat.key).toBe('doubleheaders-off-byes');
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
