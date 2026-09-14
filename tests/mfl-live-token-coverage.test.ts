import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Every custom property MFL Live's stylesheet reads must resolve in BOTH
 * themes.
 *
 * CLAUDE.md states this trap as "a `var(--x)` with no definition renders its
 * fallback in *both* themes — light looks perfect, dark ships white-on-black".
 * MFL Live shipped the NASTIER form of it, with no fallback and with LIGHT as
 * the theme that lost: five tokens (`--color-text-primary`,
 * `--color-text-secondary`, `--color-surface-3`, `--color-border-subtle`,
 * `--color-border-default`) were defined only in tokens-dark.css, across 20
 * usages. CSS fails differently for each kind of property, and none of them
 * loudly:
 *
 *   color:        invalid at computed-value time -> INHERITS, so every
 *                 "secondary" string rendered at full body colour and the
 *                 board had no text hierarchy in light mode at all.
 *   background:   -> transparent. The position chip was a chip in dark and
 *                 bare text in light.
 *   border-color: -> currentColor. A hairline separator drew at TEXT colour.
 *
 * None of that throws, none of it shows up in a dark-mode screenshot, and the
 * light page looks merely "a bit flat" rather than broken — which is why this
 * is a scan and not a thing anyone was going to notice.
 */

/** Tokens set at RUNTIME rather than in a token sheet. */
const RUNTIME_TOKENS = [
  // Per-matchup team colours: the assembler ships --tm-light/--tm-dark and
  // the stylesheet maps them per theme, so they are defined in the file
  // itself rather than in tokens.css.
  '--tm',
  '--to',
  '--tm-light',
  '--tm-dark',
  '--to-light',
  '--to-dark',
  // The win-probability split, set inline per card.
  '--wp-split',
  // PlayerCell's avatar treatment, set inline per row by the shared component.
  '--player-avatar-bg',
  '--player-avatar-border',
  '--player-avatar-ring',
  '--player-avatar-ring-dark',
  '--player-avatar-size',
  '--player-name-size',
  '--player-meta-size',
  '--player-logo-size',
  '--player-gap',
];

interface Use {
  name: string;
  total: number;
  withFallback: number;
}

function tokenUses(css: string): Map<string, Use> {
  const uses = new Map<string, Use>();
  // `var(--x` optionally followed by a comma, which is the fallback.
  for (const m of css.matchAll(/var\(\s*(--[A-Za-z0-9-]+)\s*(,)?/g)) {
    const name = m[1]!;
    const entry = uses.get(name) ?? { name, total: 0, withFallback: 0 };
    entry.total += 1;
    if (m[2]) entry.withFallback += 1;
    uses.set(name, entry);
  }
  return uses;
}

/** Is the token declared anywhere in this sheet, or in the file's own rules? */
function declares(sheet: string, token: string): boolean {
  return new RegExp(`${token}\\s*:`).test(sheet);
}

describe('mfl-live.css resolves in both themes', () => {
  const css = read('src/styles/mfl-live.css');
  const light = read('src/styles/tokens.css');
  const dark = read('src/styles/tokens-dark.css');

  const candidates = [...tokenUses(css).values()].filter(
    (u) => !RUNTIME_TOKENS.includes(u.name) && !declares(css, u.name),
  );

  it('reads a meaningful number of tokens (the scan is actually looking at something)', () => {
    expect(candidates.length).toBeGreaterThan(10);
  });

  /**
   * A token missing from LIGHT is only safe when every single use supplies a
   * fallback — one bare use is enough to break the theme.
   */
  it('every token it reads is defined in the LIGHT sheet, or always has a fallback', () => {
    const broken = candidates
      .filter((u) => !declares(light, u.name) && u.withFallback < u.total)
      .map((u) => `${u.name} (${u.total} uses, ${u.withFallback} with a fallback)`);
    expect(broken, `Undefined in tokens.css and used without a fallback:\n  ${broken.join('\n  ')}`)
      .toEqual([]);
  });

  it('every token it reads is defined in the DARK sheet, or always has a fallback', () => {
    const broken = candidates
      .filter((u) => !declares(dark, u.name) && u.withFallback < u.total)
      .map((u) => `${u.name} (${u.total} uses, ${u.withFallback} with a fallback)`);
    expect(broken, `Undefined in tokens-dark.css and used without a fallback:\n  ${broken.join('\n  ')}`)
      .toEqual([]);
  });

  /**
   * The five that actually shipped broken, named so the regression is
   * recognisable rather than just counted.
   */
  it.each([
    '--color-text-primary',
    '--color-text-secondary',
    '--color-surface-3',
    '--color-border-subtle',
    '--color-border-default',
  ])('%s is defined for light, not only for dark', (token) => {
    expect(declares(light, token), `${token} must be declared in tokens.css`).toBe(true);
  });
});

/**
 * The MFL theme's own block has to answer for the tokens the base light sheet
 * does not carry, since that block is what makes `data-league="mfl"` a theme
 * rather than TheLeague's palette with a black header.
 */
describe('the light MFL block re-points the primary ramp', () => {
  const light = read('src/styles/tokens.css');
  const block = light.slice(light.indexOf('html[data-league="mfl"]'));
  const mflBlock = block.slice(0, block.indexOf('\n}'));

  it.each(['--color-primary', '--color-primary-dark', '--shadow-focus-ring'])(
    '%s is overridden for MFL, so buttons are not TheLeague blue',
    (token) => {
      expect(mflBlock).toContain(`${token}:`);
    },
  );

  it('does not leave TheLeague blue in any MFL DECLARATION', () => {
    // Comments are stripped first: the block's own commentary explains the fix
    // by naming the colour it replaced, and prose is not a declaration.
    const declarations = mflBlock.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(declarations).not.toMatch(/#1c497c/i);
    expect(declarations).not.toMatch(/rgba\(\s*28\s*,\s*73\s*,\s*124/);
  });
});
