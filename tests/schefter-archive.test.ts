/**
 * schefter-archive.mjs — the weekly feed archiver.
 *
 * Contract under test: the active feed keeps the newest SCHEFTER_ACTIVE_MAX
 * posts, the watermark is strictly older than every remaining active post
 * (mergeFeed drops posts at/before it — a tie across the boundary would
 * silently delete an active post on the next merge), undated posts are never
 * archived, and archive files union by id so re-runs are safe.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planArchive, archiveFeedFile } from '../scripts/lib/schefter-archive.mjs';
import { mergeFeed, toEpochMs } from '../scripts/lib/merge-schefter-feed.mjs';

const post = (id: string, timestamp?: string) => ({ id, timestamp, headline: id });

const isoAt = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString();

describe('planArchive', () => {
  it('keeps feeds within the cap untouched', () => {
    const feed = { posts: [post('a', isoAt(2)), post('b', isoAt(1))] };
    const { archivedCount, feed: next } = planArchive(feed, 5);
    expect(archivedCount).toBe(0);
    expect(next).toBe(feed);
  });

  it('archives the oldest overflow and stamps a sound watermark', () => {
    const posts = Array.from({ length: 10 }, (_, i) => post(`p${i}`, isoAt(100 - i)));
    const { feed: next, archivedByYear, archivedCount } = planArchive({ posts }, 6);
    expect(archivedCount).toBe(4);
    expect(next.posts.map((p: any) => p.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
    const cutoff = toEpochMs(next.archivedThroughTimestamp);
    for (const p of next.posts) {
      expect(toEpochMs(p.timestamp)).toBeGreaterThan(cutoff);
    }
    const archived = [...archivedByYear.values()].flat();
    for (const p of archived) {
      expect(toEpochMs(p.timestamp)).toBeLessThanOrEqual(cutoff);
    }
  });

  it('never splits identical timestamps across the boundary', () => {
    const tied = isoAt(50);
    const posts = [post('a', isoAt(60)), post('b', tied), post('c', tied), post('d', isoAt(40))];
    // cap 2 would put b active and c archived with the same timestamp —
    // planArchive must widen the active window instead.
    const { feed: next, archivedCount } = planArchive({ posts }, 2);
    expect(archivedCount).toBe(1);
    expect(next.posts.map((p: any) => p.id)).toEqual(['a', 'b', 'c']);
    expect(next.archivedThroughTimestamp).toBe(isoAt(40));
  });

  it('never archives undated posts', () => {
    const posts = [post('a', isoAt(3)), post('b', isoAt(2)), post('c', isoAt(1)), { id: 'undated' }];
    const { feed: next, archivedCount } = planArchive({ posts }, 2);
    expect(archivedCount).toBe(1);
    expect(next.posts.map((p: any) => p.id)).toEqual(['a', 'b', 'undated']);
  });

  it('a post-archive feed survives a merge with its own pre-archive copy intact', () => {
    // The end-to-end race: archiver rewrites the feed, then a scan job holding
    // the pre-archive copy merges against it. Nothing archived comes back;
    // nothing active is lost.
    const posts = Array.from({ length: 8 }, (_, i) => post(`p${i}`, isoAt(100 - i)));
    const preArchive = { posts };
    const { feed: postArchive } = planArchive(preArchive, 5);
    const merged = mergeFeed(preArchive, postArchive);
    expect(merged.posts.map((p: any) => p.id)).toEqual(postArchive.posts.map((p: any) => p.id));
  });
});

describe('archiveFeedFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schefter-archive-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeFeed = (posts: unknown[]) => {
    const feedPath = path.join(dir, 'schefter-feed.json');
    fs.writeFileSync(feedPath, JSON.stringify({ lastScanTimestamp: 'x', posts }, null, 2));
    return feedPath;
  };

  it('writes per-year archive files and shrinks the feed', () => {
    const posts = [
      post('new1', '2026-08-01T00:00:00Z'),
      post('new2', '2026-07-01T00:00:00Z'),
      post('old26', '2026-01-05T00:00:00Z'),
      post('old25', '2025-11-01T00:00:00Z'),
    ];
    const feedPath = writeFeed(posts);
    const result = archiveFeedFile(feedPath, { max: 2 });
    expect(result.archivedCount).toBe(2);

    const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));
    expect(feed.posts.map((p: any) => p.id)).toEqual(['new1', 'new2']);
    expect(feed.lastScanTimestamp).toBe('x');

    const y2026 = JSON.parse(fs.readFileSync(path.join(dir, 'schefter-archive/2026.json'), 'utf8'));
    const y2025 = JSON.parse(fs.readFileSync(path.join(dir, 'schefter-archive/2025.json'), 'utf8'));
    expect(y2026.map((p: any) => p.id)).toEqual(['old26']);
    expect(y2025.map((p: any) => p.id)).toEqual(['old25']);
  });

  it('re-runs are idempotent and archive files union by id', () => {
    const feedPath = writeFeed([
      post('a', '2026-08-01T00:00:00Z'),
      post('b', '2026-06-01T00:00:00Z'),
      post('c', '2026-05-01T00:00:00Z'),
    ]);
    archiveFeedFile(feedPath, { max: 2 });
    // Second run: feed now has 2 posts, nothing more to archive.
    const second = archiveFeedFile(feedPath, { max: 2 });
    expect(second.archivedCount).toBe(0);
    // Simulate a resurrected post being re-archived: c comes back, run again.
    const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));
    feed.posts.push(post('c', '2026-05-01T00:00:00Z'));
    fs.writeFileSync(feedPath, JSON.stringify(feed, null, 2));
    archiveFeedFile(feedPath, { max: 2 });
    const y2026 = JSON.parse(fs.readFileSync(path.join(dir, 'schefter-archive/2026.json'), 'utf8'));
    expect(y2026.filter((p: any) => p.id === 'c')).toHaveLength(1);
  });

  it('dry-run touches nothing', () => {
    const feedPath = writeFeed([
      post('a', '2026-08-01T00:00:00Z'),
      post('b', '2026-06-01T00:00:00Z'),
      post('c', '2026-05-01T00:00:00Z'),
    ]);
    const before = fs.readFileSync(feedPath, 'utf8');
    const result = archiveFeedFile(feedPath, { max: 2, dryRun: true });
    expect(result.archivedCount).toBe(1);
    expect(fs.readFileSync(feedPath, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(dir, 'schefter-archive'))).toBe(false);
  });
});
