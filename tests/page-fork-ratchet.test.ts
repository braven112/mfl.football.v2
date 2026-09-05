import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { collectSiblings, describeRoute, forkedRoutes, inBandRoutes } from '../scripts/lib/ratchet-measures.mjs';
import baseline from './fixtures/page-fork-baseline.json';

/**
 * Fork ratchet — the guard behind "build components, not pages".
 *
 * A route that exists under two or more league directories in src/pages/ is a
 * SIBLING. A sibling is THIN when every league's copy of it is small enough to
 * be a route wrapper (auth gate, data import, one component), and FORKED
 * otherwise — the same page built twice, which is what this repo is trying to
 * stop doing.
 *
 * The baseline records the forked set as it stands. It may only shrink:
 *
 *   - A route not in the baseline that is forked = a NEW fork. Fails.
 *   - A route in the baseline that became thin = progress. Also fails, so the
 *     baseline gets retightened instead of quietly leaving slack for the next
 *     fork to hide in. Same idiom as tests/fixtures/typecheck-baseline.json.
 *
 * WHY A LINE COUNT AND NOT AN IMPORT CHECK: the obvious signal — "does the
 * route render something from components/shared/?" — is wrong here. It marks
 * admin/schefter.astro (34 lines, delegates to components/schefter/) and
 * schefter/index.astro (18 lines, a bare redirect) as forks, because thin
 * pages in this repo legitimately delegate to component directories that are
 * not named `shared`, or to nothing at all. Size is the honest proxy: a page
 * under ~80 lines cannot be hiding a duplicated implementation.
 *
 * The gap in that proxy is recorded in the baseline's `knownGap` note.
 */

const ROOT = process.cwd();
const PAGES_ROOT = join(ROOT, 'src/pages');
const MAX_THIN_LINES = baseline.thinPageMaxLines;

/** Every league's page directory, from the registry — never a hardcoded list. */
const LEAGUE_DIRS = ALL_LEAGUES.map((l: { slug: string }) => l.slug);

interface Copy {
  league: string;
  lines: number;
}

describe('forked sibling pages', () => {
  // Measurement is shared with scripts/ratchet.mjs (the retightening tool)
  // so the two can never disagree about what counts as a fork.
  const siblings: Map<string, Copy[]> = collectSiblings(PAGES_ROOT, LEAGUE_DIRS);
  const forkedNow: Map<string, Copy[]> = forkedRoutes(siblings, MAX_THIN_LINES);

  const recorded = new Set<string>(baseline.forkedRoutes);

  it('adds no forked sibling page that is not already in the baseline', () => {
    const added = [...forkedNow.keys()]
      .filter((r) => !recorded.has(r))
      .sort()
      .map((r) => describeRoute(r, forkedNow.get(r)!));

    expect(
      added,
      added.length === 0
        ? ''
        : `New forked sibling page(s):\n  ${added.join('\n  ')}\n\n` +
            `A route under two or more league directories where some copy exceeds ` +
            `${MAX_THIN_LINES} lines is the same page built twice. Extract the body into ` +
            `a shared page component and leave each league a thin route wrapper ` +
            `(see src/pages/theleague/division-strength.astro for the idiom, including ` +
            `why the Astro.redirect must stay in the route). If the fork is genuinely ` +
            `unavoidable, add the route to tests/fixtures/page-fork-baseline.json with ` +
            `a reason — deliberately, in review, not by accident.`,
    ).toEqual([]);
  });

  it('has a baseline with no stale entries — retighten when a page is unified', () => {
    const stale = baseline.forkedRoutes
      .filter((r) => !forkedNow.has(r))
      .map((r) => {
        if (!siblings.has(r)) return `${r} (no longer a sibling route)`;
        return `${describeRoute(r, siblings.get(r)!)} (now thin)`;
      });

    expect(
      stale,
      stale.length === 0
        ? ''
        : `Baseline is stale — remove these from tests/fixtures/page-fork-baseline.json:\n  ` +
            `${stale.join('\n  ')}\n\n` +
            `The list may only shrink. Leaving a unified route in it would let the next ` +
            `fork reuse that name and go unnoticed.`,
    ).toEqual([]);
  });

  it('keeps the threshold in the empty band it was chosen for', () => {
    // The 80-line cut is only defensible while nothing sits near it. When the
    // baseline was recorded the largest thin route measured 75 lines and the
    // smallest forked one 98, so no route's deciding copy was within 5 lines of
    // the threshold on either side and the classification was never a close call.
    //
    // This asserts that band is still empty. A page landing in it does not
    // mean the page is wrong — it means the threshold has become a judgement
    // call and has to be re-argued in review rather than silently reinterpreted.
    const { largestThinRoute, smallestForkedRoute } = baseline.emptyBand;
    // Classification is decided by a route's LARGEST copy — a forked route may
    // well have a small copy in some league (best-ball-1's rosters.astro is 245
    // lines next to TheLeague's 12,521) and that says nothing about the cut.
    const inBand: string[] = inBandRoutes(siblings, { largestThinRoute, smallestForkedRoute });
    expect(
      inBand,
      inBand.length === 0
        ? ''
        : `Sibling page(s) landed between ${largestThinRoute} and ${smallestForkedRoute} lines, ` +
            `the empty band the ${MAX_THIN_LINES}-line threshold was chosen to sit in:\n  ` +
            `${inBand.join('\n  ')}\n\n` +
            `Thin-vs-forked is now a close call for these. Either finish the extraction so ` +
            `the page is clearly thin, or accept it as a fork and update ` +
            `tests/fixtures/page-fork-baseline.json (both forkedRoutes and emptyBand) with ` +
            `the reasoning.`,
    ).toEqual([]);
  });
});
