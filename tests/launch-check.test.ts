/**
 * The pure half of scripts/launch-check.mjs: which pages a league starts from,
 * how a link maps to a dynamic route, and what counts as a finding. The
 * browser half is exercised by running `/launch-check` against a server.
 */
import { describe, expect, it } from 'vitest';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import {
  dynamicRouteFor,
  inspectBody,
  leakNeedles,
  routePath,
  startingPages,
} from '../scripts/launch-check.mjs';

describe('launch check', () => {
  it("starts from a package league's entitled static pages, and reaches dynamic ones by link", () => {
    const { pages, dynamic } = startingPages(LEAGUES.archies);
    expect(pages.map((p) => p.path)).toContain('/archies');
    expect(pages.map((p) => p.path)).toContain('/archies/standings');
    expect(pages.every((p) => !p.path.includes('['))).toBe(true);
    expect(dynamic).toContain('brand/[team].astro');
    const off = startingPages({ ...LEAGUES.archies, features: { ...LEAGUES.archies.features, liveScoring: false } });
    expect(off.pages.map((p) => p.path)).not.toContain('/archies/live-scoring');
  });

  it("uses a hand-built league's site-search entries", () => {
    const { pages, dynamic } = startingPages(LEAGUES.theleague, [
      { path: '/theleague/standings', visibility: 'all' },
      { path: '/theleague/admin/x', visibility: 'admin' },
      { path: '/afl-fantasy/standings', visibility: 'all' },
    ]);
    expect(pages.map((p) => p.path)).toEqual(['/theleague/standings']);
    expect(dynamic).toEqual([]);
  });

  it('maps a link to the dynamic route it is an example of', () => {
    const routes = ['brand/[team].astro', 'pecking-order/[year]/[week].astro'];
    expect(dynamicRouteFor('/brand/admirals', routes)).toBe('brand/[team].astro');
    expect(dynamicRouteFor('/pecking-order/2026/3?x=1', routes)).toBe('pecking-order/[year]/[week].astro');
    expect(dynamicRouteFor('/brand', routes)).toBeNull();
    expect(routePath('index.astro')).toBe('/');
  });

  it('fails on placeholders and broken values; warns on another league', () => {
    const needles = leakNeedles(LEAGUES.archies);
    const found = inspectBody(
      {
        text: 'Welcome to __LEAGUE_NAME__. Points: NaN. Pacific Pigskins? See The League.',
        hrefs: ['/archies/standings', '/afl-fantasy/rosters'],
      },
      needles,
    );
    expect(found.errors.join()).toMatch(/__LEAGUE_NAME__/);
    expect(found.errors.join()).toMatch(/NaN/);
    expect(found.warnings).toContain('links into another league: /afl-fantasy/rosters');
    expect(found.warnings.join()).not.toMatch(/archies\/standings/);
  });

  it("never flags the league's own name", () => {
    const needles = leakNeedles(LEAGUES.archies);
    expect(needles.names).not.toContain("Archie's");
    expect(inspectBody({ text: "Archie's Fantasy Football League", hrefs: [] }, needles)).toEqual({ errors: [], warnings: [] });
  });
});
