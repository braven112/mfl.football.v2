/**
 * /api/move-to-ir behaviour around MFL's real roster state.
 *
 * Oct 2026: an AFL owner moved a kicker to IR, MFL took it, but the roster
 * page kept listing him under Active (the 60 s roster cache was never busted
 * and the row was only relabelled). Trying again sent a second DEACTIVATE,
 * which MFL answers with "Cannot Be Deactivated Because Is Not On Franchise …
 * Roster" — read by the owner as the player having vanished. A repeat move
 * now reports the real state as a success, and every move busts the cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getRosterEntries = vi.fn();
const movePlayerToIR = vi.fn();
const bustRosterCaches = vi.fn(async () => {});
const createMFLApiClient = vi.fn(() => ({ getRosterEntries, movePlayerToIR }));

vi.mock('../src/utils/auth', () => ({
  getAuthUser: () => ({ id: 'cookie', franchiseId: '0001', leagueId: '19621' }),
}));
vi.mock('../src/utils/mfl-matchup-api', () => ({ createMFLApiClient }));
vi.mock('../src/utils/mfl-roster-cache', () => ({ bustRosterCaches }));

const { POST } = await import('../src/pages/api/move-to-ir');

function call(body: unknown) {
  const request = new Request('https://example.test/api/move-to-ir', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return (POST as any)({ request });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/move-to-ir', () => {
  it('reports a player already on IR as done, without a second MFL write', async () => {
    getRosterEntries.mockResolvedValue({ '0001': [{ id: '16444', status: 'INJURED_RESERVE' }] });
    const res = await call({ playerId: '16444', direction: 'to' });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toMatchObject({ success: true, alreadyDone: true });
    expect(movePlayerToIR).not.toHaveBeenCalled();
    expect(bustRosterCaches).toHaveBeenCalled();
  });

  it('busts the roster cache after a successful move', async () => {
    getRosterEntries.mockResolvedValue({ '0001': [{ id: '16444', status: 'ROSTER' }] });
    movePlayerToIR.mockResolvedValue({ success: true });
    const res = await call({ playerId: '16444', direction: 'to' });
    expect(res.status).toBe(200);
    expect(movePlayerToIR).toHaveBeenCalledWith('16444', '0001', 'to');
    expect(bustRosterCaches).toHaveBeenCalledWith(expect.any(String), '19621');
  });

  it('writes to the AFL on its own league-year clock', async () => {
    getRosterEntries.mockResolvedValue({ '0001': [{ id: '16444', status: 'ROSTER' }] });
    movePlayerToIR.mockResolvedValue({ success: true });
    // April: TheLeague's Feb 14 clock already says 2026, the AFL's June 1
    // clock still says 2025 — the 2026 AFL league may not exist yet.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-15T12:00:00-07:00'));
    try {
      await call({ playerId: '16444', direction: 'to' });
    } finally {
      vi.useRealTimers();
    }
    expect(createMFLApiClient).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: '19621', year: '2025' }),
    );
  });

  it('still refuses a player who is not on the roster at all', async () => {
    getRosterEntries.mockResolvedValue({ '0001': [{ id: '1', status: 'ROSTER' }] });
    const res = await call({ playerId: '16444', direction: 'to' });
    expect(res.status).toBe(403);
    expect(movePlayerToIR).not.toHaveBeenCalled();
  });
});
