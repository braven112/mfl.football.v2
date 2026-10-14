/**
 * One page, one icon — wherever it is linked from.
 *
 * `src/config/page-icons.json` is the only place a page's icon is chosen;
 * `pageIcon(path, league)` (src/utils/page-icon.ts) reads it. In Oct 2026 an
 * audit found 24 pages wearing a different icon depending on where the link
 * sat: Playoffs was the bracket in the menu and the title belt in the
 * related-pages card under it, the draft sub-nav still wore the glyphs the
 * menu had just retired, and Archie's menu had its own picks. Every copy had
 * been chosen by hand, so every copy drifted.
 *
 * This suite keeps the copies honest:
 *  - nav-config.json and page-directory.json still store an `icon` per link
 *    (search, quick links and the menu read them directly); each must equal
 *    the registry's.
 *  - Every page in page-directory.json must HAVE a registry icon, so a new
 *    page cannot ship without choosing one (scripts/scaffold-page.mjs writes
 *    it there).
 *  - Code that renders a page link takes the icon from pageIcon(); a source
 *    object that pairs a page path with a hand-typed icon that disagrees with
 *    the registry fails the scan below.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';
import registry from '../src/config/page-icons.json';
import navConfig from '../src/config/nav-config.json';
import pageDirectory from '../src/data/page-directory.json';
import { LEAGUES, getLeagueByPath, stripLeaguePrefix } from '../src/config/leagues-data.mjs';
import { pageIcon, hasPageIcon } from '../src/utils/page-icon';
import { draftPagesFor } from '../src/components/shared/draft-nav/draft-pages';
import { frontOfficePagesFor } from '../src/components/shared/front-office-nav/front-office-pages';
import { RELATED_PAGES, relatedPagesFor } from '../src/utils/related-pages';
import { loadSpriteIconIds } from './helpers/sprite-icons';

const ROOT = join(__dirname, '..');

/** nav-config's `leagueOnly` values are nav slugs; map them to registry slugs. */
const NAV_SLUG_TO_LEAGUE: Record<string, string> = Object.fromEntries(
  Object.values(LEAGUES as Record<string, { slug: string; navSlug?: string }>).flatMap((l) => [
    [l.slug, l.slug],
    ...(l.navSlug ? [[l.navSlug, l.slug]] : []),
  ]),
);
NAV_SLUG_TO_LEAGUE.afl ??= 'afl-fantasy';
NAV_SLUG_TO_LEAGUE.bb1 ??= 'best-ball-1';

interface NavLink { path: string; icon: string; iconAFL?: string; leagueOnly?: string; label?: string }

function navLinks(): NavLink[] {
  const out: NavLink[] = [];
  (function walk(o: unknown) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      const r = o as Record<string, unknown>;
      if (typeof r.path === 'string' && typeof r.icon === 'string') out.push(r as unknown as NavLink);
      Object.values(r).forEach(walk);
    }
  })(navConfig);
  return out;
}

describe('page-icons.json', () => {
  const sprite = loadSpriteIconIds();

  it('every icon is a real, bare glyph id', () => {
    const all = [
      ...Object.entries(registry.pages).map(([p, i]) => [p, i] as const),
      ...Object.entries(registry.leagueOverrides).flatMap(([l, m]) =>
        Object.entries(m as Record<string, string>).map(([p, i]) => [`${l}:${p}`, i] as const)),
    ];
    const bad = all.filter(([, i]) => i.startsWith('icon-') || !sprite.has(i)).map(([p, i]) => `${p} -> ${i}`);
    expect(bad).toEqual([]);
  });

  it('overrides are keyed by registry league slugs and name pages the registry has', () => {
    const slugs = new Set(Object.values(LEAGUES as Record<string, { slug: string }>).map((l) => l.slug));
    // The custom-site demo's keeper slot is registered only on a demo
    // deployment (leagues-data.mjs), so it is absent here but real there.
    slugs.add('keeper');
    for (const [slug, map] of Object.entries(registry.leagueOverrides)) {
      expect(slugs.has(slug), `unknown league "${slug}"`).toBe(true);
      for (const p of Object.keys(map as Record<string, string>)) {
        expect(hasPageIcon(p), `${slug} overrides "${p}", which has no base icon`).toBe(true);
      }
    }
  });

  it('pageIcon applies an override, then the base, and refuses an unknown page', () => {
    expect(pageIcon('/rosters', 'afl-fantasy')).toBe('roster-16');
    expect(pageIcon('/rosters', 'theleague')).toBe('roster');
    expect(pageIcon('/playoffs?week=15')).toBe(pageIcon('/playoffs'));
    expect(() => pageIcon('/no-such-page')).toThrow(/page-icons\.json/);
  });
});

