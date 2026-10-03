/**
 * The draft room's timer banner sets WHITE text on a state-coloured fill, so
 * every fill must clear 4.5:1 against white in both themes.
 *
 * ── THE BUG THIS PINS ─────────────────────────────────────────────────────
 * The fills used to read the semantic tokens (--color-warning,
 * --color-success, --color-gray-700, --color-error). Those are TEXT colours:
 * tokens-dark.css lightens them so they read on a dark page, which turned the
 * dark-mode banner into white on pastel — warning 1.7:1, idle 1.8:1,
 * complete 1.9:1, danger 2.8:1 — and the light-mode success green was
 * already 2.5:1. The draft-room stories were the first thing to render the
 * banner in every state side by side, which is how it was seen at all.
 *
 * The `other` state stays on the league's --color-primary, darkened in dark
 * mode by a color-mix toward black. Those primaries are read from the token
 * sheets here rather than listed, so a league added (or re-coloured) later is
 * checked without anyone remembering this file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrastRatio } from '../src/utils/team-color-contrast';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const CSS = read('src/styles/draft-room.css');
const MIN = 4.5;

/** The body of the first rule whose selector is exactly `selector`. */
function block(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm'));
  if (!m) throw new Error(`no "${selector}" block in draft-room.css`);
  return m[1];
}

/** `--name: value;` declarations of a block, as a map. */
function decls(body: string): Map<string, string> {
  return new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const LIGHT = decls(block(CSS, '.draft-room'));
const DARK = decls(block(CSS, 'html.dark .draft-room'));
const FILLS = [...LIGHT.keys()].filter((k) => k.startsWith('--dr-timer-bg-'));

/** Every `--color-primary` a token sheet declares, resolved to a hex. */
function primaries(sheet: string): string[] {
  const css = read(sheet);
  const out = new Set<string>();
  for (const m of css.matchAll(/--color-primary\s*:\s*([^;]+);/g)) {
    const v = m[1].trim();
    const ref = v.match(/^var\((--[\w-]+)/);
    if (ref) {
      // A palette indirection (Archie's) — resolve it from any block in the
      // same sheet that declares it.
      const hits = [...css.matchAll(new RegExp(`${ref[1]}\\s*:\\s*(#[0-9a-fA-F]{6})`, 'g'))].map((h) => h[1]);
      expect(hits.length, `${sheet}: ${ref[1]} has no hex declaration to resolve`).toBeGreaterThan(0);
      hits.forEach((h) => out.add(h.toLowerCase()));
      continue;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(v)) out.add(v.toLowerCase());
  }
  return [...out];
}

/** `color-mix(in srgb, X p%, #000000)` — X scaled toward black. */
function mixWithBlack(hex: string, pct: number): string {
  return (
    '#' +
    [1, 3, 5]
      .map((i) => Math.round((parseInt(hex.slice(i, i + 2), 16) * pct) / 100).toString(16).padStart(2, '0'))
      .join('')
  );
}

describe('draft timer banner fills', () => {
  it('finds every state fill, and the text is white', () => {
    expect(FILLS.sort()).toEqual(
      ['complete', 'danger', 'idle', 'other', 'suspended', 'warning', 'you'].map((s) => `--dr-timer-bg-${s}`),
    );
    expect(LIGHT.get('--dr-timer-text')).toBe('#ffffff');
  });

  it.each(FILLS.filter((f) => f !== '--dr-timer-bg-other'))(
    '%s is a literal deep fill that carries white text at AA',
    (fill) => {
      const value = LIGHT.get(fill)!;
      expect(
        value,
        `${fill} reads a token — the semantic colours are TEXT colours that tokens-dark.css lightens, ` +
          'so the fill turns pastel under white text in dark mode',
      ).not.toMatch(/var\(/);
      // Override in dark mode would bypass the literal; only `other` may.
      expect(DARK.has(fill), `${fill} is re-declared in html.dark`).toBe(false);
      const stops = value.match(/#[0-9a-fA-F]{6}/g) ?? [];
      expect(stops.length, `${fill} has no hex colour to measure`).toBeGreaterThan(0);
      for (const hex of stops) {
        expect(contrastRatio(hex, '#ffffff'), `${fill} stop ${hex} under white`).toBeGreaterThanOrEqual(MIN);
      }
    },
  );

  it('the light "other" fill is the league colour, and every light primary carries white', () => {
    expect(LIGHT.get('--dr-timer-bg-other')).toMatch(/^var\(--color-primary\b/);
    const light = primaries('src/styles/tokens.css');
    expect(light.length).toBeGreaterThanOrEqual(2);
    for (const hex of light) {
      expect(contrastRatio(hex, '#ffffff'), `light --color-primary ${hex} under white`).toBeGreaterThanOrEqual(MIN);
    }
  });

  it('the dark "other" fill deepens every dark primary until it carries white', () => {
    const value = DARK.get('--dr-timer-bg-other');
    const m = value?.match(/^color-mix\(in srgb,\s*var\(--color-primary[^)]*\)\s*(\d+)%,\s*#000000\)$/);
    expect(m, `html.dark .draft-room must set --dr-timer-bg-other to a mix of --color-primary with black; got ${value}`).toBeTruthy();
    const pct = Number(m![1]);
    const dark = primaries('src/styles/tokens-dark.css');
    expect(dark.length).toBeGreaterThanOrEqual(2);
    for (const hex of dark) {
      const mixed = mixWithBlack(hex, pct);
      expect(contrastRatio(mixed, '#ffffff'), `dark --color-primary ${hex} at ${pct}% → ${mixed} under white`).toBeGreaterThanOrEqual(MIN);
    }
  });
});
