#!/usr/bin/env node
/**
 * TheLeague's official championship pennants: the league-wide marks for its
 * two kinds of title (Brandon, Oct 2026: "there are no other titles other than
 * Division Champions and the overall champion"). Drawn on the AFL's set
 * (public/assets/afl/awards/) so the two leagues read as one family: a round
 * medallion for the champion, a shield per division, in TheLeague's navy and
 * green with its own crest and each division's compass star.
 *
 *   node scripts/build-theleague-award-badges.mjs
 *
 * Writes public/assets/theleague/awards/<name>.svg and the Halloween cut,
 * public/assets/theleague/halloween-marks/awards/<name>.svg: the same drawing
 * as a white-on-transparent mask, the way the AFL's Halloween badges are cut.
 * Christmas knits from the standard cut (scripts/build-sweater-league-marks.py).
 *
 * Each badge carries a stampable year (afl-badge.ts `stampBadgeYear`): the
 * medallion on a curved `#yearArc`, the shields on a flat star-wrapped line.
 * Every colour is an inline attribute, never a class: an inlined badge's
 * <style> would leak into the page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/assets/theleague/awards');
const OUT_HALLOWEEN = path.join(ROOT, 'public/assets/theleague/halloween-marks/awards');

const NAVY = '#1c497c';
const NAVY_DARK = '#13365d';
const NAVY_LIGHT = '#27598f';
const GREEN = '#2e8743';
const GREEN_DARK = '#1f5f2f';
const GREEN_LIGHT = '#3fae5a';
const GOLD = '#c9a44c';
const GOLD_LIGHT = '#e6c976';
const FONT = `font-family="'UFC Sans Condensed','Arial Narrow',sans-serif" font-weight="700"`;

/** The crest's visible shapes (theleague-logo.svg), by role: the shield, the green crown band, the stars. */
function crestParts() {
  const svg = fs.readFileSync(path.join(ROOT, 'public/assets/logos/theleague-logo.svg'), 'utf8');
  const paths = [...svg.matchAll(/<path class="(st\d)" d="([^"]*)"/g)].map((m) => ({ cls: m[1], d: m[2] }));
  const pick = (cls) => paths.filter((p) => p.cls === cls).map((p) => p.d);
  return { shield: [...pick('st3'), ...pick('st4')], band: pick('st2').slice(0, 1), stars: [...pick('st6'), ...pick('st5')] };
}

/** The division's compass star and accent (public/assets/theleague/division-badges/<name>.svg, a 72-unit drawing). */
function compass(name) {
  const svg = fs.readFileSync(path.join(ROOT, 'public/assets/theleague/division-badges', `${name}.svg`), 'utf8');
  const polys = [...svg.matchAll(/<polygon points="([^"]+)" fill="([^"]+)"( opacity="([^"]+)")?/g)].map((m) => ({
    points: m[1],
    fill: m[2],
    opacity: m[4] ?? null,
  }));
  const accent = svg.match(/<circle [^>]*stroke="(#[0-9a-f]{6})"/i)[1];
  return { polys, accent };
}

const DIVISIONS = [
  { file: 'northwest', label: 'NORTHWEST' },
  { file: 'southwest', label: 'SOUTHWEST' },
  { file: 'central', label: 'CENTRAL' },
  { file: 'east', label: 'EAST' },
];

const SHIELD = 'M32 50 L228 50 L228 176 C228 236 182 280 130 300 C78 280 32 236 32 176 Z';
const SHIELD_INNER = 'M44 62 L216 62 L216 174 C216 226 178 264 130 282 C82 264 44 226 44 174 Z';
const RIBBON_BACK = 'M20 196 L240 196 L230 219 L240 242 L20 242 L30 219 Z';
const RIBBON = 'M26 194 L234 194 L226 218 L234 240 L26 240 L34 218 Z';
const ribbonSize = (label) => (label.length > 7 ? 26 : 30);

