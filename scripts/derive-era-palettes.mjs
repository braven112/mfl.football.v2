#!/usr/bin/env node
/**
 * Derives `colorPrimary` / `colorSecondary` / `iconStroke` for every era in a
 * league config, from that era's own banner art.
 *
 * The palettes back two things: the Throwback Week scoreboard tint, and the
 * gradient that fills the letterbox behind a banner that is not banner-shaped
 * (`src/utils/era-banner-style.ts`). Both want the TEAM's colors.
 *
 * Two things in the source art are not the team's colors, and the first pass
 * of this derivation took both:
 *
 * 1. **The conference badge.** Every AFL banner carries an "AL" or "NL" plate
 *    in its bottom-left corner. The AL plate is a strong red, and on a team
 *    whose own art is otherwise green and grey it wins outright — Smokane FC
 *    came out salmon-and-olive, and its 2019 era took the badge red as its
 *    PRIMARY. The badge sits in a fixed corner, so it is masked out by
 *    position (see BADGE_*).
 * 2. **The player photograph.** Most banners paste in a stock photo of a real
 *    player, so skin tones and the opposing team's jersey are in the art
 *    without being in the identity. Smokane's elephant era took a helmet brown
 *    from one. Suppressed by SKIN, which rejects the desaturated warm envelope
 *    that photographic skin occupies while leaving a saturated gold or tan —
 *    a real team color — alone.
 *
 * Neutrals count. An earlier version only bucketed CHROMATIC pixels, so a
 * grey-and-green identity could never resolve to grey and reached for whatever
 * stray hue it could find. Greys, silvers and blacks are bucketed by lightness
 * and compete with the hues on population.
 *
 * Usage:
 *   node scripts/derive-era-palettes.mjs                 # report only
 *   node scripts/derive-era-palettes.mjs --write         # patch the config
 *   node scripts/derive-era-palettes.mjs --only 0001     # one franchise
 *
 * `--write` edits the config LINE BY LINE. Never round-trip it through
 * JSON.stringify: that reflows the whole 2000-line file and buries the change.
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const CONFIG = 'data/afl-fantasy/afl.config.json';

/** The conference plate occupies the bottom-left corner of every AFL banner. */
const BADGE_W = 0.11;   // fraction of width
const BADGE_H = 0.48;   // fraction of height, measured up from the bottom

/** Below this, a pixel is a neutral rather than a hue. */
const CHROMA_MIN = 0.2;

/** Two colors closer than this in RGB space read as one color. */
const MIN_SEPARATION = 70;

/**
 * A hue leads the pair whenever it clears this share of the sampled pixels —
 * deliberately tiny, because a team's color is usually a MINORITY of its own
 * banner. Smokane's 2019 art is a grey slab with a green "FC" and a green gas
 * mask: the green is 0.6% of the pixels and is unmistakably the team's color.
 * The grey it sits on becomes the secondary, which is how the live franchise
 * entries in this config are already written (green primary, near-white
 * secondary).
 */
const CHROMA_FLOOR = 0.005;

/** ...and at least this many pixels, so one stray antialiased edge can't lead. */
const CHROMA_MIN_PIXELS = 40;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hex = (r, g, b) =>
  '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/**
 * Photographic skin: warm, mid-light, and never very saturated. A team's own
 * gold or tan clears the saturation ceiling, so this does not eat one.
 */
const SKIN = (h, s, l) => h >= 8 && h <= 42 && s < 0.55 && l > 0.32 && l < 0.86;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export async function derivePalette(file) {
  const { data, info } = await sharp(file)
    .resize(260, 260, { fit: 'inside', withoutEnlargement: false })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const badgeX = info.width * BADGE_W;
  const badgeY = info.height * (1 - BADGE_H);
  const buckets = new Map(); // key -> {n, r, g, b, chromatic}
  let sampled = 0;

  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const x = px % info.width, y = (px / info.width) | 0;
    if (x < badgeX && y > badgeY) continue;             // conference plate
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 128) continue;
    const [h, s, l] = rgb2hsl(r, g, b);
    if (l < 0.1 || l > 0.94) continue;                  // paper and ink
    if (SKIN(h, s, l)) continue;                        // stock player photo
    const chromatic = s >= CHROMA_MIN;
    const key = chromatic ? `h${Math.floor(h / 20)}` : `n${Math.round(l * 6)}`;
    const e = buckets.get(key) ?? { n: 0, w: 0, r: 0, g: 0, b: 0, chromatic };
    // Rank buckets by pixel COUNT but average them by saturation, so a hue
    // reports the color someone would name rather than the washed-out mean of
    // its own antialiasing. Neutrals weight by distance from mid-grey for the
    // same reason.
    const w = chromatic ? Math.max(s, 0.05) : Math.max(Math.abs(l - 0.5) * 2, 0.05);
    e.n++; e.w += w; e.r += r * w; e.g += g * w; e.b += b * w;
    buckets.set(key, e);
    sampled++;
  }
  if (!sampled) return null;

  const ranked = [...buckets.values()]
    .map((e) => ({ ...e, rgb: [e.r / e.w, e.g / e.w, e.b / e.w], share: e.n / sampled }))
    .sort((a, b) => b.n - a.n);

  // A hue leads whenever the art has one at all; the plate it sits on follows.
  const topChroma = ranked.find(
    (e) => e.chromatic && e.share >= CHROMA_FLOOR && e.n >= CHROMA_MIN_PIXELS,
  );
  const primary = topChroma ?? ranked[0];
  const secondary =
    ranked.find((e) => e !== primary && dist(e.rgb, primary.rgb) >= MIN_SEPARATION) ??
    // Nothing else in the art reads as a second color — shift the primary
    // rather than invent one, so the gradient still has somewhere to go.
    { rgb: primary.rgb.map((v) => (primary.rgb.reduce((a, c) => a + c, 0) / 3 > 128 ? v * 0.62 : v * 1.45 + 26)), chromatic: primary.chromatic };

  // Order the pair by presence, not by area alone and not by colorfulness
  // alone — both fail on their own. Area alone made the pale cream plate
  // behind USC's cardinal wordmark Thundering Herd's PRIMARY, because HSL
  // saturation runs high for tints. Colorfulness alone then flipped every
  // blue-and-gold team, because a saturated yellow always out-chromas a
  // saturated blue on raw channel spread.
  //
  // chroma² x sqrt(share) settles both: squaring chroma discounts a pale
  // tint hard, while the area term keeps a small gold wordmark from
  // outranking the blue slab it is printed on. Every live franchise in this
  // config is written hue-first, near-white second, so this matches them.
  const chroma = (c) => (Math.max(...c) - Math.min(...c)) / 255;
  const presence = (e) => chroma(e.rgb) ** 2 * Math.sqrt(e.share ?? 0);
  const [lead, follow] = presence(secondary) > presence(primary)
    ? [secondary, primary]
    : [primary, secondary];

  const p = hex(...lead.rgb);
  const s = hex(...follow.rgb);
  // The rim gives a banner-cut crest an edge, so it takes the colorful half of
  // the pair — a near-white or near-black rim is invisible on one card or the
  // other, and the whole point is that it reads as a deliberate edge.
  return { primary: p, secondary: s, rim: p };
}

