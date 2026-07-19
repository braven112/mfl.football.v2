/**
 * Schefter API league resolution — src/utils/schefter-league.ts.
 *
 * Locks the resolution ladder (session JWT → ?league= → TheLeague default),
 * the schefterTips feature gate, config selection, and the per-league season
 * clock (TheLeague rolls Feb 14, AFL rolls June 1).
 */

import { describe, it, expect } from 'vitest';
import {
  resolveSchefterLeague,
  leagueHasSchefterTips,
  schefterSeasonYear,
  publicLeagueQs,
} from '../src/utils/schefter-league';
import {
  getSchefterLeagueConfig,
  findLeagueTeam,
} from '../src/utils/schefter-league-data';
import type { AuthUser } from '../src/utils/auth';

const AFL_ID = '19621';
const THELEAGUE_ID = '13522';

function fakeUser(leagueId: string): AuthUser {
  return {
    id: 'user1',
    name: 'Test Owner',
    franchiseId: '0001',
    leagueId,
    role: 'owner',
  } as AuthUser;
}

const url = (s: string) => new URL(`https://example.com${s}`);

describe('resolveSchefterLeague', () => {
  it('session JWT wins: an AFL session resolves to the AFL', () => {
    const league = resolveSchefterLeague({ user: fakeUser(AFL_ID), url: url('/api/schefter/tip') });
    expect(league?.slug).toBe('afl-fantasy');
  });

  it('JWT beats a conflicting ?league= param (no cross-league writes)', () => {
    const league = resolveSchefterLeague({
      user: fakeUser(AFL_ID),
      url: url('/api/schefter/tip?league=theleague'),
    });
    expect(league?.slug).toBe('afl-fantasy');
  });

  it('?league= accepts canonical slug and navSlug for public routes', () => {
    expect(resolveSchefterLeague({ url: url('/x?league=afl-fantasy') })?.slug).toBe('afl-fantasy');
    expect(resolveSchefterLeague({ url: url('/x?league=afl') })?.slug).toBe('afl-fantasy');
    expect(resolveSchefterLeague({ url: url('/x?league=theleague') })?.slug).toBe('theleague');
  });

  it('unknown ?league= returns null (caller 400s) instead of silently defaulting', () => {
    expect(resolveSchefterLeague({ url: url('/x?league=nfl') })).toBeNull();
  });

  it('no user, no param → TheLeague (legacy URLs keep working)', () => {
    expect(resolveSchefterLeague({ url: url('/x') })?.slug).toBe('theleague');
  });

  it('a TheLeague session resolves to TheLeague', () => {
    expect(
      resolveSchefterLeague({ user: fakeUser(THELEAGUE_ID), url: url('/x') })?.slug,
    ).toBe('theleague');
  });
});

describe('feature gate + config selection', () => {
  it('schefterTips is on for both leagues', () => {
    const tl = resolveSchefterLeague({ url: url('/x?league=theleague') })!;
    const afl = resolveSchefterLeague({ url: url('/x?league=afl') })!;
    expect(leagueHasSchefterTips(tl)).toBe(true);
    // Launched July 2026 — pinned so a bad merge can't silently kill the AFL
    // tip line while the nav still renders the link.
    expect(leagueHasSchefterTips(afl)).toBe(true);
  });

  it('config selection returns each league its own teams', () => {
    const tl = resolveSchefterLeague({ url: url('/x?league=theleague') })!;
    const afl = resolveSchefterLeague({ url: url('/x?league=afl') })!;
    expect(getSchefterLeagueConfig(tl).teams).toHaveLength(16);
    expect(getSchefterLeagueConfig(afl).teams).toHaveLength(24);
    // Same franchise id, different teams — the classic collision this guards.
    expect(findLeagueTeam(tl, '0001')?.name).not.toBe(findLeagueTeam(afl, '0001')?.name);
    // AFL teams carry conference/tier fields TheLeague doesn't have.
    expect(findLeagueTeam(afl, '0001')?.conference).toBeDefined();
    expect(findLeagueTeam(afl, '0001')?.tier).toBeDefined();
  });
});

describe('publicLeagueQs — default league omits the param', () => {
  it('TheLeague sends nothing; other leagues send ?league=<navSlug>', () => {
    expect(publicLeagueQs('theleague')).toBe('');
    expect(publicLeagueQs('afl')).toBe('?league=afl');
  });
});

describe('schefterSeasonYear — per-league rollover clocks', () => {
  const tl = resolveSchefterLeague({ url: url('/x?league=theleague') })!;
  const afl = resolveSchefterLeague({ url: url('/x?league=afl') })!;

  it('AFL rolls June 1, not Feb 14', () => {
    // Mid-May: TheLeague has already rolled (Feb 14), the AFL has not.
    const midMay = new Date('2026-05-15T12:00:00-07:00');
    expect(schefterSeasonYear(tl, midMay)).toBe(2026);
    expect(schefterSeasonYear(afl, midMay)).toBe(2025);
    // Mid-June: both are on the new year.
    const midJune = new Date('2026-06-15T12:00:00-07:00');
    expect(schefterSeasonYear(tl, midJune)).toBe(2026);
    expect(schefterSeasonYear(afl, midJune)).toBe(2026);
  });
});
