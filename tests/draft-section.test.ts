import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

  it('records the AFL’s remaining gap rather than hiding it', () => {
    // Each league shows what it HAS, so a page must stay off the AFL list
    // until its route exists. When one lands, this test is the reminder to
    // publish it here.
    const afl = draftPagesFor('afl-fantasy').map((p) => p.key);
    const tl = draftPagesFor('theleague').map((p) => p.key);
    expect(tl).toContain('room');
    expect(tl).toContain('mock');
    // The room landed for the AFL; the mock draft is still deferred, since
    // TheLeague's mocks a 3-round rookie draft and the AFL is a 108-pick
    // redraft per conference.
    expect(afl).toContain('room');
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

describe('every draft page has a way back', () => {
  // The bug this pins: Draft Broadcast and Draft Room render nothing but a
  // full-bleed island. They shipped with no breadcrumb, no strip and no exit —
  // you landed on the big board and the only way out was the browser button.
  const DRAFT_ROUTES = [
    'src/pages/theleague/draft/index.astro',
    'src/pages/theleague/draft/results.astro',
    'src/pages/theleague/draft/order.astro',
    'src/pages/theleague/draft/broadcast.astro',
    'src/pages/theleague/draft/room.astro',
    'src/pages/theleague/draft/mock/index.astro',
    'src/pages/afl-fantasy/draft/index.astro',
    'src/pages/afl-fantasy/draft/results.astro',
    'src/pages/afl-fantasy/draft/order.astro',
    'src/pages/afl-fantasy/draft/broadcast.astro',
    'src/pages/afl-fantasy/draft/room.astro',
    // Dynamic routes are pages too. They were excluded here at first, on the
    // reasoning that they "render inside a parent that carries the chrome" —
    // which is simply false: Astro routes do not nest, and the mock SESSION
    // page had no breadcrumb, no strip and no way back at all. The exclusion
    // hid from this guard exactly the bug the guard exists to catch.
    'src/pages/theleague/draft/mock/[sessionId].astro',
    'src/pages/theleague/draft/mock/[sessionId]/results.astro',
  ];

  it('covers every route under a draft/ directory', () => {
    // The list above is hand-written, so it has to be checked against the
    // filesystem — otherwise a new draft page that forgets DraftNav simply
    // never gets looked at by the test below.
    //
    // readdirSync rather than a glob, matching page-fork-ratchet.test.ts —
    // this repo has no glob dependency, and node:fs does not export globSync
    // at the @types/node version pinned here.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walk(path);
        return entry.name.endsWith('.astro') ? [path] : [];
      });

    const onDisk = ['theleague', 'afl-fantasy']
      .flatMap((league) => walk(join('src/pages', league, 'draft')))
      .sort();
    expect(onDisk).toEqual([...DRAFT_ROUTES].sort());
  });

  it('renders DraftNav — the breadcrumb trail and the strip — on each one', () => {
    for (const route of DRAFT_ROUTES) {
      const src = readFileSync(route, 'utf-8');
      const rendered = /<DraftNav\b/.test(src) || /<DraftNav\s/.test(src);
      // A route may render DraftNav itself, or delegate to a shared page
      // component that renders it — both are "has a way back".
      const delegated = /DraftResultsPage|DraftHubPage|DraftRoomPage/.test(src);
      expect(rendered || delegated, `${route} has no way back`).toBe(true);
    }
  });

  it('gives every page but the hub a trailing crumb', () => {
    for (const route of DRAFT_ROUTES) {
      const src = readFileSync(route, 'utf-8');
      if (!/<DraftNav\b/.test(src)) continue; // delegates to a shared page
      const isHub = /current="hub"/.test(src);
      if (isHub) continue;
      expect(/crumb="/.test(src), `${route} renders DraftNav without a crumb`).toBe(true);
    }
  });

  it('keeps the breadcrumb trail inside DraftNav, not duplicated per page', () => {
    // Two trails on one page is the failure mode of "fix it on every page".
    for (const route of DRAFT_ROUTES) {
      const src = readFileSync(route, 'utf-8');
      expect(/<Breadcrumbs\b/.test(src), `${route} renders its own Breadcrumbs`).toBe(false);
    }
    expect(readFileSync('src/components/shared/draft-nav/DraftNav.astro', 'utf-8')).toMatch(
      /<Breadcrumbs/
    );
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

  it('advertises the Draft Room to BOTH leagues now the AFL has one', () => {
    // Was theleague-only until the AFL's conference-aware room landed. An
    // untagged link is "every full-format league" (see nav-utils).
    expect(navLinks.find((l: any) => l.id === 'draft-room')?.leagueOnly).toBeUndefined();
  });

  it('still keeps Mock Draft off the AFL, which has none', () => {
    expect(navLinks.find((l: any) => l.id === 'mock-draft')?.leagueOnly).toBe('theleague');
  });
});
