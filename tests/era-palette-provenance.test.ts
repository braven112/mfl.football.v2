import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import aflConfig from '../data/afl-fantasy/afl.config.json';

/**
 * Era palettes must come from the TEAM's art.
 *
 * Two things in an AFL banner are in the picture without being in the
 * identity, and the first derivation took both: the "AL"/"NL" conference
 * plate in the bottom-left corner (a strong red that made Smokane FC — a
 * green-and-grey team — come out salmon, and became its 2019 PRIMARY), and
 * the stock player photograph pasted into most banners (skin tones and the
 * opposing team's jersey). `scripts/derive-era-palettes.mjs` masks the badge
 * corner and rejects the photographic skin envelope; this test is what keeps
 * a hand-edit or a re-derivation from putting either back.
 *
 * It checks PROVENANCE, not equality with the script's current output: a
 * commissioner may still hand-tune a palette, they just may not tune it to a
 * color that is nowhere in the era's own art outside that corner.
 */

const teams = (aflConfig as any).teams as any[];
const eras = teams.flatMap((t) => (t.history ?? []).map((era: any) => ({ team: t, era })));

const BADGE_W = 0.11;
const BADGE_H = 0.48;
/** Generous: the derivation samples at 260px, this at 96px, so means drift. */
const TOLERANCE = 78;

const hexToRgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
];
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Every pixel of the banner except the conference plate, at low resolution. */
async function artPixels(path: string): Promise<number[][]> {
  const { data, info } = await sharp('public' + path)
    .resize(96, 96, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out: number[][] = [];
  const badgeX = info.width * BADGE_W;
  const badgeY = info.height * (1 - BADGE_H);
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const x = px % info.width, y = (px / info.width) | 0;
    if (x < badgeX && y > badgeY) continue;
    if (data[i + 3] < 128) continue;
    out.push([data[i], data[i + 1], data[i + 2]]);
  }
  return out;
}

describe('era palettes come from the era’s own art', () => {
  it('every color exists in the banner outside the conference badge', async () => {
    const orphans: string[] = [];
    for (const { team, era } of eras) {
      if (!era.banner) continue;
      const pixels = await artPixels(era.banner);
      for (const key of ['colorPrimary', 'colorSecondary'] as const) {
        const hex = era[key];
        if (!hex) continue;
        const want = hexToRgb(hex);
        if (!pixels.some((p) => dist(p, want) <= TOLERANCE)) {
          orphans.push(`${team.franchiseId} ${era.yearStart} "${era.name}" ${key} ${hex} is not in its own art`);
        }
      }
    }
    expect(orphans, orphans.join('\n')).toEqual([]);
  }, 120_000);

  it('the two colors are actually two colors', async () => {
    // `#a6301f` twice was a real entry. A gradient between a color and itself
    // is a flat fill, and the letterbox behind a stamp-shaped banner stops
    // reading as a field.
    const flat = eras
      .filter(({ era }) => era.colorPrimary && era.colorSecondary)
      .filter(({ era }) => dist(hexToRgb(era.colorPrimary), hexToRgb(era.colorSecondary)) < 40)
      .map(({ team, era }) => `${team.franchiseId} ${era.yearStart} "${era.name}" ${era.colorPrimary} / ${era.colorSecondary}`);
    expect(flat, flat.join('\n')).toEqual([]);
  });

  it('a crest rim is one of the era’s own two colors', async () => {
    // The rim is the era's edge, so it may not be a third color nobody chose —
    // the salmon rims on Smokane's crests were the badge red leaking through.
    const strays = eras
      .filter(({ era }) => era.iconStroke)
      .filter(({ era }) => era.iconStroke !== era.colorPrimary && era.iconStroke !== era.colorSecondary)
      .map(({ team, era }) => `${team.franchiseId} ${era.yearStart} "${era.name}" rim ${era.iconStroke}`);
    expect(strays, strays.join('\n')).toEqual([]);
  });
});
