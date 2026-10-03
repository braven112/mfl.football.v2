import { describe, expect, it } from 'vitest';
import {
  getLeaguePreference,
  rememberLeagueTeamChoice,
  resolveFranchiseSelection,
  teamPrefCookieName,
  validateFranchiseId,
} from '../src/utils/team-preferences';

/** Minimal AstroCookies stand-in: get/set/delete over a Map. */
function fakeCookies(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial));
  return {
    jar,
    get: (k: string) => (jar.has(k) ? { value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  } as any;
}

describe('team preference for any registry league', () => {
  it('keeps the three existing cookie names', () => {
    expect(teamPrefCookieName('theleague')).toBe('theleague_team_pref');
    expect(teamPrefCookieName('afl')).toBe('afl_team_pref');
    expect(teamPrefCookieName('bb1')).toBe('bb1_team_pref');
  });

  it("validates against the league's own config, never another league's", () => {
    expect(validateFranchiseId('0001', 'archies')).toBe(true);
    expect(validateFranchiseId('0099', 'archies')).toBe(true);
    // A league with no config validates nothing — not TheLeague's 0001.
    expect(validateFranchiseId('0001', 'no-such-league')).toBe(false);
  });

  it('resolves a ?myteam= choice for a package league', () => {
    expect(resolveFranchiseSelection('archies', { myTeamParam: '5' })).toBe('0005');
    expect(resolveFranchiseSelection('archies', {})).toBeUndefined();
  });

  it('round-trips the cookie and ignores a junk choice', () => {
    const cookies = fakeCookies();
    rememberLeagueTeamChoice(cookies, 'archies', '0012');
    expect(getLeaguePreference(cookies, 'archies')?.franchiseId).toBe('0012');
    rememberLeagueTeamChoice(cookies, 'archies', '9999');
    expect(getLeaguePreference(cookies, 'archies')?.franchiseId).toBe('0012');
  });

  it('clears a corrupt cookie instead of trusting it', () => {
    const cookies = fakeCookies({ archies_team_pref: 'not json' });
    expect(getLeaguePreference(cookies, 'archies')).toBeNull();
    expect(cookies.jar.has('archies_team_pref')).toBe(false);
  });
});
