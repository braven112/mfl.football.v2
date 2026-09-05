import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  REPO_ROOT,
  assertRatchet,
  expectAllPresent,
  expectClean,
  scanForbidden,
  scanRequired,
  walkFiles,
} from './helpers/scan-guard';

/**
 * The scan-guard helpers are what every `/guard-test` output leans on, so
 * their own contract is pinned here against a throwaway fixture tree:
 *
 *   - a hit reports file:line and the pattern name;
 *   - an allowlist entry is scoped to the pattern names it lists;
 *   - an allowlist entry that exempts nothing is itself a failure;
 *   - `exempt` is consulted per match, not per file;
 *   - a ratchet fails in BOTH directions.
 */

// Built OUTSIDE the repo: tests/path-guard-map.test.ts walks tests/ in a
// parallel worker, and a fixture tree appearing and vanishing under it is a
// race; it also keeps the fake literals out of anything `git add -A` sees.
// walkFiles resolves roots against REPO_ROOT, so an absolute root works and
// reported paths come back as repo-relative `../…` — hence `rel()` below.
const FIXTURE_ABS = mkdtempSync(path.join(tmpdir(), 'scan-guard-fixture-'));
const FIXTURE = path.relative(REPO_ROOT, FIXTURE_ABS).split(path.sep).join('/');
const abs = (p: string) => path.join(FIXTURE_ABS, p);

beforeAll(() => {
  mkdirSync(abs('nested/node_modules'), { recursive: true });
  writeFileSync(abs('clean.ts'), "export const ok = 'nothing to see';\n");
  // Fake tokens on purpose: this tree must never carry a real league literal.
  writeFileSync(abs('dirty.ts'), "const id = 'FAKEID99';\n// second: FAKEID99 again\nconst host = 'www00.fakehost.example';\n");
  writeFileSync(abs('nested/listed.ts'), "const id = 'FAKEID99'; // allowlisted\n");
  writeFileSync(abs('nested/node_modules/ignored.ts'), "const id = 'FAKEID99';\n");
  writeFileSync(abs('skip.md'), "FAKEID99\n");
  writeFileSync(abs('article-a.ts'), "type: 'trade'\nrelatedLinks: []\n");
  writeFileSync(abs('article-b.ts'), "type: 'recap'\n");
  writeFileSync(abs('not-an-article.ts'), "export {}\n");
  writeFileSync(abs('ratchet.json'), JSON.stringify({ total: 5 }));
});

afterAll(() => {
  rmSync(FIXTURE_ABS, { recursive: true, force: true });
});

const roots = [FIXTURE];

describe('walkFiles', () => {
  it('filters by extension, skips node_modules, and returns sorted repo-relative paths', () => {
    const files = walkFiles({ roots, extensions: ['.ts'] });
    expect(files).toEqual([
      `${FIXTURE}/article-a.ts`,
      `${FIXTURE}/article-b.ts`,
      `${FIXTURE}/clean.ts`,
      `${FIXTURE}/dirty.ts`,
      `${FIXTURE}/nested/listed.ts`,
      `${FIXTURE}/not-an-article.ts`,
    ]);
  });
});

describe('scanForbidden', () => {
  const forbidden = [
    { name: 'league id', pattern: /FAKEID99/ },
    { name: 'mfl host', pattern: /www\d+\.fakehost/ },
  ];

  it('reports every match with file:line and pattern name', () => {
    const { hits } = scanForbidden({ roots, extensions: ['.ts'], forbidden });
    expect(hits.map((h) => `${path.basename(h.file)}:${h.line}:${h.name}`)).toEqual([
      'dirty.ts:1:league id',
      'dirty.ts:2:league id',
      'dirty.ts:3:mfl host',
      'listed.ts:1:league id',
    ]);
  });

  it('an allowlist entry exempts only the names it lists, and a stale entry is reported', () => {
    const res = scanForbidden({
      roots,
      extensions: ['.ts'],
      forbidden,
      allowlist: [
        { file: `${FIXTURE}/nested/listed.ts`, names: ['league id'], reason: 'fixture' },
        { file: `${FIXTURE}/dirty.ts`, names: ['league id'], reason: 'ids only — host still fails' },
        { file: `${FIXTURE}/clean.ts`, reason: 'stale: nothing here matches' },
      ],
    });
    expect(res.hits.map((h) => `${path.basename(h.file)}:${h.name}`)).toEqual(['dirty.ts:mfl host']);
    expect(res.unusedAllowlist.map((a) => path.basename(a.file))).toEqual(['clean.ts']);
    expect(() => expectClean(res, 'rule')).toThrow(/Stale allowlist/);
  });

  it('exempt() is consulted per match', () => {
    const res = scanForbidden({
      roots,
      extensions: ['.ts'],
      forbidden,
      exempt: ({ line }) => line.includes('//'),
    });
    expect(res.hits.map((h) => `${path.basename(h.file)}:${h.line}`)).toEqual(['dirty.ts:1', 'dirty.ts:3']);
  });

  it('expectClean throws a to-do list on hits and passes on a clean scan', () => {
    const dirty = scanForbidden({ roots, extensions: ['.ts'], forbidden });
    expect(() => expectClean(dirty, 'No league literals.')).toThrow(/dirty\.ts:1 {2}\[league id\]/);
    const clean = scanForbidden({ roots, extensions: ['.md'], forbidden: [{ name: 'x', pattern: /nope/ }] });
    expect(() => expectClean(clean, 'rule')).not.toThrow();
  });
});

describe('scanRequired', () => {
  it('flags files that have the trigger but not the companion, and honors the allowlist', () => {
    const res = scanRequired({
      roots,
      extensions: ['.ts'],
      name: 'articles declare relatedLinks',
      when: /^type:/m,
      require: /relatedLinks/,
    });
    expect(res.missing.map((f) => path.basename(f))).toEqual(['article-b.ts']);
    expect(() => expectAllPresent(res, 'Every article type declares relatedLinks.')).toThrow(/article-b\.ts/);

    const allowed = scanRequired({
      roots,
      extensions: ['.ts'],
      name: 'articles declare relatedLinks',
      when: /^type:/m,
      require: /relatedLinks/,
      allowlist: [{ file: `${FIXTURE}/article-b.ts`, reason: 'fixture' }],
    });
    expect(allowed.missing).toEqual([]);
    expect(allowed.unusedAllowlist).toEqual([]);
  });
});

describe('assertRatchet', () => {
  const base = { baselineFile: `${FIXTURE}/ratchet.json`, label: 'widgets', howToRetighten: 'edit total' };
  it('passes at the baseline, fails above it, and fails below it with a retighten message', () => {
    expect(() => assertRatchet({ ...base, current: 5 })).not.toThrow();
    expect(() => assertRatchet({ ...base, current: 6 })).toThrow(/regression/);
    expect(() => assertRatchet({ ...base, current: 4 })).toThrow(/Retighten: edit total/);
  });
});
