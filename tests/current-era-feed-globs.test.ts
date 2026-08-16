import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Bundle-size guard for the two megafile feeds.
 *
 * Every page here is SSR, so an `import.meta.glob` over
 * `mfl-feeds/<years>/players.json` (~1.4 MB × season × league) or
 * `weekly-results-raw.json` (~1.3 MB × season) bakes each matched file into
 * the Vercel server chunk. A bare `*` year segment pulls 15-20 seasons of
 * JSON into pages that read only the current league/season year — tens of
 * MB per route, paid at every cold start.
 *
 * Vite requires literal glob patterns, so the era filter cannot live in a
 * shared constant; this test is the substitute (same idea as
 * tests/afl-keeper-feed-globs.test.ts). Rules:
 *
 * - Any glob whose pattern matches players.json or weekly-results-raw.json
 *   under mfl-feeds/ must carry a year filter — either the current-era
 *   pattern (2025+) or the AFL keeper-era pattern (2024+).
 * - The two pages that genuinely render every season (the roster archives)
 *   are allowlisted until their historical payloads move to derived
 *   snapshots. Do not grow this list — filter the glob or precompute.
 * - The era floor is a maintenance dial, not self-cleaning: the pattern
 *   matches through 2099, so the bundled window grows by one season a year.
 *   The staleness check below starts failing when the floor is >3 seasons
 *   behind, as a reminder to bump the floor digit (and this constant).
 */

const ERA_FLOOR = 2025;
/** Matches 2025-2099. */
const CURRENT_ERA = '20{2[5-9],[3-9][0-9]}';
/** AFL keeper era, matches 2024-2099 — see tests/afl-keeper-feed-globs.test.ts. */
const KEEPER_ERA = '20{2[4-9],[3-9][0-9]}';

const ALLOWLIST_BARE_YEAR = new Set([
  // Renders all ~20 seasons via its season selector; Phase 3 of the storage
  // work moves the historical payloads to derived snapshots.
  'src/pages/theleague/rosters.astro',
  // ?year= browsing back to 2010; players.json is needed per selected year.
  'src/pages/afl-fantasy/rosters.astro',
]);

const HEAVY_FEED = /\/mfl-feeds\/(?<years>[^/]+)\/(?:[^/']*\{[^}]*\})?[^/']*?(players|weekly-results-raw)\.json/;

const trackedSources = (): string[] =>
  execSync("git ls-files 'src/**/*.astro' 'src/**/*.ts' 'src/**/*.tsx'", { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

type Hit = { file: string; pattern: string; years: string };

const collectHeavyGlobs = (): Hit[] => {
  const hits: Hit[] = [];
  for (const file of trackedSources()) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('import.meta.glob')) continue;
    for (const m of source.matchAll(/import\.meta\.glob\(\s*'([^']+)'/g)) {
      const pattern = m[1];
      const heavy = pattern.match(HEAVY_FEED);
      if (heavy?.groups) hits.push({ file, pattern, years: heavy.groups.years });
    }
  }
  return hits;
};

describe('current-era feed globs', () => {
  const hits = collectHeavyGlobs();

  it('finds the heavy-feed globs (guard is wired to real files)', () => {
    expect(hits.length).toBeGreaterThan(10);
  });

  it('every players.json / weekly-results-raw glob carries a year filter', () => {
    for (const { file, pattern, years } of hits) {
      if (ALLOWLIST_BARE_YEAR.has(file)) continue;
      expect(
        years === CURRENT_ERA || years === KEEPER_ERA,
        `${file} globs "${pattern}" with year segment "${years}" — a bare or unknown year ` +
          `pattern bakes every season's megafile into the server chunk. Use '${CURRENT_ERA}' ` +
          `(or precompute a derived snapshot), or add the file to ALLOWLIST_BARE_YEAR with a reason.`
      ).toBe(true);
    }
  });

  it('allowlisted pages still exist and still use a bare year glob', () => {
    // If one of these pages drops its bare glob (e.g. Phase 3 lands), remove
    // it from the allowlist so it can't silently regress later.
    for (const file of ALLOWLIST_BARE_YEAR) {
      const bare = hits.filter((h) => h.file === file && h.years === '*');
      expect(
        bare.length,
        `${file} is allowlisted for a bare-year megafile glob but no longer has one — ` +
          `remove it from ALLOWLIST_BARE_YEAR in this test.`
      ).toBeGreaterThan(0);
    }
  });

  it('the era floor is not stale', () => {
    const currentYear = new Date().getFullYear();
    expect(
      currentYear - ERA_FLOOR,
      `The current-era glob floor (${ERA_FLOOR}) is more than 3 seasons old, so the ` +
        `"current era" bundles ${currentYear - ERA_FLOOR + 1} seasons of megafiles again. ` +
        `Bump the floor digit in every '${CURRENT_ERA}' glob and update ERA_FLOOR here.`
    ).toBeLessThanOrEqual(3);
  });
});
