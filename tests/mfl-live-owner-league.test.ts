/**
 * Guard: the MFL Football app's "which league, as which team" check
 * (`src/utils/live/owner-league.ts`, package F2).
 *
 * Every app endpoint under `src/pages/api/mfl-live/` acts in a league the
 * PHONE names. That id must only be honoured when the owner's own MFL account
 * lists a team there, and the franchise acted as must be the one MFL lists —
 * never one from the request, because every MFL league has a franchise 0001.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const fetchMyLeagues = vi.fn();
const getMflLiveUser = vi.fn();

vi.mock('../src/utils/my-leagues', () => ({
  fetchMyLeagues: (...a: unknown[]) => fetchMyLeagues(...a),
}));
vi.mock('../src/utils/auth', () => ({
  getMflLiveUser: (...a: unknown[]) => getMflLiveUser(...a),
}));

const { listOwnerLeagues, requireOwnerLeague, requireAppUser } = await import('../src/utils/live/owner-league');
const { GET: myTeams } = await import('../src/pages/api/mfl-live/my-teams');

const user = { id: 'mfl-cookie', name: 'Brandon', franchiseId: '0003', leagueId: '13522', role: 'owner' as const };
const OUTSIDE = { id: '55555', name: 'Work league', franchiseId: '0007', franchiseName: 'Desk Jockeys', host: 'https://www49.myfantasyleague.com' };
const req = () => new Request('https://mfl.football/api/mfl-live/x', { headers: { authorization: 'Bearer t' } });

beforeEach(() => {
  fetchMyLeagues.mockReset();
  getMflLiveUser.mockReset();
  getMflLiveUser.mockReturnValue(user);
  fetchMyLeagues.mockResolvedValue({ ok: true, leagues: [OUTSIDE] });
});

describe('listOwnerLeagues', () => {
  it("lists the account's own leagues, with the session league folded in", async () => {
    const r = await listOwnerLeagues(user);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.leagues.map((l) => l.leagueId);
    expect(ids).toContain('55555');
    expect(ids).toContain('13522');
    expect(r.leagues.find((l) => l.leagueId === '55555')).toMatchObject({ franchiseId: '0007', franchiseName: 'Desk Jockeys' });
  });

  it('asks MFL with the owner’s own cookie', async () => {
    await listOwnerLeagues(user);
    expect(fetchMyLeagues.mock.calls[0][0]).toBe('mfl-cookie');
  });

  it('leaves out a league where the account has no team', async () => {
    fetchMyLeagues.mockResolvedValue({ ok: true, leagues: [{ ...OUTSIDE, franchiseId: '' }] });
    const r = await listOwnerLeagues(user);
    expect(r.ok && r.leagues.map((l) => l.leagueId)).not.toContain('55555');
  });

  it('a dead cookie is signed out, a failed fetch is unavailable', async () => {
    fetchMyLeagues.mockResolvedValueOnce({ ok: false, leagues: [], reason: 'dead-cookie' });
    expect(await listOwnerLeagues(user)).toEqual({ ok: false, reason: 'signed-out' });
    fetchMyLeagues.mockResolvedValueOnce({ ok: false, leagues: [], reason: 'fetch-failed' });
    expect(await listOwnerLeagues(user)).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('requireOwnerLeague', () => {
  it('401 without a session', async () => {
    getMflLiveUser.mockReturnValue(null);
    const r = await requireOwnerLeague(req(), '55555');
    expect(r instanceof Response && r.status).toBe(401);
  });

  it('400 without a numeric league id', async () => {
    for (const id of [null, '', 'theleague', '1; drop']) {
      const r = await requireOwnerLeague(req(), id);
      expect(r instanceof Response && r.status).toBe(400);
    }
  });

  it("403 for a league the account isn't in", async () => {
    const r = await requireOwnerLeague(req(), '77777');
    expect(r instanceof Response && r.status).toBe(403);
  });

  it('503 when MFL does not answer, 401 when the cookie is dead', async () => {
    fetchMyLeagues.mockResolvedValueOnce({ ok: false, leagues: [], reason: 'fetch-failed' });
    const a = await requireOwnerLeague(req(), '55555');
    expect(a instanceof Response && a.status).toBe(503);
    fetchMyLeagues.mockResolvedValueOnce({ ok: false, leagues: [], reason: 'dead-cookie' });
    const b = await requireOwnerLeague(req(), '55555');
    expect(b instanceof Response && b.status).toBe(401);
  });

  it("acts as the franchise MFL lists for this account, not the session's", async () => {
    const r = await requireOwnerLeague(req(), '55555');
    expect(r instanceof Response).toBe(false);
    if (r instanceof Response) return;
    expect(r.league.franchiseId).toBe('0007');
    expect(r.user).toBe(user);
  });
});

describe('GET /api/mfl-live/my-teams', () => {
  it('lists the teams without the server-side host', async () => {
    const res = await myTeams({ request: req() } as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.teams.find((t: any) => t.leagueId === '55555')).toEqual({
      leagueId: '55555',
      leagueName: 'Work league',
      franchiseId: '0007',
      franchiseName: 'Desk Jockeys',
      year: expect.any(Number),
    });
    expect(JSON.stringify(body)).not.toContain('myfantasyleague.com');
  });

  it('401 signed out', async () => {
    getMflLiveUser.mockReturnValue(null);
    expect((await myTeams({ request: req() } as any)).status).toBe(401);
    expect(requireAppUser(req()) instanceof Response).toBe(true);
  });
});

describe('every app endpoint goes through the check', () => {
  const ROOT = join(__dirname, '..');
  const DIR = join(ROOT, 'src/pages/api/mfl-live');
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

  it('each file under src/pages/api/mfl-live calls requireOwnerLeague or requireAppUser', () => {
    const bad = walk(DIR)
      .filter((f) => /\.(ts|mjs)$/.test(f))
      .filter((f) => !/\brequire(OwnerLeague|AppUser)\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(bad).toEqual([]);
  });

  it('and none reads the session itself or acts with the server’s credentials', () => {
    const bad = walk(DIR)
      .filter((f) => /\.(ts|mjs)$/.test(f))
      .filter((f) => /getMflLiveUser\(|getAuthUser\(|MFL_COMMISH|process\.env\.MFL_/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(bad).toEqual([]);
  });
});