// ── config patching ────────────────────────────────────────────────────────
/** Indent of a TEAM's own `franchiseId`. Deeper ones are `ownerHistory` rows. */
const TEAM_INDENT = 6;

function patch(lines, fid, yearStart, values) {
  // Match on indent, not on trimmed text. `ownerHistory` entries carry a
  // `franchiseId` too, eight of them in this config, and matching the first
  // occurrence walked into one and then patched whatever `history[]` came
  // next — CSKA Sofia's palette landed on Blowing My Horn, and three eras
  // were silently skipped.
  const want = `"franchiseId": "${fid}",`;
  const fi = lines.findIndex(
    (l) => l.trim() === want && l.length - l.trimStart().length === TEAM_INDENT,
  );
  if (fi < 0) throw new Error(`franchise ${fid} not found at team level`);
  const hi = lines.findIndex((l, i) => i > fi && l.trim() === '"history": [');
  let depth = 0, he = hi;
  for (let j = hi; j < lines.length; j++) {
    depth += (lines[j].match(/\[/g) ?? []).length - (lines[j].match(/\]/g) ?? []).length;
    if (depth === 0) { he = j; break; }
  }
  for (let s = hi + 1; s < he; s++) {
    if (lines[s].trim() !== '{') continue;
    let d = 0, e = s;
    for (; e <= he; e++) {
      d += (lines[e].match(/\{/g) ?? []).length - (lines[e].match(/\}/g) ?? []).length;
      if (d === 0) break;
    }
    if (!new RegExp(`"yearStart":\\s*${yearStart}\\b`).test(lines.slice(s, e + 1).join('\n'))) continue;
    for (const [key, value] of Object.entries(values)) {
      const li = lines.findIndex((l, i) => i >= s && i <= e && l.includes(`"${key}"`));
      if (li < 0) continue;                       // absent field: leave it absent
      const indent = lines[li].match(/^\s*/)[0];
      const comma = lines[li].trimEnd().endsWith(',') ? ',' : '';
      lines[li] = `${indent}"${key}": ${JSON.stringify(value)}${comma}`;
    }
    return true;
  }
  return false;
}

const args = process.argv.slice(2);
const write = args.includes('--write');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const raw = readFileSync(CONFIG, 'utf8');
const cfg = JSON.parse(raw);
const lines = raw.split('\n');
let changed = 0;

for (const team of cfg.teams) {
  if (only && team.franchiseId !== only) continue;
  for (const era of team.history ?? []) {
    if (!era.banner) continue;
    const got = await derivePalette('public' + era.banner);
    if (!got) { console.log(`  ${team.franchiseId} ${era.yearStart} — no sampleable pixels`); continue; }
    const same = got.primary === era.colorPrimary && got.secondary === era.colorSecondary;
    console.log(
      `${team.franchiseId} ${String(era.yearStart).padEnd(5)} ${era.name.slice(0, 26).padEnd(27)}` +
      `${era.colorPrimary ?? '-------'} ${era.colorSecondary ?? '-------'}  ->  ${got.primary} ${got.secondary}` +
      `${same ? '' : '   *'}`
    );
    if (!same) changed++;
    if (write) {
      const values = { colorPrimary: got.primary, colorSecondary: got.secondary };
      if (era.iconStroke) values.iconStroke = got.rim;
      // A miss must be loud: a silent skip leaves the old palette in place
      // and looks exactly like "the derivation decided not to change it".
      if (!patch(lines, team.franchiseId, era.yearStart, values)) {
        throw new Error(`could not patch ${team.franchiseId} ${era.yearStart}`);
      }
    }
  }
}

if (write) {
  const out = lines.join('\n');
  JSON.parse(out); // fail before writing, never after
  writeFileSync(CONFIG, out);
  console.log(`\nwrote ${CONFIG} — ${changed} palettes changed`);
} else {
  console.log(`\n${changed} palettes would change (run with --write)`);
}
