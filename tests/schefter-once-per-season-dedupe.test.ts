import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDuplicate } from '../scripts/article-utils/feed-writer.mjs';
import { guardSeason, config } from '../scripts/article-types/schedule-release.mjs';

/**
 * Once-per-season Schefter articles must not re-publish after the original
 * rotates out of the live feed.
 *
 * 2026-09-15: the weekly archiver moved `sf_2026_schedule_release_theleague`
 * (posted Aug 23) into schefter-archive/2026.json at 14:57 UTC. The 18:00 UTC
 * schedule-release cron checked the live feed only, found nothing, and posted
 * the column to GroupMe again — six days into the NFL season.
 */

const ID = 'sf_2026_schedule_release_theleague';

describe('isDuplicate reads the season archive', () => {
  let dir: string;
  let feedPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'schefter-dedupe-'));
    feedPath = path.join(dir, 'schefter-feed.json');
    writeFileSync(feedPath, JSON.stringify({ posts: [{ id: 'sf_other' }] }));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is false when the id is nowhere', async () => {
    expect(await isDuplicate(feedPath, ID)).toBe(false);
  });

  it('is true when the id is in the live feed', async () => {
    writeFileSync(feedPath, JSON.stringify({ posts: [{ id: ID }] }));
    expect(await isDuplicate(feedPath, ID)).toBe(true);
  });

  it('is true when the original was archived (bare-array shard)', async () => {
    mkdirSync(path.join(dir, 'schefter-archive'));
    writeFileSync(path.join(dir, 'schefter-archive', '2026.json'), JSON.stringify([{ id: ID }]));
    expect(await isDuplicate(feedPath, ID)).toBe(true);
  });

  it('is true for an archive shard shaped { posts }', async () => {
    mkdirSync(path.join(dir, 'schefter-archive'));
    writeFileSync(path.join(dir, 'schefter-archive', '2027.json'), JSON.stringify({ posts: [{ id: ID }] }));
    expect(await isDuplicate(feedPath, ID)).toBe(true);
  });
});

describe('schedule-release is a preseason column', () => {
  it('uses a once-per-season id', () => {
    expect(config.id(2026, 0, 'theleague')).toBe(ID);
  });

  it('may fire before the 2026 kickoff (Wed Sep 9)', () => {
    expect(guardSeason(0, 2026, new Date('2026-08-23T00:52:00Z'))).toBe(true);
    expect(guardSeason(0, 2026, new Date('2026-09-08T20:00:00-07:00'))).toBe(true);
  });

  it('refuses once the season has kicked off', () => {
    expect(guardSeason(0, 2026, new Date('2026-09-09T12:00:00-07:00'))).toBe(false);
    expect(guardSeason(0, 2026, new Date('2026-09-15T20:48:52Z'))).toBe(false);
  });
});
