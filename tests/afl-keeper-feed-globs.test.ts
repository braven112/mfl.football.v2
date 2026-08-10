import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Bundle-size guard for the AFL Keeper Report Card.
 *
 * The page is SSR (`prerender = false`) and reads committed MFL feeds via
 * `import.meta.glob`, so every matched file is baked into the Vercel server
 * function. AFL feed history runs back to 2003 (~55MB); the keeper era
 * starts at 2024. A bare `*` year segment therefore pulls two decades of
 * irrelevant JSON into the function and pushes it past the 250MB
 * uncompressed limit — a failure that only surfaces at deploy time, long
 * after the change that caused it looks fine locally.
 *
 * Vite requires a literal glob pattern, so the era filter cannot live in a
 * shared constant that a new glob would automatically inherit. This test is
 * the substitute: it fails the build if any feed glob on the page drops the
 * filter, and nudges new feeds into the existing single glob's brace list
 * rather than a sixth `import.meta.glob` call.
 */

const PAGE = 'src/pages/afl-fantasy/keeper-analysis.astro';
/** Matches 2024-2099 — see AFL_KEEPER_ERA_FIRST_PREV_YEAR. */
const ERA_YEARS = '20{2[4-9],[3-9][0-9]}';

const source = readFileSync(resolve(process.cwd(), PAGE), 'utf8');
const globPatterns = [...source.matchAll(/import\.meta\.glob\(\s*'([^']+)'/g)].map((m) => m[1]);
const feedGlobs = globPatterns.filter((p) => p.includes('/mfl-feeds/'));

describe('keeper report card feed globs', () => {
  it('finds the page globs (guard is wired to the real file)', () => {
    expect(feedGlobs.length).toBeGreaterThan(0);
  });

  it('scopes every mfl-feeds glob to the keeper era', () => {
    for (const pattern of feedGlobs) {
      expect(
        pattern,
        `${PAGE} globs "${pattern}" without the keeper-era year filter — a bare year ` +
          `segment bakes pre-2024 AFL feeds into the SSR bundle. Use /mfl-feeds/${ERA_YEARS}/.`
      ).toContain(`/mfl-feeds/${ERA_YEARS}/`);
    }
  });

  it('keeps the per-season feeds in one glob instead of one call per file', () => {
    // Feeds that sit directly under the year directory (as opposed to the
    // roster-history snapshots, which are a directory deeper and keyed by
    // snapshot date). Adding a sixth of these should extend the brace list,
    // not add another glob call.
    const flatFeedGlobs = feedGlobs.filter((p) => /\/mfl-feeds\/[^/]+\/[^/]+$/.test(p));
    expect(flatFeedGlobs).toHaveLength(1);
    expect(flatFeedGlobs[0]).toMatch(/\{[^}]*,[^}]*\}\.json$/);
  });
});
