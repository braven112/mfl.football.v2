import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Asserts the ACTUAL Response the route hands back — status, body and the exact
 * Cache-Control string — not the source text. CLAUDE.md's middleware post-mortem
 * is the reason: grep-shaped assertions there stayed green through a deleted
 * method gate, a flipped status code and a dropped header.
 */

const checkRateLimit = vi.fn();
const fetchAthleteNews = vi.fn();
const getPlayer = vi.fn();
const getGlobalPlayerMap = vi.fn();

vi.mock('../src/utils/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
}));

vi.mock('../src/utils/player-map', () => ({
  getPlayer: (...args: unknown[]) => getPlayer(...args),
  getGlobalPlayerMap: () => getGlobalPlayerMap(),
}));

vi.mock('../src/utils/player-news', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/player-news')>();
  return { ...actual, fetchAthleteNews: (...args: unknown[]) => fetchAthleteNews(...args) };
});

const { GET } = await import('../src/pages/api/player-news');

const CACHE_OK = 'public, s-maxage=300, stale-while-revalidate=1800';

// Reference the constant rather than a literal — the default limit doubles as
// the number of reserved skeleton rows, so it is tuned as a UI decision.
const { PLAYER_NEWS_DEFAULT_LIMIT, PLAYER_NEWS_MAX_LIMIT } =
  await import('../src/utils/player-news');

function call(query: string, headers: Record<string, string> = {}) {
  const url = new URL(`https://example.test/api/player-news${query}`);
  const request = new Request(url, { headers });
  // Astro hands the route both; the route only reads `request` and `url`.
  return GET({ request, url } as never);
}

beforeEach(() => {
  checkRateLimit.mockReset().mockResolvedValue({ allowed: true, count: 1 });
  // The feed lookup is what keeps college ids out of the NFL athlete endpoint.
  getPlayer.mockReset().mockReturnValue({ nflEspnId: '3139477' });
  getGlobalPlayerMap.mockReset().mockReturnValue(new Map());
  fetchAthleteNews.mockReset().mockResolvedValue({
    espnId: '3139477',
    status: 'ok',
    items: [{ id: '1', headline: 'h', description: 'd', published: null, type: 'Story', link: null }],
    fetchedAt: '2026-08-19T00:00:00.000Z',
  });
});

