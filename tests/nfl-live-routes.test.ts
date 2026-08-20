/**
 * Route-level behavior tests for the two live NFL feeds.
 *
 * These import the real Astro route handlers and assert on the Response they
 * hand back — status, headers, and body — with `fetch` stubbed. Greps were
 * explicitly avoided: every guard here (no-store, the ok/empty split, the
 * fan-out's partial results) is invisible in the source text once it regresses,
 * which is the lesson from the middleware punctuation-redirect tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildEspnScoreboardUrl, espnSeasonSlot } from '../src/utils/espn-scoreboard-url';

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf-8'));

const SCOREBOARD = fixture('espn-nfl-scoreboard.json');
const SCOREBOARD_LIVE = fixture('espn-nfl-scoreboard-live.json');
const SUMMARY = fixture('espn-game-summary.json');
const PLAYS = fixture('espn-game-plays.json');

const ctx = (search: string) => ({ url: new URL(`https://example.test/api/x${search}`) }) as never;

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const bad = (status: number) =>
  ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

describe('espnSeasonSlot', () => {
  it('maps the regular season straight through', () => {
    expect(espnSeasonSlot(1)).toEqual({ seasonType: 2, week: 1 });
    expect(espnSeasonSlot(18)).toEqual({ seasonType: 2, week: 18 });
  });

  it('maps playoffs to seasontype 3, week 1-4 — NOT weeks 19-22', () => {
    // ESPN restarts the count in the postseason; asking for week=19 returns an
    // empty slate that reads as "no games" rather than as a bug.
    expect(espnSeasonSlot(19)).toEqual({ seasonType: 3, week: 1 });
    expect(espnSeasonSlot(22)).toEqual({ seasonType: 3, week: 4 });
  });

  it('clamps junk to week 1 of the regular season', () => {
    expect(espnSeasonSlot(0)).toEqual({ seasonType: 2, week: 1 });
    expect(espnSeasonSlot(NaN)).toEqual({ seasonType: 2, week: 1 });
  });

  it('builds a URL carrying all three parameters', () => {
    const url = buildEspnScoreboardUrl(espnSeasonSlot(19), 2025);
    expect(url).toContain('week=1');
    expect(url).toContain('seasontype=3');
    expect(url).toContain('dates=2025');
  });
});

describe('GET /api/nfl-scoreboard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const load = async () => (await import('../src/pages/api/nfl-scoreboard')).GET;

  it('never lets a live scoreboard be cached', async () => {
    fetchMock.mockResolvedValue(ok(SCOREBOARD));
    const res = await (await load())(ctx('?week=1&year=2025'));
    // A CDN copy of a live scoreboard is not stale, it is wrong while looking
    // live — and Cloudflare has stamped its own max-age on our responses before.
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('normalizes team codes to the canonical form the logo assets use', async () => {
    fetchMock.mockResolvedValue(ok(SCOREBOARD));
    const body = await (await (await load())(ctx('?week=1&year=2025'))).json();
    expect(body.ok).toBe(true);
    expect(body.games[0].home.code).toBe('PHI');
    expect(body.games[0].away.code).toBe('DAL');
  });

  it('surfaces the live situation — red zone, down & distance, last play', async () => {
    fetchMock.mockResolvedValue(ok(SCOREBOARD_LIVE));
    const body = await (await (await load())(ctx('?week=2&year=2025'))).json();
    const kc = body.games.find((g: any) => g.away.code === 'KC');
    expect(kc.situation).toMatchObject({
      isRedZone: true,
      possession: 'KC',
      shortDownDistanceText: '1st & Goal',
    });
    expect(kc.situation.lastPlay).toContain('T.Kelce');
    // possession is mirrored to the top level for the existing strip markers.
    expect(kc.possession).toBe('KC');
  });

  it('carries no situation for a game that is not in progress', async () => {
    fetchMock.mockResolvedValue(ok(SCOREBOARD));
    const body = await (await (await load())(ctx('?week=1&year=2025'))).json();
    expect(body.games.every((g: any) => !g.situation)).toBe(true);
    expect(body.games.every((g: any) => g.possession === null)).toBe(true);
  });

  it('reports an upstream failure as ok:false, NOT as an empty slate', async () => {
    fetchMock.mockResolvedValue(bad(503));
    const body = await (await (await load())(ctx('?week=1&year=2025'))).json();
    expect(body).toMatchObject({ ok: false, games: [] });
  });

  it('reports a thrown fetch the same way, and still 200s', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    const res = await (await load())(ctx('?week=1&year=2025'));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(false);
  });

  it('distinguishes a genuinely empty slate (ok:true, no games)', async () => {
    fetchMock.mockResolvedValue(ok({ events: [] }));
    const body = await (await (await load())(ctx('?week=1&year=2025'))).json();
    expect(body).toMatchObject({ ok: true, games: [] });
  });

  it('asks ESPN for the postseason slot when the week is past 18', async () => {
    fetchMock.mockResolvedValue(ok({ events: [] }));
    await (await load())(ctx('?week=20&year=2025'));
    expect(String(fetchMock.mock.calls[0][0])).toContain('week=2&seasontype=3');
  });
});

describe('GET /api/nfl-game-detail', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // The route memoizes per event id across invocations by design; a fresh
    // map per test keeps the cases independent.
    (globalThis as any).__nflGameDetailCache = new Map();
  });
  afterEach(() => vi.unstubAllGlobals());

  const load = async () => (await import('../src/pages/api/nfl-game-detail')).GET;

  /** Route every ESPN URL shape to its fixture. */
  const routeFetch = (over: { summary?: () => Response; plays?: () => Response } = {}) =>
    fetchMock.mockImplementation(async (u: string) => {
      const url = String(u);
      if (url.includes('/scoreboard')) return ok(SCOREBOARD);
      if (url.includes('/summary')) return over.summary ? over.summary() : ok(SUMMARY);
      if (url.includes('/plays')) return over.plays ? over.plays() : ok(PLAYS);
      throw new Error(`unexpected fetch ${url}`);
    });

  it('rejects a missing or out-of-range week before any upstream call', async () => {
    routeFetch();
    for (const q of ['', '?week=0', '?week=99', '?week=abc']) {
      const res = await (await load())(ctx(q));
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never lets a live box score be cached', async () => {
    routeFetch();
    const res = await (await load())(ctx('?week=1&year=2025'));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('keys the box score by MFL player id, never by ESPN athlete id', async () => {
    routeFetch();
    const body = await (await (await load())(ctx('?week=1&year=2025'))).json();
    expect(body.ok).toBe(true);
    const ids = Object.keys(body.boxScore);
    expect(ids.length).toBeGreaterThan(0);
    // ESPN athlete ids in the fixture are 7 digits (e.g. CeeDee Lamb 4241389);
    // MFL ids are 4-5. Shipping an ESPN id for joining is the bug this guards.
    expect(ids).not.toContain('4241389');
    expect(ids.every((id) => /^\d{1,6}$/.test(id))).toBe(true);
    for (const line of Object.values<any>(body.boxScore)) {
      expect(line.playerId).toBeTruthy();
      expect(line.nflTeam).toMatch(/^[A-Z]{2,3}$/);
    }
  });

  it('resolves a real player’s stat line end to end', async () => {
    routeFetch();
    const body = await (await (await load())(ctx('?week=1&year=2025'))).json();
    const lamb = Object.values<any>(body.boxScore).find((l) => l.statLine.includes('13 tgt'));
    expect(lamb?.statLine).toBe('7 rec (13 tgt), 110 yds');
    expect(lamb?.nflTeam).toBe('DAL');
  });

  it('returns scoring plays attributed to MFL player ids', async () => {
    routeFetch();
    const body = await (await (await load())(ctx('?week=1&year=2025'))).json();
    expect(body.plays.length).toBeGreaterThan(0);
    const attributed = body.plays.filter((p: any) => p.playerIds.length > 0);
    expect(attributed.length).toBeGreaterThan(0);
    for (const p of body.plays) {
      expect(p.playId).toMatch(/^\d+$/);
      expect(p.playerIds.every((id: string) => /^\d{1,6}$/.test(id))).toBe(true);
    }
  });

  it('does not expand games that have not kicked off', async () => {
    // Every fixture event is final; a pre-game event has an empty box score and
    // no plays, so fetching one is pure cost.
    const pre = {
      events: SCOREBOARD.events.map((e: any) => ({
        ...e,
        competitions: [{ ...e.competitions[0], status: { type: { state: 'pre' } } }],
      })),
    };
    fetchMock.mockImplementation(async (u: string) => {
      if (String(u).includes('/scoreboard')) return ok(pre);
      throw new Error('should not fan out to a pre-game event');
    });
    const body = await (await (await load())(ctx('?week=1&year=2025'))).json();
    expect(body).toMatchObject({ ok: true, gamesRequested: 0, gamesLoaded: 0 });
    expect(body.plays).toEqual([]);
  });

  it('returns PARTIAL results when one game fails — never a blank board', async () => {
    let summaryCalls = 0;
    routeFetch({
      summary: () => {
        summaryCalls += 1;
        // First game's summary dies; the rest must still land.
        return summaryCalls === 1 ? bad(500) : ok(SUMMARY);
      },
    });
    const body = await (await (await load())(ctx('?week=1&year=2025'))).json();
    expect(body.ok).toBe(true);
    expect(body.gamesRequested).toBe(3);
    expect(body.gamesLoaded).toBe(2);
    expect(Object.keys(body.boxScore).length).toBeGreaterThan(0);
  });

  it('reports a lost scoreboard as ok:false rather than an empty slate', async () => {
    fetchMock.mockImplementation(async (u: string) =>
      String(u).includes('/scoreboard') ? bad(503) : ok(SUMMARY),
    );
    const res = await (await load())(ctx('?week=1&year=2025'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, gamesRequested: 0, plays: [] });
    expect(body.boxScore).toEqual({});
  });

  it('memoizes a completed game so repeat viewers do not re-fan-out', async () => {
    routeFetch();
    await (await load())(ctx('?week=1&year=2025'));
    const first = fetchMock.mock.calls.length;
    await (await load())(ctx('?week=1&year=2025'));
    // Second call re-reads the scoreboard (cheap, one request) but serves every
    // per-game expansion from the TTL cache.
    expect(fetchMock.mock.calls.length).toBe(first + 1);
  });

  it('does NOT memoize a partial read — a hiccup must not pin itself in front of everyone', async () => {
    routeFetch({ plays: () => bad(500) });
    await (await load())(ctx('?week=1&year=2025'));
    const first = fetchMock.mock.calls.length;
    await (await load())(ctx('?week=1&year=2025'));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(first + 1);
  });
});
