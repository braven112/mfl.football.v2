import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  FUNCTION_EXCLUDED,
  STORE_ROOTS,
  globToRegExp,
  isFunctionExcluded,
  storeFiles,
} from '../scripts/lib/league-data-store.mjs';
import {
  __setLeagueDataManifestForTests,
  getLeagueData,
  hasLeagueData,
  listLeagueData,
  loadLeagueData,
  preloadLeagueData,
} from '../src/utils/league-data';
import baseline from './fixtures/league-data-import-baseline.json';

/**
 * League data moves out of the Vercel function into Blob, read through
 * src/utils/league-data.ts (plan: docs/claude/rules/storage-and-build.md
 * § "League data lives in Blob"). Two things keep that move from going
 * backwards or breaking production:
 *
 *   1. A shrink-only RATCHET on bundled data reads. Every `import.meta.glob`
 *      over a data path and every static/dynamic import of a data JSON is
 *      compiled into the function. The baseline counts them per file; a file
 *      may only go down. A new one fails — read it with `loadLeagueData`
 *      instead. A drop also fails until the baseline is retightened, so no
 *      slack is left for the next one to hide in (typecheck-baseline idiom).
 *      One key per line, so parallel PRs touching different files merge clean.
 *
 *   2. FUNCTION_EXCLUDED files are left out of the function, so an `fs` read of
 *      one works on a laptop and fails in production. Any such reader fails
 *      here first. (Globs and imports compile the data in and are unaffected;
 *      the ratchet above is what moves those.)
 */

const SOURCE_GLOBS = "'src/**/*.astro' 'src/**/*.ts' 'src/**/*.tsx' 'src/**/*.mjs' 'src/**/*.js'";
const sources = (): string[] =>
  execSync(`git ls-files ${SOURCE_GLOBS}`, { encoding: 'utf8' }).split('\n').filter(Boolean);

/** Specifiers that compile data into the bundle: globs over data paths and JSON imports. */
const GLOB_RE = /import\.meta\.glob(?:<[^>]*>)?\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*"|`[^`]*`)/g;
const STATIC_IMPORT_RE = /(?:^|\n)\s*import\s+[^'"`;]*?from\s+['"]([^'"]+\.json)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+\.json)['"]\s*\)/g;
const isDataPath = (spec: string) => /(^|\/)data\//.test(spec);

export function bundledDataReads(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(GLOB_RE)) if (isDataPath(m[1])) out.push(m[1]);
  for (const m of text.matchAll(STATIC_IMPORT_RE)) if (isDataPath(m[1])) out.push(m[1]);
  for (const m of text.matchAll(DYNAMIC_IMPORT_RE)) if (isDataPath(m[1])) out.push(m[1]);
  return out;
}

function currentCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sources()) {
    const n = bundledDataReads(readFileSync(file, 'utf8')).length;
    if (n > 0) counts[file] = n;
  }
  return counts;
}

describe('bundled league data ratchet', () => {
  it('counts globs and JSON imports of data paths, and nothing else', () => {
    expect(
      bundledDataReads(
        [
          "import a from '../../data/theleague/derived/x.json';",
          "import b from '../data/theleague/mfl-salary.json';",
          "import c from './local.json';",
          "const g = import.meta.glob('../../../data/afl-fantasy/mfl-feeds/*/players.json', { eager: true });",
          "const h = import.meta.glob('../styles/*.css');",
          "const d = await import('../../data/nfl/bye-weeks.json');",
        ].join('\n'),
      ),
    ).toHaveLength(4);
  });

  it('no file reads more bundled data than the baseline allows', () => {
    const counts = currentCounts();
    const grew = Object.entries(counts)
      .filter(([f, n]) => n > ((baseline.files as Record<string, number>)[f] ?? 0))
      .map(([f, n]) => `${f}: ${(baseline.files as Record<string, number>)[f] ?? 0} → ${n}`);
    expect(
      grew,
      'These files compile MORE league data into the Vercel function than before. Read it with ' +
        'loadLeagueData / preloadLeagueData from src/utils/league-data.ts instead.',
    ).toEqual([]);
  });

  it('the baseline is tight (retighten it when a file drops)', () => {
    const counts = currentCounts();
    const slack = Object.entries(baseline.files as Record<string, number>)
      .filter(([f, n]) => (counts[f] ?? 0) < n)
      .map(([f, n]) => `${f}: ${n} → ${counts[f] ?? 0}`);
    expect(
      slack,
      'Progress! Update tests/fixtures/league-data-import-baseline.json to the new counts ' +
        '(node -e is fine; drop a file whose count reaches 0).',
    ).toEqual([]);
  });
});

