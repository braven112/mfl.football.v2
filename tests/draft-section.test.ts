import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import navConfig from '../src/config/nav-config.json';
import pageDirectory from '../src/data/page-directory.json';
import { DRAFT_PAGES, draftPagesFor } from '../src/components/shared/draft-nav/draft-pages';

/**
 * The draft section: a hub, an archive, and a strip that ties every draft page
 * to every other (docs/plans/draft-hub-and-results.md).
 *
 * This guards the parts that are easy to half-undo: the retired History tab,
 * the league-neutral paths the strip depends on, and the fact that every page
 * the strip advertises to a league actually EXISTS for that league.
 */

const orderPage = readFileSync('src/pages/theleague/draft/order.astro', 'utf-8');
const selector = readFileSync('src/components/theleague/DraftViewSelector.astro', 'utf-8');
const navLinks = navConfig.sections.flatMap((s: any) => s.links ?? []);
const directory = pageDirectory as { id: string; path: string; visibility: string }[];

describe('the retired History tab', () => {
  it('is gone from the view selector', () => {
    // It rendered a full pick-by-pick archive as the third tab of a page
    // called "Draft Order" — TheLeague-only, and linked from nowhere.
    expect(selector).not.toMatch(/key:\s*'history'/);
    expect(selector).not.toMatch(/label:\s*'History'/);
  });

  it('is gone from the order page’s valid views', () => {
    expect(orderPage).toMatch(/VALID_VIEWS\s*=\s*\['projected',\s*'final'\]/);
  });

  it('redirects ?view=history AND the older ?view=trades alias', () => {
    expect(orderPage).toMatch(/normalizedView === 'history' \|\| normalizedView === 'trades'/);
    expect(orderPage).toMatch(/\/theleague\/draft\/results/);
  });

  it('carries ?year= and ?team= across, so a bookmark keeps meaning', () => {
    expect(orderPage).toMatch(/carried\.set\('year', year\)/);
    expect(orderPage).toMatch(/carried\.set\('team', team\)/);
  });

  it('redirects BEFORE resolving the view, or the branch stays reachable', () => {
    const redirect = orderPage.indexOf("normalizedView === 'history'");
    const resolve = orderPage.indexOf('const VALID_VIEWS');
    expect(redirect).toBeGreaterThan(-1);
    expect(resolve).toBeGreaterThan(redirect);
  });

  it('leaves none of the old history rendering behind', () => {
    for (const dead of ['buildHistoryRows', 'historyPlayerLookup', 'filteredHistoryRows', 'setupHistorySelect']) {
      expect(orderPage, `${dead} still present`).not.toContain(dead);
    }
  });
});

describe('the draft page registry', () => {
  it('keeps every path league-NEUTRAL', () => {
    // A prefixed path here would send half the readers to the other league's
    // site — resolveLeaguePath adds the prefix per reader.
    for (const p of DRAFT_PAGES) {
      expect(p.path, p.key).not.toMatch(/^\/(theleague|afl-fantasy|best-ball-1)\b/);
      expect(p.path.startsWith('/'), p.key).toBe(true);
    }
  });

  it('only advertises a page to a league that has the route file', () => {
    const routeFor = (league: string, path: string) => {
      const rel = `src/pages/${league}${path}`;
      return existsSync(`${rel}.astro`) || existsSync(`${rel}/index.astro`);
    };
    for (const page of DRAFT_PAGES) {
      for (const league of page.leagues) {
        expect(routeFor(league, page.path), `${league} has no ${page.path}`).toBe(true);
      }
    }
  });

  it('gives both leagues a hub route', () => {
    expect(existsSync('src/pages/theleague/draft/index.astro')).toBe(true);
    expect(existsSync('src/pages/afl-fantasy/draft/index.astro')).toBe(true);
  });

  it('records the AFL’s two known gaps rather than hiding them', () => {
    // The AFL has no Draft Room or Mock Draft yet — Phase 5 and the deferred
    // mock. The decision was to show each league what it HAS, so these must
    // stay off the AFL list until the routes exist. When they land, this test
    // is the reminder to publish them here.
    const afl = draftPagesFor('afl-fantasy').map((p) => p.key);
    const tl = draftPagesFor('theleague').map((p) => p.key);
    expect(tl).toContain('room');
    expect(tl).toContain('mock');
    expect(afl).not.toContain('mock');
    expect(afl).toEqual(expect.arrayContaining(['order', 'results', 'broadcast']));
  });

  it('has a page-directory entry for every page it advertises', () => {
    // Without one the page is invisible to site search.
    const paths = new Set(directory.map((p) => p.path));
    const covered = (league: string, path: string) =>
      paths.has(path) || paths.has(`/${league}${path}`);
    for (const page of DRAFT_PAGES) {
      for (const league of page.leagues) {
        expect(covered(league, page.path), `${league}${page.path} not in page-directory`).toBe(true);
      }
    }
    expect(covered('theleague', '/draft')).toBe(true);
    expect(covered('afl-fantasy', '/draft')).toBe(true);
  });
});

describe('nav', () => {
  it('links the draft hub and the archive', () => {
    expect(navLinks.find((l: any) => l.id === 'draft-hub')?.path).toBe('/draft');
    expect(navLinks.find((l: any) => l.id === 'draft-results')?.path).toBe('/draft/results');
  });

  it('finally links the Draft Broadcast for BOTH leagues', () => {
    // TheLeague's broadcast shipped in PRs #650-#653 and sat in
    // page-directory.json but never in the nav — only the AFL's was there.
    const b = navLinks.find((l: any) => l.id === 'draft-broadcast');
    expect(b?.path).toBe('/draft/broadcast');
    expect(b?.leagueOnly).toBeUndefined();
    expect(navLinks.find((l: any) => l.id === 'afl-draft-broadcast')).toBeUndefined();
  });

  it('does not leave the Draft Room or Mock Draft advertised to the AFL', () => {
    for (const id of ['draft-room', 'mock-draft']) {
      expect(navLinks.find((l: any) => l.id === id)?.leagueOnly, id).toBe('theleague');
    }
  });
});
