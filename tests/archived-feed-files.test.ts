import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archivedFeedFiles,
  SEASONS_KEPT,
  NEVER_SHIPPED_FEEDS,
  GLOB_ONLY_FEED_DIRS,
  FS_READ_DERIVED,
  LEAGUE_DIRS,
} from '../scripts/lib/archived-feed-files.mjs';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

/**
 * The Vercel function has a hard 250 MB uncompressed limit and this repo has
 * already hit it: an unresolvable `join(process.cwd(), dataPath, …)` made the
 * file tracer copy all of `data/` in, putting the function at 263 MB and
 * failing every deploy. These tests pin the shape of the fix, because the
 * failure mode is a deploy-time rejection with no local signal.
 */
function makeFixture(years: Record<string, string[]>): string {
  const root = mkdtempSync(join(tmpdir(), 'feeds-'));
  for (const [year, files] of Object.entries(years)) {
    const dir = join(root, 'data', 'theleague', 'mfl-feeds', year);
    mkdirSync(dir, { recursive: true });
    for (const f of files) writeFileSync(join(dir, f), '{}');
  }
  return root;
}

const OPTS = { leagues: ['theleague'] };

describe('archivedFeedFiles', () => {
  it('keeps the newest seasons and excludes every file in older ones', () => {
    const root = makeFixture({
      2026: ['players.json', 'schedule.json'],
      2025: ['players.json'],
      2024: ['players.json'],
      2023: ['players.json', 'schedule.json'],
      2011: ['players.json'],
    });

    const excluded = archivedFeedFiles({ root, ...OPTS });

    // Newest three survive.
    expect(excluded.some((p) => p.includes(join('mfl-feeds', '2026')))).toBe(false);
    expect(excluded.some((p) => p.includes(join('mfl-feeds', '2025')))).toBe(false);
    expect(excluded.some((p) => p.includes(join('mfl-feeds', '2024')))).toBe(false);
    // Everything older goes, file by file.
    expect(excluded).toContain(join(root, 'data/theleague/mfl-feeds/2023/players.json'));
    expect(excluded).toContain(join(root, 'data/theleague/mfl-feeds/2023/schedule.json'));
    expect(excluded).toContain(join(root, 'data/theleague/mfl-feeds/2011/players.json'));
  });

  it('sorts seasons numerically, not lexically', () => {
    // A lexical sort happens to be right for 4-digit years, so this only fails
    // once something else lands in the directory — which is exactly when a
    // silently-wrong sort would evict a season that is still being read.
    const root = makeFixture({ 2009: ['a.json'], 2010: ['a.json'], 2026: ['a.json'], 999: ['a.json'] });
    const excluded = archivedFeedFiles({ root, ...OPTS });
    // '999' is not a 4-digit year and must be ignored entirely, not sorted in.
    expect(excluded.some((p) => p.includes(join('mfl-feeds', '999')))).toBe(false);
    // Newest three of {2009, 2010, 2026} are kept → nothing excluded.
    expect(excluded).toHaveLength(0);
  });

  it('keeps three seasons, not two — a rollover stub must not evict a live season', () => {
    // At rollover the new year's directory exists before it holds real data.
    // With a 2-season window, 2027 + 2026 would push 2025 out while schefter-og
    // is still reading [year, year - 1].
    expect(SEASONS_KEPT).toBeGreaterThanOrEqual(3);

    const root = makeFixture({
      2027: [], // rollover stub, no feeds yet
      2026: ['players.json'],
      2025: ['players.json'],
    });
    const excluded = archivedFeedFiles({ root, ...OPTS });
    expect(excluded.some((p) => p.includes(join('mfl-feeds', '2025')))).toBe(false);
  });

  it('drops never-shipped feeds from the kept seasons too', () => {
    const root = makeFixture({
      2026: ['players.json', ...NEVER_SHIPPED_FEEDS],
      2025: ['players.json'],
    });
    const excluded = archivedFeedFiles({ root, ...OPTS });

    for (const name of NEVER_SHIPPED_FEEDS) {
      expect(excluded).toContain(join(root, 'data/theleague/mfl-feeds/2026', name));
    }
    // ...without taking the rest of that season with them.
    expect(excluded).not.toContain(join(root, 'data/theleague/mfl-feeds/2026/players.json'));
  });

  it('returns an empty list rather than throwing when a league has no archive', () => {
    const root = mkdtempSync(join(tmpdir(), 'feeds-empty-'));
    expect(archivedFeedFiles({ root, leagues: ['theleague', 'afl-fantasy'] })).toEqual([]);
  });

  it('drops glob-only roster-history snapshots from the kept seasons', () => {
    const root = makeFixture({ 2026: ['players.json'], 2025: ['players.json'] });
    const histDir = join(root, 'data/theleague/mfl-feeds/2026/roster-history');
    mkdirSync(histDir);
    writeFileSync(join(histDir, 'rosters-2026-07-20.json'), '{}');

    const excluded = archivedFeedFiles({ root, ...OPTS });
    expect(excluded).toContain(join(histDir, 'rosters-2026-07-20.json'));
    expect(excluded).not.toContain(join(root, 'data/theleague/mfl-feeds/2026/players.json'));
  });

  it('drops every derived/ file except the ones fs reads', () => {
    const root = makeFixture({ 2026: ['players.json'] });
    const derivedDir = join(root, 'data/theleague/derived');
    mkdirSync(derivedDir);
    for (const f of [...FS_READ_DERIVED, 'franchise-history.json']) {
      writeFileSync(join(derivedDir, f), '{}');
    }

    const excluded = archivedFeedFiles({ root, ...OPTS });
    expect(excluded).toContain(join(derivedDir, 'franchise-history.json'));
    for (const f of FS_READ_DERIVED) expect(excluded).not.toContain(join(derivedDir, f));
  });

  it('trims derived/ even for a league with no feed archive', () => {
    const root = mkdtempSync(join(tmpdir(), 'derived-only-'));
    const derivedDir = join(root, 'data/theleague/derived');
    mkdirSync(derivedDir, { recursive: true });
    writeFileSync(join(derivedDir, 'franchise-history.json'), '{}');
    expect(archivedFeedFiles({ root, ...OPTS })).toEqual([join(derivedDir, 'franchise-history.json')]);
  });

  it('only ever excludes mfl-feeds and derived/ paths', () => {
    // Everything else under data/ (schefter archives, schedule releases,
    // awards, configs) is read off disk by name and must stay.
    const excluded = archivedFeedFiles();
    expect(
      excluded.every((p) => p.includes(join('mfl-feeds', '')) || p.includes(join('derived', ''))),
    ).toBe(true);
  });

  it('excludes nothing an fs reader in src/ names', () => {
    // GLOB_ONLY_FEED_DIRS and FS_READ_DERIVED are allowlists of what fs may
    // read. An fs reader of anything outside them works locally and in tests
    // and ENOENTs only on Vercel, so the check has to be here. A file counts
    // as an fs reader if it imports fs; static `import x from '…json'` lines,
    // import.meta.glob patterns and comments compile into dist/ and are skipped.
    const srcRoot = join(__dirname, '..', 'src');
    const offenders: string[] = [];
    const derivedNames = new Set<string>();
    for (const league of LEAGUE_DIRS) {
      try {
        for (const f of readdirSync(join(__dirname, '..', 'data', league, 'derived'))) derivedNames.add(f);
      } catch {
        // no derived/ for this league
      }
    }
    const excludedDerived = [...derivedNames].filter((f) => !FS_READ_DERIVED.includes(f));
    expect(excludedDerived.length).toBeGreaterThan(0);

    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|mts|mjs|js|astro)$/.test(e.name) && !/\.test\./.test(e.name)) check(p);
      }
    };
    const check = (file: string) => {
      const text = readFileSync(file, 'utf-8');
      if (!/from\s+['"](node:)?fs(\/promises)?['"]|require\(['"](node:)?fs/.test(text)) return;
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/import\.meta\.glob\([\s\S]*?\)/g, '')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|import\s)/.test(l))
        .join('\n');
      for (const dir of GLOB_ONLY_FEED_DIRS) {
        if (code.includes(dir)) offenders.push(`${file}: ${dir}/`);
      }
      for (const name of excludedDerived) {
        if (code.includes(name)) offenders.push(`${file}: derived/${name}`);
      }
      if (/derived\/\$\{/.test(code)) offenders.push(`${file}: dynamic derived/ filename`);
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });

  it('is wired into the Vercel adapter', () => {
    // A helper existing is not the same as the config calling it — the whole
    // saving is in astro.config.ts passing it to excludeFiles.
    const config = readFileSync(join(__dirname, '..', 'astro.config.ts'), 'utf-8');
    expect(config).toMatch(/excludeFiles:\s*archivedFeedFiles\(\)/);
  });
});

describe('LEAGUE_DIRS', () => {
  it('covers every registry league with a data directory', () => {
    // Hardcoding two leagues let a third league's whole archive ride into the
    // function and fail the deploy at 254 MB.
    for (const league of ALL_LEAGUES) {
      if (!league.dataPath?.startsWith('data/')) continue;
      expect(LEAGUE_DIRS).toContain(league.dataPath.slice('data/'.length));
    }
  });
});
