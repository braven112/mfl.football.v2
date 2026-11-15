import { describe, expect, it } from 'vitest';
import { ALL_LEAGUES, LEAGUE_TIERS, isFullManagementLeague, leagueTier, mflLiveSignInLeagueIds } from '../src/config/leagues';
import { BOTH_LEAGUES } from '../scripts/lib/weekly-changelog-format.mjs';
import { mflLiveIncludedNames } from '../src/data/league-showcase';

// Three products (Brandon, 2026-11-15): a History league, an AI league (we
// write its articles) and a full league. The old "full management" test was
// `!bestBall`, which let the first History league (gumbas) into MFL Live Pro,
// sign-in, the lineup check and the weekly What's New.
describe('league tiers', () => {
  it('names exactly three tiers, and a league with no tier is full', () => {
    expect([...LEAGUE_TIERS]).toEqual(['history', 'ai', 'full']);
    expect(leagueTier({})).toBe('full');
    expect(leagueTier(null)).toBe('full');
    for (const l of ALL_LEAGUES) expect(LEAGUE_TIERS, l.slug).toContain(leagueTier(l));
  });

  it('only full, non-best-ball leagues are full-management', () => {
    for (const l of ALL_LEAGUES) {
      expect(isFullManagementLeague(l), l.slug).toBe(!l.bestBall && leagueTier(l) === 'full');
    }
    expect(isFullManagementLeague({ tier: 'ai' })).toBe(false);
    expect(isFullManagementLeague({ tier: 'history' })).toBe(false);
    expect(isFullManagementLeague({ tier: 'full', bestBall: true })).toBe(false);
    expect(isFullManagementLeague(null)).toBe(false);
  });

  it('keeps History and AI leagues out of season-time surfaces', () => {
    for (const l of ALL_LEAGUES.filter((x) => leagueTier(x) !== 'full')) {
      expect(mflLiveSignInLeagueIds()).not.toContain(l.id);
      expect(BOTH_LEAGUES).not.toContain(l.navSlug);
      expect(mflLiveIncludedNames()).not.toContain(l.name);
    }
  });

  it('the sample History league is on the History tier', () => {
    expect(leagueTier(ALL_LEAGUES.find((l) => l.slug === 'gumbas'))).toBe('history');
  });
});
