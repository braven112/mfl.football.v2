#!/usr/bin/env node
/**
 * Generate the per-league push-notification badge + Android maskable icon.
 *
 * Two derived assets, both regenerated from the league's existing 192/512
 * favicon so there is one source of truth for the mark:
 *
 * 1. `badge-96.png` — the Android notification SMALL icon. Android renders
 *    `showNotification({ badge })` by throwing away RGB and using ONLY the
 *    alpha channel as a stencil, which it then tints. A fully-opaque PNG
 *    therefore renders as a solid filled block, not a logo — which is exactly
 *    what shipped: every notification passed TheLeague's `icon-192.png`
 *    (color type 2, no alpha channel at all) as the badge, so the AFL's
 *    notifications showed a blank white square. The badge must be a
 *    white-on-TRANSPARENT silhouette. Luminance drives alpha here, so the
 *    light parts of a mark (the AFL wordmark, TheLeague's stars) punch
 *    through as holes and the shape stays readable at 24dp.
 *
 * 2. `icon-maskable-512.png` — the Android adaptive launcher icon, which is
 *    also the app identity Android shows on an installed PWA's notifications.
 *    Full-bleed on the league's background color with the mark inside the
 *    80% safe circle, because Android crops maskable icons to an
 *    OEM-chosen shape.
 *
 * Deterministic in the only sense that matters: same inputs → same PIXELS.
 * `--check` decodes and compares pixels rather than compressed bytes, because
 * the byte stream is zlib's to decide — a Node major that ships a different
 * zlib re-encodes identical art to a different length, and comparing bytes
 * would turn that into a guard-test failure that blocks every path-guard edit
 * under public/assets, src/utils/push-*.ts and public/sw.js.
 *
 * Usage: node scripts/generate-notification-icons.mjs [--check]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, encodePng, decodePng } from './lib/png-raw.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Per-league art sources. Keyed by navSlug — the same key `leaguePushIcon`
 * and `leaguePushBadge` in src/utils/push-notify-trade.ts use, so a league
 * cannot get an icon here without getting one there.
 *
 * `bestBall` leagues are absent on purpose: bb1 is draft-only and ships no
 * PWA manifest, so it has nothing to badge.
 */
const TARGETS = [
  {
    navSlug: 'theleague',
    source: 'public/assets/icons/pwa/icon-192.png',
    badge: 'public/assets/icons/pwa/badge-96.png',
  },
  {
    navSlug: 'afl',
    source: 'public/assets/afl/favicons/favicon-192.png',
    badge: 'public/assets/afl/favicons/badge-96.png',
    maskableSource: 'public/assets/afl/favicons/favicon-512.png',
    maskable: 'public/assets/afl/favicons/icon-maskable-512.png',
    // Matches the AFL manifest's background_color / theme_color.
    maskableBackground: [0x00, 0x22, 0x44],
  },
];

const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Bounding box of every pixel whose alpha clears `threshold`. */
function alphaBounds(alpha, width, height, threshold = 8) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('source image has no visible content');
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Area-average resample of a sub-rectangle of `src` into `dstW x dstH`.
 * Alpha is premultiplied across the average so a transparent neighbour never
 * bleeds its RGB into an edge pixel (the classic dark-halo artifact).
 */
function resampleArea(src, box, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4);
  const scaleX = box.width / dstW;
  const scaleY = box.height / dstH;
  for (let dy = 0; dy < dstH; dy++) {
    const y0 = box.minY + dy * scaleY;
    const y1 = box.minY + (dy + 1) * scaleY;
    for (let dx = 0; dx < dstW; dx++) {
      const x0 = box.minX + dx * scaleX;
      const x1 = box.minX + (dx + 1) * scaleX;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = Math.floor(y0); sy < Math.min(Math.ceil(y1), src.height); sy++) {
        const covY = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (covY <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.min(Math.ceil(x1), src.width); sx++) {
          const covX = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (covX <= 0) continue;
          const w = covX * covY;
          const i = (sy * src.width + sx) * 4;
          const sa = src.data[i + 3] / 255;
          r += src.data[i] * sa * w;
          g += src.data[i + 1] * sa * w;
          b += src.data[i + 2] * sa * w;
          a += src.data[i + 3] * w;
          wsum += w;
        }
      }
      const o = (dy * dstW + dx) * 4;
      if (wsum === 0) continue;
      const outA = a / wsum;
      const unpremul = outA > 0 ? 255 / outA : 0;
      out[o] = Math.round(Math.min(255, (r / wsum) * unpremul));
      out[o + 1] = Math.round(Math.min(255, (g / wsum) * unpremul));
      out[o + 2] = Math.round(Math.min(255, (b / wsum) * unpremul));
      out[o + 3] = Math.round(outA);
    }
  }
  return { width: dstW, height: dstH, data: out };
}

/**
 * Build the white-on-transparent notification badge.
 *
 * Alpha comes from INVERTED luminance, not from the source alpha: these
 * favicons sit on an opaque white plate, so "how dark is this pixel" is the
 * only signal that separates the mark from its backing.
 */
