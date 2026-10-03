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
import { loadThemes } from '../scripts/generate-league-themes.mjs';
import { resolveTheme } from '../scripts/lib/theme-resolve.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

/**
 * Comments are stripped FIRST. A scan guard that reads raw CSS is satisfied by
 * a commented-out block, so someone could disable the override and still be
 * told it exists — the guard would then be worse than none, because it reads
 * as coverage.
 */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const CSS = stripComments(read('src/styles/live-scoring-hero.css'));

type Mode = 'light' | 'dark';
const themes = loadThemes() as Record<string, Record<Mode, Record<string, string | null>>>;

/** Each theme's resolved hero accent and hero ink, per mode. */
function accents(): { theme: string; mode: Mode; hex: string; ink: string }[] {
  const out: { theme: string; mode: Mode; hex: string; ink: string }[] = [];
  for (const [id, theme] of Object.entries(themes)) {
    for (const mode of ['light', 'dark'] as const) {
      const r = resolveTheme(theme, mode);
      out.push({ theme: id, mode, hex: r['--hero-accent']!, ink: r['--hero-ink']! });
    }
  }
  return out;
}

const luminance = (hex: string) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(ch[0]) + 0.7152 * f(ch[1]) + 0.0722 * f(ch[2]);
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

/**
 * The surface the accent is judged against: the white card in light, the
 * theme's --hero-ink card in dark. It doubles as the badge's INK
 * (--lsh-featured-badge-ink is #ffffff light / --hero-ink dark), so one
 * comparison covers both roles, at the 4.5:1 the 10px badge label needs.
 */
const MIN_CONTRAST = 4.5;

