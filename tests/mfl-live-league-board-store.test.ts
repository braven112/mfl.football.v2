/**
 * Guard: the league board's store mode (`/api/league-board?mfl=<id>&source=mfl`).
 *
 * The MFL Live phone app's league screen. The store build may not carry ESPN
 * data, NFL club marks or colours, or player headshots
 * (docs/plans/mfl-live-store-app.md, Legal), so `source=mfl` must reach the
 * assembler as `mflOnly` — which strips them (tests/mfl-live-board-store.test.ts
 * pins the same rule for the Matchups board). And it must exist ONLY on the
 * `?mfl=` path: that is the one signed in through `getMflLiveUser`, the only
 * reader of the app's Bearer token.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMflLiveUser = vi.fn();
const discoverBoardLeagues = vi.fn();
const assembleMflLeagueBoard = vi.fn();
const getCurrentNFLWeek = vi.fn();

vi.mock('../src/utils/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMflLiveUser: (...a: unknown[]) => getMflLiveUser(...a),
}));
vi.mock('../src/utils/cross-league-live', () => ({
  discoverBoardLeagues: (...a: unknown[]) => discoverBoardLeagues(...a),
}));
vi.mock('../src/utils/live/mfl-league-board', () => ({
  assembleMflLeagueBoard: (...a: unknown[]) => assembleMflLeagueBoard(...a),
}));
vi.mock('../src/utils/current-week', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCurrentNFLWeek: (...a: unknown[]) => getCurrentNFLWeek(...a),
}));

const { GET } = await import('../src/pages/api/league-board');

const user = { id: 'mfl-cookie', name: 'Brandon', franchiseId: '0001', leagueId: '13522', role: 'owner' as const };
const league = { id: '99999', name: 'Outside league', franchiseId: '0003' };

async function call(query: string, headers: Record<string, string> = { Authorization: 'Bearer t' }) {
  const url = new URL(`https://mfl.football/api/league-board?${query}`);
  const res = await (GET as any)({ url, request: new Request(url, { headers }) });
  return { status: res.status as number, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  getMflLiveUser.mockReturnValue(user);
  discoverBoardLeagues.mockResolvedValue([league]);
  assembleMflLeagueBoard.mockResolvedValue({ board: { ok: true, week: 8, panels: [] } });
  getCurrentNFLWeek.mockReturnValue(8);
});

describe('store mode on the ?mfl= path', () => {
  it('passes mflOnly to the assembler', async () => {
    const { status } = await call('mfl=99999&week=8&source=mfl');
    expect(status).toBe(200);
    expect(assembleMflLeagueBoard).toHaveBeenCalledWith(expect.objectContaining({ league, week: 8, mflOnly: true }));
  });

  it('leaves the web board alone without source=mfl', async () => {
    await call('mfl=99999&week=8');
    expect(assembleMflLeagueBoard).toHaveBeenCalledWith(expect.objectContaining({ mflOnly: false }));
  });

  it('defaults the week to the running NFL week, so the app needs no NFL calendar', async () => {
    getCurrentNFLWeek.mockReturnValue(11);
    await call('mfl=99999&source=mfl');
    expect(assembleMflLeagueBoard).toHaveBeenCalledWith(expect.objectContaining({ week: 11, mflOnly: true }));
  });

  it('answers week 0 when no NFL week is running, never clamping it to 1', async () => {
    getCurrentNFLWeek.mockReturnValue(null);
    const { status } = await call('mfl=99999&source=mfl');
    expect(status).toBe(200);
    expect(assembleMflLeagueBoard).toHaveBeenCalledWith(expect.objectContaining({ week: 0 }));
  });

  it('still requires a week on the web path', async () => {
    const { status } = await call('mfl=99999');
    expect(status).toBe(400);
    expect(assembleMflLeagueBoard).not.toHaveBeenCalled();
  });

  it('is 401 without a signed-in MFL Live user', async () => {
    getMflLiveUser.mockReturnValue(null);
    const { status } = await call('mfl=99999&source=mfl', {});
    expect(status).toBe(401);
  });

  it('is 404 for a league the account is not in: the id is a check, never an input', async () => {
    const { status } = await call('mfl=12345&source=mfl');
    expect(status).toBe(404);
    expect(assembleMflLeagueBoard).not.toHaveBeenCalled();
  });

  it('keeps a failed read a 200 with ok:false, so the app holds its last good board', async () => {
    assembleMflLeagueBoard.mockRejectedValue(new Error('MFL down'));
    const { status, body } = await call('mfl=99999&source=mfl');
    expect(status).toBe(200);
    expect(body).toEqual({ ok: false });
  });
});

describe('store mode does not exist on the ?league= path', () => {
  it('is a 400, never the web board served to the app', async () => {
    const { status } = await call('league=theleague&week=8&source=mfl');
    expect(status).toBe(400);
    expect(assembleMflLeagueBoard).not.toHaveBeenCalled();
  });
});