describe('GET /api/player-news', () => {
  it('returns articles and a cacheable Cache-Control on success', async () => {
    const res = await call('?espnId=3139477');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(CACHE_OK);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.items).toHaveLength(1);
  });

  it('caches an empty result too — ESPN answered, there is just no news', async () => {
    fetchAthleteNews.mockResolvedValue({
      espnId: '3139477', status: 'empty', items: [], fetchedAt: 'x',
    });
    const res = await call('?espnId=3139477');
    expect(res.headers.get('Cache-Control')).toBe(CACHE_OK);
    expect((await res.json()).status).toBe('empty');
  });

  it('NEVER caches an upstream error', async () => {
    // A cached outage pins the broken response in front of every visitor for the
    // whole window. This is the single most important header assertion here.
    fetchAthleteNews.mockResolvedValue({
      espnId: '3139477', status: 'error', items: [], fetchedAt: 'x', reason: 'upstream-status',
    });
    const res = await call('?espnId=3139477');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect((await res.json()).status).toBe('error');
  });

  it('rejects a non-numeric espnId with 400 and never calls upstream', async () => {
    for (const bad of ['../../etc', 'https://evil.test', '12a', '']) {
      fetchAthleteNews.mockClear();
      const res = await call(`?espnId=${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(fetchAthleteNews).not.toHaveBeenCalled();
    }
  });

  it('rejects a missing espnId', async () => {
    const res = await call('');
    expect(res.status).toBe(400);
    expect(fetchAthleteNews).not.toHaveBeenCalled();
  });

  it('clamps an oversized limit before calling upstream', async () => {
    await call('?espnId=3139477&limit=999');
    expect(fetchAthleteNews).toHaveBeenCalledWith('3139477', PLAYER_NEWS_MAX_LIMIT, expect.any(Date));
  });

  it('falls back to the default limit for junk', async () => {
    await call('?espnId=3139477&limit=abc');
    expect(fetchAthleteNews).toHaveBeenCalledWith('3139477', PLAYER_NEWS_DEFAULT_LIMIT, expect.any(Date));
  });

  it('returns an uncacheable 429 when rate limited, without calling upstream', async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, count: 61 });
    const res = await call('?espnId=3139477');
    expect(res.status).toBe(429);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(fetchAthleteNews).not.toHaveBeenCalled();
  });

  it('keys the rate limit on the forwarded client IP', async () => {
    await call('?espnId=3139477', { 'x-forwarded-for': '203.0.113.7, 70.41.3.18' });
    expect(checkRateLimit).toHaveBeenCalledWith('player-news', '203.0.113.7', 60, 60);
  });

  it('degrades to an uncacheable error if the fetch layer throws unexpectedly', async () => {
    fetchAthleteNews.mockRejectedValue(new Error('boom'));
    const res = await call('?espnId=3139477');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect((await res.json()).status).toBe('error');
  });
});

describe('GET /api/player-news — mflId resolution', () => {
  it('resolves an MFL id to the feed\'s NFL espn_id and fetches that', async () => {
    getPlayer.mockReturnValue({ nflEspnId: '4362628' });
    await call('?mflId=13116');
    expect(fetchAthleteNews).toHaveBeenCalledWith('4362628', PLAYER_NEWS_DEFAULT_LIMIT, expect.any(Date));
  });

  it('never uses a college id — a player with no NFL espn_id resolves to empty, not to some other athlete', async () => {
    // resolveEspnId falls back to a COLLEGE athlete id for incoming rookies, and
    // a college id is numerically indistinguishable from an NFL one. The route
    // reads nflEspnId only, so the college id can never reach ESPN.
    getPlayer.mockReturnValue({ espnId: '5083321', nflEspnId: null });
    getGlobalPlayerMap.mockReturnValue(new Map());

    const res = await call('?mflId=16999');
    expect(fetchAthleteNews).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('empty');
  });

  it('falls back to the all-years map when the current feed lacks the player', async () => {
    getPlayer.mockReturnValue(undefined);
    getGlobalPlayerMap.mockReturnValue(new Map([['9999', { nflEspnId: '1257' }]]));
    await call('?mflId=9999');
    expect(fetchAthleteNews).toHaveBeenCalledWith('1257', PLAYER_NEWS_DEFAULT_LIMIT, expect.any(Date));
  });

  it('treats a known player with no ESPN id as empty (cacheable), not as a 400', async () => {
    // Every team DEF and a handful of kickers land here. It is not an error —
    // there is simply nothing to ask ESPN about.
    getPlayer.mockReturnValue({ nflEspnId: null });
    getGlobalPlayerMap.mockReturnValue(new Map());
    const res = await call('?mflId=0511');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(CACHE_OK);
  });

  it('rejects a non-numeric mflId with 400', async () => {
    const res = await call('?mflId=' + encodeURIComponent('../../etc'));
    expect(res.status).toBe(400);
    expect(fetchAthleteNews).not.toHaveBeenCalled();
  });

  it('still accepts a direct espnId for the DEF stand-in', async () => {
    await call('?espnId=3127287');
    expect(fetchAthleteNews).toHaveBeenCalledWith('3127287', PLAYER_NEWS_DEFAULT_LIMIT, expect.any(Date));
  });
});

describe('GET /api/player-news — recency window', () => {
  it('names the window on a no-ESPN-id player, so the note can say what was searched', async () => {
    // This branch never reaches fetchAthleteNews, so the route has to supply
    // windowDays itself — otherwise the modal falls back to a vaguer note for
    // exactly the players who most look broken (every team DEF, some kickers).
    getPlayer.mockReturnValue(undefined);
    getGlobalPlayerMap.mockReturnValue(new Map());
    const res = await call('?mflId=13593&testDate=2026-11-01');
    const body = await res.json();
    expect(body.status).toBe('empty');
    expect(body.windowDays).toBe(30);
  });

  it('honors ?testDate= so the window is verifiable without moving the clock', async () => {
    await call('?espnId=3139477&testDate=2026-11-01');
    const passed = fetchAthleteNews.mock.calls[0][2] as Date;
    expect(passed.getFullYear()).toBe(2026);
    expect(passed.getMonth()).toBe(10);
  });

  it('passes the real clock through when no testDate is given', async () => {
    await call('?espnId=3139477');
    const passed = fetchAthleteNews.mock.calls[0][2] as Date;
    expect(Math.abs(passed.getTime() - Date.now())).toBeLessThan(5000);
  });

  it('a testDate result is still cacheable — it is a distinct URL, not a poisoned one', async () => {
    const res = await call('?espnId=3139477&testDate=2026-11-01');
    expect(res.headers.get('Cache-Control')).toBe(CACHE_OK);
  });
});
