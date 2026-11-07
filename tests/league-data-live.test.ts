import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LEAGUE_DATA_SCHEMA,
  LIVE_CHECK_INTERVAL_MS,
  LIVE_MAX_AGE_MS,
  composeFiles,
  globToRegExp,
  parsePointer,
  pointerIsStale,
} from '../src/config/league-data-live.mjs';
import {
  __setLeagueDataManifestForTests,
  __setLeaguePointerReaderForTests,
  getLeagueData,
  leagueDataVersion,
  listLeagueData,
  loadLeagueData,
  onLeagueDataChange,
  refreshLeagueData,
} from '../src/utils/league-data';
import { buildOverlay, makePointer, planHydrate, planRollback } from '../scripts/lib/league-data-live-ops.mjs';

/**
 * The live league-data pointer (plan "Data syncs without a Vercel build",
 * phase 1): a data sync moves what the site reads without a deploy.
 */

const h = (c: string) => c.repeat(32);
const OVERLAY = h('f');
const PATTERNS = ['data/x/mfl-feeds/**'];

const pointer = (over: Record<string, unknown> = {}) => ({
  schema: LEAGUE_DATA_SCHEMA,
  overlay: OVERLAY,
  patterns: PATTERNS,
  publishedAt: '2026-11-07T12:00:00.000Z',
  source: 'roster-sync',
  ...over,
});

