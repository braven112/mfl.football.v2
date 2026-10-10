import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  DEFAULT_LINEUP_SLOTS,
  deriveLineupSlots,
  eligibleSlotsFor,
  exceedsPositionMax,
  lineupSlotsFor,
} from '../src/utils/lineup-slots';

/**
 * The Set Lineup page's slots come from each league's MFL starter rules
 * (utils/lineup-slots.ts). The page used to hard-code TheLeague's layout,
 * which would have made Archie's owners start a kicker they cannot roster.
 */

const starters = (slug: string) =>
  JSON.parse(fs.readFileSync(`data/${slug}/mfl-feeds/2026/league.json`, 'utf-8')).league.starters;

describe('deriveLineupSlots', () => {
  it.each(['theleague', 'afl-fantasy'])('%s derives exactly the layout the page always showed', (slug) => {
    expect(deriveLineupSlots(starters(slug))).toEqual(DEFAULT_LINEUP_SLOTS);
  });

  it("Archie's: no kicker, four FLEX that take a QB, at most two QBs", () => {
    const layout = deriveLineupSlots(starters('archies'));
    expect(layout.positions).toEqual(['QB', 'RB', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'FLEX', 'DEF']);
    expect(layout.eligibility.FLEX).toEqual(['QB', 'RB', 'WR', 'TE']);
    expect(layout.eligibility.PK).toBeUndefined();
    expect(layout.positionMax.QB).toBe(2);
  });

  it('has no layout for missing, unreadable or non-nine-starter rules', () => {
    expect(lineupSlotsFor(undefined)).toBeNull();
    expect(lineupSlotsFor({ count: '10', position: [{ name: 'QB', limit: '1-3' }] })).toBeNull();
    expect(lineupSlotsFor({ count: '9', position: [{ name: 'LB', limit: '1-3' }] })).toBeNull();
  });

  it('deriveLineupSlots falls back to the default for those same rules', () => {
    expect(deriveLineupSlots(undefined)).toBe(DEFAULT_LINEUP_SLOTS);
    expect(deriveLineupSlots({ count: 'x', position: [] })).toBe(DEFAULT_LINEUP_SLOTS);
    expect(
      deriveLineupSlots({ count: '10', position: [{ name: 'QB', limit: '1-3' }] }),
    ).toBe(DEFAULT_LINEUP_SLOTS);
    expect(
      deriveLineupSlots({ count: '9', position: [{ name: 'LB', limit: '1-3' }] }),
    ).toBe(DEFAULT_LINEUP_SLOTS);
  });
});

describe('eligibility and the per-position cap', () => {
  const archies = deriveLineupSlots(starters('archies'));

  it("a QB may fill a FLEX in Archie's but not in TheLeague", () => {
    expect(eligibleSlotsFor('QB', archies)).toEqual(['QB', 'FLEX']);
    expect(eligibleSlotsFor('QB', DEFAULT_LINEUP_SLOTS)).toEqual(['QB']);
  });

  it('a second QB is allowed, a third is not', () => {
    expect(exceedsPositionMax('QB', ['QB', 'RB'], archies.positionMax)).toBe(false);
    expect(exceedsPositionMax('QB', ['QB', 'QB', 'RB'], archies.positionMax)).toBe(true);
    expect(exceedsPositionMax('WR', ['WR'], archies.positionMax)).toBe(false);
  });
});

describe('the lineup page reads the layout, never its own literal', () => {
  const page = fs.readFileSync('src/components/shared/lineup/LineupPage.astro', 'utf-8');
  it('has no hard-coded slot list or RB/WR/TE flex rule', () => {
    expect(page).not.toMatch(/'QB',\s*'RB',\s*'WR',\s*'TE',\s*'FLEX'/);
    expect(page).not.toMatch(/\['RB',\s*'WR',\s*'TE'\]\.includes/);
  });
});
