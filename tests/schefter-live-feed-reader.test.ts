/**
 * The site reads each league's Schefter feed from Redis per request
 * (getSchefterFeed, src/utils/schefter-league-data.ts), falling back to the
 * committed daily snapshot. Pins: live posts appear, a snapshot-only post is
 * kept, Redis down or empty serves the snapshot, and reads are memoized.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisGet = vi.fn();
let redisAvailable = true;
vi.mock('../src/utils/redis-client', () => ({
  getRedis: async () => (redisAvailable ? { get: redisGet } : null),
}));

const {
  getSchefterFeed,
  getBundledSchefterFeed,
  getSchefterFeedIfAny,
  resetLiveFeedMemo,
  LIVE_FEED_TTL_MS,
} = await import('../src/utils/schefter-league-data');
const { getLeagueBySlug } = await import('../src/config/leagues');

const theleague = getLeagueBySlug('theleague')!;
const livePost = { id: 'sf_live_test_post', timestamp: '2099-01-01T00:00:00Z', type: 'external', body: 'x' };

beforeEach(() => {
  redisGet.mockReset();
  redisAvailable = true;
  resetLiveFeedMemo();
});

describe('getSchefterFeed', () => {
  it('serves posts that are only in Redis, merged with the snapshot', async () => {
    const bundled = getBundledSchefterFeed(theleague);
    redisGet.mockResolvedValue({ ...bundled, posts: [livePost] });
    const feed = await getSchefterFeed(theleague);
    expect(feed.posts[0].id).toBe(livePost.id);
    // Nothing that reached only git is lost.
    expect(feed.posts.length).toBe(bundled.posts.length + 1);
  });

  it('accepts the feed as a JSON string too', async () => {
    redisGet.mockResolvedValue(JSON.stringify({ posts: [livePost] }));
    expect((await getSchefterFeed(theleague)).posts.some((p) => p.id === livePost.id)).toBe(true);
  });

  it('serves the snapshot when Redis is empty, unreachable or throws', async () => {
    const bundled = getBundledSchefterFeed(theleague);
    redisGet.mockResolvedValue(null);
    expect(await getSchefterFeed(theleague)).toBe(bundled);

    resetLiveFeedMemo();
    redisAvailable = false;
    expect(await getSchefterFeed(theleague)).toBe(bundled);

    resetLiveFeedMemo();
    redisAvailable = true;
    redisGet.mockRejectedValue(new Error('down'));
    expect(await getSchefterFeed(theleague)).toBe(bundled);
  });

  it('reads Redis once per memo window, then again after it', async () => {
    redisGet.mockResolvedValue({ posts: [livePost] });
    const t0 = 1_000_000;
    await getSchefterFeed(theleague, t0);
    await getSchefterFeed(theleague, t0 + LIVE_FEED_TTL_MS - 1);
    expect(redisGet).toHaveBeenCalledTimes(1);
    await getSchefterFeed(theleague, t0 + LIVE_FEED_TTL_MS);
    expect(redisGet).toHaveBeenCalledTimes(2);
  });

  it('throws for a league that does not run the feed; the tolerant reader does not', async () => {
    const bb = getLeagueBySlug('best-ball-1')!;
    expect(() => getSchefterFeed(bb)).toThrow();
    expect(await getSchefterFeedIfAny(bb)).not.toBeUndefined();
    expect(redisGet).not.toHaveBeenCalled();
  });
});
