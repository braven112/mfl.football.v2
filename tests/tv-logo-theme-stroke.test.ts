import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { buildTvLogoManifest, collectTvLogos, measureAllTvLogos } from '../scripts/measure-tv-logo-contrast.mjs';
import { STROKE_THRESHOLD } from '../scripts/measure-crest-contrast.mjs';
import { LIGHT_STROKE_THRESHOLD } from '../scripts/measure-tv-logo-contrast.mjs';
import { buildTvLogoThemeCss, TV_LOGO_LIGHT_STROKE_COLOR } from '../src/utils/tv-logo-theme-css';
import { CREST_STROKE_FILTER, crestStrokeFilter } from '../src/utils/crest-dark-stroke-css';
import { buildAllTeamIconDarkCss } from '../src/utils/team-icon-dark-styles';

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'src/data/tv-logo-stroke-manifest.json'), 'utf8'));
const LOGOS = path.join(ROOT, 'public/assets/tv-logos');

describe('tv-logo dark-mode manifest', () => {
  it('matches what the committed marks actually measure', async () => {
    // Derived, not hand-curated — swap a mark for a darker one, or add a
    // logoDark, and this fails until `pnpm measure:tv-logo-contrast` is re-run.
    const measured = buildTvLogoManifest(await measureAllTvLogos());
    expect(measured.needsStroke).toEqual(manifest.needsStroke);
    expect(measured.needsLightStroke).toEqual(manifest.needsLightStroke);
    expect(measured.lightThreshold).toBe(manifest.lightThreshold);
    expect(measured.darkVariants).toEqual(manifest.darkVariants);
    expect(measured.threshold).toBe(manifest.threshold);
  }, 60_000);

  it('never strokes a mark that swaps to dark artwork, and every dark variant exists', () => {
    const swapped = new Set(manifest.darkVariants.map((v: any) => v.file));
    for (const e of manifest.needsStroke) expect(swapped.has(e.file)).toBe(false);
    for (const v of manifest.darkVariants) expect(existsSync(path.join(LOGOS, v.dark)), v.dark).toBe(true);
  });

  it('only lists marks below the threshold, and the light bar is the stricter one', () => {
    for (const e of manifest.needsStroke) {
      expect(e.legible).toBeLessThan(STROKE_THRESHOLD);
      expect(e.legible).toBeGreaterThanOrEqual(0);
    }
    for (const e of manifest.needsLightStroke) {
      expect(e.legible, e.file).toBeLessThan(LIGHT_STROKE_THRESHOLD);
      expect(e.legible).toBeGreaterThanOrEqual(0);
    }
    // A mark with pale DETAIL is not a pale mark: loosening the light bar to
    // the dark one would ring CBS, NBC, RedZone and Prime, which nobody
    // struggles to read on white.
    expect(LIGHT_STROKE_THRESHOLD).toBeLessThan(STROKE_THRESHOLD);
  });

  it('covers every mark the mapping file can render', () => {
    const files = collectTvLogos().map((l) => l.file);
    const known = new Set([
      ...manifest.needsStroke.map((e: any) => e.file),
      ...manifest.needsLightStroke.map((e: any) => e.file),
      ...manifest.darkVariants.map((v: any) => v.file),
    ]);
    // Marks that measured fine are absent from both lists by design; what
    // must hold is that nothing in the manifest points at a mark no longer used.
    for (const f of known) expect(files).toContain(f);
  });
});

describe('buildTvLogoThemeCss', () => {
  it('swaps dark variants by exact src and strokes the rest with the crest ring, under html.dark only', () => {
    const css = buildTvLogoThemeCss({
      needsStroke: [{ file: 'cbs-nfl-us.png', legible: 0.1 }, { file: 'abc.png', legible: 0.2 }],
      darkVariants: [{ file: 'dazn-black.png', dark: 'dazn.png' }],
    });
    expect(css).toContain('html.dark img[src="/assets/tv-logos/dazn-black.png"] { content: url("/assets/tv-logos/dazn.png"); }');
    expect(css).toContain('html.dark img[src="/assets/tv-logos/cbs-nfl-us.png"]');
    expect(css).toContain('html.dark img[src="/assets/tv-logos/abc.png"]');
    expect(css).toContain(`filter: ${CREST_STROKE_FILTER}`);
    expect(css).not.toMatch(/^img\[/m);
  });

  // The dark ring must never reach the white artwork a logoDark swaps in, so
  // the light rule is guarded on html:not(.dark), never left unguarded.
  it('rings a pale mark on the light card, in the crest ring shape and under html:not(.dark)', () => {
    const css = buildTvLogoThemeCss({
      needsStroke: [],
      needsLightStroke: [{ file: 'channel-5-uk.png', legible: 0 }, { file: 'kayo-sports.png', legible: 0.18 }],
      darkVariants: [{ file: 'dazn-black.png', dark: 'dazn.png' }],
    });
    expect(css).toContain('html:not(.dark) img[src="/assets/tv-logos/channel-5-uk.png"]');
    expect(css).toContain('html:not(.dark) img[src="/assets/tv-logos/kayo-sports.png"]');
    expect(css).toContain(`filter: ${crestStrokeFilter(TV_LOGO_LIGHT_STROKE_COLOR)}`);
    expect(css).not.toContain('html.dark img[src="/assets/tv-logos/channel-5-uk.png"]');
  });

  it('is empty with nothing to do, and is part of the ONE composed stylesheet', () => {
    expect(buildTvLogoThemeCss({ needsStroke: [], needsLightStroke: [], darkVariants: [] })).toBe('');
    expect(buildAllTeamIconDarkCss()).toContain('/* tv-logo theme:');
  });
});
