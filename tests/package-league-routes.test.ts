/**
 * A package league's pages, site-search entries and nav come from ONE place:
 * the page kit (templates/package-league, scripts/lib/package-kit.mjs) and the
 * league's ticked features (src/config/package-league-routes.mjs).
 *
 * Fails when:
 *   - a route file drifted from its template (someone edited
 *     src/pages/<league>/x.astro instead of the template), or a route exists
 *     without its feature / is missing with it;
 *   - a league's search entries or nav links disagree with its features;
 *   - the kit lost a template, or carries one league's name;
 *   - the nav shows a link to a page the league's features do not entitle.
 *
 * Fix for the first two: `node scripts/sync-league-routes.mjs --all`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_LEAGUES, LEAGUES } from '../src/config/leagues-data.mjs';
import { PACKAGE_ROUTES, isPackageLeague } from '../src/config/package-league-routes.mjs';
import { KIT_DIR, syncDirectory, syncNav, syncPlan } from '../scripts/lib/package-kit.mjs';
import { getVisibleLinks } from '../src/utils/nav-utils';

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_LEAGUES = ALL_LEAGUES.filter(isPackageLeague);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('the page kit', () => {
  it('has exactly one template per manifest route', () => {
    const templates = walk(path.join(ROOT, KIT_DIR))
      .filter((f) => f.endsWith('.tmpl'))
      .map((f) => path.relative(path.join(ROOT, KIT_DIR), f).replace(/\.tmpl$/, ''))
      .sort();
    expect(templates).toEqual(Object.keys(PACKAGE_ROUTES).sort());
  });

  it('names no package league — its slug and names are placeholders', () => {
    // (A reference to a hand-built league — "mirrors /afl-fantasy/login" — is
    // fine: that text is true for every league the kit renders.)
    for (const f of walk(path.join(ROOT, KIT_DIR))) {
      const text = readFileSync(f, 'utf8');
      for (const l of PACKAGE_LEAGUES) {
        expect(text, path.relative(ROOT, f)).not.toMatch(new RegExp(`\\b${l.slug}\\b`));
      }
      expect(text, path.relative(ROOT, f)).not.toMatch(/Archie/);
    }
  });
});

describe('every package league matches its features and the kit', () => {
  it('there is at least one (Archie’s)', () => {
    expect(PACKAGE_LEAGUES.map((l) => l.slug)).toContain('archies');
  });

  for (const league of PACKAGE_LEAGUES) {
    it(league.slug, () => {
      const pending = syncPlan(league).map((c) => `${c.content === null ? 'delete' : 'write'} ${c.path}`);
      expect(
        pending,
        `${league.slug} is out of line with its features or the page kit. Edit the template in ${KIT_DIR}, ` +
          'not the route file, then run `node scripts/sync-league-routes.mjs --all`.',
      ).toEqual([]);
    });
  }
});

describe('unticking a feature', () => {
  const off = { ...LEAGUES.archies, features: { ...LEAGUES.archies.features, powerRankings: false } };

  it('removes its pages, search entries and nav links, and nothing else', () => {
    const plan = syncPlan(off);
    expect(plan.filter((c) => c.content === null).map((c) => c.path).sort()).toEqual([
      'src/pages/archies/pecking-order/[year]/[week].astro',
      'src/pages/archies/pecking-order/index.astro',
    ]);
    const dir = JSON.parse(readFileSync(path.join(ROOT, 'src/data/page-directory.json'), 'utf8'));
    const after = syncDirectory(dir, off);
    expect(dir.length - after.length).toBe(1);
    expect(after.some((e: { path: string }) => e.path === '/archies/pecking-order')).toBe(false);

    const nav = JSON.parse(readFileSync(path.join(ROOT, 'src/config/nav-config.json'), 'utf8'));
    const links = syncNav(nav, off).sections.find((s: { id: string }) => s.id === 'archies').links;
    expect(links.map((l: { path: string }) => l.path)).not.toContain('/pecking-order');
    // Archie's own page (The Gauntlet) is not a kit route and stays.
    expect(links.map((l: { path: string }) => l.path)).toContain('/schedule-strength');
  });

  it('and re-ticking it puts the nav link back where it was', () => {
    const nav = JSON.parse(readFileSync(path.join(ROOT, 'src/config/nav-config.json'), 'utf8'));
    const before = nav.sections.find((s: { id: string }) => s.id === 'archies').links.map((l: { path: string }) => l.path);
    const back = syncNav(syncNav(nav, off), LEAGUES.archies)
      .sections.find((s: { id: string }) => s.id === 'archies')
      .links.map((l: { path: string }) => l.path);
    expect(back).toEqual(before);
  });
});

describe('the nav hides a package league link its features do not entitle', () => {
  const saved = { ...LEAGUES.archies.features };
  afterEach(() => {
    Object.assign(LEAGUES.archies.features, saved);
  });

  it('even before the sync has run', () => {
    const nav = JSON.parse(readFileSync(path.join(ROOT, 'src/config/nav-config.json'), 'utf8'));
    const section = nav.sections.find((s: { id: string }) => s.id === 'archies');
    const visible = () => getVisibleLinks(section, 'archies', null, []).map((l) => l.path);
    expect(visible()).toContain('/pecking-order');
    LEAGUES.archies.features.powerRankings = false;
    expect(visible()).not.toContain('/pecking-order');
    expect(visible()).toContain('/schedule-strength');
  });
});

it('no package league route file exists outside a package league', () => {
  // A non-package league's pages are hand-built; the kit must never have
  // written into one.
  for (const l of ALL_LEAGUES.filter((x) => !isPackageLeague(x))) {
    const dir = path.join(ROOT, 'src/pages', l.slug);
    if (!existsSync(dir)) continue;
    for (const f of walk(dir)) expect(readFileSync(f, 'utf8'), path.relative(ROOT, f)).not.toMatch(/__LEAGUE_/);
  }
});
