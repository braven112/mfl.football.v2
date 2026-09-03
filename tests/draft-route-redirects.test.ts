import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import navConfig from '../src/config/nav-config.json';
import pageDirectory from '../src/data/page-directory.json';

/**
 * The 2026-09-02 move of the draft routes under `/draft/*`
 * (docs/plans/draft-hub-and-results.md).
 *
 * This guard exists because the redirects live in `vercel.json` and
 * `vercel.json` DOES NOT RUN UNDER `astro dev`. Locally an old draft URL just
 * 404s, so there is no way to notice a missing or misspelled redirect before
 * production — which is exactly where every bookmark, every GroupMe link and
 * every published Schefter article still points.
 *
 * It also pins the half of the move that is easy to get backwards: Best Ball
 * deliberately did NOT move. It keeps `/draft-room` and `/mock-draft`, and its
 * nav entries must keep pointing there.
 */

const vercel = JSON.parse(readFileSync('vercel.json', 'utf-8')) as {
  redirects: { source: string; destination: string; statusCode?: number }[];
};

/** Old path → new path, for every route the move touched. */
const MOVED: Record<string, string> = {
  '/draft-predictor': '/draft/order',
  '/draft-broadcast': '/draft/broadcast',
  '/draft-room': '/draft/room',
  '/mock-draft': '/draft/mock',
};

const redirectFor = (source: string) =>
  vercel.redirects.find((r) => r.source === source);

describe('draft route redirects', () => {
  it('redirects every old BARE draft path (the apex hosts serve these)', () => {
    for (const [oldPath, newPath] of Object.entries(MOVED)) {
      const rule = redirectFor(oldPath);
      expect(rule, `no vercel redirect for ${oldPath}`).toBeDefined();
      expect(rule!.destination).toBe(newPath);
      expect(rule!.statusCode).toBe(301);
    }
  });

  it('redirects the league-PREFIXED forms too (the shared host serves these)', () => {
    const prefixed: [string, string][] = [
      ['/theleague/draft-predictor', '/theleague/draft/order'],
      ['/theleague/draft-broadcast', '/theleague/draft/broadcast'],
      ['/theleague/draft-room', '/theleague/draft/room'],
      ['/theleague/mock-draft', '/theleague/draft/mock'],
      ['/afl-fantasy/draft-predictor', '/afl-fantasy/draft/order'],
      ['/afl-fantasy/draft-broadcast', '/afl-fantasy/draft/broadcast'],
    ];
    for (const [src, dest] of prefixed) {
      const rule = redirectFor(src);
      expect(rule, `no vercel redirect for ${src}`).toBeDefined();
      expect(rule!.destination).toBe(dest);
    }
  });

  it('carries mock-draft SUB-paths, not just the index', () => {
    // /mock-draft/<sessionId> and /mock-draft/<sessionId>/results are live
    // URLs owners share with each other mid-mock. A bare index redirect would
    // strand every one of them.
    for (const src of ['/mock-draft/:path*', '/theleague/mock-draft/:path*']) {
      const rule = redirectFor(src);
      expect(rule, `no wildcard redirect for ${src}`).toBeDefined();
      expect(rule!.destination).toContain('/draft/mock/:path*');
    }
  });

  it('places the draft rules BEFORE the apex prefix-strip rules', () => {
    // Vercel evaluates redirects top-down and `/theleague/:path*` -> `/:path*`
    // matches every prefixed draft URL. Below it, the prefixed draft rules
    // would still work but only via a second hop.
    const firstStrip = vercel.redirects.findIndex((r) => r.source === '/theleague/:path*');
    const lastDraft = vercel.redirects.map((r) => r.source).lastIndexOf('/best-ball-1/draft/mock/:path*');
    expect(firstStrip).toBeGreaterThan(-1);
    expect(lastDraft).toBeGreaterThan(-1);
    expect(lastDraft).toBeLessThan(firstStrip);
  });

  it('every redirect destination resolves to a real page file', () => {
    // A BARE destination like /draft/order is league-relative: it only becomes
    // a real path once an apex host rewrite puts the league prefix back on.
    // So a bare path is satisfied by ANY league owning that route.
    const LEAGUE_DIRS = ['theleague', 'afl-fantasy', 'best-ball-1'];
    const resolves = (rel: string) =>
      [`src/pages/${rel}.astro`, `src/pages/${rel}/index.astro`, `src/pages/${rel}`].some(
        existsSync
      );
    const pageFor = (p: string) => {
      const rel = p.replace(/^\//, '').replace(/\/:path\*$/, '');
      if (LEAGUE_DIRS.some((d) => rel.startsWith(`${d}/`))) return resolves(rel);
      return LEAGUE_DIRS.some((d) => resolves(`${d}/${rel}`));
    };
    const draftDests = vercel.redirects
      .map((r) => r.destination)
      .filter((d) => d.includes('draft') || d.includes('mock'));
    expect(draftDests.length).toBeGreaterThan(0);
    for (const d of draftDests) {
      expect(pageFor(d), `redirect destination ${d} has no page file`).toBe(true);
    }
  });

  describe('Best Ball did not move', () => {
    it('keeps its own /draft-room and /mock-draft nav paths', () => {
      const links = navConfig.sections.flatMap((s: any) => s.links ?? []);
      const bb = (id: string) => links.find((l: any) => l.id === id);
      expect(bb('bb-draft-room')?.path).toBe('/draft-room');
      expect(bb('bb-mock-draft')?.path).toBe('/mock-draft');
      // …and they are genuinely Best Ball's, not a stray untagged link.
      expect(bb('bb-draft-room')?.leagueOnly).toBe('bb1');
      expect(bb('bb-mock-draft')?.leagueOnly).toBe('bb1');
    });

    it('still has the page files those paths point at', () => {
      expect(existsSync('src/pages/best-ball-1/draft-room.astro')).toBe(true);
      expect(existsSync('src/pages/best-ball-1/mock-draft/index.astro')).toBe(true);
    });

    it('catches the league switcher handing Best Ball a /draft/* path', () => {
      // routeEquivalence has ONE value per key for ALL target leagues, so
      // switching into bb1 from TheLeague's draft room asks for
      // /best-ball-1/draft/room — a path bb1 does not have.
      for (const [src, dest] of [
        ['/best-ball-1/draft/room', '/best-ball-1/draft-room'],
        ['/best-ball-1/draft/mock', '/best-ball-1/mock-draft'],
      ]) {
        expect(redirectFor(src)?.destination, `bb1 compat redirect for ${src}`).toBe(dest);
      }
    });
  });

  it('leaves no old draft path in the page directory', () => {
    const stale = (pageDirectory as { id: string; path: string }[]).filter(
      (p) =>
        !p.path.startsWith('/best-ball-1/') &&
        /\/(draft-predictor|draft-broadcast|draft-room|mock-draft)\b/.test(p.path)
    );
    expect(stale.map((p) => `${p.id} → ${p.path}`)).toEqual([]);
  });
});
