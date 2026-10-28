import { describe, it, expect } from 'vitest';
import committed from '../src/data/league-routes.json';
import { buildLeagueRoutes } from '../scripts/generate-league-routes.mjs';
import { getEquivalentRoute, getLeagueSwitchUrl } from '../src/utils/nav-utils';

describe('src/data/league-routes.json', () => {
  it('matches src/pages (run node scripts/generate-league-routes.mjs)', async () => {
    expect(committed).toEqual(await buildLeagueRoutes());
  });
});

// The missed-files report (2026-10-27) counted 47 visits to
// mfl.football/best-ball-1/{draft/results,standings,division-strength,owners},
// all from the AFL's own pages: the switcher kept the page across leagues even
// though Best Ball (draft-only) has none of them.
describe('league switch to a league without the page', () => {
  it('goes to the target league home instead of a page it lacks', () => {
    for (const page of ['/standings', '/draft/results', '/division-strength', '/owners']) {
      expect(getEquivalentRoute(`/afl-fantasy${page}`, 'bb1'), page).toBe('/best-ball-1');
    }
  });

  it('still keeps a page the target league has', () => {
    expect(getEquivalentRoute('/afl-fantasy/rosters', 'bb1')).toBe('/best-ball-1/rosters');
  });

  it('links Best Ball home from the AFL apex standings page', () => {
    expect(getLeagueSwitchUrl('/afl-fantasy/standings', 'bb1', true, 'www.afl-fantasy.com')).not.toContain(
      '/standings',
    );
  });
});
