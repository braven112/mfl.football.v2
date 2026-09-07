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

/**
 * Both file kinds carry composite-hero CSS. The shared shell's surfaces moved
 * out of seven scoped <style> blocks and into src/styles/composite-hero.css
 * when the heroes were unified — scanning `.astro` alone would have quietly
 * stopped enforcing this rule for every hero on the site.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.astro') || full.endsWith('.css')) out.push(full);
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
/**
 * The same fail-safe, carried as a paired token instead of a paint.
 *
 * A rule that only DEFINES a palette for a descendant to paint (the hero
 * showcase's `.hc-page` sets the gallery card's gradient; `.hcx` paints it)
 * has no `background` of its own to put a literal beside. What it must still
 * do is move the literal WITH the gradient — a `--*-solid` hex declared in the
 * same rule — or a theme block that redefines only the gradient leaves the
 * other theme's solid underneath it, which is the same bug one level up.
 */
const LITERAL_SOLID_TOKEN = /--[a-z0-9-]+-solid[a-z0-9-]*\s*:\s*#[0-9a-f]{3,8}\b/i;

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
        if (!LITERAL_BG_COLOR.test(body) && !LITERAL_SOLID_TOKEN.test(body)) {
          offenders.push(
            `${relative(ROOT, file)} → --${match[1]} has no literal background-color `
              + 'or paired --*-solid hex in the same rule',
          );
        }
      }
    }
    expect(
      offenders,
      'Every theme/variant block that redefines a gradient surface needs its own '
        + 'literal background-color (or a paired --*-solid hex, when the rule only '
        + 'defines a palette a descendant paints), or that theme loses the fail-safe:\n'
        + offenders.join('\n'),
    ).toEqual([]);
  });
});