describe('parsePointer', () => {
  it('accepts a pointer, as an object or as a JSON string', () => {
    expect(parsePointer(pointer())).toEqual(pointer());
    expect(parsePointer(JSON.stringify(pointer()))).toEqual(pointer());
  });

  it('refuses anything malformed, so a bad write serves the deploy instead of breaking pages', () => {
    for (const bad of [
      null,
      'not json',
      42,
      pointer({ schema: '1' }),
      pointer({ overlay: 'abc' }),
      pointer({ overlay: h('G') }),
      pointer({ patterns: 'data/**' }),
      pointer({ patterns: [''] }),
      pointer({ publishedAt: undefined }),
    ]) {
      expect(parsePointer(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('composeFiles', () => {
  it('takes the patterns from the overlay — including a file the sync deleted — and the rest from the deploy', () => {
    const built = {
      'data/x/mfl-feeds/2026/rosters.json': h('1'),
      'data/x/mfl-feeds/2026/gone.json': h('2'),
      'data/x/config.json': h('3'),
    };
    const overlay = {
      'data/x/mfl-feeds/2026/rosters.json': h('4'),
      'data/x/mfl-feeds/2026/new.json': h('5'),
      // Outside the patterns: the overlay does not own it, so it is ignored.
      'data/x/config.json': h('6'),
    };
    expect(composeFiles(built, overlay, PATTERNS)).toEqual({
      'data/x/config.json': h('3'),
      'data/x/mfl-feeds/2026/rosters.json': h('4'),
      'data/x/mfl-feeds/2026/new.json': h('5'),
    });
  });

  it('reads globs the way the rest of the store does', () => {
    expect(globToRegExp('data/*/derived/**').test('data/afl-fantasy/derived/a/b.json')).toBe(true);
    expect(globToRegExp('src/data/mfl-player-salaries-*.json').test('src/data/x/mfl-player-salaries-2026.json')).toBe(
      false,
    );
  });
});

describe('the loader under a live pointer', () => {
  const realFetch = globalThis.fetch;
  let blobs: Record<string, unknown>;
  let fetched: string[];

  beforeEach(() => {
    fetched = [];
    blobs = {
      [h('1')]: { v: 'deploy rosters' },
      [h('3')]: { v: 'config' },
      [h('4')]: { v: 'synced rosters' },
      [OVERLAY]: { files: { 'data/x/mfl-feeds/2026/rosters.json': h('4') } },
    };
    globalThis.fetch = (async (url: string) => {
      fetched.push(String(url));
      const hash = String(url).match(/([0-9a-f]{32})\.json$/)?.[1] ?? '';
      return hash in blobs ? new Response(JSON.stringify(blobs[hash])) : new Response('nope', { status: 404 });
    }) as typeof fetch;
    __setLeagueDataManifestForTests({
      base: 'https://store.example/',
      schema: LEAGUE_DATA_SCHEMA,
      files: { 'data/x/mfl-feeds/2026/rosters.json': h('1'), 'data/x/config.json': h('3') },
    });
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    __setLeaguePointerReaderForTests(null);
    __setLeagueDataManifestForTests(undefined);
  });

  it('serves the deploy until a pointer exists, then the sync-published file', async () => {
    let raw: unknown = null;
    __setLeaguePointerReaderForTests(async () => raw);
    let changes = 0;
    const off = onLeagueDataChange(() => changes++);
    try {
      await refreshLeagueData(0);
      expect(leagueDataVersion()).toBe('deploy');
      expect(await loadLeagueData('data/x/mfl-feeds/2026/rosters.json')).toEqual({ v: 'deploy rosters' });

      raw = pointer();
      await refreshLeagueData(LIVE_CHECK_INTERVAL_MS);
      expect(leagueDataVersion()).toBe(`live:${OVERLAY}`);
      expect(changes).toBe(1);
      expect(await loadLeagueData('data/x/mfl-feeds/2026/rosters.json')).toEqual({ v: 'synced rosters' });
      // Outside the pointer's patterns the deploy still decides.
      expect(await loadLeagueData('data/x/config.json')).toEqual({ v: 'config' });
      expect(listLeagueData('data/x/mfl-feeds/*/rosters.json')).toEqual(['data/x/mfl-feeds/2026/rosters.json']);
    } finally {
      off();
    }
  });

  it('checks Redis at most once a minute per instance', async () => {
    let reads = 0;
    __setLeaguePointerReaderForTests(async () => {
      reads++;
      return pointer();
    });
    await refreshLeagueData(1_000);
    await refreshLeagueData(1_000 + LIVE_CHECK_INTERVAL_MS - 1);
    expect(reads).toBe(1);
    await refreshLeagueData(1_000 + LIVE_CHECK_INTERVAL_MS);
    expect(reads).toBe(2);
    // The overlay is fetched once, not on every check.
    expect(fetched.filter((u) => u.includes(OVERLAY))).toHaveLength(1);
  });

  it('ignores a pointer for another data layout, so a sync cannot get ahead of the code', async () => {
    __setLeaguePointerReaderForTests(async () => pointer({ schema: LEAGUE_DATA_SCHEMA + 1 }));
    await refreshLeagueData(0);
    expect(leagueDataVersion()).toBe('deploy');
    expect(await loadLeagueData('data/x/mfl-feeds/2026/rosters.json')).toEqual({ v: 'deploy rosters' });
  });

  it('a deploy built for another layout ignores every pointer', async () => {
    __setLeagueDataManifestForTests({
      base: 'https://store.example/',
      schema: LEAGUE_DATA_SCHEMA + 1,
      files: { 'data/x/mfl-feeds/2026/rosters.json': h('1') },
    });
    __setLeaguePointerReaderForTests(async () => pointer());
    await refreshLeagueData(0);
    expect(leagueDataVersion()).toBe('deploy');
  });

  it('keeps the view it has when Redis or the overlay cannot be read', async () => {
    let fail = false;
    __setLeaguePointerReaderForTests(async () => {
      if (fail) throw new Error('redis down');
      return pointer();
    });
    await refreshLeagueData(0);
    expect(leagueDataVersion()).toBe(`live:${OVERLAY}`);
    fail = true;
    await refreshLeagueData(LIVE_CHECK_INTERVAL_MS);
    expect(leagueDataVersion()).toBe(`live:${OVERLAY}`);

    // A pointer to an overlay the store lacks is not applied, and nothing throws.
    __setLeaguePointerReaderForTests(async () => pointer({ overlay: h('e') }));
    await refreshLeagueData(3 * LIVE_CHECK_INTERVAL_MS);
    expect(leagueDataVersion()).toBe(`live:${OVERLAY}`);
  });

  it('a cleared pointer returns every instance to the deploy', async () => {
    let raw: unknown = pointer();
    __setLeaguePointerReaderForTests(async () => raw);
    await refreshLeagueData(0);
    expect(leagueDataVersion()).toBe(`live:${OVERLAY}`);
    raw = null;
    await refreshLeagueData(LIVE_CHECK_INTERVAL_MS);
    expect(leagueDataVersion()).toBe('deploy');
  });

  it('a sync read preloaded just before the pointer moved gets the previous value, not an error', async () => {
    let raw: unknown = null;
    __setLeaguePointerReaderForTests(async () => raw);
    await refreshLeagueData(0);
    await loadLeagueData('data/x/mfl-feeds/2026/rosters.json');
    raw = pointer();
    await refreshLeagueData(LIVE_CHECK_INTERVAL_MS);
    expect(getLeagueData('data/x/mfl-feeds/2026/rosters.json')).toEqual({ v: 'deploy rosters' });
  });

  it('ignores a pointer no sync has confirmed in a day and a half — the syncs stopped', async () => {
    const at = Date.parse('2026-11-07T12:00:00.000Z');
    __setLeaguePointerReaderForTests(async () => pointer({ refreshedAt: '2026-11-07T12:00:00.000Z' }));
    await refreshLeagueData(at + LIVE_MAX_AGE_MS - 1);
    expect(leagueDataVersion()).toBe(`live:${OVERLAY}`);
    await refreshLeagueData(at + LIVE_MAX_AGE_MS + LIVE_CHECK_INTERVAL_MS);
    expect(leagueDataVersion()).toBe('deploy');
  });

  it('does nothing off disk (dev, tests)', async () => {
    __setLeagueDataManifestForTests(null);
    let reads = 0;
    __setLeaguePointerReaderForTests(async () => {
      reads++;
      return pointer();
    });
    await refreshLeagueData(0);
    expect(reads).toBe(0);
    expect(leagueDataVersion()).toBe('disk');
  });
});

describe('moving the pointer (scripts/league-data-pointer.mjs)', () => {
  it('builds the overlay from the files on disk under the patterns, named by its own content', () => {
    const root = mkdtempSync(join(tmpdir(), 'league-live-'));
    try {
      mkdirSync(join(root, 'data/x/mfl-feeds/2026'), { recursive: true });
      writeFileSync(join(root, 'data/x/mfl-feeds/2026/rosters.json'), '{"a":1}');
      writeFileSync(join(root, 'data/x/config.json'), '{"b":2}');
      const a = buildOverlay(PATTERNS, root);
      expect(Object.keys(a.files)).toEqual(['data/x/mfl-feeds/2026/rosters.json']);
      expect(JSON.parse(a.body.toString())).toEqual({ files: a.files });
      expect(buildOverlay(PATTERNS, root).hash).toBe(a.hash);
      writeFileSync(join(root, 'data/x/mfl-feeds/2026/rosters.json'), '{"a":2}');
      expect(buildOverlay(PATTERNS, root).hash).not.toBe(a.hash);
      expect(parsePointer(makePointer({ overlay: a.hash, patterns: PATTERNS, source: 'roster-sync' }))).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('a sync run starts from the live data, except where git moved on since', () => {
    const files = { 'data/a.json': h('1'), 'data/b.json': h('2'), 'data/c.json': h('3'), 'data/d.json': h('4') };
    const disk: Record<string, string> = { 'data/a.json': h('1'), 'data/b.json': h('9'), 'data/c.json': h('8') };
    expect(planHydrate(files, (p: string) => disk[p] ?? null, new Set(['data/c.json']))).toEqual([
      { path: 'data/b.json', hash: h('2') }, // the sync changed it since the daily commit
      { path: 'data/d.json', hash: h('4') }, // a file only the live data has
    ]);
  });

  it('never writes a path the run would not publish itself', () => {
    const files = { 'data/x/mfl-feeds/2026/a.json': h('1'), '../../etc/passwd': h('2'), 'data/x/b.json': 'nothex' };
    const allowed = (p: string) => !p.split('/').includes('..') && globToRegExp(PATTERNS[0]).test(p);
    expect(planHydrate(files, () => null, new Set(), allowed)).toEqual([{ path: 'data/x/mfl-feeds/2026/a.json', hash: h('1') }]);
  });

  it('records what the next run needs to start from it', () => {
    const p = parsePointer(
      makePointer({ overlay: OVERLAY, patterns: PATTERNS, source: 'roster-sync', base: 'https://s.example/', gitBase: 'a'.repeat(40) }),
    );
    expect(p).toMatchObject({ base: 'https://s.example/', gitBase: 'a'.repeat(40), refreshedAt: p?.publishedAt });
    expect(pointerIsStale(p!, Date.parse(p!.publishedAt) + LIVE_MAX_AGE_MS + 1)).toBe(true);
    expect(pointerIsStale(p!, Date.parse(p!.publishedAt))).toBe(false);
  });

  it('a rollback goes back, and a second one goes further back rather than flipping forward', () => {
    const history = [pointer({ overlay: h('a') }), pointer({ overlay: h('b') }), 'junk'];
    expect(planRollback(history, 1)).toEqual({ target: pointer({ overlay: h('a') }), drop: 1 });
    expect(planRollback(history, 2).target.overlay).toBe(h('b'));
    expect(() => planRollback(history, 3)).toThrow(/not a usable pointer/);
    expect(() => planRollback(history, 4)).toThrow(/cannot go back 4/);
    expect(() => planRollback(history, 0)).toThrow();
  });
});

/**
 * A helper that memoizes something BUILT from league data for the life of the
 * instance keeps serving the old data after a sync moves the pointer, unless
 * it clears that memo in an `onLeagueDataChange` listener. This flags every
 * module that reads league data and holds an empty module-level Map or a
 * module-level `let`, the two shapes those memos take.
 */
const NO_LISTENER_NEEDED: Record<string, string> = {
  'src/utils/league-data.ts': 'the loader itself; its cache is keyed by content hash',
  'src/utils/draft-broadcast-server.ts': 'collegeLogoIndex is built from a bundled config import, not league data',
};

describe('memoized league data drops with the pointer', () => {
  it('every module caching league data registers onLeagueDataChange', () => {
    const files = execSync(`git ls-files 'src/**/*.ts' 'src/**/*.mjs'`, { encoding: 'utf8' }).split('\n').filter(Boolean);
    const memo = /^(?:let \w+|const \w+(?:: [^=]+)? = new (?:Map|Set)(?:<[^()\n]*>)?\(\))/m;
    const offenders = files.filter((file) => {
      if (NO_LISTENER_NEEDED[file]) return false;
      const src = readFileSync(file, 'utf8');
      if (!/from '(?:\.\.?\/)+(?:utils\/)?league-data'/.test(src)) return false;
      return memo.test(src) && !src.includes('onLeagueDataChange(');
    });
    expect(
      offenders,
      'These read league data and memoize at module level. Clear the memo in onLeagueDataChange ' +
        '(src/utils/league-data.ts), or list the file in NO_LISTENER_NEEDED with the reason.',
    ).toEqual([]);
  });

  it('every NO_LISTENER_NEEDED entry still exists', () => {
    for (const file of Object.keys(NO_LISTENER_NEEDED)) expect(() => readFileSync(file), file).not.toThrow();
  });
});
