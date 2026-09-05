import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyConflict, generatedPatternsFrom, mainSide, orderConflicts } from '../scripts/lib/rebase-conflicts.mjs';

/**
 * The rebase conflict classifier behind `/rebase` and
 * scripts/resolve-rebase-conflicts.mjs.
 *
 * Two things are pinned because they are the two ways an automated resolve
 * goes wrong silently:
 *
 *   1. SIDE. Under a rebase `--ours` is main. A tool that "prefers --theirs
 *      for feed files" (CLAUDE.md's wording, written for a merge) keeps the
 *      branch's stale snapshot and throws away the cron's live one — the
 *      exact outcome the rule exists to prevent — and the rebase still
 *      completes cleanly, so nobody notices until a feed goes backwards.
 *
 *   2. CLASS. The generated-data patterns must agree with .gitattributes:
 *      everything that file marks merge=binary is something this tool must
 *      resolve automatically, or the rebase stops on a file the policy says
 *      never to hand-merge.
 */

describe('mainSide', () => {
  it('names main as --ours under a rebase and --theirs under a merge', () => {
    expect(mainSide('rebase')).toBe('ours');
    expect(mainSide('merge')).toBe('theirs');
  });
});

describe('classifyConflict', () => {
  it('routes each CLAUDE.md class', () => {
    expect(classifyConflict('package.json').klass).toBe('package-json');
    expect(classifyConflict('pnpm-lock.yaml').klass).toBe('lockfile');
    expect(classifyConflict('src/data/theleague/schefter-feed.json').klass).toBe('generated-data');
    expect(classifyConflict('src/data/theleague/post-history.json').klass).toBe('generated-data');
    expect(classifyConflict('data/afl-fantasy/mfl-feeds/2026/rosters.json').klass).toBe('generated-data');
    expect(classifyConflict('data/afl-fantasy/derived/keepers-feed.json').klass).toBe('generated-data');
    expect(classifyConflict('data/theleague/schefter-scan.lock').klass).toBe('generated-data');
    expect(classifyConflict('tests/fixtures/typecheck-baseline.json').klass).toBe('ratchet-baseline');
    expect(classifyConflict('tests/fixtures/page-fork-baseline.json').klass).toBe('ratchet-baseline');
    expect(classifyConflict('tests/fixtures/clientrouter-init-baseline.json').klass).toBe('ratchet-baseline');
    expect(classifyConflict('CLAUDE.md').klass).toBe('docs');
    expect(classifyConflict('docs/claude/rules/roger.md').klass).toBe('docs');
    expect(classifyConflict('src/utils/auth.ts').klass).toBe('source');
    expect(classifyConflict('scripts/schefter-scan.mjs').klass).toBe('source');
    expect(classifyConflict('tests/foo.test.ts').klass).toBe('source');
  });

  it('only the mechanical classes are auto-resolved', () => {
    const auto = ['pnpm-lock.yaml', 'data/theleague/mfl-feeds/2026/x.json', 'tests/fixtures/typecheck-baseline.json'];
    const manual = ['package.json', 'CLAUDE.md', 'src/utils/auth.ts'];
    for (const f of auto) expect(classifyConflict(f).auto, f).toBe(true);
    for (const f of manual) expect(classifyConflict(f).auto, f).toBe(false);
  });

  it('covers every merge=binary path in .gitattributes as generated-data or lockfile', () => {
    const attrs = readFileSync('.gitattributes', 'utf8')
      .split('\n')
      .filter((l) => /merge=binary/.test(l))
      .map((l) => l.split(/\s+/)[0]);
    expect(attrs.length).toBeGreaterThan(3);
    for (const pattern of attrs) {
      // A slash-less pattern matches at any depth in git; test it nested, not at the root.
      const sample = pattern.includes('/') || !pattern.includes('*') ? pattern.replace('**', '2026/sample.json') : `deep/er/${pattern.replace('*', 'sample')}`;
      const { klass, auto } = classifyConflict(sample);
      expect(['generated-data', 'lockfile'], `${pattern} → ${klass}`).toContain(klass);
      expect(auto, pattern).toBe(true);
    }
  });
});

describe('generatedPatternsFrom', () => {
  it('turns .gitattributes globs into anchored regexes and skips the lockfile and comments', () => {
    const res = generatedPatternsFrom([
      '# comment merge=binary',
      'pnpm-lock.yaml merge=binary',
      'src/data/x/feed.json merge=binary',
      'data/x/mfl-feeds/** merge=binary',
      'package.json merge=union',
    ].join('\n'));
    const matches = (f: string) => res.some((re) => re.test(f));
    expect(matches('src/data/x/feed.json')).toBe(true);
    expect(matches('data/x/mfl-feeds/2026/deep/rosters.json')).toBe(true);
    expect(matches('data/x/mfl-feeds')).toBe(false);
    expect(matches('pnpm-lock.yaml')).toBe(false);
    expect(matches('package.json')).toBe(false);
    expect(matches('anything-feed.json')).toBe(true);
  });

  it('follows gitattributes semantics: slash-less patterns match at any depth, ? is one character', () => {
    const res = generatedPatternsFrom('*.snap merge=binary\nfeeds/week-?.json merge=binary\n');
    const matches = (f: string) => res.some((re) => re.test(f));
    expect(matches('tests/__snapshots__/x.snap')).toBe(true);
    expect(matches('x.snap')).toBe(true);
    expect(matches('feeds/week-3.json')).toBe(true);
    expect(matches('feeds/week-10.json')).toBe(false);
    expect(matches('other/feeds/week-3.json')).toBe(false);
  });
});

describe('ratchet baselines', () => {
  it('classifies every baseline scripts/ratchet.mjs manages (a new ratchet must be added in both places)', () => {
    const src = readFileSync('scripts/ratchet.mjs', 'utf8');
    const managed = [...src.matchAll(/'(tests\/fixtures\/[a-z-]+-baseline\.json)'/g)].map((m) => m[1]);
    expect(managed.length).toBeGreaterThanOrEqual(3);
    for (const f of managed) expect(classifyConflict(f).klass, f).toBe('ratchet-baseline');
  });
});

describe('orderConflicts', () => {
  it('puts package.json before the lockfile and generated data before source', () => {
    const order = orderConflicts([
      'src/utils/auth.ts',
      'pnpm-lock.yaml',
      'data/theleague/mfl-feeds/2026/x.json',
      'package.json',
      'CLAUDE.md',
    ]).map((c: { file: string }) => c.file);
    expect(order).toEqual([
      'package.json',
      'pnpm-lock.yaml',
      'data/theleague/mfl-feeds/2026/x.json',
      'CLAUDE.md',
      'src/utils/auth.ts',
    ]);
  });
});