describe('FUNCTION_EXCLUDED', () => {
  it('matches paths with * as one segment and ** as any depth', () => {
    expect(globToRegExp('data/*/mfl-feeds/*/players.json').test('data/afl-fantasy/mfl-feeds/2019/players.json')).toBe(true);
    expect(globToRegExp('data/*/mfl-feeds/*/players.json').test('data/afl-fantasy/mfl-feeds/2019/x/players.json')).toBe(false);
    expect(globToRegExp('data/**/players.json').test('data/a/b/c/players.json')).toBe(true);
    expect(isFunctionExcluded('data/x.json', ['data/*.json'])).toBe(true);
  });

  it('every excluded pattern lies under a published root and matches a real file', () => {
    const files = storeFiles();
    for (const g of FUNCTION_EXCLUDED) {
      expect(STORE_ROOTS.some((r: string) => g.startsWith(`${r}/`)), g).toBe(true);
      expect(files.some((f: string) => globToRegExp(g).test(f)), `${g} matches no file`).toBe(true);
    }
  });

  it('nothing in src/ reads an excluded file off disk except through the loader', () => {
    const offenders: string[] = [];
    for (const g of FUNCTION_EXCLUDED) {
      // Only RAW readers break: a glob or import is compiled into the bundle
      // and never touches the excluded file. Match on the file name, however
      // the directories around it are spelled in the path join.
      const base = g.split('/').pop()!;
      const namePattern = base
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/\'"`]*');
      const nameRe = new RegExp(`(^|[/'"\`])${namePattern}(['"\`]|$)`);
      for (const file of sources()) {
        if (file === 'src/utils/league-data.ts') continue;
        const text = readFileSync(file, 'utf8');
        if (/from ['"](?:node:)?fs(?:\/promises)?['"]/.test(text) && nameRe.test(text)) {
          offenders.push(`${file}: fs read of ${base}`);
        }
      }
    }
    expect(
      [...new Set(offenders)],
      'These read a file that no longer ships in the function — they will ENOENT in production. ' +
        'Use loadLeagueData / preloadLeagueData (src/utils/league-data.ts).',
    ).toEqual([]);
  });
});

describe('loadLeagueData', () => {
  afterEach(() => __setLeagueDataManifestForTests(undefined));

  it('reads committed files off disk with no manifest', async () => {
    __setLeagueDataManifestForTests(null);
    const bye = await loadLeagueData<Record<string, unknown>>('data/nfl/bye-weeks.json');
    expect(bye).toBeTruthy();
    expect(await loadLeagueData('data/nfl/does-not-exist.json')).toBeNull();
    expect(hasLeagueData('data/nfl/bye-weeks.json')).toBe(true);
  });

  it('lists one file per season for a * pattern', () => {
    __setLeagueDataManifestForTests(null);
    const seasons = listLeagueData('data/afl-fantasy/mfl-feeds/*/players.json');
    expect(seasons.length).toBeGreaterThan(5);
    expect(seasons.every((p) => /^data\/afl-fantasy\/mfl-feeds\/\d{4}\/players\.json$/.test(p))).toBe(true);
  });

  it('throws on a sync read nobody preloaded, and serves one that was', async () => {
    __setLeagueDataManifestForTests(null);
    expect(() => getLeagueData('data/nfl/bye-weeks.json')).toThrow(/preloadLeagueData/);
    await preloadLeagueData(['data/nfl/bye-weeks.json']);
    expect(getLeagueData('data/nfl/bye-weeks.json')).toBeTruthy();
  });

  it('fetches from the store by content hash when a manifest is built', async () => {
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ ok: 1 }));
    }) as typeof fetch;
    try {
      __setLeagueDataManifestForTests({
        base: 'https://store.example/',
        files: { 'data/x/feed.json': 'a'.repeat(32) },
      });
      expect(await loadLeagueData('data/x/feed.json')).toEqual({ ok: 1 });
      expect(await loadLeagueData('data/x/feed.json')).toEqual({ ok: 1 });
      expect(calls).toEqual([`https://store.example/league-data/${'a'.repeat(32)}.json`]);
      expect(await loadLeagueData('data/x/missing.json')).toBeNull();
      expect(listLeagueData('data/*/feed.json')).toEqual(['data/x/feed.json']);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// Regenerate the baseline after a migration:
//   UPDATE_LEAGUE_DATA_BASELINE=1 pnpm vitest run tests/league-data-store.test.ts
if (process.env.UPDATE_LEAGUE_DATA_BASELINE === '1') {
  const counts = currentCounts();
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    'tests/fixtures/league-data-import-baseline.json',
    `${JSON.stringify({ note: baseline.note, files: sorted }, null, 2)}\n`,
  );
}
