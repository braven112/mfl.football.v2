/**
 * Generated SVG art for the demo franchises: a shield crest (light and dark
 * cut) and a wide banner. Deliberately plain — the demo sells the SITE, and a
 * prospect's own league would get its real marks.
 */

const escapeXml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** Two-letter monogram from the short name ("Barracudas" → "BA", "Red Rock Raptors" → "RR"). */
export function monogram(franchise) {
  const words = franchise.name.split(/\s+/).filter(Boolean);
  if (words.length >= 3) return (words[0][0] + words[1][0]).toUpperCase();
  return franchise.nameShort.slice(0, 2).toUpperCase();
}

const SHIELD = 'M128 12 L232 44 V124 C232 186 188 226 128 246 C68 226 24 186 24 124 V44 Z';

/**
 * Square crest. `dark` swaps the rim to a light stroke so the mark holds on a
 * dark card, the way the real site's `_dark` icon cuts do.
 */
export function crestSvg(franchise, { dark = false } = {}) {
  const rim = dark ? '#f5f5f5' : franchise.colorSecondary;
  const text = monogram(franchise);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="${escapeXml(franchise.name)}">
<path d="${SHIELD}" fill="${franchise.colorPrimary}" stroke="${rim}" stroke-width="12" stroke-linejoin="round"/>
<path d="M128 40 L208 64 V124 C208 170 176 202 128 218" fill="none" stroke="${rim}" stroke-opacity="0.35" stroke-width="6"/>
<text x="128" y="152" text-anchor="middle" font-family="Arial Black, Helvetica, Arial, sans-serif" font-weight="900" font-size="88" fill="${rim}">${escapeXml(text)}</text>
</svg>
`;
}

/** 3:1 banner — crest at left, name at right, on the primary colour. */
export function bannerSvg(franchise) {
  const crest = crestSvg(franchise, { dark: false })
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400" width="1200" height="400" role="img" aria-label="${escapeXml(franchise.name)}">
<rect width="1200" height="400" fill="${franchise.colorPrimary}"/>
<rect y="340" width="1200" height="60" fill="${franchise.colorSecondary}"/>
<g transform="translate(60 60) scale(1.09)">${crest}</g>
<text x="380" y="215" font-family="Arial Black, Helvetica, Arial, sans-serif" font-weight="900" font-size="84" fill="#ffffff">${escapeXml(franchise.name.toUpperCase())}</text>
<text x="380" y="285" font-family="Helvetica, Arial, sans-serif" font-size="40" fill="#ffffff" fill-opacity="0.8">${escapeXml(franchise.division)} Division</text>
</svg>
`;
}

/** League mark — for the league logo slots the real site fills with its own crest. */
export function leagueMarkSvg(leagueName) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="${escapeXml(leagueName)}">
<circle cx="128" cy="128" r="116" fill="#14213d" stroke="#fca311" stroke-width="12"/>
<text x="128" y="150" text-anchor="middle" font-family="Arial Black, Helvetica, Arial, sans-serif" font-weight="900" font-size="72" fill="#fca311">DEMO</text>
</svg>
`;
}
