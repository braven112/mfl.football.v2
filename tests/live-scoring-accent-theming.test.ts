/**
 * The live hero's accent is per-league, and every league that overrides it
 * must do so in BOTH themes.
 *
 * `--lsh-accent` is not decoration: it is the leading score's TEXT color, the
 * featured card's border, and the "YOUR GAME" badge's FILL (whose ink is
 * --lsh-featured-badge-ink, which itself flips per theme). The two themes
 * therefore need OPPOSITE answers — the light card is white and wants a dark
 * accent; the dark card IS --afl-navy #0f1e2e and wants a light one.
 *
 * Defining only the light value is the trap docs/claude/rules/theming-and-assets.md
 * names: the dark theme silently keeps the base value, so light looks perfect
 * and dark ships a navy score on a navy card. Nothing throws and no test of
 * the light theme notices.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

/**
 * Comments are stripped FIRST. A scan guard that reads raw CSS is satisfied by
 * a commented-out block, so someone could disable the override and still be
 * told it exists — the guard would then be worse than none, because it reads
 * as coverage.
 */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const CSS = stripComments(read('src/styles/live-scoring-hero.css'));

interface AccentRule { league: string; dark: boolean; hex: string; selector: string }

/**
 * Every rule that sets --lsh-accent under a [data-league] selector.
 *
 * The dark flag is read from the WHOLE selector rather than from a fixed
 * position, because `html.dark[data-league="afl"]` and
 * `html[data-league="afl"].dark` are both valid at identical specificity and
 * the repo uses the former (tokens-dark.css). A guard that only understood one
 * ordering would read a correct dark override as a second light one and pass
 * a file with no dark value at all.
 *
 * The hex is captured HERE, from the block already matched, so nothing has to
 * rebuild a selector-shaped regex later and re-make the same assumption.
 */
function accentRules(): AccentRule[] {
  const out: AccentRule[] = [];
  const re = /([^{}]*\[data-league=["']([a-z0-9-]+)["'][^{}]*)\{([^}]*)\}/g;
  for (const m of CSS.matchAll(re)) {
    const [, selector, league, body] = m;
    const hex = body.match(/--lsh-accent\s*:\s*(#[0-9a-fA-F]{6})\b/)?.[1];
    if (!hex) continue;
    out.push({ league, dark: /\.dark\b/.test(selector), hex, selector: selector.trim() });
  }
  return out;
}

const luminance = (hex: string) => {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(ch[0]) + 0.7152 * f(ch[1]) + 0.0722 * f(ch[2]);
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

/**
 * The surface the accent is judged against, per theme.
 *
 * It doubles as the badge's INK (--lsh-featured-badge-ink is #ffffff light /
 * #0f1e2e dark — the same two values as --lsh-bg), so one comparison covers
 * both roles, and the binding floor is the stricter of the two: the badge
 * label is 10px, which is WCAG small text at 4.5:1, not the 3:1 the 24px bold
 * score would allow on its own.
 */
const SURFACE = { light: '#ffffff', dark: '#0f1e2e' } as const;
const MIN_CONTRAST = 4.5;

describe('per-league live-scoring accent', () => {
  it('the AFL overrides the accent at all', () => {
    // Without this the AFL renders TheLeague's #2563eb blue.
    expect(accentRules().some((r) => r.league === 'afl')).toBe(true);
  });

  it('every league that overrides the accent covers BOTH themes', () => {
    const byLeague = new Map<string, Set<boolean>>();
    for (const r of accentRules()) {
      if (!byLeague.has(r.league)) byLeague.set(r.league, new Set());
      byLeague.get(r.league)!.add(r.dark);
    }
    const halfDone = [...byLeague.entries()]
      .filter(([, themes]) => themes.size < 2)
      .map(([league, themes]) => `${league} (only ${[...themes][0] ? 'dark' : 'light'})`);
    expect(halfDone).toEqual([]);
  });

  it('every override clears AA against the card it sits on, in its own theme', () => {
    // WCAG thresholds are inclusive, so this is >= rather than >: a value that
    // lands exactly on 4.5:1 passes the standard and must pass here too.
    const failures = accentRules()
      .map((r) => ({ r, ratio: contrast(r.hex, SURFACE[r.dark ? 'dark' : 'light']) }))
      .filter(({ ratio }) => ratio < MIN_CONTRAST)
      .map(({ r, ratio }) => `${r.selector} → ${r.hex} is ${ratio.toFixed(2)}:1`);
    expect(failures).toEqual([]);
  });

  it('the AFL light accent is DARK and the dark accent is LIGHT', () => {
    // The direction, not just the ratio — a near-white light accent and a
    // near-black dark one would both fail the check above, but this states the
    // intent plainly and fails a straight copy-paste between the two blocks.
    const afl = Object.fromEntries(
      accentRules().filter((r) => r.league === 'afl').map((r) => [r.dark ? 'dark' : 'light', r.hex]),
    );
    expect(luminance(afl.light)).toBeLessThan(luminance(SURFACE.light));
    expect(luminance(afl.dark)).toBeGreaterThan(luminance(SURFACE.dark));
    expect(afl.light).not.toBe(afl.dark);
  });
});
