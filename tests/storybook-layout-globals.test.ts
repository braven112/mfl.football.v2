import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Storybook layout-globals wiring — the guard on Trap 4b.
 *
 * Storybook loads neither astro.config.ts (where Vend Sans is registered) nor
 * TheLeagueLayout's <style> block (which applies --font-family-base and
 * --font-display). Until Aug 2026 that meant every story rendered in Times New
 * Roman with zero web fonts loaded, and it read as a slightly-off canvas
 * rather than as a bug.
 *
 * `.storybook/preview-layout-globals.css` closes both gaps. The failure mode if
 * any link in that chain is dropped is SILENT — the font 404s or the variable
 * goes undefined and the canvas falls back, exactly as before, with a green
 * build and a full set of wrong Chromatic baselines. So each link is pinned
 * here.
 *
 * See docs/claude/rules/storybook.md, Trap 4b.
 */

const ROOT = join(__dirname, '..');
const CSS_PATH = join(ROOT, '.storybook/preview-layout-globals.css');
const css = readFileSync(CSS_PATH, 'utf8');

describe('Storybook layout-globals wiring', () => {
  it('preview.ts imports the stylesheet', () => {
    const preview = readFileSync(join(ROOT, '.storybook/preview.ts'), 'utf8');
    expect(preview).toContain("import './preview-layout-globals.css'");
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
    // Asserted as a PROPERTY, not as one hardcoded path: a probe for a single
    // filename passes for any other name or directory, which would let the
    // byte-identical-bundle invariant break with a green suite. Every face
    // must come from the Storybook-only mount.
    const urls = [...css.matchAll(/url\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    for (const url of urls) {
      expect(url, `${url} is not served from the Storybook-only font mount`).toMatch(
        /^\/storybook-fonts\//,
      );
    }
  });

  it('declares the font directory to Chromatic as a visual input', () => {
    // TurboSnap does not trace staticDirs through the module graph — the built
    // CSS keeps the literal url() and the woff2 is only copied. Without this
    // glob, swapping or re-subsetting the font is treated as affecting
    // NOTHING and every snapshot is inherited, so the regression ships green.
    // Same reason public/assets/** is already listed.
    const pkg = readFileSync(join(ROOT, 'package.json'), 'utf8');
    expect(pkg).toContain('--externals \\"' + '.storybook/static/**' + '\\"');
  });

  it('self-hosts every face — a third-party font URL is a Chromatic flake', () => {
    // Chromatic waits for network idle before capturing: a slow response is a
    // timeout and an intermittent one is a false diff. Same reasoning that
    // stubbed the playoff-hero headshots to data URIs.
    expect(css).not.toMatch(/url\(['"]?https?:/);
  });

  it('does NOT set a root font-size — that is a separate, baseline-moving change', () => {
    // The layout sets `html { font-size: var(--font-size-base) }`, a clamp
    // near 18.9px. Root font-size is the rem basis, so adding it here
    // re-scales every rem in the canvas and moves every Chromatic baseline at
    // once. Do that on purpose, with its own full-capture build and review
    // pass — not as a side effect of a font change.
    const htmlRule = css.match(/\bhtml\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(htmlRule).not.toMatch(/font-size/);
  });

  it('applies the layout typography rules a component never carries', () => {
    // TheLeagueLayout's own <style> block. Keep in sync with it.
    expect(css).toMatch(/html\s*\{[^}]*font-family:\s*var\(--font-family-base\)/);
    expect(css).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-family-base\)/);
    // Match the GROUPED rule explicitly. `/h4\s*\{/` also passes today, but only
    // because h4 happens to be last in the group and the group happens to
    // precede the standalone `h4 { font-size }` block — reorder either and a
    // correct stylesheet starts failing.
    expect(css).toMatch(/h1,\s*h2,\s*h3,\s*h4\s*\{[^}]*font-family:\s*var\(--font-display\)/s);
  });

  it('applies the layout link colors, which Chromatic would otherwise baseline as UA blue', () => {
    // main runs `chromatic --auto-accept-changes`, so an unstyled anchor does
    // not just look wrong once — it becomes the accepted baseline and the
    // suite goes blind to real link-color regressions.
    expect(css).toMatch(/\ba\s*\{[^}]*color:\s*var\(--primary-link-default-text-color\)/s);
    expect(css).toMatch(/a:hover\s*\{[^}]*color:\s*var\(--primary-link-hover-text-color\)/s);
    expect(css).toMatch(/a:focus\s*\{[^}]*color:\s*var\(--primary-link-focus-text-color\)/s);
  });
});
