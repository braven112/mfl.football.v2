/**
 * A doc comment must not be closed by its own contents.
 *
 * ## The bug
 *
 * A cron step expression contains the two characters that END a block comment.
 * Quote one inside a JSDoc and the comment stops there, mid-sentence, and every
 * remaining line of prose — backticks, em dashes, bare dates — is handed to the
 * compiler as code.
 *
 * It happened three times in one session on 2026-09-17, twice in files whose
 * whole subject was cron cadence and once in the file that documents this very
 * rule. Knowing about it is not protection; the characters are invisible in
 * the sentence you are writing.
 *
 * ## Why a guard rather than "the compiler catches it"
 *
 * It depends entirely on WHERE it lands, and the two outcomes are hours apart:
 *
 *   - In a test or any imported module, esbuild throws in under a second.
 *   - In an API route, NOTHING catches it short of `astro check`. `pnpm
 *     test:unit` does not type-check, and no unit test imports a route, so the
 *     full suite stayed green across two runs while the file was syntactically
 *     broken. It surfaced as +39 type errors in CI, 2.5 minutes in, on a
 *     hotfix — and the only reason it was diagnosable at all was that all 39
 *     sat in one file.
 *
 * This runs at edit time through path-guard instead.
 *
 * ## The signature
 *
 * After a premature close, the rest of the doc block is still written in doc
 * style — so the first non-blank line following the comment begins with `*`.
 * That is unambiguous: real code does not resume with a bare asterisk, and a
 * correctly terminated doc comment is never followed by one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

/** Tracked sources only — never walk node_modules or build output. */
function trackedSources(): string[] {
  return execFileSync(
    'git',
    ['ls-files', 'src/**/*.ts', 'src/**/*.mjs', 'scripts/**/*.mjs', 'tests/**/*.ts'],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
    .split('\n')
    .filter(Boolean);
}

interface Offence {
  file: string;
  line: number;
  orphan: string;
}

/**
 * Every doc comment whose close is followed by an orphaned ` * ` line.
 *
 * Scoped to `/**` doc comments: a plain `/*` block is not written in the
 * continuation style this detects, and a bare `*` after one is far more likely
 * to be a wrapped multiplication than a broken comment.
 */
function findPrematureCloses(source: string): Omit<Offence, 'file'>[] {
  const out: Omit<Offence, 'file'>[] = [];
  for (const match of source.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    const end = (match.index ?? 0) + match[0].length;
    // Skip the REMAINDER of the closing line before looking for the orphan. A
    // premature close lands mid-sentence, so what follows it on that same line
    // is the back half of the sentence ("5` as 5-8 runs a day") and never
    // starts with a star. The giveaway is the line AFTER it, which is still
    // written in continuation style.
    const rest = source.slice(end);
    const newline = rest.indexOf('\n');
    if (newline === -1) continue;
    const nextLine = rest
      .slice(newline + 1)
      .split('\n')
      .find((l) => l.trim().length > 0);
    if (nextLine === undefined) continue;
    if (!/^\s*\*(?!\/)/.test(nextLine)) continue;
    out.push({
      line: source.slice(0, end).split('\n').length,
      orphan: nextLine.trim().slice(0, 80),
    });
  }
  return out;
}

describe('doc comments terminate where they mean to', () => {
  it('has no doc comment closed by its own contents', () => {
    const offences: Offence[] = [];
    for (const file of trackedSources()) {
      const source = readFileSync(resolve(root, file), 'utf8');
      // Cheap pre-filter: no doc comment, nothing to check.
      if (!source.includes('/**')) continue;
      for (const hit of findPrematureCloses(source)) offences.push({ file, ...hit });
    }
    expect(
      offences.map((o) => `${o.file}:${o.line} — orphaned doc line: ${o.orphan}`),
      'A doc comment ended early and the rest of its prose is now code. The ' +
        'usual cause is quoting a cron step expression, which contains the two ' +
        'characters that close a block comment. Spell the cadence out in words, ' +
        'or use a line comment.',
    ).toEqual([]);
  });
});

describe('the detector itself', () => {
  it('catches the exact shape that shipped', () => {
    // Reconstructed rather than pasted, so this fixture cannot break THIS file
    // the same way. `STEP` is the offending pair with a star in front.
    const STEP = '*' + '/5';
    const broken = [
      '/**',
      ' * Reliable is the point, not fast.',
      ` * GitHub delivered \`${STEP}\` as 5-8 runs a day, not 288.`,
      ' * — and because the feeds are baked into the build, it cannot update.',
      ' */',
      'export const x = 1;',
    ].join('\n');
    const hits = findPrematureCloses(broken);
    expect(hits).toHaveLength(1);
    expect(hits[0].orphan).toMatch(/because the feeds are baked/);
  });

  it('does not flag a correctly terminated doc comment', () => {
    const fine = ['/**', ' * A normal comment.', ' */', 'export const x = 1;'].join('\n');
    expect(findPrematureCloses(fine)).toEqual([]);
  });

  it('does not flag consecutive doc comments', () => {
    const fine = [
      '/** First. */',
      'export const a = 1;',
      '/** Second. */',
      'export const b = 2;',
    ].join('\n');
    expect(findPrematureCloses(fine)).toEqual([]);
  });
});
