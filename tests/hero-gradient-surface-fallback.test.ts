/**
 * Gradient-surface fail-safe guard.
 *
 * The composite heroes carry their background in a custom property —
 * `--psh-surface: linear-gradient(...)` — and paint it with a single
 * `background: var(--psh-surface)`. That one declaration is a single point of
 * failure: `var()` substitution happens at computed-value time, so if the
 * substituted value is not something the browser accepts for `background`, the
 * WHOLE shorthand becomes invalid at computed-value time and falls back to the
 * initial value — `transparent`. Every other declaration in the same rule
 * (white ink, the pills, the accent numerals) still applies, so the hero does
 * not degrade: it renders white-on-page-background and is unreadable. That
 * shipped on mobile in both themes (owner report, 2026-08-18).
 *
 * The fix is not clever: paint a LITERAL solid `background-color` under the
 * gradient and let `background-image` carry the gradient. A literal hex cannot
 * be dropped, so the worst case is the flat brand color the gradient is built
 * from — on-brand, and still dark enough for the white ink these heroes use.
 *
 * So: any rule that defines a `--*-surface` gradient must also declare a
 * literal `background-color`, and no rule may paint one with the `background`
 * shorthand.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.astro')) out.push(full);
  }
  return out;
}

/** Split CSS-ish text into `{ ... }` bodies, one per rule (nesting-free here). */
function ruleBodies(text: string): string[] {
  const bodies: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      if (depth === 0) start = i + 1;
      depth += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        bodies.push(text.slice(start, i));
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return bodies;
}

const GRADIENT_SURFACE = /--([a-z0-9-]+-surface)\s*:\s*[^;]*gradient\(/i;
const LITERAL_BG_COLOR = /background-color\s*:\s*#[0-9a-f]{3,8}\b/i;

const files = walk(SRC);

describe('gradient surfaces keep a literal background-color under them', () => {
  it('never paints a --*-surface with the `background` shorthand', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const surfaces = [...text.matchAll(/--([a-z0-9-]+-surface)\s*:\s*[^;]*gradient\(/gi)].map((m) => m[1]);
      for (const name of new Set(surfaces)) {
        const shorthand = new RegExp(`background\\s*:\\s*var\\(--${name}[,)]`);
        if (shorthand.test(text)) {
          offenders.push(`${relative(ROOT, file)} → background: var(--${name})`);
        }
      }
    }
    expect(
      offenders,
      'Use `background-color: <literal hex>` + `background-image: var(--x-surface)` '
        + 'so a dropped gradient cannot turn the surface transparent:\n'
        + offenders.join('\n'),
    ).toEqual([]);
  });

  it('declares a literal background-color in every rule that sets a gradient surface', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const body of ruleBodies(text)) {
        const match = body.match(GRADIENT_SURFACE);
        if (!match) continue;
        if (!LITERAL_BG_COLOR.test(body)) {
          offenders.push(`${relative(ROOT, file)} → --${match[1]} has no literal background-color in the same rule`);
        }
      }
    }
    expect(
      offenders,
      'Every theme/variant block that redefines a gradient surface needs its own '
        + 'literal background-color, or that theme loses the fail-safe:\n'
        + offenders.join('\n'),
    ).toEqual([]);
  });
});