function buildBadge(src, size, safeFraction = 0.84) {
  const alpha = new Uint8Array(src.width * src.height);
  let peak = 0;
  for (let i = 0, p = 0; i < src.data.length; i += 4, p++) {
    const a = src.data[i + 3] / 255;
    const ink = 1 - luminance(src.data[i], src.data[i + 1], src.data[i + 2]) / 255;
    const v = Math.round(255 * a * ink);
    alpha[p] = v;
    if (v > peak) peak = v;
  }
  // Normalize so the darkest ink is fully opaque — Android tints the stencil,
  // and a mark that peaks at 80% alpha reads as a washed-out smudge.
  if (peak > 0 && peak < 255) {
    const gain = 255 / peak;
    for (let p = 0; p < alpha.length; p++) alpha[p] = Math.min(255, Math.round(alpha[p] * gain));
  }

  const stencil = { width: src.width, height: src.height, data: Buffer.alloc(src.width * src.height * 4) };
  for (let p = 0; p < alpha.length; p++) {
    const o = p * 4;
    stencil.data[o] = 255;
    stencil.data[o + 1] = 255;
    stencil.data[o + 2] = 255;
    stencil.data[o + 3] = alpha[p];
  }

  const box = alphaBounds(alpha, src.width, src.height);
  return fitCentered(stencil, box, size, safeFraction, null);
}

/** Scale `box` of `src` to fit `safeFraction` of a `size` square, centered. */
function fitCentered(src, box, size, safeFraction, background) {
  const budget = size * safeFraction;
  const scale = Math.min(budget / box.width, budget / box.height);
  const dstW = Math.max(1, Math.round(box.width * scale));
  const dstH = Math.max(1, Math.round(box.height * scale));
  const scaled = resampleArea(src, box, dstW, dstH);

  const canvas = Buffer.alloc(size * size * 4);
  if (background) {
    for (let p = 0; p < size * size; p++) {
      const o = p * 4;
      canvas[o] = background[0];
      canvas[o + 1] = background[1];
      canvas[o + 2] = background[2];
      canvas[o + 3] = 255;
    }
  }
  const offX = Math.round((size - dstW) / 2);
  const offY = Math.round((size - dstH) / 2);
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const s = (y * dstW + x) * 4;
      const d = ((y + offY) * size + (x + offX)) * 4;
      const sa = scaled.data[s + 3] / 255;
      if (sa <= 0) continue;
      const da = canvas[d + 3] / 255;
      const outA = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        canvas[d + c] = Math.round((scaled.data[s + c] * sa + canvas[d + c] * da * (1 - sa)) / outA);
      }
      canvas[d + 3] = Math.round(outA * 255);
    }
  }
  return { width: size, height: size, data: canvas };
}

/**
 * Background mask by flood fill from the border. Only pixels CONNECTED to the
 * edge count as backing — the white inside a wordmark stays part of the mark,
 * which is what keeps "AFL" legible instead of punching a hole to navy.
 */
function backgroundMask(src) {
  const { width, height, data } = src;
  const mask = new Uint8Array(width * height);
  const stack = [];
  const isBacking = (p) => {
    const i = p * 4;
    return data[i + 3] < 16 || luminance(data[i], data[i + 1], data[i + 2]) > 224;
  };
  for (let x = 0; x < width; x++) {
    stack.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    stack.push(y * width, y * width + width - 1);
  }
  while (stack.length) {
    const p = stack.pop();
    if (mask[p] || !isBacking(p)) continue;
    mask[p] = 1;
    const x = p % width, y = (p / width) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - width);
    if (y < height - 1) stack.push(p + width);
  }
  return mask;
}

/** Full-bleed adaptive icon: mark inside the safe circle on a solid plate. */
function buildMaskable(src, size, background, safeFraction = 0.6) {
  const mask = backgroundMask(src);
  const cut = { width: src.width, height: src.height, data: Buffer.from(src.data) };
  const alpha = new Uint8Array(src.width * src.height);
  for (let p = 0; p < mask.length; p++) {
    const a = mask[p] ? 0 : cut.data[p * 4 + 3];
    cut.data[p * 4 + 3] = a;
    alpha[p] = a;
  }
  const box = alphaBounds(alpha, src.width, src.height);
  return fitCentered(cut, box, size, safeFraction, background);
}

const checkOnly = process.argv.includes('--check');
const written = [];
let drift = false;

for (const target of TARGETS) {
  const league = Object.values(LEAGUES).find((l) => l.navSlug === target.navSlug);
  if (!league) throw new Error(`no league in the registry with navSlug ${target.navSlug}`);

  const emit = (relPath, image) => {
    const abs = path.join(ROOT, relPath);
    const next = encodePng(image);
    // Pixel comparison, not byte comparison — see the header note on zlib.
    // An unreadable/absent file counts as "differs" rather than throwing.
    // One read, no existsSync probe: a check-then-use pair is a file-system
    // race (CodeQL flags it), and the catch already covers absent-or-corrupt.
    let unchanged = false;
    try {
      const current = decodePng(fs.readFileSync(abs));
      unchanged =
        current.width === image.width &&
        current.height === image.height &&
        current.data.equals(image.data);
    } catch {
      unchanged = false;
    }
    if (unchanged) return;
    if (checkOnly) {
      drift = true;
      console.error(`[notification-icons] STALE: ${relPath}`);
      return;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, next);
    written.push(relPath);
  };

  emit(target.badge, buildBadge(readPng(path.join(ROOT, target.source)), 96));

  if (target.maskable) {
    emit(
      target.maskable,
      buildMaskable(readPng(path.join(ROOT, target.maskableSource)), 512, target.maskableBackground),
    );
  }
}

if (checkOnly) {
  if (drift) {
    console.error('[notification-icons] run `node scripts/generate-notification-icons.mjs` and commit the result.');
    process.exit(1);
  }
  console.log('[notification-icons] up to date.');
} else {
  console.log(written.length ? `[notification-icons] wrote:\n  ${written.join('\n  ')}` : '[notification-icons] no changes.');
}
