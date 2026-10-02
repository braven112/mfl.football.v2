/**
 * League themes — the theme library (src/themes/<id>.json) is the only source
 * of each league's palette. Plan: docs/plans/league-themes.md.
 *
 * Pins:
 *  - the committed generated CSS is exactly what the generator produces;
 *  - every theme is COMPLETE over THEMED_TOKENS in light and dark, and names
 *    no other token, so no league can fall back to another league's colors;
 *  - every registry league (demo slots included) names a theme that exists;
 *  - the shared token files declare no themed token and no per-league block —
 *    a second definition there is a second source of truth;
 *  - no stylesheet sets a themed token on a bare `:root` / `html` /
 *    `html.dark`: the theme blocks outrank those selectors, so the override
 *    silently stops applying (two pages had exactly this when themes landed;
 *    they now use `:root:not(.dark)`).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { THEMED_TOKENS } from '../src/config/theme-tokens.mjs';
import { loadThemes, loadSurfaces } from '../scripts/generate-league-themes.mjs';
import { resolveTheme } from '../scripts/lib/theme-resolve.mjs';

/** WCAG contrast of two #rgb / #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    let h = hex.replace('#', '');
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    const [r, g, bl] = [0, 2, 4].map((i) => {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const themes = loadThemes();
const TOKENS = new Set<string>(THEMED_TOKENS);
/** Every custom property the shared token files declare. */
const SHARED_DECLS = new Set<string>(
  ['src/styles/tokens.css', 'src/styles/tokens-dark.css'].flatMap((rel) =>
    [...fs.readFileSync(path.join(ROOT, rel), 'utf8').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!),
  ),
);

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/** CSS of a stylesheet, or of each top-level <style> block in an .astro file. */
function cssChunks(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.css')) return [src];
  return [...src.matchAll(/^\s*<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gm)].map((m) => m[1]);
}

describe('league themes', () => {
  it('the generated CSS is up to date', () => {
    expect(() =>
      execFileSync(process.execPath, ['scripts/generate-league-themes.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('THEMED_TOKENS has no duplicates', () => {
    expect(TOKENS.size).toBe(THEMED_TOKENS.length);
  });

  for (const [id, theme] of Object.entries(themes) as [string, any][]) {
    describe(`theme "${id}"`, () => {
      it('has a name and description', () => {
        expect(typeof theme.name).toBe('string');
        expect(typeof theme.description).toBe('string');
      });

      it('never inherits from another theme', () => {
        for (const key of ['extends', 'inherits', 'base', 'parent']) expect(theme).not.toHaveProperty(key);
      });

      for (const mode of ['light', 'dark'] as const) {
        it(`names every themed token in ${mode}, and nothing else`, () => {
          const keys = Object.keys(theme[mode] ?? {});
          expect(keys.filter((k) => !TOKENS.has(k)), 'not in THEMED_TOKENS').toEqual([]);
          expect(THEMED_TOKENS.filter((t: string) => !(t in theme[mode])), 'missing').toEqual([]);
          for (const k of keys) expect(theme[mode][k] === null || typeof theme[mode][k] === 'string', k).toBe(true);
        });
      }

      for (const mode of ['light', 'dark'] as const) {
        it(`every var() it reads in ${mode} resolves`, () => {
          // A value may point at another token: one of this theme's own (set
          // in the same mode) or a shared default from the token files. A
          // reference with a fallback always resolves.
          const dangling: string[] = [];
          for (const [token, value] of Object.entries(theme[mode] as Record<string, string | null>)) {
            for (const m of (value ?? '').matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
              const ref = m[1]!;
              if (m[2]) continue;
              if (TOKENS.has(ref) ? theme[mode][ref] != null : SHARED_DECLS.has(ref)) continue;
              dangling.push(`${token} → ${ref}`);
            }
          }
          expect(dangling).toEqual([]);
        });
      }

      for (const mode of ['light', 'dark'] as const) {
        it(`CTA text clears AA on its fill and hover in ${mode}`, () => {
          const r = resolveTheme(theme, mode);
          for (const fill of ['--cta-fill', '--cta-fill-hover']) {
            expect(r[fill], fill).toMatch(/^#[0-9a-f]{3}([0-9a-f]{3})?$/i);
            expect(contrast(r['--on-cta-fill']!, r[fill]!), `--on-cta-fill on ${fill}`).toBeGreaterThanOrEqual(4.5);
          }
        });
      }

      it('notes only name themed tokens', () => {
        expect(Object.keys(theme.notes ?? {}).filter((k) => !TOKENS.has(k))).toEqual([]);
      });
    });
  }

  it('every registry league and themed surface names an existing theme', async () => {
    const surfaces = await loadSurfaces();
    expect(Object.keys(surfaces).length).toBeGreaterThan(0);
    for (const [slug, id] of Object.entries(surfaces)) expect(themes, `${slug} → ${id}`).toHaveProperty(id);
  });

  it('the shared token files declare no themed token and no per-league block', () => {
    for (const rel of ['src/styles/tokens.css', 'src/styles/tokens-dark.css']) {
      const root = postcss.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      const offenders: string[] = [];
      root.walkRules((rule) => {
        if (rule.selector.includes('data-league')) offenders.push(`${rel}: ${rule.selector}`);
      });
      root.walkDecls((d) => {
        if (TOKENS.has(d.prop)) offenders.push(`${rel}: ${d.prop}`);
      });
      expect(offenders).toEqual([]);
    }
  });

  it('no CTA re-points its fill to --league-accent (the theme\'s --cta-fill is the league colour)', () => {
    // MFL Live's dark accent carries white at 3.49:1; four pages shipped it as
    // a button fill before CTAs read the theme.
    const offenders = walk(path.join(ROOT, 'src'), ['.css', '.astro', '.tsx'])
      .filter((f) => /--cta-(bg|bg-hover)\s*:\s*var\(--league-accent/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('no stylesheet sets a themed token on a selector the theme blocks outrank', () => {
    const WEAK = new Set([':root', 'html', 'html.dark', ':root.dark', 'html:root']);
    const files = [
      ...walk(path.join(ROOT, 'src'), ['.css', '.astro']),
      ...walk(path.join(ROOT, '.storybook'), ['.css']),
    ].filter((f) => !f.endsWith('league-themes.generated.css'));
    const offenders: string[] = [];
    for (const file of files) {
      for (const chunk of cssChunks(file)) {
        let root: postcss.Root;
        try {
          root = postcss.parse(chunk);
        } catch {
          continue;
        }
        root.walkRules((rule) => {
          const weak = rule.selectors.some((s) => WEAK.has(s.replace(/^:global\((.*)\)$/, '$1').trim()));
          if (!weak) return;
          rule.each((d) => {
            if (d.type === 'decl' && TOKENS.has(d.prop)) offenders.push(`${path.relative(ROOT, file)}: ${rule.selector} { ${d.prop} }`);
          });
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
