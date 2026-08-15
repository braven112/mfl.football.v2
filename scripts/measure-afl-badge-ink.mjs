#!/usr/bin/env node
/**
 * Measure the true rendered ink of the AFL tier/conference badges and write
 * tests/fixtures/afl-badge-ink.json, which `tests/afl-badge-viewbox.test.ts`
 * asserts against.
 *
 * Why an alpha bounding box and not `getBBox()`: every `-dark` badge paints a
 * white halo so the mark reads on a dark surface, and that halo is a STROKE (a
 * `feMorphology` dilate on the premier crest). `getBBox()` returns the geometry
 * box with stroke and filters EXCLUDED, so it reports the dark ink as identical
 * to the light ink and makes the dark files' viewBox padding look like dead
 * space. It isn't — it's holding the halo. Normalizing on `getBBox()` numbers
 * clipped all four assets (Aug 2026). Rendering and scanning the alpha channel
 * is the only measurement that answers "how big does this actually draw".
 *
 * Run after editing any badge artwork or viewBox:
 *   node scripts/measure-afl-badge-ink.mjs
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BADGE_PAIRS, artworkHash, parseViewBox } from './lib/afl-badge-ink.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests/fixtures/afl-badge-ink.json');

async function measure(browser, svgText) {
  const [mx, my, vw, vh] = parseViewBox(svgText);
  const W = 2000;
  const H = Math.round((W * vh) / vw);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  // Strip root width/height so our explicit size governs the render.
  const svg = svgText.replace(
    /<svg\b([^>]*)>/s,
    (_m, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} width="${W}" height="${H}">`,
  );
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  const shot = await page.screenshot({ omitBackground: true, type: 'png' });
  await ctx.close();

  const { data, info } = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('rendered nothing');
  const ux = (px) => mx + (px / info.width) * vw;
  const uy = (py) => my + (py / info.height) * vh;
  return {
    viewBox: [mx, my, vw, vh],
    ink: [ux(minX), uy(minY), ux(maxX + 1) - ux(minX), uy(maxY + 1) - uy(minY)].map((v) => +v.toFixed(3)),
  };
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
});
const out = {};
for (const rel of BADGE_PAIRS.flat()) {
  const svgText = readFileSync(join(ROOT, 'public', rel), 'utf8');
  const m = await measure(browser, svgText);
  out[rel] = { ...m, artworkHash: artworkHash(svgText) };
  console.log(`${rel.padEnd(34)} viewBox ${m.viewBox.join(' ')}  ink ${m.ink.join(' ')}`);
}
await browser.close();

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`\nwrote ${OUT}`);
