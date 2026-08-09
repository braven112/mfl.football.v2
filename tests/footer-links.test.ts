import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  getFooterColumns,
  getDeepCuts,
  pathBelongsToLeague,
} from '../src/config/footer-config';
import { getFooterChampions } from '../src/utils/footer-champions';
import { resolveDirectoryHref } from '../src/utils/nav-utils';
import type { CanonicalLeagueSlug } from '../src/config/leagues';
import type { LeagueSlug } from '../src/types/nav';

/**
 * Every footer link must resolve to a route that actually exists.
 *
 * This exists because two 404s shipped past both a config review and a
 * per-league column review:
 *
 *  - `/afl-fantasy/league-comparison` — the AFL deck listed the directory id
 *    `league-comparison`, whose path is the bare `/league-comparison`. Bare
 *    paths are TheLeague's, so prefixing it for AFL invented a route. (It is
 *    also a salary-cap tool, and AFL runs salaryCap:false.)
 *  - `/afl-fantasy/search` and `/best-ball-1/search` — the utility bar's
 *    Search link, on EVERY page of two leagues.
 *
 * Neither was catchable by the existing tests, which assert column structure
 * but never resolve a link and never look at src/pages/. This one does both.
 */

const ROOT = process.cwd();
const PAGES = path.join(ROOT, 'src/pages');

const NAV_SLUG: Record<CanonicalLeagueSlug, LeagueSlug> = {
  theleague: 'theleague',
  'afl-fantasy': 'afl',
  'best-ball-1': 'bb1',
};

const LEAGUES = Object.keys(NAV_SLUG) as CanonicalLeagueSlug[];

/**
 * Does an Astro route back this pathname?
 *
 * Checks the concrete forms a static route can take. Deliberately does NOT
 * treat catch-all routes as a match: `src/pages/[...path].astro` matches
 * everything and explicitly returns 404, so counting it would make this test
 * pass on exactly the bugs it exists to catch.
 */
function routeExists(pathname: string): boolean {
  const clean = pathname.split('?')[0].split('#')[0].replace(/\/$/, '');
  if (!clean || clean === '/') return existsSync(path.join(PAGES, 'index.astro'));
  const rel = clean.replace(/^\//, '');
  return (
    existsSync(path.join(PAGES, `${rel}.astro`)) ||
    existsSync(path.join(PAGES, rel, 'index.astro')) ||
    existsSync(path.join(PAGES, `${rel}.ts`)) ||
    existsSync(path.join(PAGES, `${rel}.md`))
  );
}

/** Every href the footer renders for a league, as the browser would see it. */
function renderedHrefs(slug: CanonicalLeagueSlug): Array<{ label: string; href: string }> {
  const nav = NAV_SLUG[slug];
  const columns = getFooterColumns(slug);
  const out: Array<{ label: string; href: string }> = [];

  for (const col of columns) {
    for (const l of col.links) {
      // Planned pages render as inert text, not links.
      if (l.soon || !l.path) continue;
      out.push({ label: `${col.title} › ${l.label}`, href: resolveDirectoryHref(l.path, nav) });
    }
  }
  for (const cut of getDeepCuts(slug, columns)) {
    out.push({ label: `Deep Cuts › ${cut.label}`, href: resolveDirectoryHref(cut.path!, nav) });
  }
  // Trophy Case + champion cards, which build hrefs outside the config.
  if (slug !== 'best-ball-1') {
    out.push({ label: 'Trophy Case', href: resolveDirectoryHref('/franchises', nav) });
  }
  for (const champ of getFooterChampions(slug)) {
    out.push({ label: `Champion › ${champ.team}`, href: champ.href });
  }
  if (pathBelongsToLeague('/search', slug)) {
    out.push({ label: 'Utility › Search', href: resolveDirectoryHref('/search', nav) });
  }
  return out;
}

describe('every footer link resolves to a real route', () => {
  for (const slug of LEAGUES) {
    describe(slug, () => {
      const hrefs = renderedHrefs(slug);

      it('renders at least one link', () => {
        expect(hrefs.length).toBeGreaterThan(0);
      });

      it('has no dead links', () => {
        const dead = hrefs.filter((h) => !routeExists(h.href));
        expect(
          dead.map((d) => `${d.label} -> ${d.href}`),
          `Footer links with no backing route under src/pages/ for ${slug}`
        ).toEqual([]);
      });

      it('never points at another league', () => {
        const foreign = hrefs.filter((h) => {
          for (const other of LEAGUES) {
            if (other === slug) continue;
            if (h.href === `/${other}` || h.href.startsWith(`/${other}/`)) return true;
          }
          return false;
        });
        expect(
          foreign.map((f) => `${f.label} -> ${f.href}`),
          `Footer links leaking into another league from ${slug}`
        ).toEqual([]);
      });

      it('never double-prefixes', () => {
        const doubled = hrefs.filter((h) =>
          /^\/(theleague|afl-fantasy|best-ball-1)\/(theleague|afl-fantasy|best-ball-1)\//.test(h.href)
        );
        expect(doubled.map((d) => d.href)).toEqual([]);
      });
    });
  }
});

describe('pathBelongsToLeague', () => {
  it('treats a BARE directory path as TheLeague, not as shared', () => {
    // The bug: assuming bare == shared invents /afl-fantasy/league-comparison.
    expect(pathBelongsToLeague('/league-comparison', 'theleague')).toBe(true);
    expect(pathBelongsToLeague('/league-comparison', 'afl-fantasy')).toBe(false);
    expect(pathBelongsToLeague('/search', 'best-ball-1')).toBe(false);
  });

  it('assigns prefixed paths to their own league', () => {
    expect(pathBelongsToLeague('/afl-fantasy/rosters', 'afl-fantasy')).toBe(true);
    expect(pathBelongsToLeague('/afl-fantasy/rosters', 'theleague')).toBe(false);
    expect(pathBelongsToLeague('/best-ball-1/rules', 'best-ball-1')).toBe(true);
    expect(pathBelongsToLeague('/theleague/lineup', 'theleague')).toBe(true);
  });
});