/** A division champion's shield, 260×336 like the AFL's. `mask` draws the Halloween cut. */
function divisionShield({ file, label }, mask = false) {
  const { polys, accent } = compass(file);
  const id = `tl-${file}`;
  // the 72-unit compass star, centred in the shield's top field
  const star = (fillFor) =>
    `<g transform="translate(130 119) scale(1.9) translate(-36 -36)">${polys
      .map((p) => `<polygon points="${p.points}" fill="${fillFor(p)}"${p.opacity ? ` opacity="${p.opacity}"` : ''}/>`)
      .join('')}</g>`;
  if (mask) {
    const body = [
      `<path d="${SHIELD}" fill="#ffffff" stroke="#ffffff" stroke-width="13"/>`,
      `<path d="${SHIELD}" fill="none" stroke="#000000" stroke-width="3"/>`,
      `<path d="${SHIELD_INNER}" fill="none" stroke="#000000" stroke-width="2"/>`,
      `<circle cx="130" cy="119" r="56" fill="none" stroke="#000000" stroke-width="3"/>`,
      star((p) => (p.fill === '#fff' ? '#000000' : '#777777')),
      `<path d="${RIBBON_BACK}" fill="#000000"/>`,
      `<path d="${RIBBON}" fill="#ffffff"/>`,
      `<text x="130" y="219" text-anchor="middle" ${FONT} font-style="italic" font-size="${ribbonSize(label)}" fill="#000000" dominant-baseline="middle">${label}</text>`,
      `<text x="130" y="270" text-anchor="middle" ${FONT} font-size="19" fill="#000000" letter-spacing="3">★  2025  ★</text>`,
    ].join('\n');
    return maskWrap('0 0 260 336', `hm-awards-${file}`, body);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 336" role="img" aria-label="${label[0]}${label.slice(1).toLowerCase()} division champion">
<defs><clipPath id="${id}-sh"><path d="${SHIELD}"/></clipPath>
<radialGradient id="${id}-field" cx="50%" cy="40%" r="62%"><stop offset="0" stop-color="${NAVY_LIGHT}"/><stop offset="0.72" stop-color="${NAVY}"/><stop offset="1" stop-color="${NAVY_DARK}"/></radialGradient>
<linearGradient id="${id}-rib" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GREEN_LIGHT}"/><stop offset="0.5" stop-color="${GREEN}"/><stop offset="1" stop-color="${GREEN_DARK}"/></linearGradient></defs>
<path d="${SHIELD}" fill="none" stroke="#ffffff" stroke-width="13"/>
<path d="${SHIELD}" fill="${NAVY_DARK}"/>
<g clip-path="url(#${id}-sh)"><rect x="20" y="40" width="220" height="152" fill="url(#${id}-field)"/></g>
<path d="${SHIELD_INNER}" fill="none" stroke="${accent}" stroke-width="2" opacity="0.8"/>
<path d="${SHIELD}" fill="none" stroke="${NAVY_DARK}" stroke-width="3"/>
<circle cx="130" cy="119" r="56" fill="none" stroke="${accent}" stroke-width="3"/>
${star((p) => p.fill)}
<path d="${RIBBON_BACK}" fill="${GREEN_DARK}"/>
<path d="${RIBBON}" fill="url(#${id}-rib)"/>
<text x="130" y="219" text-anchor="middle" ${FONT} font-style="italic" font-size="${ribbonSize(label)}" fill="#ffffff" stroke="${GREEN_DARK}" stroke-width="0.8" paint-order="stroke" dominant-baseline="middle">${label}</text>
<text x="130" y="270" text-anchor="middle" ${FONT} font-size="19" fill="${GOLD}" letter-spacing="3">★  2025  ★</text>
</svg>
`;
}

/** Letters set one by one round the top of the medallion, as the AFL's ring is. */
function ringLetters(word, fill) {
  const r = 120;
  const span = 168;
  const step = span / (word.length - 1);
  return [...word]
    .map((ch, i) => {
      const deg = -span / 2 + i * step;
      const rad = ((deg - 90) * Math.PI) / 180;
      const x = (150 + r * Math.cos(rad)).toFixed(1);
      const y = (150 + r * Math.sin(rad)).toFixed(1);
      return ch === ' '
        ? ''
        : `<text x="${x}" y="${y}" transform="rotate(${deg.toFixed(1)} ${x} ${y})" text-anchor="middle" dominant-baseline="middle" ${FONT} font-size="20" fill="${fill}">${ch}</text>`;
    })
    .join('');
}

/** The trophy, in the AFL medallion's own coordinates, with TheLeague's crest on the cup. */
function trophy({ dark, light, crest }) {
  const { shield, band, stars } = crestParts();
  return `<g transform="translate(70,64)">
<path d="M40 26 C18 26 18 64 46 70 L46 60 C32 56 32 36 46 36 Z" fill="${dark}"/>
<path d="M120 26 C142 26 142 64 114 70 L114 60 C128 56 128 36 114 36 Z" fill="${dark}"/>
<path d="M38 24 L122 24 C122 70 100 96 80 96 C60 96 38 70 38 24 Z" fill="${light}"/>
<path d="M46 30 L114 30 C114 66 96 88 80 88 C64 88 46 66 46 30 Z" fill="${dark}"/>
<g transform="translate(80,57) scale(0.105) translate(-208,-221)">${[
    ...shield.map((d) => `<path d="${d}" fill="${crest.shield}"/>`),
    ...band.map((d) => `<path d="${d}" fill="${crest.band}"/>`),
    ...stars.map((d) => `<path d="${d}" fill="${crest.stars}"/>`),
  ].join('')}</g>
<rect x="74" y="96" width="12" height="20" fill="${dark}"/>
<path d="M58 116 L102 116 L96 132 L64 132 Z" fill="${light}"/>
<rect x="52" y="132" width="56" height="12" rx="2" fill="${dark}"/>
</g>`;
}

const YEAR_ARC = '<path id="yearArc" d="M 78.9 251.6 A 124 124 0 0 0 221.1 251.6" fill="none"/>';

/** The league champion's medallion, 300×300 like the AFL's. */
function championMedallion(mask = false) {
  if (mask) {
    const body = [
      YEAR_ARC.replace('fill="none"', 'fill="none" stroke="none"'),
      '<circle cx="150" cy="150" r="144" fill="#ffffff"/>',
      '<circle cx="150" cy="150" r="107" fill="none" stroke="#000000" stroke-width="5"/>',
      ringLetters('THELEAGUE CHAMPION', '#000000'),
      `<text dy="5" ${FONT} font-size="20" letter-spacing="3" fill="#000000"><textPath href="#yearArc" startOffset="50%" text-anchor="middle">★  2025  ★</textPath></text>`,
      trophy({ dark: '#000000', light: '#000000', crest: { shield: '#ffffff', band: '#000000', stars: '#ffffff' } }),
    ].join('\n');
    return maskWrap('0 0 300 300', 'hm-awards-league-champion', body);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" role="img" aria-label="TheLeague champion"><defs>
${YEAR_ARC}</defs>
<circle cx="150" cy="150" r="144" fill="${GOLD}"/><circle cx="150" cy="150" r="138" fill="${NAVY}"/><circle cx="150" cy="150" r="110" fill="${GOLD}"/><circle cx="150" cy="150" r="105" fill="${NAVY_DARK}"/>
<circle cx="150" cy="150" r="100" fill="none" stroke="${GREEN}" stroke-width="2"/>
${ringLetters('THELEAGUE CHAMPION', GOLD_LIGHT)}
<text dy="5" ${FONT} font-size="20" letter-spacing="3" fill="${GOLD_LIGHT}"><textPath href="#yearArc" startOffset="50%" text-anchor="middle">★  2025  ★</textPath></text>
${trophy({ dark: GOLD, light: GOLD_LIGHT, crest: { shield: NAVY, band: GREEN, stars: '#ffffff' } })}
</svg>
`;
}

/** A Halloween cut: the drawing as a mask over a white field (white keeps, black cuts out). */
function maskWrap(viewBox, id, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="-50" y="-50" width="1000" height="1000">
${body}
</mask></defs>
<rect x="-50" y="-50" width="1000" height="1000" fill="#ffffff" mask="url(#${id})"/>
</svg>
`;
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(OUT_HALLOWEEN, { recursive: true });
const write = (dir, name, svg) => fs.writeFileSync(path.join(dir, `${name}.svg`), svg);
write(OUT, 'league-champion', championMedallion());
write(OUT_HALLOWEEN, 'league-champion', championMedallion(true));
for (const div of DIVISIONS) {
  write(OUT, `${div.file}-champion`, divisionShield(div));
  write(OUT_HALLOWEEN, `${div.file}-champion`, divisionShield(div, true));
}
console.log(`wrote ${1 + DIVISIONS.length} badges, standard and Halloween`);
