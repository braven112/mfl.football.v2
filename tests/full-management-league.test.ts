import { describe, expect, it } from 'vitest';
import { ALL_LEAGUES, isFullManagementLeague, mflLiveSignInLeagueIds } from '../src/config/leagues';
import { BOTH_LEAGUES } from '../scripts/lib/weekly-changelog-format.mjs';
import { mflLiveIncludedNames } from '../src/data/league-showcase';

// A History-only league has its past seasons and nothing else. The old
// "full management" test was `!bestBall`, which let the first one (gumbas)
// into MFL Live Pro, sign-in, the lineup check and the weekly What's New.
describe('isFullManagementLeague', () => {
  const historyOnly = ALL_LEAGUES.filter((l) => l.historyOnly);

  it('excludes best-ball and History-only leagues', () => {
    for (const l of ALL_LEAGUES) {
      expect(isFullManagementLeague(l), l.slug).toBe(!l.bestBall && !l.historyOnly);
    }
    expect(isFullManagementLeague(null)).toBe(false);
  });

  it('keeps History-only leagues out of season-time surfaces', () => {
    for (const l of historyOnly) {
      expect(mflLiveSignInLeagueIds()).not.toContain(l.id);
      expect(BOTH_LEAGUES).not.toContain(l.navSlug);
      expect(mflLiveIncludedNames()).not.toContain(l.name);
    }
  });
});
