import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Bundle-size guard for the AFL Keeper Report Card.
 *
 * The page used to read committed MFL feeds through `import.meta.glob`, which
 * baked every matched file into the Vercel server function. AFL feed history
 * runs back to 2003 (~55MB) while the keeper era starts at 2024, so a bare
 * year segment pushed the function past its 250MB limit — a failure that
 * only surfaced at deploy time.
 *
 * The page now reads its feeds through the league-data loader
 * (src/utils/league-data.ts), which fetches them from Blob at request time
 * and bundles nothing. This guard keeps it that way, and keeps the reads
 * scoped to the keeper era so a request never fetches two decades of feeds.
 */

const PAGE = 'src/pages/afl-fantasy/keeper-analysis.astro';
const source = readFileSync(resolve(process.cwd(), PAGE), 'utf8');

describe('keeper report card feed reads', () => {
  it('bundles no mfl-feeds glob', () => {
    const feedGlobs = [...source.matchAll(/import\.meta\.glob(?:<[^>]*>)?\(\s*['"`]([^'"`]+)/g)]
      .map((m) => m[1])
      .filter((p) => p.includes('/mfl-feeds/'));
    expect(
      feedGlobs,
      `${PAGE} globs MFL feeds into the function bundle — read them with loadLeagueData / preloadLeagueData.`,
    ).toEqual([]);
  });

  it('reads feeds through the loader, scoped to the keeper era', () => {
    expect(source).toMatch(/from '\.\.\/\.\.\/utils\/league-data'/);
    expect(source).toMatch(/const inKeeperEra = \(year: number\) => year >= AFL_KEEPER_ERA_FIRST_PREV_YEAR/);
    // The season list feeding every preload is filtered to the era.
    expect(source).toMatch(/listLeagueData\([^)]*weekly-results-raw\.json`\)[\s\S]{0,80}\.filter\(inKeeperEra\)/);
  });
});
