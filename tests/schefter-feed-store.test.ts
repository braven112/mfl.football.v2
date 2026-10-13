/**
 * The Schefter feed lives in Redis; git holds a daily snapshot
 * (scripts/lib/schefter-feed-store.mjs). These pin the store's merge, lock and
 * pull behaviour against an in-memory stand-in for the Upstash REST API, and
 * the commit step's rule that a feed Redis took is left out of the commit
 * while one it refused is committed exactly as before.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  feedKey,
  feedLeagues,
  leagueForFeedPath,
  mergeFeedIntoRedis,
  pullFeedFile,
  readFeedFromRedis,
} from '../scripts/lib/schefter-feed-store.mjs';
import { publishFeedsToRedis } from '../scripts/commit-feed-and-push.mjs';
import { lastSnapshotMs, snapshotDue } from '../scripts/schefter-feed-sync.mjs';
import { withLiveFeed } from '../src/utils/transaction-stories';

const REDIS = { url: 'https://redis.test', token: 't' };

/** Enough of GET / SET [NX EX] / EVAL(compare-and-del) for the store. */
function fakeRedis() {
  const data = new Map<string, string>();
  const calls: string[][] = [];
  const command = async (_redis: unknown, args: string[]) => {
    calls.push(args);
    const [op, key, value, ...rest] = args;
    if (op === 'GET') return data.get(key) ?? null;
    if (op === 'SET') {
      if (rest.includes('NX') && data.has(key)) return null;
      data.set(key, value);
      return 'OK';
    }
    if (op === 'EVAL') {
      const [, , , lock, token] = args;
      if (data.get(lock) === token) {
        data.delete(lock);
        return 1;
      }
      return 0;
    }
    throw new Error(`unexpected command ${op}`);
  };
  return { data, calls, command };
}

const post = (id: string, ts: string) => ({ id, timestamp: ts, type: 'external', body: id });
const feed = (...posts: ReturnType<typeof post>[]) => ({
  lastScanTimestamp: '2026-10-11T10:00:00Z',
  lastProcessedMflTimestamp: '1',
  posts,
});

const tmpDirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-store-'));
  tmpDirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('feed store registry wiring', () => {
  it('covers every league that runs the feed, and only those', () => {
    const slugs = feedLeagues().map((l) => l.slug);
    expect(slugs).toContain('theleague');
    expect(slugs).toContain('afl-fantasy');
    expect(slugs).not.toContain('best-ball-1'); // has a feed file, but schefterFeed is off
  });

  it('maps a committed feed path back to its league', () => {
    expect(leagueForFeedPath('src/data/theleague/schefter-feed.json')?.slug).toBe('theleague');
    expect(leagueForFeedPath('./data/afl-fantasy/schefter-feed.json')?.slug).toBe('afl-fantasy');
    expect(leagueForFeedPath('data/afl-fantasy/resolved-events.json')).toBeNull();
  });

  it('keys each league separately, TheLeague on its legacy unprefixed key', () => {
    expect(feedKey('theleague')).toBe('schefter:feed:live');
    expect(feedKey('afl-fantasy')).toBe('schefter:afl:feed:live');
  });
});

describe('mergeFeedIntoRedis', () => {
  it('seeds an empty key, then unions a second writer in without losing a post', async () => {
    const r = fakeRedis();
    await mergeFeedIntoRedis(REDIS, 'theleague', feed(post('a', '2026-10-11T09:00:00Z')), r.command);
    const second = await mergeFeedIntoRedis(REDIS, 'theleague', feed(post('b', '2026-10-11T10:00:00Z')), r.command);
    expect(second.written).toBe(true);
    const live = await readFeedFromRedis(REDIS, 'theleague', r.command);
    expect(live.posts.map((p: { id: string }) => p.id)).toEqual(['b', 'a']);
  });

  it('writes nothing when Redis already holds everything ours carries', async () => {
    const r = fakeRedis();
    const f = feed(post('a', '2026-10-11T09:00:00Z'));
    await mergeFeedIntoRedis(REDIS, 'theleague', f, r.command);
    const sets = () => r.calls.filter((c) => c[0] === 'SET' && c[1] === feedKey('theleague')).length;
    const before = sets();
    const again = await mergeFeedIntoRedis(REDIS, 'theleague', f, r.command);
    expect(again.written).toBe(false);
    expect(sets()).toBe(before);
  });

  it('releases its lock, so the next writer is not kept waiting', async () => {
    const r = fakeRedis();
    await mergeFeedIntoRedis(REDIS, 'theleague', feed(post('a', '2026-10-11T09:00:00Z')), r.command);
    expect([...r.data.keys()].some((k) => k.endsWith('feed:lock'))).toBe(false);
  });

  it('releases the lock even when the write fails', async () => {
    const r = fakeRedis();
    const failing = async (redis: unknown, args: string[]) => {
      if (args[0] === 'SET' && args[1] === feedKey('theleague')) throw new Error('boom');
      return r.command(redis, args);
    };
    await expect(mergeFeedIntoRedis(REDIS, 'theleague', feed(), failing)).rejects.toThrow('boom');
    expect([...r.data.keys()].some((k) => k.endsWith('feed:lock'))).toBe(false);
  });
});

