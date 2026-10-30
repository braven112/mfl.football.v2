/**
 * A rough sample sketch of each logo style, drawn in the owner's colors and
 * initials, for the style picker on `/live/team-logo`.
 *
 * Brandon (2026-10-30): "Classic crest" or "Modern mascot" means little until
 * you see one. These are not the logo — the owner's AI draws that — just
 * enough shape to show what each style asks for. Plain SVG strings, no image
 * files, so they recolor as the owner taps colors.
 *
 * Every shape carries a black outline and white highlights, the same two
 * neutrals the prompt always offers (`neutralsFor`, team-logo-prompt.ts).
 */

const OUTLINE = '#111111';
const LIGHT = '#FFFFFF';

/** Up to two initials from the team name: "Pacific Pigskins" → "PP", "Smokane" → "S". */
export function teamInitials(teamName: string): string {
  const words = `${teamName ?? ''}`.match(/[A-Za-z0-9]+/g) ?? [];
  const letters = words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return letters || 'MT';
}

/** Escape text for an SVG text node or attribute. */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface Palette {
  main: string;
  second: string;
  accent: string;
}

/** The owner's colors as main / second / accent, filled out with white and black. */
function paletteFor(hexes: string[]): Palette {
  const [main = '#C8102E', second, accent] = hexes;
  const fallback = main.toUpperCase() === LIGHT ? OUTLINE : LIGHT;
  return { main, second: second ?? fallback, accent: accent ?? second ?? fallback };
}

/** A geometric animal head, centered on (50, 50) at scale 1. */
function mascotHead(p: Palette, transform = ''): string {
  return (
    `<g transform="${transform}" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round">` +
    `<polygon points="22,16 42,36 26,46" fill="${p.main}"/>` +
    `<polygon points="78,16 58,36 74,46" fill="${p.main}"/>` +
    `<polygon points="26,40 50,28 74,40 72,62 50,86 28,62" fill="${p.main}"/>` +
    `<polygon points="36,60 50,54 64,60 50,86" fill="${p.second}"/>` +
    `<polygon points="32,48 45,51 40,56" fill="${p.accent}"/>` +
    `<polygon points="68,48 55,51 60,56" fill="${p.accent}"/>` +
    `<polygon points="45,74 55,74 50,81" fill="${OUTLINE}"/>` +
    '</g>'
  );
}

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">';

function crest(p: Palette, initials: string): string {
  const shield = 'M50 6 L88 18 V48 C88 72 70 86 50 95 C30 86 12 72 12 48 V18 Z';
  return (
    SVG_OPEN +
    `<path d="${shield}" fill="${p.main}" stroke="${OUTLINE}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="M50 14 L80 23 V48 C80 67 66 79 50 87 C34 79 20 67 20 48 V23 Z" fill="none" stroke="${p.second}" stroke-width="3"/>` +
    `<path d="M20 30 L50 42 L80 30 V38 L50 50 L20 38 Z" fill="${p.accent}" stroke="${OUTLINE}" stroke-width="2" stroke-linejoin="round"/>` +
    `<text x="50" y="76" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${initials.length > 1 ? 24 : 30}" fill="${p.second}" stroke="${OUTLINE}" stroke-width="1.5" paint-order="stroke">${esc(initials)}</text>` +
    '</svg>'
  );
}

function mascot(p: Palette): string {
  return SVG_OPEN + mascotHead(p) + '</svg>';
}

function monogram(p: Palette, initials: string): string {
  const size = initials.length > 1 ? 50 : 66;
  const text = (dx: number, dy: number, fill: string, stroke: number) =>
    `<text x="${50 + dx}" y="${68 + dy}" text-anchor="middle" font-family="'Arial Black', Impact, 'Helvetica Neue', sans-serif" font-weight="900" font-style="italic" font-size="${size}" letter-spacing="-3" fill="${fill}" stroke="${OUTLINE}" stroke-width="${stroke}" stroke-linejoin="round" paint-order="stroke">${esc(initials)}</text>`;
  return SVG_OPEN + text(4, 4, p.second, 4) + text(0, 0, p.main, 4) + `<rect x="18" y="78" width="64" height="5" rx="2" fill="${p.accent}" stroke="${OUTLINE}" stroke-width="1.5"/>` + '</svg>';
}

function retro(p: Palette, initials: string): string {
  const star = (x: number) =>
    `<polygon transform="translate(${x} 30) scale(0.55)" points="0,-10 2.9,-3.1 10,-3.1 4.3,1.2 6.5,8.1 0,3.8 -6.5,8.1 -4.3,1.2 -10,-3.1 -2.9,-3.1" fill="${p.accent}" stroke="${OUTLINE}" stroke-width="2"/>`;
  return (
    SVG_OPEN +
    `<ellipse cx="50" cy="50" rx="45" ry="36" fill="${p.main}" stroke="${OUTLINE}" stroke-width="4"/>` +
    `<ellipse cx="50" cy="50" rx="38" ry="29" fill="none" stroke="${p.second}" stroke-width="2" stroke-dasharray="4 3"/>` +
    star(36) + star(50) + star(64) +
    `<text x="50" y="64" text-anchor="middle" font-family="'Brush Script MT', 'Segoe Script', cursive" font-style="italic" font-weight="700" font-size="28" fill="${p.second}" stroke="${OUTLINE}" stroke-width="1.5" paint-order="stroke">${esc(initials)}</text>` +
    `<path d="M30 71 Q50 78 70 71" fill="none" stroke="${p.accent}" stroke-width="3" stroke-linecap="round"/>` +
    '</svg>'
  );
}

function badge(p: Palette, teamName: string, id: string): string {
  const ring = esc((cleanName(teamName) || 'My Team').toUpperCase());
  return (
    SVG_OPEN +
    `<defs><path id="${id}" d="M50 50 m-34 0 a34 34 0 1 1 68 0 a34 34 0 1 1 -68 0"/></defs>` +
    `<circle cx="50" cy="50" r="46" fill="${p.main}" stroke="${OUTLINE}" stroke-width="4"/>` +
    `<circle cx="50" cy="50" r="27" fill="${p.second}" stroke="${OUTLINE}" stroke-width="3"/>` +
    `<text font-family="'Arial Black', 'Helvetica Neue', sans-serif" font-weight="900" font-size="9" letter-spacing="1" fill="${LIGHT}" stroke="${OUTLINE}" stroke-width="1" paint-order="stroke"><textPath href="#${id}" startOffset="25%" text-anchor="middle">${ring}</textPath></text>` +
    mascotHead({ ...p, second: p.accent, accent: LIGHT }, 'translate(50 51) scale(0.42) translate(-50 -51)') +
    '</svg>'
  );
}

/** The name around a round badge: short enough to fit on its half circle. */
function cleanName(teamName: string): string {
  return `${teamName ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 22);
}

let badgeIds = 0;

/**
 * The sample sketch for one style, as an SVG string. Unknown style ids get
 * the crest, matching the prompt builder's fallback.
 */
export function logoStyleArt(style: string, hexes: string[], teamName: string): string {
  const p = paletteFor(hexes);
  const initials = teamInitials(teamName);
  switch (style) {
    case 'mascot':
      return mascot(p);
    case 'monogram':
      return monogram(p, initials);
    case 'retro':
      return retro(p, initials);
    case 'badge':
      return badge(p, teamName, `tlogo-ring-${++badgeIds}`);
    default:
      return crest(p, initials);
  }
}
