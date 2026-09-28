/**
 * Who may change a league's settings (src/utils/league-admin.ts).
 *
 * A commissioner: their own league, and a request naming another is REFUSED
 * rather than quietly redirected. A platform admin: every league, recognised
 * by the MFL account name the login route wrote after MFL accepted the
 * password — never by franchise id, which both leagues share (0001).
 */
import { describe, expect, it } from 'vitest';
import {
  PLATFORM_ADMIN_USERNAMES,
  canAdministerLeague,
  isPlatformAdmin,
  resolveAdministeredLeague,
} from '../src/utils/league-admin';
import { getLeagueBySlug } from '../src/config/leagues';
import type { AuthUser } from '../src/utils/auth';

const theleague = getLeagueBySlug('theleague')!;
const archies = getLeagueBySlug('archies')!;
const afl = getLeagueBySlug('afl-fantasy')!;

const user = (over: Partial<AuthUser>): AuthUser => ({
  id: 'u',
  name: 'someone',
  franchiseId: '0007',
  leagueId: theleague.id,
  role: 'owner',
  ...over,
});

describe('isPlatformAdmin', () => {
  it('recognises the site owner by MFL account name, any case', () => {
    expect(PLATFORM_ADMIN_USERNAMES).toContain('braven112');
    expect(isPlatformAdmin({ name: 'braven112' })).toBe(true);
    expect(isPlatformAdmin({ name: '  Braven112 ' })).toBe(true);
  });

  it('never recognises anyone else, or nobody', () => {
    expect(isPlatformAdmin({ name: 'braven1123' })).toBe(false);
    expect(isPlatformAdmin({ name: '' })).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
  });
});

describe('canAdministerLeague', () => {
  it('lets a commissioner administer only their own league', () => {
    const commish = user({ role: 'commissioner', leagueId: archies.id });
    expect(canAdministerLeague(commish, archies)).toBe(true);
    expect(canAdministerLeague(commish, theleague)).toBe(false);
  });

  it('refuses an owner, even in their own league', () => {
    expect(canAdministerLeague(user({ leagueId: archies.id }), archies)).toBe(false);
  });

  it('lets a platform admin administer every league from any session', () => {
    const me = user({ name: 'braven112', leagueId: theleague.id, role: 'owner' });
    for (const league of [theleague, afl, archies]) expect(canAdministerLeague(me, league)).toBe(true);
  });
});

describe('resolveAdministeredLeague', () => {
  it('gives a commissioner their session league, with or without the matching param', () => {
    const commish = user({ role: 'commissioner', leagueId: archies.id });
    expect(resolveAdministeredLeague(commish, null)).toEqual({ ok: true, league: archies });
    expect(resolveAdministeredLeague(commish, 'archies')).toEqual({ ok: true, league: archies });
  });

  it('refuses a commissioner who names another league', () => {
    const commish = user({ role: 'commissioner', leagueId: archies.id });
    expect(resolveAdministeredLeague(commish, 'theleague')).toMatchObject({ ok: false, status: 403 });
  });

  it('lets a platform admin name any league, defaulting to the session one', () => {
    const me = user({ name: 'braven112' });
    expect(resolveAdministeredLeague(me, 'archies')).toEqual({ ok: true, league: archies });
    expect(resolveAdministeredLeague(me, null)).toEqual({ ok: true, league: theleague });
  });

  it('refuses unknown leagues, owners and signed-out callers', () => {
    expect(resolveAdministeredLeague(user({ name: 'braven112' }), 'nope')).toMatchObject({ ok: false, status: 403 });
    expect(resolveAdministeredLeague(user({}), null)).toMatchObject({ ok: false, status: 403 });
    expect(resolveAdministeredLeague(null, 'archies')).toMatchObject({ ok: false, status: 401 });
  });
});
