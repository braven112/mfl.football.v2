import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

/**
 * A source file that git classifies as BINARY is invisible to every
 * diff-based reviewer.
 *
 * This shipped. `src/utils/mfl-login-redirect.ts` — the resolver that decides
 * where a half-authenticated visitor gets sent, which is the single most
 * security-sensitive file in the MFL Live branch — was written with a literal
 * NUL, 0x1f and 0x7f inside its control-character regex instead of the `\x00`
 * escape sequences those bytes were meant to spell. The regex was CORRECT:
 * `[<NUL>-<0x1f><0x7f>\\]` is the same character class as `[\x00-\x1f\x7f\\]`,
 * and all 45 of its tests passed. Nothing was broken at runtime.
 *
 * What broke was review. Git marks a blob binary the moment it contains a NUL,
 * so the file landed as `Bin 0 -> 3120 bytes`: no diff on the PR, nothing for
 * Copilot or CodeQL to read, no `git blame`, and a merge conflict there would
 * have had no textual sides to resolve. An open-redirect guard went through a
 * four-reviewer pipeline without one of them seeing a line of it.
 *
 * The bytes are also invisible in the editor and in `grep` output, so the
 * mistake cannot be caught by looking. Only a byte scan finds it.
 */
describe('no source file is binary to git', () => {
  const EXTENSIONS = new Set([
    '.ts', '.tsx', '.mjs', '.cjs', '.js', '.jsx', '.astro',
    '.json', '.css', '.md', '.yml', '.yaml', '.html', '.svg',
  ]);

  /** Tab, newline and carriage return are legitimate text. Nothing else is. */
  const isForbidden = (b: number) => (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f;

  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'src', 'tests', 'scripts', 'docs', '.github'], {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((p) => EXTENSIONS.has(p.slice(p.lastIndexOf('.')).toLowerCase()));

  it('finds files to scan, so a broken glob cannot pass vacuously', () => {
    expect(tracked.length).toBeGreaterThan(500);
  });

  it('contains no raw control bytes — write \\x00, never the byte itself', () => {
    const offenders: string[] = [];

    for (const rel of tracked) {
      let buf: Buffer;
      try {
        buf = readFileSync(join(ROOT, rel));
      } catch {
        continue; // a path in the index but not on disk
      }
      const found = new Set<string>();
      for (let i = 0; i < buf.length; i += 1) {
        if (isForbidden(buf[i])) {
          found.add(`0x${buf[i].toString(16).padStart(2, '0')} @ byte ${i}`);
          if (found.size >= 3) break;
        }
      }
      if (found.size) offenders.push(`${rel} — ${[...found].join(', ')}`);
    }

    expect(
      offenders,
      'A raw control byte makes git treat the file as binary: no diff, no blame, '
        + 'no reviewer. Replace the byte with its escape sequence (\\x00, \\x1b, …) — '
        + 'in a JS string literal and a regex character class the two are equivalent, '
        + 'so behaviour does not change.',
    ).toEqual([]);
  });
});
