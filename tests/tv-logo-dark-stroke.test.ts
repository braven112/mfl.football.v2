import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { buildTvLogoManifest, collectTvLogos, measureAllTvLogos } from '../scripts/measure-tv-logo-contrast.mjs';
import { STROKE_THRESHOLD } from '../scripts/measure-crest-contrast.mjs';
import { buildTvLogoDarkCss } from '../src/utils/tv-logo-dark-css';
import { CREST_STROKE_FILTER } from '../src/utils/crest-dark-stroke-css';
import { buildAllTeamIconDarkCss } from '../src/utils/team-icon-dark-styles';

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'src/data/tv-logo-dark-stroke-manifest.json'), 'utf8'));
const LOGOS = path.join(ROOT, 'public/assets/tv-logos');

describe('tv-logo dark-mode manifest', () => {
  it('matches what the committed marks actually measure', async () => {
    // Derived, not hand-curated — swap a mark for a darker one, or add a
    // logoDark, and this fails until `pnpm measure:tv-logo-contrast` is re-run.
    const measured = buildTvLogoManifest(await measureAllTvLogos());
    expect(measured.needsStroke).toEqual(manifest.needsStroke);
    expect(measured.darkVariants).toEqual(manifest.darkVariants);
    expect(measured.threshold).toBe(manifest.threshold);
  }, 60_000);

  it('never strokes a mark that swaps to dark artwork, and every dark variant exists', () => {
    const swapped = new Set(manifest.darkVariants.map((v: any) => v.file));
    for (const e of manifest.needsStroke) expect(swapped.has(e.file)).toBe(false);
    for (const v of manifest.darkVariants) expect(existsSync(path.join(LOGOS, v.dark)), v.dark).toBe(true);
  });

  it('only lists marks below the threshold', () => {
    for (const e of manifest.needsStroke) {
      expect(e.legible).toBeLessThan(STROKE_THRESHOLD);
      expect(e.legible).toBeGreaterThanOrEqual(0);
    }
  });

  it('covers every mark the mapping file can render', () => {
    const files = collectTvLogos().map((l) => l.file);
    const known = new Set([...manifest.needsStroke.map((e: any) => e.file), ...manifest.darkVariants.map((v: any) => v.file)]);
    // Marks that measured fine are absent from both lists by design; what
    // must hold is that nothing in the manifest points at a mark no longer used.
    for (const f of known) expect(files).toContain(f);
  });
});

describe('buildTvLogoDarkCss', () => {
  it('swaps dark variants by exact src and strokes the rest with the crest ring, under html.dark only', () => {
    const css = buildTvLogoDarkCss({
      needsStroke: [{ file: 'cbs-nfl-us.png', legible: 0.1 }, { file: 'abc.png', legible: 0.2 }],
      darkVariants: [{ file: 'dazn-ca-black.png', dark: 'dazn-ca.png' }],
    });
    expect(css).toContain('html.dark img[src="/assets/tv-logos/dazn-ca-black.png"] { content: url("/assets/tv-logos/dazn-ca.png"); }');
    expect(css).toContain('html.dark img[src="/assets/tv-logos/cbs-nfl-us.png"]');
    expect(css).toContain('html.dark img[src="/assets/tv-logos/abc.png"]');
    expect(css).toContain(`filter: ${CREST_STROKE_FILTER}`);
    expect(css).not.toMatch(/^img\[/m);
  });

  it('is empty with nothing to do, and is part of the ONE composed dark stylesheet', () => {
    expect(buildTvLogoDarkCss({ needsStroke: [], darkVariants: [] })).toBe('');
    expect(buildAllTeamIconDarkCss()).toContain('/* tv-logo dark:');
  });
});
