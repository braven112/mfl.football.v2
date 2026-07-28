import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getStandingsFeedWithLiveRefresh,
  __resetLiveStandingsCacheForTests,
  type StandingsFeed,
} from '../src/utils/live-standings';
import { getCurrentSeasonYear } from '../src/utils/league-year';
import { getLeagueBySlug } from '../src/config/leagues';

const league = getLeagueBySlug('theleague')!;
const currentYear = getCurrentSeasonYear();

const committedFeed: StandingsFeed = {
  version: '1.0',
  leagueStandings: {
    franchise: [
      { id: '0001', h2hw: '3', pf: '321.5' },
      { id: '0002', h2hw: '1', pf: '280.0' },
    ],
  },
};

const liveFranchises = [
  { id: '0001', h2hw: '4', pf: '410.2' },
  { id: '0002', h2hw: '1', pf: '295.7' },
];

function okJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getStandingsFeedWithLiveRefresh', () => {
  beforeEach(() => {
    __resetLiveStandingsCacheForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('falls back to the committed feed when the live fetch fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getStandingsFeedWithLiveRefresh({
      league,
      year: currentYear,
      committedFeed,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.feed).toBe(committedFeed);
    expect(result.live).toBe(false);
    expect(result.fetchedAt).toBeNull();
  });

  it('falls back to the committed feed on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503 })));

    const result = await getStandingsFeedWithLiveRefresh({
      league,
      year: currentYear,
      committedFeed,
    });

    expect(result.feed).toBe(committedFeed);
    expect(result.live).toBe(false);
  });

  it('falls back to the committed feed on a malformed/empty payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJsonResponse({ unexpected: true })));

    const result = await getStandingsFeedWithLiveRefresh({
      league,
      year: currentYear,
      committedFeed,
    });

    expect(result.feed).toBe(committedFeed);
    expect(result.live).toBe(false);
  });

  it('falls back to the committed feed on an MFL error payload (HTTP 200 + error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okJsonResponse({ error: 'Invalid league.' }))
    );

    const result = await getStandingsFeedWithLiveRefresh({
      league,
      year: currentYear,
      committedFeed,
    });

    expect(result.feed).toBe(committedFeed);
    expect(result.live).toBe(false);
  });

  it('never fetches for historical years — the committed feed is authoritative', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await getStandingsFeedWithLiveRefresh({
      league,
      year: currentYear - 1,
      committedFeed,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.feed).toBe(committedFeed);
    expect(result.live).toBe(false);
    expect(result.fetchedAt).toBeNull();
  });

  it('returns live data on success and hits the MFL export API with registry values', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJsonResponse({ leagueStandings: { franchise: liveFranchises } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getStandingsFeedWithLiveRefresh({
      league,
      year: currentYear,
      committedFeed,
    });

    expect(result.live).toBe(true);
    expect(result.fetchedAt).toBeInstanceOf(Date);
    expect(result.feed?.leagueStandings?.franchise).toEqual(liveFranchises);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(`https://${league.mflHost}/${currentYear}/export`);
    expect(url).toContain('TYPE=leagueStandings');
    expect(url).toContain(`L=${league.id}`);
    expect(url).toContain('JSON=1');
  });

  it('serves the TTL cache on a second call and refetches after expiry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJsonResponse({ leagueStandings: { franchise: liveFranchises } }));
    vi.stubGlobal('fetch', fetchMock);

    let nowMs = 1_000_000;
    const now = () => nowMs;

    await getStandingsFeedWithLiveRefresh({ league, year: currentYear, committedFeed, now });
    nowMs += 30_000; // inside the 60s TTL
    const cachedResult = await getStandingsFeedWithLiveRefresh({
      league,
      year: currentYear,
      committedFeed,
      now,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cachedResult.live).toBe(true);

    nowMs += 61_000; // past the TTL
    await getStandingsFeedWithLiveRefresh({ league, year: currentYear, committedFeed, now });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('after a failure, cools down (no refetch) then retries once the cooldown passes', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(okJsonResponse({ leagueStandings: { franchise: liveFranchises } }));
    vi.stubGlobal('fetch', fetchMock);

    let nowMs = 5_000_000;
    const now = () => nowMs;

    const failed = await getStandingsFeedWithLiveRefresh({
      league,
      year: currentYear,
      committedFeed,
      now,
    });
    expect(failed.live).toBe(false);

    nowMs += 10_000; // inside the 30s failure cooldown
    const duringCooldown = await getStandingsFeedWithLiveRefresh({
      league,
      year: currentYear,
      committedFeed,
      now,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(duringCooldown.live).toBe(false);
    expect(duringCooldown.feed).toBe(committedFeed);

    nowMs += 31_000; // past the cooldown
    const recovered = await getStandingsFeedWithLiveRefresh({
      league,
      year: currentYear,
      committedFeed,
      now,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(recovered.live).toBe(true);
  });

  it('normalizes a single-franchise payload to an array (MFL collapses singletons)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okJsonResponse({ leagueStandings: { franchise: liveFranchises[0] } })
      )
    );

    const result = await getStandingsFeedWithLiveRefresh({
      league,
      year: currentYear,
      committedFeed,
    });

    expect(result.live).toBe(true);
    expect(result.feed?.leagueStandings?.franchise).toEqual([liveFranchises[0]]);
  });
});