describe('per-league live-scoring accent', () => {
  it('the hero reads the theme accent and ink in both modes, not a league name', () => {
    expect(CSS).toMatch(/--lsh-accent:\s*var\(--hero-accent,/);
    expect(CSS).toMatch(/--lsh-bg:\s*var\(--hero-ink,/);
    expect(CSS).toMatch(/--lsh-featured-badge-ink:\s*var\(--hero-ink,/);
    expect(CSS).not.toMatch(/\[data-league=/);
  });

  it('every theme sets a hero accent in both modes', () => {
    const missing = accents().filter((a) => !a.hex || !/^#/.test(a.hex)).map((a) => `${a.theme} ${a.mode}`);
    expect(missing).toEqual([]);
  });

  it('every accent clears AA against the card it sits on, in its own mode', () => {
    // WCAG thresholds are inclusive, so this is >= rather than >.
    const failures = accents()
      .map((a) => ({ a, ratio: contrast(a.hex, a.mode === 'light' ? '#ffffff' : a.ink) }))
      .filter(({ ratio }) => ratio < MIN_CONTRAST)
      .map(({ a, ratio }) => `${a.theme} ${a.mode} → ${a.hex} is ${ratio.toFixed(2)}:1`);
    expect(failures).toEqual([]);
  });

  it('the AFL keeps its own navy: DARK in light, LIGHT in dark', () => {
    const afl = Object.fromEntries(accents().filter((a) => a.theme === 'afl').map((a) => [a.mode, a]));
    expect(afl.light.hex).toBe('#16324a');
    expect(luminance(afl.light.hex)).toBeLessThan(luminance('#ffffff'));
    expect(luminance(afl.dark.hex)).toBeGreaterThan(luminance(afl.dark.ink));
    expect(afl.light.hex).not.toBe(afl.dark.hex);
  });
});

/**
 * The per-team "yet to play" counts, and the colour that is the ONLY thing
 * saying which is which.
 *
 * ── RE-POINTED, NOT RELAXED ───────────────────────────────────────────────
 * This pinned `.ls-rem-dot.away → --ta` / `.ls-rem-dot.home → --th` on the
 * card header of the board that has since been unified onto the shared kit.
 * The kit states the same fact in the win-probability bar's labels instead of
 * as two header dots — same information, same hazard, one place. So the rule
 * is asserted where it now lives.
 *
 * The rule itself is unchanged and is worth restating. Each side's count is
 * coloured from the card's own resolved pair (`--t0` / `--t1`), because those
 * are the values already matched to each team and already contrast-adjusted
 * against that surface's card ground. A generic `--content-text-muted` (the
 * obvious "tidy-up") would render two identical grey numbers and silently turn
 * the split back into an unlabelled pair, which is worse than the single total
 * it replaced.
 *
 * And it pins the ASSIGNMENT. Swapping the two would be invisible on any
 * matchup whose teams are evenly matched and actively wrong on every other
 * one — `8 – 6` reads perfectly either way round.
 */
describe('per-team yet-to-play counts', () => {
  const SHEET = stripComments(read('src/styles/live.css'));
  const BAR = read('src/components/shared/live/LvWinProbBar.tsx');

  /**
   * Escapes EVERY regex metacharacter, and fails loudly when the selector is
   * absent rather than returning ''. Both matter: `replace('.', '\\.')` takes a
   * string pattern, so it escapes only the FIRST dot and leaves the second one
   * a wildcard; and a `?? ''` fallback makes every `not.toMatch` assertion
   * below pass vacuously the moment a selector is renamed. A guard that goes
   * green by failing to find its subject is worse than no guard.
   */
  const ruleBody = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = SHEET.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    expect(m, `live.css has no rule for ${selector}`).not.toBeNull();
    return m![1];
  };

  /**
   * The INK pair, because these are text.
   *
   * `--t0`/`--t1` clear ΔE against the card, which is right for the bar
   * segments below and wrong for a 0.72rem label — the AFL's #314d78 sat at
   * 1.89:1 and was unreadable. `--t0-ink`/`--t1-ink` are the same colours run
   * through `ensureContrastOn` at AA body.
   *
   * Asserted as the exact ink names rather than a loose `--t[01]` so a revert
   * to the fill pair still fails here, not just in live-ink-contrast.
   */
  it('colours each label from the card INK pair, keyed to the matchup side', () => {
    expect(ruleBody('.lv-wp__ink0')).toMatch(/color:\s*var\(--t0-ink\)/);
    expect(ruleBody('.lv-wp__ink1')).toMatch(/color:\s*var\(--t1-ink\)/);
    // And never the fill pair, which is the regression this replaced.
    expect(ruleBody('.lv-wp__ink0')).not.toMatch(/color:\s*var\(--t0\)/);
    expect(ruleBody('.lv-wp__ink1')).not.toMatch(/color:\s*var\(--t1\)/);
  });

  it('pairs each label with the matching side in the component', () => {
    // The LEFT label carries side 0's count, the right side 1's — the same
    // order the caller renders the score header in. Swapping just those two
    // would paint each team's count under the other team's number.
    const left = BAR.match(/lv-wp__l[^]{0,200}?side(0|1)YetToPlay/)?.[1];
    const right = BAR.match(/lv-wp__r[^]{0,200}?side(0|1)YetToPlay/)?.[1];
    expect(left, 'no `lv-wp__l` followed by a yet-to-play count').toBe('0');
    expect(right, 'no `lv-wp__r` followed by a yet-to-play count').toBe('1');
  });

  it('keys the fills to the matchup colour, never to a position', () => {
    expect(ruleBody('.lv-wp__fill0')).toMatch(/var\(--t0\)/);
    expect(ruleBody('.lv-wp__fill1')).toMatch(/var\(--t1\)/);
    expect(BAR.indexOf('lv-wp__l')).toBeLessThan(BAR.indexOf('lv-wp__r'));
    // Positional colour rules are how the bar drifted from the header.
    expect(SHEET).not.toMatch(/\.lv-wp__[lr]\s*\{[^}]*color/);
  });

  it('never falls back to a shared neutral for either label', () => {
    for (const sel of ['.lv-wp__ink0', '.lv-wp__ink1']) {
      expect(ruleBody(sel)).not.toMatch(/--content-text|--page-text|currentColor/);
    }
  });

  it('gives the bar a height, so it cannot collapse to nothing', () => {
    const track = ruleBody('.lv-wp__track');
    expect(track).toMatch(/height:\s*[\d.]+/);
  });
});
