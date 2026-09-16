import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { isDuplicate, appendToFeed, _resetArchiveCache } from '../scripts/article-utils/feed-writer.mjs';
import { guardSeason, config } from '../scripts/article-types/schedule-release.mjs';
import { nflWeekStartInstant } from '../src/utils/nfl-week-starts.mjs';

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
    _resetArchiveCache();
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

  it('fails closed on an unreadable archive shard instead of reading "never posted"', async () => {
    mkdirSync(path.join(dir, 'schefter-archive'));
    writeFileSync(path.join(dir, 'schefter-archive', '2026.json'), '[{"id": "sf_2026_sched');
    await expect(isDuplicate(feedPath, ID)).rejects.toThrow();
  });
});

describe('schedule-release is a preseason column', () => {
  it('uses a once-per-season id', () => {
    expect(config.id(2026, 0, 'theleague')).toBe(ID);
  });

  // Compared as instants, so the result cannot depend on the process TZ (the
  // GitHub runner is UTC; a local-midnight kickoff there is 5pm PT the day before).
  const kickoff = nflWeekStartInstant(2026, 1).getTime();

  it('may fire before the 2026 kickoff (Wed Sep 9)', () => {
    expect(guardSeason(0, 2026, new Date('2026-08-23T00:52:00Z'))).toBe(true);
    expect(guardSeason(0, 2026, new Date('2026-09-08T20:00:00-07:00'))).toBe(true);
    expect(guardSeason(0, 2026, new Date(kickoff - 60_000))).toBe(true);
  });

  it('refuses once the season has kicked off', () => {
    expect(guardSeason(0, 2026, new Date(kickoff))).toBe(false);
    expect(guardSeason(0, 2026, new Date('2026-09-15T20:48:52Z'))).toBe(false);
  });
});


/**
 * F1 — the WRITE-time check has to read the archive too.
 *
 * `isDuplicate` is a pre-flight that only the weekly-article runner calls. The
 * other two writers — schefter-announce.mjs and lib/schefter-assistant-post.mjs
 * — go straight to `appendToFeed`, and both gate a side effect on its return
 * value (announce sends GroupMe only when it wrote). Against the live feed
 * alone that gate silently expires: `sf_announce_dark-mode` had already rotated
 * into src/data/theleague/schefter-archive/2026.json by Sept 2026, so re-running
 * that slug would have written a second post AND buzzed the chat a second time.
 */
describe('appendToFeed refuses an id that only survives in the archive', () => {
  let dir: string;
  let feedPath: string;

  const post = (id: string) => ({ id, timestamp: '2026-09-15T20:48:52.000Z', headline: id, body: id });

  beforeEach(() => {
    _resetArchiveCache();
    dir = mkdtempSync(path.join(tmpdir(), 'schefter-append-'));
    feedPath = path.join(dir, 'schefter-feed.json');
    writeFileSync(feedPath, JSON.stringify({ posts: [] }));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes an id that was never published', async () => {
    expect(await appendToFeed(feedPath, post('sf_announce_brand-new'))).toBe(true);
    expect(JSON.parse(readFileSync(feedPath, 'utf8')).posts).toHaveLength(1);
  });

  it('refuses a second write of the same id while it is still live', async () => {
    await appendToFeed(feedPath, post('sf_announce_dark-mode'));
    expect(await appendToFeed(feedPath, post('sf_announce_dark-mode'))).toBe(false);
  });

  it('refuses an id that has rotated out of the live feed into the archive', async () => {
    mkdirSync(path.join(dir, 'schefter-archive'));
    writeFileSync(
      path.join(dir, 'schefter-archive', '2026.json'),
      JSON.stringify([{ id: 'sf_announce_dark-mode' }]),
    );
    expect(await appendToFeed(feedPath, post('sf_announce_dark-mode'))).toBe(false);
    expect(JSON.parse(readFileSync(feedPath, 'utf8')).posts).toHaveLength(0);
  });

  it('fails closed on an unreadable shard rather than writing a duplicate', async () => {
    mkdirSync(path.join(dir, 'schefter-archive'));
    writeFileSync(path.join(dir, 'schefter-archive', '2026.json'), '[{"id": "sf_ann');
    await expect(appendToFeed(feedPath, post('sf_announce_dark-mode'))).rejects.toThrow();
  });
});

/**
 * The two lanes that never call `isDuplicate`. If either one grows its own
 * dedup, or stops gating its side effect on the write, the archive check above
 * stops protecting it — and neither failure is visible in a unit test of the
 * lane itself.
 */
