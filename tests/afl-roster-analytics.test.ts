/**
 * Pure-logic guard for src/utils/afl-roster-analytics.ts — the Front Office
 * AFL panel's roster-analytics data (position composition, age-by-position,
 * age stats/distribution, NFL/college groupings). A fresh implementation of
 * the same analysis AFL rosters.astro's Analytics view computes inline, not
 * an extraction — see that module's header comment for why.
 */
import { describe, it, expect } from 'vitest';
import {
  buildRosterAnalytics,
  groupByNflTeam,
  groupByCollege,
  calculateAgeFromBirthdate,
  type RosterAnalyticsInput,
} from '../src/utils/afl-roster-analytics';

const AGE_30_BIRTHDATE = Math.floor(
  new Date(new Date().getFullYear() - 30, 0, 1).getTime() / 1000,
).toString();
const AGE_24_BIRTHDATE = Math.floor(
  new Date(new Date().getFullYear() - 24, 0, 1).getTime() / 1000,
).toString();

function player(overrides: Partial<RosterAnalyticsInput>): RosterAnalyticsInput {
  return {
    name: 'Test Player',
    position: 'WR',
    team: 'KC',
    college: 'Alabama',
    birthdate: AGE_24_BIRTHDATE,
    ...overrides,
  };
}

describe('buildRosterAnalytics', () => {
  it('returns a stable empty shape for an empty roster (no divide-by-zero NaNs)', () => {
    const analytics = buildRosterAnalytics([]);
    expect(analytics.rosterSize).toBe(0);
    expect(analytics.positionDistribution).toEqual([]);
    expect(analytics.donutSegments).toEqual([]);
    expect(analytics.ageBuckets).toEqual([]);
    expect(analytics.ageStats).toEqual({ avg: null, oldest: null, youngest: null });
    expect(analytics.ageByPositionDots).toEqual([]);
  });

  it('buckets positions, folding anything outside QB/RB/WR/TE/PK/DEF into Other', () => {
    const roster = [
      player({ position: 'QB' }),
      player({ position: 'RB' }),
      player({ position: 'RB' }),
      player({ position: 'Def' }),
      player({ position: 'Coach' }),
    ];
    const analytics = buildRosterAnalytics(roster);
    const byLabel = Object.fromEntries(analytics.positionDistribution.map((b) => [b.label, b.count]));
    expect(byLabel.QB).toBe(1);
    expect(byLabel.RB).toBe(2);
    expect(byLabel.DEF).toBe(1);
    expect(byLabel.Other).toBe(1);
  });

  it('computes age stats and buckets from birthdate, skipping players with none', () => {
    const roster = [
      player({ name: 'Old Guy', birthdate: AGE_30_BIRTHDATE }),
      player({ name: 'Young Guy', birthdate: AGE_24_BIRTHDATE }),
      player({ name: 'No Birthdate', birthdate: null }),
    ];
    const analytics = buildRosterAnalytics(roster);
    expect(analytics.ageStats.oldest?.name).toBe('Old Guy');
    expect(analytics.ageStats.youngest?.name).toBe('Young Guy');
    expect(analytics.ageStats.avg).toBeCloseTo(27, 0);
    const bucket30plus = analytics.ageBuckets.find((b) => b.label === '30+');
    expect(bucket30plus?.count).toBe(1);
  });

  it('donut segments sum their dash lengths to the full circumference', () => {
    const roster = [player({ position: 'QB' }), player({ position: 'RB' }), player({ position: 'WR' })];
    const analytics = buildRosterAnalytics(roster);
    const circumference = 2 * Math.PI * 42;
    const totalDash = analytics.donutSegments.reduce((sum, seg) => {
      const [len] = seg.dashArray.split(' ').map(Number);
      return sum + len;
    }, 0);
    expect(totalDash).toBeCloseTo(circumference, 5);
  });

  it('stacks same-age, same-position dots instead of overlapping them at stackIndex 0', () => {
    const roster = [
      player({ name: 'A', position: 'WR', birthdate: AGE_24_BIRTHDATE }),
      player({ name: 'B', position: 'WR', birthdate: AGE_24_BIRTHDATE }),
    ];
    const analytics = buildRosterAnalytics(roster);
    const stackIndices = analytics.ageByPositionDots.map((d) => d.stackIndex).sort();
    expect(stackIndices).toEqual([0, 1]);
  });
});

describe('calculateAgeFromBirthdate', () => {
  it('returns null for a missing or non-positive birthdate', () => {
    expect(calculateAgeFromBirthdate(null)).toBeNull();
    expect(calculateAgeFromBirthdate(undefined)).toBeNull();
    expect(calculateAgeFromBirthdate('0')).toBeNull();
  });
});

describe('groupByNflTeam / groupByCollege', () => {
  it('only groups a team/college with 2+ players, excludes FA/N-A/unknown/coaches/DEF', () => {
    const roster = [
      player({ name: 'A', team: 'KC', college: 'Alabama' }),
      player({ name: 'B', team: 'KC', college: 'Alabama' }),
      player({ name: 'Solo', team: 'DAL', college: 'Georgia' }),
      player({ name: 'Coach', team: 'KC', position: 'Coach' }),
      player({ name: 'Def Unit', team: 'FA', position: 'Def', college: 'N/A' }),
    ];
    const byTeam = groupByNflTeam(roster);
    const byCollege = groupByCollege(roster);
    expect(byTeam).toHaveLength(1);
    expect(byTeam[0].key).toBe('KC');
    expect(byTeam[0].players.map((p) => p.name)).toEqual(['A', 'B']);
    expect(byCollege).toHaveLength(1);
    expect(byCollege[0].key).toBe('Alabama');
  });
});
