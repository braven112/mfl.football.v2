import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getSearchPath, resolveDirectoryHref } from '../src/utils/nav-utils';
import { getFooterColumns, getDeepCuts, pathBelongsToLeague } from '../src/config/footer-config';
import { ALL_LEAGUES, getLeagueBySlug, type CanonicalLeagueSlug } from '../src/config/leagues';
import directory from '../src/data/page-directory.json';

/**
 * Site search must be reachable from every league that has it, and invisible
 * in every league that doesn't.
 *
 * This exists because the AFL shipped with 41 pages in the directory and no
 * way to search them. The header's magnifying glass was hardcoded to
 * `/theleague/search` behind a `!isAFL` gate while the footer's Search link
 * was gated on `pathBelongsToLeague('/search', slug)` — two independent
 * answers to one question, and both said "TheLeague only" for different
 * reasons. getSearchPath() is now the single answer; this pins what it owes.
 */

const ROOT = process.cwd();
const PAGES = path.join(ROOT, 'src/pages');
const LEAGUES = ALL_LEAGUES.map((l) => l.slug as CanonicalLeagueSlug);

/** Same route check footer-links.test.ts uses — the catch-all never counts. */
function routeExists(pathname: string): boolean {
  const rel = pathname.replace(/^\//, '').replace(/\/$/, '');
  return (
    existsSync(path.join(PAGES, `${rel}.astro`)) ||
    existsSync(path.join(PAGES, rel, 'index.astro'))
  );
}

describe('getSearchPath', () => {
  it('covers every registered league', () => {
    // A new league added to the registry gets an explicit answer here rather
    // than silently falling into the "no search" branch.
    expect(LEAGUES.sort()).toEqual(['afl-fantasy', 'best-ball-1', 'theleague']);
  });

  for (const slug of LEAGUES) {
    const searchPath = getSearchPath(slug);
    if (!searchPath) {
      it(`${slug}: has no search page, so links nothing`, () => {
        expect(searchPath).toBeNull();
      });
      continue;
    }

    describe(slug, () => {
      const navSlug = getLeagueBySlug(slug)!.navSlug;
      const href = resolveDirectoryHref(searchPath, navSlug);

      it('resolves to a route that exists', () => {
        expect(routeExists(href), `No route under src/pages for ${href}`).toBe(true);
      });

      it('belongs to its own league', () => {
        // The bare `/search` is TheLeague's by convention; a prefixed path
        // must carry its OWN league's prefix, or the footer scopes it away.
        expect(pathBelongsToLeague(searchPath, slug)).toBe(true);
        expect(href.startsWith(`/${slug}`)).toBe(true);
      });

      it('is listed in page-directory.json', () => {
        // Without an entry the page is invisible to the search it powers.
        const entry = directory.find((e) => e.path === searchPath);
        expect(entry, `page-directory.json has no entry for ${searchPath}`).toBeTruthy();
      });
    });
  }
});

describe('the header search icon', () => {
  const header = readFileSync(
    path.join(ROOT, 'src/components/theleague/Header.astro'),
    'utf8',
  );

  it('builds its href through getSearchPath, never a hardcoded league path', () => {
    expect(header).toContain('getSearchPath(');
    expect(header).not.toContain('"/theleague/search"');
    expect(header).not.toContain("'/theleague/search'");
  });

  it('actually renders the icon from that value', () => {
    // Without this, the test above passes on a Header that imports and calls
    // getSearchPath() and then renders nothing from it — which is the exact
    // end state (no icon on the AFL) this whole guard exists to prevent.
    expect(header).toContain('{searchHref && (');
    expect(header).toContain('href={searchHref}');
    expect(header).toContain('breadcrumb-search-link');
  });
});

describe('the footer links search exactly once', () => {
  // Deep Cuts is a RULE, not a list: it surfaces any public, low-popularity
  // directory entry the footer doesn't already link. Search is meant to be
  // excluded because the utility bar carries it — but that exclusion was a
  // hardcoded '/search', which is TheLeague's directory path only. The moment
  // the AFL got a search page at the prefixed '/afl-fantasy/search', the AFL
  // footer printed "Search" in Deep Cuts AND in the utility bar four lines
  // below, both pointing at the same page.
  for (const slug of LEAGUES) {
    it(`${slug}: search appears in Deep Cuts or the utility bar, never both`, () => {
      const searchPath = getSearchPath(slug);
      const deepCuts = getDeepCuts(slug, getFooterColumns(slug, null));
      const inDeepCuts = deepCuts.filter((c) => c.path === searchPath);
      expect(
        inDeepCuts.map((c) => `${c.label} -> ${c.path}`),
        `Deep Cuts repeats the utility bar's Search link for ${slug}`,
      ).toEqual([]);
    });
  }
});