describe('pullFeedFile', () => {
  it('brings the file up to Redis and keeps a post that reached only git', async () => {
    const r = fakeRedis();
    await mergeFeedIntoRedis(REDIS, 'theleague', feed(post('live', '2026-10-11T10:00:00Z')), r.command);
    const file = path.join(tmp(), 'schefter-feed.json');
    fs.writeFileSync(file, JSON.stringify(feed(post('git-only', '2026-10-11T08:00:00Z'))));
    expect(await pullFeedFile(REDIS, 'theleague', file, r.command)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk.posts.map((p: { id: string }) => p.id)).toEqual(['live', 'git-only']);
    expect(await pullFeedFile(REDIS, 'theleague', file, r.command)).toBe(false);
  });

  it('leaves the file alone when Redis holds nothing yet', async () => {
    const r = fakeRedis();
    const file = path.join(tmp(), 'schefter-feed.json');
    fs.writeFileSync(file, '{"posts":[]}');
    expect(await pullFeedFile(REDIS, 'theleague', file, r.command)).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"posts":[]}');
  });
});

describe('publishFeedsToRedis (commit-feed-and-push)', () => {
  const feedPath = 'src/data/theleague/schefter-feed.json';
  const changes = [{ path: feedPath }, { path: 'data/afl-fantasy/resolved-events.json' }];

  it('returns only the feeds Redis took; everything else is committed', async () => {
    const merge = async () => ({ written: true, feed: { posts: [] } });
    const published = await publishFeedsToRedis(changes, { redis: REDIS, merge });
    expect([...published.keys()]).toEqual([feedPath]);
  });

  it('commits a feed to git when its Redis write fails', async () => {
    const merge = async () => {
      throw new Error('redis down');
    };
    const published = await publishFeedsToRedis(changes, { redis: REDIS, merge });
    expect(published.size).toBe(0);
  });

  it('publishes nothing without Redis credentials (the old git-only path)', async () => {
    const published = await publishFeedsToRedis(changes, { redis: null });
    expect(published.size).toBe(0);
  });
});

describe('daily snapshot cadence', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');
  it('is due a day after the last feed commit, and when there has never been one', () => {
    expect(snapshotDue(now - 23 * 3600_000, now)).toBe(false);
    expect(snapshotDue(now - 24 * 3600_000, now)).toBe(true);
    expect(snapshotDue(0, now)).toBe(true);
  });

  it('reads the newest commit touching the feed paths', () => {
    const seen: string[][] = [];
    const ms = lastSnapshotMs(['a.json'], (args: string[]) => {
      seen.push(args);
      return '1760000000\n';
    });
    expect(ms).toBe(1760000000 * 1000);
    expect(seen[0]).toEqual(['log', '-1', '--format=%ct', '--', 'a.json']);
    expect(lastSnapshotMs(['a.json'], () => '')).toBe(0);
  });
});

describe('withLiveFeed (transactions stories)', () => {
  it('answers the active feed from the live loader and leaves the archives alone', async () => {
    const archive = async () => ({ default: [{ id: 'old' }] });
    const glob = {
      '../../data/x/schefter-feed.json': async () => ({ default: { posts: [{ id: 'snapshot' }] } }),
      '../../data/x/schefter-archive/2025.json': archive,
    };
    const live = { posts: [{ id: 'live' }] };
    const out = withLiveFeed(glob, async () => live);
    expect(await out['../../data/x/schefter-feed.json']()).toBe(live);
    expect(out['../../data/x/schefter-archive/2025.json']).toBe(archive);
  });
});
