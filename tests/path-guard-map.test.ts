import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  loadMap,
  matchDomains,
  toRepoRelative,
  trapLineFor,
  walkRepo,
  MAP_FILE,
  REPO_ROOT,
} from '../.claude/hooks/path-guard.mjs';

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
const repoFiles = walkRepo(REPO_ROOT);
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

  it('accepts absolute paths and rejects paths outside the repo', () => {
    expect(toRepoRelative(path.join(REPO_ROOT, 'src/utils/auth.ts'))).toBe('src/utils/auth.ts');
    expect(toRepoRelative('/etc/passwd')).toBeNull();
    expect(matchDomains(null, map)).toEqual([]);
  });

  it('a file that belongs to no domain matches nothing (the hook must stay silent there)', () => {
    expect(matchDomains('README.md', map)).toEqual([]);
    expect(matchDomains('src/components/SomeRandomCard.astro', map)).toEqual([]);
  });

  it('a sibling league page matches the page-forks domain on both sides', () => {
    for (const p of ['src/pages/theleague/players.astro', 'src/pages/afl-fantasy/players.astro']) {
      expect(matchDomains(p, map).map((d: { name: string }) => d.name)).toContain('page-forks');
    }
  });
});
