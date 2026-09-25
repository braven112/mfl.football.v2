/**
 * Guard: a session belongs to one of OUR leagues, and an admin action that
 * targets a fixed league is gated on THAT league.
 *
 * Three holes this closes, all reachable before Sep 2026:
 *
 * 1. /api/auth/login trusted the body's `leagueId` (or, with none, the MFL
 *    account's FIRST league), so a direct POST minted a valid session for any
 *    MFL league on earth. Both leagues have a franchise 0001, and so does
 *    every stranger's league — endpoints keyed on franchiseId alone could not
 *    tell them apart, and the AI endpoints spent our Anthropic budget for them.
 * 2. Sessions minted before the login fix live 90 days; getAuthUser voids any
 *    whose league is not in the registry, rather than letting them age out.
 * 3. `isCommissionerOrAdmin` trusts a role that carries no league, so an AFL
 *    commissioner session passed the gate on endpoints that write TheLeague's
 *    contracts. Those endpoints use `isCommissionerOrAdminForLeague`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createSessionToken } from '../src/utils/session';
import { getAuthUser, isCommissionerOrAdminForLeague, type AuthUser } from '../src/utils/auth';
import { getLeagueBySlug } from '../src/config/leagues';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const THELEAGUE_ID = getLeagueBySlug('theleague')!.id;
const AFL_ID = getLeagueBySlug('afl-fantasy')!.id;
const FOREIGN_ID = '99999';

const requestWith = (leagueId: string) =>
  new Request('https://example.test/', {
    headers: {
      cookie: `session_token=${createSessionToken({
        userId: 'u1',
        username: 'owner',
        franchiseId: '0001',
        leagueId,
        role: 'owner',
      })}`,
    },
  });

describe('getAuthUser — registry leagues only', () => {
  it('accepts a session for a registry league', () => {
    expect(getAuthUser(requestWith(THELEAGUE_ID))?.leagueId).toBe(THELEAGUE_ID);
    expect(getAuthUser(requestWith(AFL_ID))?.leagueId).toBe(AFL_ID);
  });

  it('voids a validly signed session for a league outside the registry', () => {
    expect(getAuthUser(requestWith(FOREIGN_ID))).toBeNull();
  });

  it('voids a session with no league at all', () => {
    expect(getAuthUser(requestWith(''))).toBeNull();
  });
});

describe('isCommissionerOrAdminForLeague', () => {
  const commish = (leagueId: string): AuthUser => ({
    id: 'u1',
    name: 'c',
    franchiseId: '0099',
    leagueId,
    role: 'commissioner',
  });

  it("passes a commissioner of the target league", () => {
    expect(isCommissionerOrAdminForLeague(commish(THELEAGUE_ID), THELEAGUE_ID)).toBe(true);
  });

  it("refuses another league's commissioner", () => {
    expect(isCommissionerOrAdminForLeague(commish(AFL_ID), THELEAGUE_ID)).toBe(false);
  });
});

describe('/api/auth/login — refuses leagues outside the registry', () => {
  const authenticateWithMFL = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    authenticateWithMFL.mockReset();
    vi.doMock('../src/utils/mfl-login', () => ({ authenticateWithMFL }));
    vi.doMock('../src/utils/rate-limit', () => ({
      checkRateLimit: async () => ({ allowed: true }),
    }));
  });

  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import('../src/pages/api/auth/login');
    return POST({
      request: new Request('https://example.test/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'u', password: 'p', ...body }),
      }),
      cookies: { set: () => {} },
    } as never);
  };

  it('refuses a foreign league without relaying the credentials to MFL', async () => {
    const res = await post({ leagueId: FOREIGN_ID });
    expect(res.status).toBe(400);
    expect(authenticateWithMFL).not.toHaveBeenCalled();
  });

  it("refuses a request with no league (MFL would pick the account's first)", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(authenticateWithMFL).not.toHaveBeenCalled();
  });

  it('scopes the session to the registry league it asked for', async () => {
    authenticateWithMFL.mockResolvedValue({
      success: true,
      userId: 'cookie',
      franchiseId: '0001',
      // Whatever MFL echoes back, the session names the registry league.
      leagueId: FOREIGN_ID,
      role: 'owner',
    });
    const res = await post({ leagueId: AFL_ID });
    expect(res.status).toBe(200);
    expect(authenticateWithMFL.mock.calls[0][2]).toBe(AFL_ID);
    expect((await res.json()).user.leagueId).toBe(AFL_ID);
  });
});

describe('fixed-league admin endpoints gate on their own league', () => {
  // Each of these acts on ONE league whatever the session says, so the bare
  // role check lets another league's commissioner through.
  const FIXED_LEAGUE_ENDPOINTS = [
    'src/pages/api/contracts/approve.ts',
    'src/pages/api/contracts/delete.ts',
    'src/pages/api/contracts/pending.ts',
    'src/pages/api/contracts/reconcile.ts',
    'src/pages/api/contracts/verify.ts',
    'src/pages/api/admin/autocut-control.ts',
    'src/pages/api/groupme/members.ts',
  ];

  for (const file of FIXED_LEAGUE_ENDPOINTS) {
    it(`${file} uses isCommissionerOrAdminForLeague, never the bare role check`, () => {
      const src = read(file);
      expect(src).toMatch(/isCommissionerOrAdminForLeague\(/);
      expect(src).not.toMatch(/\bisCommissionerOrAdmin\(/);
    });
  }

  const THELEAGUE_ADMIN_PAGES = [
    'src/pages/theleague/admin/index.astro',
    'src/pages/theleague/admin/cutdown-report.astro',
    'src/pages/theleague/contracts/franchise-tags.astro',
  ];

  for (const file of THELEAGUE_ADMIN_PAGES) {
    it(`${file} checks the session's league as well as its role`, () => {
      expect(read(file)).toMatch(/isAuthorizedForLeague\(user, /);
    });
  }

  it('contract declarations check the contract league, not just the franchise id', () => {
    expect(read('src/pages/api/contracts/declare.ts')).toMatch(
      /isAuthorizedForLeague\(user, CONTRACT_LEAGUE_ID\)/,
    );
  });
});

describe('AI endpoints key their rate limit by league AND franchise', () => {
  for (const file of [
    'src/pages/api/schefter-replies/[postId]/ai-reply.ts',
    'src/pages/api/groupme/rewrite.ts',
  ]) {
    it(file, () => {
      expect(read(file)).toMatch(/checkRateLimit\([^)]*\$\{user\.leagueId\}:\$\{user\.franchiseId\}/);
    });
  }
});
