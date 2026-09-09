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

const css = readFileSync(resolve(process.cwd(), 'src/styles/live-scoring-hero.css'), 'utf-8');

/** Every `html[data-league="X"]` block that sets --lsh-accent, and whether it is the dark one. */
function accentOverrides(): { league: string; dark: boolean }[] {
  const out: { league: string; dark: boolean }[] = [];
  const re = /html\[data-league=["']([a-z0-9-]+)["']\]((?:\.[a-z-]+)*)\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    if (!/--lsh-accent\s*:/.test(m[3])) continue;
    out.push({ league: m[1], dark: m[2].includes('.dark') });
  }
  return out;
}

describe('per-league live-scoring accent', () => {
  it('the AFL overrides the accent at all', () => {
    // Without this the AFL renders TheLeague's #2563eb blue.
    expect(accentOverrides().some((o) => o.league === 'afl')).toBe(true);
  });

  it('every league that overrides the accent covers BOTH themes', () => {
    const byLeague = new Map<string, Set<boolean>>();
    for (const o of accentOverrides()) {
      if (!byLeague.has(o.league)) byLeague.set(o.league, new Set());
      byLeague.get(o.league)!.add(o.dark);
    }
    const halfDone = [...byLeague.entries()]
      .filter(([, themes]) => themes.size < 2)
      .map(([league, themes]) => `${league} (only ${[...themes][0] ? 'dark' : 'light'})`);
    expect(halfDone).toEqual([]);
  });

  it('the AFL dark accent is LIGHT and the light accent is DARK', () => {
    // The dark card is #0f1e2e. An accent darker than it is invisible; so is a
    // near-white accent on the light card. This is the assertion that a
    // copy-paste of the light value into the dark block would fail.
    const hexes = Object.fromEntries(
      accentOverrides().map((o) => {
        const re = new RegExp(
          `html\\[data-league=["']${o.league}["']\\]${o.dark ? '\\.dark' : ''}\\s*\\{([^}]*)\\}`,
        );
        const hex = css.match(re)![1].match(/--lsh-accent\s*:\s*(#[0-9a-fA-F]{6})/)![1];
        return [`${o.league}:${o.dark ? 'dark' : 'light'}`, hex];
      }),
    );

    const luminance = (hex: string) => {
      const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(ch[0]) + 0.7152 * f(ch[1]) + 0.0722 * f(ch[2]);
    };
    // --lsh-bg is #ffffff light / #0f1e2e dark; contrast against the card the
    // accent actually sits on, at the 3:1 floor for the 24px bold score.
    const contrast = (a: number, b: number) =>
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

    expect(contrast(luminance(hexes['afl:light']), luminance('#ffffff'))).toBeGreaterThan(3);
    expect(contrast(luminance(hexes['afl:dark']), luminance('#0f1e2e'))).toBeGreaterThan(3);
  });
});
