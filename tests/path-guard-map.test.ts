import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  loadMap,
  matchDomains,
  newPageWarnings,
  toRepoRelative,
  trapLineFor,
  walkRepo,
  MAP_FILE,
  REPO_ROOT,
} from '../.claude/hooks/path-guard.mjs';
import { ALL_LEAGUES, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';

/**
 * Path-guard map validator.
 *
 * `.claude/hooks/path-guard.mjs` runs on every Write/Edit and decides, from
 * `.claude/hooks/path-guard.json`, which guard suites to run and which rules
 * doc to surface. A map entry that points at a renamed test or a moved doc
 * fails SILENTLY at edit time — the hook skips what it can't find, the edit
 * goes through unguarded, and nobody notices until the bug the guard existed
 * for ships again. So the map is checked here, where a stale pointer is loud.
 *
 * Also pinned: every `docs/claude/rules/*.md` is routed by at least one
 * domain. A rules doc no path leads to is prose nobody is told to read.
 */

const map = loadMap(MAP_FILE);
const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
// data/ is 161 MB and no map glob points into it; skipping it takes this
// suite from ~3.6 s to well under a second, and it runs on every docs edit.
const repoFiles = walkRepo(REPO_ROOT, { skipPaths: ['data'] });
const claudeMd = readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');

describe('path-guard map', () => {
  it('every domain has a name, at least one path glob, and at least one test', () => {
    for (const d of map.domains) {
      expect(d.name, JSON.stringify(d)).toBeTruthy();
      expect(d.paths?.length, `${d.name}: paths`).toBeGreaterThan(0);
      expect(d.tests?.length, `${d.name}: tests`).toBeGreaterThan(0);
    }
  });

  it('domain names are unique', () => {
    const names = map.domains.map((d: { name: string }) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every path glob matches at least one file in the repo (a typo guards nothing)', () => {
    const dead: string[] = [];
    for (const d of map.domains) {
      for (const glob of d.paths) {
        if (!repoFiles.some((f) => path.matchesGlob(f, glob))) dead.push(`${d.name}: ${glob}`);
      }
    }
    expect(dead, `globs that match nothing:\n  ${dead.join('\n  ')}`).toEqual([]);
  });

  it('every test file exists under tests/', () => {
    const missing: string[] = [];
    for (const d of map.domains) {
      for (const t of d.tests) {
        if (!t.startsWith('tests/')) missing.push(`${d.name}: ${t} (must live under tests/)`);
        else if (!existsSync(path.join(REPO_ROOT, t))) missing.push(`${d.name}: ${t}`);
      }
    }
    expect(missing, `tests that do not exist:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('every rules doc exists', () => {
    const missing: string[] = [];
    for (const d of map.domains) {
      for (const doc of asList(d.rules)) {
        if (!existsSync(path.join(REPO_ROOT, doc))) missing.push(`${d.name}: ${doc}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every docs/claude/rules/*.md is routed by at least one domain', () => {
    const rulesDir = path.join(REPO_ROOT, 'docs/claude/rules');
    const docs = readdirSync(rulesDir)
      .filter((f) => f.endsWith('.md') && f !== 'README.md')
      .map((f) => `docs/claude/rules/${f}`);
    const routed = new Set<string>(map.domains.flatMap((d: { rules?: string | string[] }) => asList(d.rules)));
    const orphans = docs.filter((doc) => !routed.has(doc));
    expect(
      orphans,
      `rules docs with no domain in .claude/hooks/path-guard.json (add one — nothing else tells an editor to read them):\n  ${orphans.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every domain doc that has a CLAUDE.md "Read before you touch" row yields its trap line', () => {
    // Not every doc has a row (cross-cutting rules live in CLAUDE.md prose), but
    // the ones that do must be findable — the hook prints the trap from here.
    const routed = new Set<string>(map.domains.flatMap((d: { rules?: string | string[] }) => asList(d.rules)));
    const rowDocs = [...claudeMd.matchAll(/`(docs\/[^`]+\.md)`/g)]
      .map((m) => m[1])
      .filter((doc) => routed.has(doc) && claudeMd.split('\n').some((l) => l.startsWith('|') && l.includes(doc)));
    expect(rowDocs.length).toBeGreaterThan(5);
    for (const doc of rowDocs) {
      expect(trapLineFor(doc, claudeMd), doc).toBeTruthy();
    }
  });
});

describe('path-guard matching', () => {
  it('routes the historical Roger paths to the Roger domain (the hook this generalized)', () => {
    for (const p of [
      'scripts/schefter-scan.mjs',
      'scripts/compute-league-events.mjs',
      'scripts/lib/roger-reminder-window.mjs',
      'src/data/theleague/league-year-config.ts',
      'src/data/theleague/nfl-draft-dates-fetched.json',
    ]) {
      const names = matchDomains(p, map).map((d: { name: string }) => d.name);
      expect(names, p).toContain('roger');
    }
    const rogerTests = map.domains.find((d: { name: string }) => d.name === 'roger').tests;
    expect(rogerTests).toContain('tests/roger-reminder-window.test.ts');
  });

  it('resolves a path reaching the repo through a symlink (REPO_ROOT is realpath\'d, the hook input is not)', () => {
    const linkDir = mkdtempSync(path.join(tmpdir(), 'path-guard-link-'));
    const link = path.join(linkDir, 'repo');
    try {
      symlinkSync(REPO_ROOT, link);
      expect(toRepoRelative(path.join(link, 'src/utils/auth.ts'))).toBe('src/utils/auth.ts');
      // A Write that has not landed yet: realpath the nearest existing ancestor.
      expect(toRepoRelative(path.join(link, 'src/pages/theleague/not-yet-written.astro'))).toBe(
        'src/pages/theleague/not-yet-written.astro',
      );
    } finally {
      rmSync(linkDir, { recursive: true, force: true });
    }
  });

  it('accepts absolute paths and rejects paths outside the repo', () => {
    expect(toRepoRelative(path.join(REPO_ROOT, 'src/utils/auth.ts'))).toBe('src/utils/auth.ts');
    expect(toRepoRelative('/etc/passwd')).toBeNull();
    expect(matchDomains(null, map)).toEqual([]);
  });

  it('a file that belongs to no domain matches nothing (the hook must stay silent there)', () => {
    expect(matchDomains('README.md', map)).toEqual([]);
    expect(matchDomains('docs/plans/some-plan.md', map)).toEqual([]);
    expect(matchDomains('src/utils/zzz-unmapped-helper.ts', map)).toEqual([]);
  });

  it('every .astro component and page is covered by the ClientRouter init ratchet', () => {
    for (const p of [
      'src/components/SomeRandomCard.astro',
      'src/pages/theleague/anything.astro',
      'src/pages/best-ball-1/anything.astro',
      'src/pages/index.astro',
      'src/pages/login.astro',
    ]) {
      const tests = matchDomains(p, map).flatMap((d: { tests: string[] }) => d.tests);
      expect(tests, p).toContain('tests/clientrouter-init-ratchet.test.ts');
    }
  });

  it('a sibling league page matches the page-forks domain on both sides, nested routes included', () => {
    for (const p of [
      'src/pages/theleague/players.astro',
      'src/pages/afl-fantasy/players.astro',
      'src/pages/theleague/draft/order.astro',
      'src/pages/afl-fantasy/reports/deep/new.astro',
    ]) {
      expect(matchDomains(p, map).map((d: { name: string }) => d.name)).toContain('page-forks');
    }
  });
});

describe('new-page warnings', () => {
  const leagues = [
    { slug: 'theleague', bestBall: false },
    { slug: 'afl-fantasy', bestBall: false },
    { slug: 'best-ball-1', bestBall: true },
  ];
  const directory = [{ path: '/registered' }, { path: '/theleague/prefixed' }];
  const files = new Set([
    'src/pages/theleague',
    'src/pages/afl-fantasy',
    'src/pages/best-ball-1',
    'src/pages/theleague/registered.astro',
    'src/pages/afl-fantasy/registered.astro',
    'src/pages/theleague/prefixed.astro',
    'src/pages/afl-fantasy/prefixed.astro',
    'src/pages/theleague/lonely.astro',
  ]);
  const ctx = { leagues, directory, exists: (p: string) => files.has(p), defaultLeague: 'theleague' };

  it('accepts a bare path for the default league only, and a prefixed path for any league', () => {
    expect(newPageWarnings('src/pages/theleague/registered.astro', ctx)).toEqual([]);
    expect(newPageWarnings('src/pages/theleague/prefixed.astro', ctx)).toEqual([]);
    // AFL page registered only by the bare entry: search filters that entry to
    // TheLeague (pathBelongsToLeague), so it is NOT registered for the AFL.
    const w = newPageWarnings('src/pages/afl-fantasy/registered.astro', ctx);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/"\/afl-fantasy\/registered"/);
    expect(w[0]).not.toMatch(/twin/);
  });

  it('is silent for a registered route with a twin, and for non-page paths', () => {
    expect(newPageWarnings('src/pages/theleague/registered.astro', ctx)).toEqual([]);
    expect(newPageWarnings('src/utils/auth.ts', ctx)).toEqual([]);
    expect(newPageWarnings('src/pages/api/thing.ts', ctx)).toEqual([]);
    expect(newPageWarnings('src/pages/theleague/news/[id].astro', ctx)).toEqual([]);
    expect(newPageWarnings('src/pages/theleague/index.astro', ctx)).toEqual([]);
  });

  it('warns once for a missing directory entry and once for a missing twin, never for best-ball', () => {
    const w = newPageWarnings('src/pages/theleague/lonely.astro', ctx);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatch(/page-directory\.json/);
    expect(w[1]).toMatch(/src\/pages\/afl-fantasy\//);
    expect(w[1]).not.toMatch(/best-ball-1/);
  });

  it('flags no real registered page as unregistered (the directory mixes neutral and prefixed paths)', () => {
    const directory = JSON.parse(readFileSync(path.join(REPO_ROOT, 'src/data/page-directory.json'), 'utf8'));
    const ctx = {
      leagues: ALL_LEAGUES.map((l: { slug: string; bestBall?: boolean }) => ({ slug: l.slug, bestBall: Boolean(l.bestBall) })),
      directory,
      exists: (p: string) => existsSync(path.join(REPO_ROOT, p)),
      defaultLeague: DEFAULT_LEAGUE_SLUG,
    };
    const registeredPaths = new Set<string>(directory.map((e: { path: string }) => e.path));
    const falseAlarms: string[] = [];
    for (const rel of repoFiles.filter((f) => /^src\/pages\/(theleague|afl-fantasy)\/[^/[]+\.astro$/.test(f))) {
      const route = rel.replace(/^src\/pages\/[^/]+\//, '').replace(/\.astro$/, '');
      const league = rel.split('/')[2];
      const registered = registeredPaths.has(`/${league}/${route}`) || (league === DEFAULT_LEAGUE_SLUG && registeredPaths.has(`/${route}`));
      const warned = newPageWarnings(rel, ctx).some((w) => w.includes('page-directory.json'));
      if (registered && warned) falseAlarms.push(rel);
    }
    expect(falseAlarms).toEqual([]);
  });
});
