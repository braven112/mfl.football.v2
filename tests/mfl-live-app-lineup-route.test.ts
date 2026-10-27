/**
 * `/api/mfl-live/lineup` (package J): the app's Set Lineup endpoint for any
 * MFL league. The league check and the view are tested elsewhere
 * (mfl-live-owner-league, mfl-live-app-lineup); this pins the route's own
 * job — that a POST is only sent to MFL when the server's read of the week
 * allows it, as the account's own team, with the owner's own cookie.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireOwnerLeague = vi.fn();
const loadAppLineup = vi.fn();
const submitLineupToMfl = vi.fn();

vi.mock('../src/utils/live/owner-league', async (orig) => ({
  ...(await orig<typeof import('../src/utils/live/owner-league')>()),
  requireOwnerLeague: (...a: unknown[]) => requireOwnerLeague(...a),
}));
vi.mock('../src/utils/live/mfl-live-app-lineup', async (orig) => ({
  ...(await orig<typeof import('../src/utils/live/mfl-live-app-lineup')>()),
  loadAppLineup: (...a: unknown[]) => loadAppLineup(...a),
}));
vi.mock('../src/utils/lineup-write', async (orig) => ({
  ...(await orig<typeof import('../src/utils/lineup-write')>()),
  submitLineupToMfl: (...a: unknown[]) => submitLineupToMfl(...a),
}));

const { GET, POST } = await import('../src/pages/api/mfl-live/lineup');

const league = {
  leagueId: '55555', leagueName: 'Work league', franchiseId: '0007', franchiseName: 'Desk Jockeys',
  year: 2026, host: 'https://www49.myfantasyleague.com',
};
const user = { id: 'owner-cookie', name: 'Owner', franchiseId: '0003', leagueId: '13522', role: 'owner' };
const STARTERS = ['1', '2', '3'];
const view = (over: Record<string, unknown> = {}) => ({
  supported: true, canSubmit: true, mode: 'saved', starterCount: 3,
  players: [...STARTERS, '4'].map((id) => ({ id, canStart: id !== '4' })),
  ...over,
});

function ctx(method: string, body?: unknown, query = '?league=55555') {
  const url = new URL(`https://mfl.football/api/mfl-live/lineup${query}`);
  const request = new Request(url, {
    method,
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { request, url } as any;
}

beforeEach(() => {
  requireOwnerLeague.mockReset().mockResolvedValue({ user, league });
  loadAppLineup.mockReset().mockResolvedValue(view());
  submitLineupToMfl.mockReset().mockResolvedValue({ ok: true });
});

describe('/api/mfl-live/lineup', () => {
  it('returns the league check’s refusal untouched', async () => {
    requireOwnerLeague.mockResolvedValue(new Response('{}', { status: 403 }));
    expect((await GET(ctx('GET'))).status).toBe(403);
    expect((await POST(ctx('POST', { week: 8, starters: STARTERS }))).status).toBe(403);
    expect(submitLineupToMfl).not.toHaveBeenCalled();
  });

  it('GET reads the week as the account’s own team', async () => {
    const res = await GET(ctx('GET', undefined, '?league=55555&week=8'));
    expect(res.status).toBe(200);
    expect(loadAppLineup).toHaveBeenCalledWith({ league, ownerCookie: 'owner-cookie', week: 8 });
  });

  it('GET refuses a nonsense week', async () => {
    expect((await GET(ctx('GET', undefined, '?league=55555&week=40'))).status).toBe(400);
  });

  it('POST submits with the owner’s cookie, as the team MFL lists for this account', async () => {
    const res = await POST(ctx('POST', { week: 8, starters: STARTERS }));
    expect(res.status).toBe(200);
    expect(submitLineupToMfl).toHaveBeenCalledWith(expect.objectContaining({
      leagueId: '55555', week: 8, starters: STARTERS, ownerCookie: 'owner-cookie', mflHost: 'www49.myfantasyleague.com',
    }));
  });

  it('POST never writes over a lineup it could not read', async () => {
    loadAppLineup.mockResolvedValue(view({ canSubmit: false, mode: 'read-failed' }));
    const res = await POST(ctx('POST', { week: 8, starters: STARTERS }));
    expect(res.status).toBe(409);
    expect(submitLineupToMfl).not.toHaveBeenCalled();
  });

  it('POST refuses the wrong count and players who can’t start', async () => {
    expect((await POST(ctx('POST', { week: 8, starters: ['1', '2'] }))).status).toBe(400);
    expect((await POST(ctx('POST', { week: 8, starters: ['1', '2', '4'] }))).status).toBe(400);
    expect(submitLineupToMfl).not.toHaveBeenCalled();
  });

  it('POST passes MFL’s refusal through with its fix link', async () => {
    submitLineupToMfl.mockResolvedValue({ ok: false, status: 422, error: 'IR violation', reason: 'ir-violation', fixUrl: 'https://x' });
    const res = await POST(ctx('POST', { week: 8, starters: STARTERS }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'IR violation', reason: 'ir-violation', fixUrl: 'https://x' });
  });
});