describe('the announce and assistant lanes rely on appendToFeed alone', () => {
  const announce = readFileSync('scripts/schefter-announce.mjs', 'utf8');
  const assistant = readFileSync('scripts/lib/schefter-assistant-post.mjs', 'utf8');

  it('announce still gates its GroupMe send on the feed write', () => {
    expect(announce).toMatch(/written = await appendToFeed\(/);
    expect(announce).toMatch(/if \(sendGroupMeFlag && written\)/);
  });

  it('neither lane has grown a second, live-feed-only dedup', () => {
    for (const src of [announce, assistant]) {
      expect(src).not.toMatch(/feed\.posts\.some\(/);
    }
  });

  // NOTE: that the assistant id carries the season is NOT asserted here.
  // Scanning the template literal would be a second, weaker copy of
  // tests/schefter-assistant-post.test.ts, which proves it behaviourally —
  // 2026's and 2027's week-6 ids differ, and a missing year throws.
});

/**
 * F4 — `--week` may only waive the season guard for a type whose id actually
 * varies by week. For the rest it changes nothing about the article, so a
 * bypass is a silent lever for publishing the preseason schedule column in
 * December. The runner derives this from `config.id`; this table is what makes
 * an id change that flips a type visible.
 */
describe('--week only waives the guard where the week is part of the id', () => {
  const WEEK_SCOPED = ['matchup-preview', 'schedule-strength', 'waiver-pickups', 'weekend-preview', 'weekly-recap'];
  const NOT_WEEK_SCOPED = ['championship-recap', 'cut-watch', 'draft-grades', 'schedule-release', 'team-grades'];

  it('covers every article type — a new one must be classified here', () => {
    const types = readdirSync('scripts/article-types')
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => f.replace(/\.mjs$/, ''))
      .sort();
    expect(types).toEqual([...WEEK_SCOPED, ...NOT_WEEK_SCOPED].sort());
  });

  it.each(WEEK_SCOPED)('%s: id varies by week', async (type) => {
    const mod = await import(`../scripts/article-types/${type}.mjs`);
    expect(mod.config.id(2026, 1, 'theleague')).not.toBe(mod.config.id(2026, 2, 'theleague'));
  });

  it.each(NOT_WEEK_SCOPED)('%s: id ignores the week', async (type) => {
    const mod = await import(`../scripts/article-types/${type}.mjs`);
    expect(mod.config.id(2026, 1, 'theleague')).toBe(mod.config.id(2026, 2, 'theleague'));
  });

  it('the runner derives the waiver from the id, not from a per-type flag', () => {
    const src = readFileSync('scripts/schefter-weekly-articles.mjs', 'utf8');
    expect(src).toMatch(
      /const idVariesByWeek = mod\.config\.id\(year, 1, league\) !== mod\.config\.id\(year, 2, league\);/,
    );
    expect(src).toMatch(/opts\.week != null && idVariesByWeek/);
    // The unconditional bypass that shipped the risk.
    expect(src).not.toMatch(/opts\.week != null\s*\n?\s*\?\s*true/);
  });
});

/**
 * F2 — the retract script has to LEAVE the tombstone, or mergeFeed has nothing
 * to filter on. The tombstone's behaviour is pinned in
 * tests/merge-schefter-feed.test.ts; what cannot be reached behaviourally is
 * this script, which is a top-level-await CLI bound to the real registry
 * paths. Scanned instead of executed.
 */
describe('schefter-retract-post records the tombstone', () => {
  const src = readFileSync('scripts/schefter-retract-post.mjs', 'utf8');

  it('writes retractedIds onto the live feed', () => {
    expect(src).toMatch(/retractedIds: nextTombstones/);
    expect(src).toMatch(/const isLiveFeed = file === league\.feedPath;/);
  });

  it('does not put a tombstone on an archive shard, which has nowhere to keep it', () => {
    expect(src).toMatch(/\.\.\.\(isLiveFeed \? \{ retractedIds: nextTombstones \} : \{\}\)/);
  });

  /**
   * --feed-only is the DUPLICATE case: the archived original stays, and the id
   * must still be barred from the live feed. A tombstone written only on a
   * full retraction would leave exactly the incident case unprotected.
   */
  it('is not conditioned on --feed-only', () => {
    const block = src.slice(src.indexOf('const isLiveFeed'), src.indexOf('const missing'));
    expect(block).not.toMatch(/FEED_ONLY/);
  });

  it('still writes when this run removed nothing, so a re-run re-asserts the bar', () => {
    expect(src).toMatch(/if \(removed === 0 && tombstonesAdded === 0\) continue;/);
  });
});
