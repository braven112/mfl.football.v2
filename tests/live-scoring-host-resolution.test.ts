/**
 * Which MFL server our league-scoped routes fetch from, driven through the real
 * handlers.
 *
 * Every league lives on a different MFL host, and MFL answers a league id it
 * does not host with that host's own data rather than an error. So pairing
 * one league's `L` with another's host is a silent wrong-data answer — the
 * AFL board quietly rendering TheLeague's scores — which no status check and
 * no `res.ok` catches. The route therefore treats `host` as a HINT and falls
 * back to the registry entry for `L`, never to the default league's host.
 *
 * That fallback is also what lets a caller send `L` alone. The gameday health
 * check depends on it: its probes carried `host=<hostname>`, which reads like
 * an SSRF attempt to a WAF, and both leagues' probes were blocked at the edge
 * with a 403 that never reached this route (2026-09-03).
 *
 * A grep can't hold either line — `resolveHost` returning DEFAULT_HOST for an
 * unrecognized host looks entirely reasonable in isolation — so this asserts
 * on the URL the handler actually fetches.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '../src/pages/api/live-scoring';
import { GET as draftStatusGET } from '../src/pages/api/draft/status';
import { getLeagueBySlug, DEFAULT_LEAGUE } from '../src/config/leagues';

const AFL = getLeagueBySlug('afl-fantasy')!;

const ctx = (search: string) => ({ url: new URL(`https://example.test/api/live-scoring${search}`) }) as never;
const ok = () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response;

describe('GET /api/live-scoring — MFL host resolution', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    // Block body, not an expression: returning vi's own object here is a
    // type error against Awaitable<void>, and this repo ratchets that count.
    vi.unstubAllGlobals();
  });

  /** Hostnames the handler fetched, in call order. */
  async function hostsFetchedFor(search: string): Promise<string[]> {
    await GET(ctx(search));
    return fetchMock.mock.calls.map((c) => new URL(String(c[0])).hostname);
  }

  it('derives the host from `L` when no host param is sent', async () => {
    const hosts = await hostsFetchedFor(`?week=3&L=${AFL.id}`);
    expect(hosts.length).toBeGreaterThan(0);
    expect(new Set(hosts)).toEqual(new Set([AFL.mflHost]));
    expect(hosts).not.toContain(DEFAULT_LEAGUE.mflHost);
  });

  it('honors an explicit registered host', async () => {
    const hosts = await hostsFetchedFor(`?week=3&L=${AFL.id}&host=https://${AFL.mflHost}`);
    expect(new Set(hosts)).toEqual(new Set([AFL.mflHost]));
  });

  it('rejects an off-registry host without falling through to another league', async () => {
    const hosts = await hostsFetchedFor(`?week=3&L=${AFL.id}&host=https://evil.example.com`);
    expect(hosts).not.toContain('evil.example.com');
    expect(new Set(hosts)).toEqual(new Set([AFL.mflHost]));
  });

  it('falls back to the default league only when `L` names no known league', async () => {
    const hosts = await hostsFetchedFor('?week=3');
    expect(new Set(hosts)).toEqual(new Set([DEFAULT_LEAGUE.mflHost]));
  });
});

/**
 * `/api/draft/status` had the identical branch — `resolveMflHost(raw,
 * DEFAULT_HOST)` — and it is reachable the same way: the broadcast board's
 * `?mflLeague=` override is a documented public caller, so a league id can
 * arrive without a matching host. Fixing one route and not the other would
 * leave the trap in place behind a different door.
 */
describe('GET /api/draft/status — MFL host resolution', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function hostsFetchedFor(search: string): Promise<string[]> {
    await draftStatusGET({ url: new URL(`https://example.test/api/draft/status${search}`) } as never);
    return fetchMock.mock.calls.map((c) => new URL(String(c[0])).hostname);
  }

  it('derives the host from the league id when no host param is sent', async () => {
    const hosts = await hostsFetchedFor(`?league=${AFL.id}`);
    expect(hosts.length).toBeGreaterThan(0);
    expect(hosts).not.toContain(DEFAULT_LEAGUE.mflHost);
    expect(new Set(hosts)).toEqual(new Set([AFL.mflHost]));
  });

  it('rejects an off-registry host without falling through to another league', async () => {
    const hosts = await hostsFetchedFor(`?league=${AFL.id}&host=evil.example.com`);
    expect(hosts).not.toContain('evil.example.com');
    expect(new Set(hosts)).toEqual(new Set([AFL.mflHost]));
  });
});
