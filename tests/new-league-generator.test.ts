/**
 * scripts/new-league.mjs — the League Launcher's generator.
 *
 * The full proof is end to end: generate a league into the working tree and
 * run the whole suite plus the type check against it (done when this was
 * built: every suite green). These tests pin the pieces that proof depends on
 * without writing anything to the repo.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from '../src/config/league-archetypes.mjs';
import { PACKAGE_ROUTES, packageLeagueHasPath, packageRouteForPath } from '../src/config/package-league-routes.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { planLaunch, registryEntry, specErrors } from '../scripts/new-league.mjs';
import { renderKit } from '../scripts/lib/package-kit.mjs';

const SPEC = {
  mflId: '70707',
  slug: 'smith',
  name: 'Smith Family League',
  shortName: 'Smith',
  mflHost: 'www40.myfantasyleague.com',
  archetype: 'standard-redraft',
  features: { ...ARCHETYPES['standard-redraft'].features },
};

describe('the spec', () => {
  it('accepts a complete spec', () => {
    expect(specErrors(SPEC)).toEqual([]);
  });

  it('refuses what would break a generated file', () => {
    expect(specErrors({ ...SPEC, slug: 'smith-league' })[0]).toMatch(/slug/);
    expect(specErrors({ ...SPEC, name: 'Bad "Quote" League' })[0]).toMatch(/name/);
    expect(specErrors({ ...SPEC, mflHost: 'example.com' })[0]).toMatch(/mflHost/);
    expect(specErrors({ ...SPEC, features: { ...SPEC.features, schefterTips: true, schefterFeed: false } })).toContain(
      'schefterTips requires schefterFeed',
    );
  });

  it('refuses a league that already exists', () => {
    expect(specErrors({ ...SPEC, slug: 'archies' }).join()).toMatch(/already/);
    expect(specErrors({ ...SPEC, mflId: LEAGUES.theleague.id }).join()).toMatch(/already/);
  });
});

describe('the template', () => {
  it('every package route has a template in the page kit (templates/package-league)', () => {
    for (const route of Object.keys(PACKAGE_ROUTES)) {
      expect(existsSync(path.join('templates/package-league', `${route}.tmpl`)), route).toBe(true);
    }
  });

  it('maps unprefixed paths to routes', () => {
    expect(packageRouteForPath('/')).toBe('index.astro');
    expect(packageRouteForPath('/pecking-order')).toBe('pecking-order/index.astro');
    expect(packageRouteForPath('/front-office/trade-builder')).toBe('front-office/trade-builder.astro');
    expect(packageRouteForPath('/schedule-strength')).toBeNull();
    expect(packageLeagueHasPath({ features: { liveScoring: false } }, '/live-scoring')).toBe(false);
  });

  it('renders every kit placeholder for the league', () => {
    const out = renderKit(
      "import c from '../../../data/__LEAGUE_SLUG__/__LEAGUE_SLUG__.config.json';\nconst x = getLeagueBySlug('__LEAGUE_SLUG__');\n<p>__LEAGUE_NAME__ — __LEAGUE_SHORT__</p>",
      SPEC,
    );
    expect(out).toContain('data/smith/smith.config.json');
    expect(out).toContain("getLeagueBySlug('smith')");
    expect(out).toContain('Smith Family League — Smith');
    expect(out).not.toMatch(/__LEAGUE_/);
  });
});

describe('the plan', () => {
  const plan = planLaunch(SPEC);
  const byPath = new Map(plan.files.map((f) => [f.path, f.content]));

  it('writes a registry that still parses, with the new entry in house style', () => {
    const registry = byPath.get('src/config/leagues-data.mjs')!;
    const dir = mkdtempSync(path.join(tmpdir(), 'new-league-'));
    const file = path.join(dir, 'leagues-data.mjs');
    writeFileSync(file, registry);
    execFileSync(process.execPath, ['--check', file]);
    expect(registry).toContain("    slug: 'smith',");
    expect(registry).toContain("navSlug: /** @type {const} */ ('smith')");
    expect(registryEntry(SPEC)).toContain('articleTypes: []');
  });

  it("generates only the pages the features entitle, with no trace of Archie's", () => {
    const pages = [...byPath.keys()].filter((p) => p.startsWith('src/pages/smith/'));
    expect(pages.length).toBe(plan.routes.length);
    expect(pages).not.toContain('src/pages/smith/schedule-strength.astro');
    const off = planLaunch({ ...SPEC, features: { ...SPEC.features, liveScoring: false, liveScoringSample: false } });
    expect(off.routes).not.toContain('live-scoring.astro');
    for (const p of pages) expect(byPath.get(p), p).not.toMatch(/\barchies\b|Archie/);
  });

  it('adds directory entries, a nav section and Chromatic paths — and touches no job workflow', () => {
    const dir = JSON.parse(byPath.get('src/data/page-directory.json')!) as Array<{ path: string; tags: string[] }>;
    const own = dir.filter((e) => e.path === '/smith' || e.path.startsWith('/smith/'));
    expect(own.length).toBe(plan.directoryEntries);
    for (const e of own) expect(e.tags.length).toBeGreaterThanOrEqual(10);
    const nav = JSON.parse(byPath.get('src/config/nav-config.json')!);
    expect(nav.sections.some((s: { id: string }) => s.id === 'smith')).toBe(true);
    // Scheduled jobs read the registry (scripts/lib/league-jobs.mjs); the only
    // workflow a launch may write is Chromatic's path filter.
    const workflows = [...byPath.keys()].filter((p) => p.startsWith('.github/workflows/'));
    expect(workflows).toEqual(['.github/workflows/chromatic.yml']);
    expect(byPath.get('.github/workflows/chromatic.yml')!.match(/data\/smith\/smith\.config\.json/g)?.length).toBe(2);
  });
});
