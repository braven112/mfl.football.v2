import { describe, it, expect } from 'vitest';
import { expectClean, scanForbidden, walkFiles } from './helpers/scan-guard';

/**
 * A source file that git classifies as BINARY is invisible to every
 * diff-based reviewer.
 *
 * This shipped. `src/utils/mfl-login-redirect.ts` — the resolver that decides
 * where a half-authenticated visitor gets sent, which is the one open-redirect
 * guard on the MFL Live branch — was written with literal NUL, 0x1f and 0x7f
 * bytes inside its control-character regex instead of the `\x00` / `\x1f` /
 * `\x7f` escape sequences those bytes were meant to spell. The regex was
 * CORRECT: in a character class the byte and its escape are the same thing, so
 * all 45 of its tests passed and there was never a runtime symptom.
 *
 * What broke was review. Git marks a blob binary the moment it contains a NUL,
 * so the file landed in PR #1078 as `Bin 0 -> 3120 bytes`: no diff, nothing for
 * Copilot or CodeQL to read, no `git blame`, and a merge conflict there would
 * have had no textual sides to resolve. It cleared five reviewers without one
 * of them seeing a line of it.
 *
 * The reason this is a guard and not a line in a rules doc: it cannot be caught
 * by looking. The bytes do not render in an editor, do not appear in `grep`
 * output, do not upset `node --check`, and do not fail a test. Only a scan
 * finds it. `tests/rules-qa-flags.test.ts` carried the same bug (NUL + 0x1b, in
 * an ANSI-stripping case) from the day it was written until this guard landed.
 */
describe('no source file is binary to git', () => {
  const ROOTS = ['src', 'tests', 'scripts', 'docs', '.github'];
  const EXTENSIONS = [
    '.ts', '.tsx', '.mjs', '.cjs', '.js', '.jsx', '.astro',
    '.json', '.css', '.md', '.yml', '.yaml', '.html', '.svg',
  ];

  it('finds files to scan, so a broken root or extension list cannot pass vacuously', () => {
    expect(walkFiles({ roots: ROOTS, extensions: EXTENSIONS }).length).toBeGreaterThan(500);
  });

  it('contains no raw control characters — write \\x00, never the byte itself', () => {
    expectClean(
      scanForbidden({
        roots: ROOTS,
        extensions: EXTENSIONS,
        forbidden: [
          {
            name: 'raw-control-char',
            // Everything below 0x20 except tab, plus DEL. LF and CR never
            // reach here — the scanner splits on \n and trims the line.
            pattern: /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/,
          },
        ],
      }),
      'A raw control character makes git treat the whole file as BINARY: no diff on the PR, '
        + 'nothing for Copilot or CodeQL to read, no blame, and no textual sides to a future '
        + 'conflict. Replace the character with its escape sequence (\\x00, \\x1b, …) — in a '
        + 'string literal and in a regex character class the two are equivalent, so behaviour '
        + 'does not change.',
    );
  });
});
