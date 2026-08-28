import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Storybook typography wiring — the guard on Trap 4b.
 *
 * Storybook loads neither astro.config.ts (where Vend Sans is registered) nor
 * TheLeagueLayout's <style> block (which applies --font-family-base and
 * --font-display). Until Aug 2026 that meant every story rendered in Times New
 * Roman with zero web fonts loaded, and it read as a slightly-off canvas
 * rather than as a bug.
 *
 * `.storybook/preview-typography.css` closes both gaps. The failure mode if
 * any link in that chain is dropped is SILENT — the font 404s or the variable
 * goes undefined and the canvas falls back, exactly as before, with a green
 * build and a full set of wrong Chromatic baselines. So each link is pinned
 * here.
 *
 * See docs/claude/rules/storybook.md, Trap 4b.
 */

const ROOT = join(__dirname, '..');
const CSS_PATH = join(ROOT, '.storybook/preview-typography.css');
const css = readFileSync(CSS_PATH, 'utf8');

describe('Storybook typography wiring', () => {
  it('preview.ts imports the typography stylesheet', () => {
    const preview = readFileSync(join(ROOT, '.storybook/preview.ts'), 'utf8');
    expect(preview).toContain("import './preview-typography.css'");
  });

  it('defines --font-vend-sans, which astro.config.ts supplies in production', () => {
    // tokens.css reads `var(--font-vend-sans, 'Vend Sans')`. Without this
    // declaration BOTH the variable and the family are missing and
    // --font-family-base resolves all the way to system-ui.
    expect(css).toMatch(/--font-vend-sans:\s*'Vend Sans'/);
  });

  it('serves every @font-face src from a file that exists', () => {
    const urls = [...css.matchAll(/url\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);

    for (const url of urls) {
      // /storybook-fonts/* is the staticDirs mapping asserted below; anything
      // else is expected to come from public/ like the rest of the assets.
      const onDisk = url.startsWith('/storybook-fonts/')
        ? join(ROOT, '.storybook/static/fonts', url.slice('/storybook-fonts/'.length))
        : join(ROOT, 'public', url.replace(/^\//, ''));
      expect(existsSync(onDisk), `${url} has no file at ${onDisk}`).toBe(true);
    }
  });

  it('maps the Storybook-only font directory in main.ts', () => {
    const main = readFileSync(join(ROOT, '.storybook/main.ts'), 'utf8');
    expect(main).toContain("from: './static/fonts'");
    expect(main).toContain("to: '/storybook-fonts'");
  });

  it('keeps Storybook fonts OUT of public/, so the shipped bundle is unchanged', () => {
    expect(existsSync(join(ROOT, 'public/assets/fonts/vend-sans-latin.woff2'))).toBe(false);
  });

  it('self-hosts every face — a third-party font URL is a Chromatic flake', () => {
    // Chromatic waits for network idle before capturing: a slow response is a
    // timeout and an intermittent one is a false diff. Same reasoning that
    // stubbed the playoff-hero headshots to data URIs.
    expect(css).not.toMatch(/url\(['"]?https?:/);
  });

  it('applies the layout typography rules a component never carries', () => {
    // TheLeagueLayout's own <style> block. Keep in sync with it.
    expect(css).toMatch(/html\s*\{[^}]*font-family:\s*var\(--font-family-base\)/);
    expect(css).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-family-base\)/);
    expect(css).toMatch(/h4\s*\{[^}]*font-family:\s*var\(--font-display\)/s);
  });
});
