/**
 * `/api/contracts/verify` exists to prove a contract write actually landed.
 *
 * That makes its failure mode unusually nasty: the salaries export is
 * owner-gated, and MFL answers an unauthenticated read with a well-formed
 * EMPTY payload under HTTP 200. So a route that reads without credentials
 * reports "0 players, verified" — a confirmation of nothing, indistinguishable
 * from a league whose contracts really are all clear.
 *
 * The route had no test at all until the read was moved onto mflFetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockMflFetch = vi.fn();
vi.mock('../src/utils/mfl-fetch', () => ({
  mflFetch: (...args: unknown[]) => mockMflFetch(...args),
}));

const mockGetAuthUser = vi.fn();
const mockIsCommish = vi.fn();
vi.mock('../src/utils/auth', () => ({
  getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  isCommissionerOrAdmin: (...args: unknown[]) => mockIsCommish(...args),
}));

// Any bare fetch here is the bug this route was fixed for.
const mockFetch = vi.fn(() => {
  throw new Error('bare fetch: the salaries read must go through mflFetch');
});
vi.stubGlobal('fetch', mockFetch);

const originalEnv = process.env;
const request = () => new Request('https://example.test/api/contracts/verify');

describe('/api/contracts/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = { ...originalEnv, MFL_USER_ID: 'test_cookie_value' };
    mockGetAuthUser.mockReturnValue({ id: 'u1', leagueId: 'theleague' });
    mockIsCommish.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('refuses to verify when the server has no MFL credentials', async () => {
    process.env.MFL_USER_ID = '';

    const { GET } = await import('../src/pages/api/contracts/verify');
    const res = await GET({ request: request() } as never);

    // 503, not an empty 200 — "cannot verify" and "nothing to fix" are
    // different answers and must not render identically.
    expect(res.status).toBe(503);
    expect(mockMflFetch).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reads through mflFetch with the cookie and maps contracts by player id', async () => {
    mockMflFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          salaries: {
            leagueUnit: {
              player: [
                { id: '14056', salary: '500000', contractYear: '3', contractInfo: 'RC' },
                { id: '15000', salary: '1000000', contractYear: '4', contractInfo: '' },
              ],
            },
          },
        }),
    });

    const { GET } = await import('../src/pages/api/contracts/verify');
    const res = await GET({ request: request() } as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.playerCount).toBe(2);
    expect(body.contracts['14056']).toEqual({
      salary: '500000',
      contractYear: '3',
      contractInfo: 'RC',
    });
    expect(mockMflFetch.mock.calls[0][0].mflUserCookie).toBe('test_cookie_value');
    expect(mockMflFetch.mock.calls[0][0].method).toBe('GET');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('502s when MFL answers non-OK', async () => {
    mockMflFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });

    const { GET } = await import('../src/pages/api/contracts/verify');
    const res = await GET({ request: request() } as never);

    expect(res.status).toBe(502);
  });

  it('still gates on auth before touching MFL', async () => {
    mockGetAuthUser.mockReturnValue(null);

    const { GET } = await import('../src/pages/api/contracts/verify');
    const res = await GET({ request: request() } as never);

    expect(res.status).toBe(401);
    expect(mockMflFetch).not.toHaveBeenCalled();
  });

  it('403s a non-commissioner', async () => {
    mockIsCommish.mockReturnValue(false);

    const { GET } = await import('../src/pages/api/contracts/verify');
    const res = await GET({ request: request() } as never);

    expect(res.status).toBe(403);
    expect(mockMflFetch).not.toHaveBeenCalled();
  });
});