describe('every copy of a page icon agrees with the registry', () => {
  it('page-directory.json: every page has a registry icon, and stores the same one', () => {
    const wrong: string[] = [];
    for (const entry of pageDirectory as { id: string; path: string; icon: string }[]) {
      const league = getLeagueByPath(entry.path);
      const local = stripLeaguePrefix(league, entry.path);
      if (!hasPageIcon(local)) {
        wrong.push(`${entry.path}: no icon in src/config/page-icons.json`);
        continue;
      }
      const want = pageIcon(local, league.slug);
      if (entry.icon !== want) wrong.push(`${entry.path}: "${entry.icon}", registry says "${want}"`);
    }
    expect(wrong).toEqual([]);
  });

  it('nav-config.json: every link stores its page icon (and iconAFL only where the AFL differs)', () => {
    const wrong: string[] = [];
    for (const link of navLinks()) {
      if (/^https?:/.test(link.path)) continue;
      const league = link.leagueOnly ? NAV_SLUG_TO_LEAGUE[link.leagueOnly] ?? link.leagueOnly : 'theleague';
      if (!hasPageIcon(link.path)) {
        wrong.push(`${link.path}: no icon in src/config/page-icons.json`);
        continue;
      }
      const want = pageIcon(link.path, league);
      if (link.icon !== want) wrong.push(`${link.path} (${league}): "${link.icon}", registry says "${want}"`);
      if (!link.leagueOnly) {
        const afl = pageIcon(link.path, 'afl-fantasy');
        const shown = link.iconAFL ?? link.icon;
        if (shown !== afl) wrong.push(`${link.path} (afl-fantasy): "${shown}", registry says "${afl}"`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('the draft and Front Office sub-navs and the related-pages cards resolve every page', () => {
    for (const league of ['theleague', 'afl-fantasy'] as const) {
      for (const p of draftPagesFor(league)) expect(p.icon).toBe(`icon-${pageIcon(p.path, league)}`);
      for (const p of frontOfficePagesFor(league)) expect(p.icon).toBe(`icon-${pageIcon(p.path, league)}`);
      for (const host of Object.keys(RELATED_PAGES)) {
        for (const p of relatedPagesFor(host, league, false)?.pages ?? []) expect(p.icon).toBe(pageIcon(p.path, league));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Source scan: no hand-picked icon on a page link
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(astro|ts|tsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const SOURCES = walk(join(ROOT, 'src')).map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, 'utf8') }));

describe('source scan', () => {
  it('every pageIcon() literal names a page the registry has', () => {
    const missing: string[] = [];
    for (const { file, text } of SOURCES) {
      for (const m of text.matchAll(/pageIcon\(\s*['"`]([^'"`$]+)['"`]/g)) {
        if (!hasPageIcon(m[1])) missing.push(`${file}: pageIcon('${m[1]}')`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('no object pairs a page link with a hand-typed icon that disagrees with the registry', () => {
    // A one-level object literal carrying both a page path (`path:`/`href:`,
    // plain or wrapped in a helper such as r()/href()) and a literal `icon:`.
    const OBJ = /\{[^{}]*?\b(?:path|href)\s*:\s*(?:[a-zA-Z_]+\()?\s*['"`]([^'"`]*)['"`][^{}]*?\bicon\s*:\s*['"](?:icon-)?([a-z0-9-]+)['"][^{}]*\}|\{[^{}]*?\bicon\s*:\s*['"](?:icon-)?([a-z0-9-]+)['"][^{}]*?\b(?:path|href)\s*:\s*(?:[a-zA-Z_]+\()?\s*['"`]([^'"`]*)['"`][^{}]*\}/g;
    const offenders: string[] = [];
    for (const { file, text } of SOURCES) {
      if (file.endsWith('page-icon.ts')) continue;
      for (const m of text.matchAll(OBJ)) {
        const rawPath = (m[1] ?? m[4]).replace(/^\$\{[^}]+\}/, '');
        const icon = m[2] ?? m[3];
        if (!rawPath.startsWith('/')) continue;
        const league = getLeagueByPath(rawPath);
        const local = stripLeaguePrefix(league, rawPath);
        if (!hasPageIcon(local)) continue;
        const want = pageIcon(local, league.slug);
        if (icon !== want) offenders.push(`${file}: ${rawPath} wears "${icon}", its page icon is "${want}" — use pageIcon()`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
