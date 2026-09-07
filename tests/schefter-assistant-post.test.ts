import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAssistantPost,
  publishAssistantPosts,
  assistantPostId,
} from '../scripts/lib/schefter-assistant-post.mjs';
import { postIsForViewer } from '../src/utils/schefter-watching';

const league = { navSlug: 'theleague', registrySlug: 'theleague' } as any;
const NOW = new Date('2026-10-18T16:20:00.000Z');

const base = {
  league,
  franchiseId: '0001',
  kind: 'lineup',
  week: 6,
  headline: 'Check your lineup',
  body: 'Pacific Pigskins: Nico Collins (WR) is OUT',
  now: NOW,
};

describe('buildAssistantPost', () => {
  /**
   * The For You feed finds these by franchise, not by player — "no lineup
   * submitted" names nobody. Losing franchiseIds makes the post invisible to
   * the one person it is addressed to.
   */
  it('always scopes to exactly the one franchise it is addressed to', () => {
    expect(buildAssistantPost(base).franchiseIds).toEqual(['0001']);
  });

  it('reaches that owner’s For You feed with no player match at all', () => {
    const post = buildAssistantPost({ ...base, headline: 'No lineup submitted', playerIds: [] });
    const empty = { watched: new Set<string>(), roster: new Set<string>(), all: new Set<string>() };
    expect(postIsForViewer(post as any, empty, '0001')).toBe(true);
  });

  it('does not reach anyone else', () => {
    const post = buildAssistantPost(base);
    const empty = { watched: new Set<string>(), roster: new Set<string>(), all: new Set<string>() };
    expect(postIsForViewer(post as any, empty, '0007')).toBe(false);
  });

  it('is the same id on a re-run, and a different one next week', () => {
    expect(buildAssistantPost(base).id).toBe(buildAssistantPost(base).id);
    expect(buildAssistantPost({ ...base, week: 7 }).id).not.toBe(buildAssistantPost(base).id);
  });

  /** Both leagues have a franchise 0001, so the league must be in the id. */
  it('cannot collide across leagues', () => {
    const afl = assistantPostId({ navSlug: 'afl', franchiseId: '0001', kind: 'lineup', week: 6 });
    const tl = assistantPostId({ navSlug: 'theleague', franchiseId: '0001', kind: 'lineup', week: 6 });
    expect(afl).not.toBe(tl);
  });

  it('omits playerIds entirely rather than writing an empty array', () => {
    expect(buildAssistantPost(base)).not.toHaveProperty('playerIds');
    expect(buildAssistantPost({ ...base, playerIds: ['16613'] }).playerIds).toEqual(['16613']);
  });
});

describe('publishAssistantPosts', () => {
  let dir: string;
  let feedPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'assist-'));
    feedPath = join(dir, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({ lastScanTimestamp: '', posts: [] }));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const silent = { log: () => {}, warn: () => {} };

  it('writes each post once and no-ops on a re-run', async () => {
    const posts = [buildAssistantPost(base)];
    const withPath = { ...league, feedPath };

    expect(await publishAssistantPosts({ league: withPath, posts, log: silent })).toBe(1);
    expect(await publishAssistantPosts({ league: withPath, posts, log: silent })).toBe(0);

    const feed = JSON.parse(readFileSync(feedPath, 'utf8'));
    expect(feed.posts).toHaveLength(1);
  });

  it('writes nothing in a dry run', async () => {
    const written = await publishAssistantPosts({
      league: { ...league, feedPath },
      posts: [buildAssistantPost(base)],
      dryRun: true,
      log: silent,
    });
    expect(written).toBe(0);
    expect(JSON.parse(readFileSync(feedPath, 'utf8')).posts).toHaveLength(0);
  });

  /**
   * The caller has already sent the push and the chat post by this point. A
   * feed write that throws must not take the job down with it.
   */
  it('never throws when the feed cannot be written', async () => {
    const written = await publishAssistantPosts({
      league: { ...league, feedPath: join(dir, 'nope', 'missing.json') },
      posts: [buildAssistantPost(base)],
      log: silent,
    });
    expect(written).toBe(0);
  });
});
