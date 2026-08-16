import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archivedFeedFiles,
  SEASONS_KEPT,
  NEVER_SHIPPED_FEEDS,
} from '../scripts/lib/archived-feed-files.mjs';

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

  it('never excludes a feed nothing else can supply', () => {
    // The pages that render historical seasons reach them through
    // import.meta.glob, which compiles into dist/. Exclusion is only safe
    // because of that, so the config must not exclude anything outside
    // mfl-feeds — derived/ files are read straight off disk.
    const excluded = archivedFeedFiles();
    expect(excluded.every((p) => p.includes(join('mfl-feeds', '')))).toBe(true);
    expect(excluded.some((p) => p.includes('derived'))).toBe(false);
  });

  it('is wired into the Vercel adapter', () => {
    // A helper existing is not the same as the config calling it — the whole
    // saving is in astro.config.ts passing it to excludeFiles.
    const config = readFileSync(join(__dirname, '..', 'astro.config.ts'), 'utf-8');
    expect(config).toMatch(/excludeFiles:\s*archivedFeedFiles\(\)/);
  });
});
