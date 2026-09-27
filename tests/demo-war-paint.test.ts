import { describe, expect, it } from 'vitest';
import { WAR_PAINT_PALETTES, warPaintFiles, warPaintSvg } from '../scripts/demo/lib/war-paint.mjs';

describe('demo war-paint league mark', () => {
  it('recolours the disc, outlines and helmet from the league palette', () => {
    const svg = warPaintSvg(WAR_PAINT_PALETTES.bestball);
    expect(svg).toContain(WAR_PAINT_PALETTES.bestball.ink);
    expect(svg).toContain(WAR_PAINT_PALETTES.bestball.helmet);
    // The source art's navy and red must not survive into another league's cut.
    expect(svg).not.toMatch(/#002244|#c41e3a|#9e1830/i);
    expect(svg).not.toContain('${');
  });

  it('gives the dark cut the brightened helmet and a light rim, the light cut neither', () => {
    const light = warPaintSvg(WAR_PAINT_PALETTES.theleague);
    const dark = warPaintSvg(WAR_PAINT_PALETTES.theleague, { dark: true });
    expect(dark).toContain(WAR_PAINT_PALETTES.theleague.helmetDark);
    expect(dark).toContain('stroke:#f5f5f5');
    expect(light).not.toContain('stroke:#f5f5f5');
  });

  it('writes both cuts under the slot file name the site swaps between', () => {
    const files = warPaintFiles('keeper-logo', WAR_PAINT_PALETTES.afl, 'Keeper');
    expect(files.map(([rel]) => rel)).toEqual(['assets/logos/keeper-logo.svg', 'assets/logos/keeper-logo-dark.svg']);
  });
});
