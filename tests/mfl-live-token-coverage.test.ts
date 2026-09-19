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

/**
 * ── THE SAME SCAN OVER THE SHARED KIT'S SHEET ─────────────────────────────
 *
 * `src/styles/live.css` needs this more than `mfl-live.css` did, because it is
 * being built by PORTING `live-scoring.css` — and a port is exactly where a
 * `var()` loses its declaration. The first attempt at moving the player-row
 * rules across proved it: the rules read `var(--lv-row-gap)`, `--lv-slot-w`
 * and `--lv-face-w`, but those custom properties are declared on ANCESTOR
 * selectors (`.ls-root`, `.ls-mx-body`) that a rule-by-rule extraction does
 * not pick up, and redeclared inside media queries that it renamed only on the
 * read side. The result compiles, ships, and renders a row with no metrics.
 *
 * Nothing about that is loud. Per CLAUDE.md: an undefined `var()` renders its
 * fallback in BOTH themes, and with no fallback it is invalid at
 * computed-value time — `color` inherits, `background` goes transparent,
 * `border-color` becomes `currentColor`. None of it throws and none of it
 * shows up in a dark-mode screenshot.
 *
 * So this scan runs on every edit to the sheet (path-guard), and the kit's CSS
 * is ported in whole cascading units rather than cherry-picked rules.
 */
describe('live.css resolves in both themes', () => {
  const css = read('src/styles/live.css');
  const light = read('src/styles/tokens.css');
  const dark = read('src/styles/tokens-dark.css');

  /** Set at runtime by the assembler or inline per element, not in a sheet. */
  const KIT_RUNTIME_TOKENS = [
    // The franchise pair: resolved SERVER-side per theme (live/surface.ts +
    // live/model.ts) and aliased to --t0/--t1 by this sheet itself.
    '--t0',
    '--t1',
    '--t0-light',
    '--t0-dark',
    '--t1-light',
    '--t1-dark',
    // The win-probability seam position, set inline per bar.
    '--lv-wp-split',
  ];

  const candidates = [...tokenUses(css).values()].filter(
    (u) => !KIT_RUNTIME_TOKENS.includes(u.name) && !declares(css, u.name),
  );

  it('reads a meaningful number of tokens (the scan is looking at something)', () => {
    expect(candidates.length).toBeGreaterThan(5);
  });

  /**
   * ── WHY THIS IS "LIGHT OR DARK", NOT "LIGHT AND DARK" ───────────────────
   * `tokens-dark.css` is scoped to `html.dark` and deliberately overrides only
   * what CHANGES with the theme. Everything declared on `:root` in
   * `tokens.css` keeps cascading under `html.dark` — so demanding a token
   * appear in the dark sheet flags every theme-INVARIANT one it reads
   * (`--spacing-sm`, `--radius-md`, `--font-size-sm`, `--font-display`), which
   * are correct exactly as they are and would be wrong to duplicate.
   *
   * The block above gets away with the stricter pair because `mfl-live.css`
   * supplies fallbacks on its spacing tokens; that is a property of that
   * sheet, not a rule worth propagating. What CSS actually requires is that
   * the declaration exist SOMEWHERE in the cascade, which is what this
   * asserts. The theme-specific half of the risk is covered by
   * `tests/live-surface-grounds.test.ts`, which pins the values that genuinely
   * differ per theme against the sheets they come from.
   */
  it('every token it reads resolves somewhere in the cascade, or always has a fallback', () => {
    const broken = candidates
      .filter(
        (u) => !declares(light, u.name) && !declares(dark, u.name) && u.withFallback < u.total,
      )
      .map((u) => `${u.name} (${u.total} uses, ${u.withFallback} with a fallback)`);
    expect(
      broken,
      `Declared in neither token sheet and used without a fallback:\n  ${broken.join('\n  ')}`,
    ).toEqual([]);
  });

  /**
   * Every `--lv-*` the sheet reads must be declared by the sheet itself. These
   * are the kit's OWN vocabulary, so nothing in tokens.css will ever cover
   * them and a typo is silent.
   */
  it('declares every --lv-* it reads, itself', () => {
    const own = [...tokenUses(css).values()].filter(
      (u) => u.name.startsWith('--lv-') && !KIT_RUNTIME_TOKENS.includes(u.name),
    );
    expect(own.length).toBeGreaterThan(0);
    const undeclared = own.filter((u) => !declares(css, u.name)).map((u) => u.name);
    expect(undeclared, `read but never declared in live.css:\n  ${undeclared.join('\n  ')}`).toEqual([]);
  });

  /**
   * Every animation it names must have a `@keyframes` in this file.
   *
   * The port's other silent failure: `.ls-dot.live` animates `ls-pulse`, whose
   * `@keyframes` is an at-rule a selector-driven extraction skips entirely. A
   * missing keyframe does not throw — the element simply never animates, so
   * the "live" dot stops being distinguishable from the final one.
   */
  it('defines every @keyframes it animates', () => {
    const named = [
      ...new Set(
        [...css.matchAll(/animation:\s*([A-Za-z][\w-]*)/g)].map((m) => m[1]!),
      ),
    ].filter((n) => n !== 'none');
    for (const name of named) {
      expect(
        new RegExp(`@keyframes\\s+${name}\\b`).test(css),
        `live.css animates "${name}" but defines no @keyframes for it`,
      ).toBe(true);
    }
  });
});
