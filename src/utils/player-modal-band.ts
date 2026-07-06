/**
 * Player Modal Band — mini composite hero for player modal headers.
 *
 * Client-side counterpart to the composite heroes (FeatureCompositeHero et
 * al): team-color gradient + ghost wordmark + glow + transparent ESPN cutout,
 * at modal-header height. The player modals are populated at open time from
 * client data, so the band is applied here rather than server-rendered.
 * Styles live in src/styles/player-modal-band.css (`.pmb` prefix).
 *
 * Composite rules (docs/claude/insights/features/player-composites.md):
 *   - Only transparent ESPN headshots composite (URL contains espncdn.com);
 *     MFL JPGs have baked backgrounds and ruin the band — gradient-only then.
 *   - DEF "players" are logos, not people — never cut out.
 *   - A 404'd cutout hides itself and the band stays gradient-only.
 *
 * @example
 * ```ts
 * import { applyPlayerModalBand } from '../../utils/player-modal-band';
 *
 * applyPlayerModalBand(document.getElementById('pdm-band'), playerData);
 * applyPlayerModalBand(band, playerData, { accent: '#dc2626', ghost: 'Questionable' });
 * ```
 */

import { getNflTeamColors, getNflTeamNickname, hexToRgba } from './nfl-team-colors';
import { normalizeTeamCode } from './nfl-logo';

export interface BandPlayer {
  name?: string | null;
  position?: string | null;
  nflTeam?: string | null;
  espnId?: string | null;
  headshot?: string | null;
}

export interface BandOptions {
  /** Blend the gradient toward a status accent (e.g. injury red) */
  accent?: string;
  /** Override the ghost wordmark (defaults to "POS NICKNAME") */
  ghost?: string;
}

/** Linear mix of two #rrggbb colors; t=0 → a, t=1 → b */
function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    const v = m ? parseInt(m[1], 16) : 0x16202c;
    return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  };
  const ca = parse(a);
  const cb = parse(b);
  const mix = ca.map((c, i) => Math.round(c + (cb[i] - c) * t));
  return `#${mix.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Resolve the transparent-cutout URL for a player, or null when the band
 * must stay gradient-only (DEF, or no ESPN source available).
 */
export function resolveCutoutUrl(player: BandPlayer): string | null {
  if ((player.position || '').toUpperCase() === 'DEF') return null;
  const shot = player.headshot || '';
  if (shot.includes('espncdn.com')) return shot;
  if (player.espnId) {
    return `https://a.espncdn.com/i/headshots/nfl/players/full/${player.espnId}.png`;
  }
  return null;
}

/**
 * Paint a modal header band for the given player: gradient stops + glow via
 * CSS custom props, ghost wordmark text, and the cutout image (shown only
 * when a transparent ESPN source exists; hidden again on 404).
 *
 * The band element is expected to contain `.pmb__ghost`, `.pmb__glow` and
 * `.pmb__cutout` children (any may be omitted).
 */
export function applyPlayerModalBand(
  band: HTMLElement | null,
  player: BandPlayer,
  opts: BandOptions = {}
): void {
  if (!band) return;

  const teamCode = player.nflTeam ? normalizeTeamCode(player.nflTeam) : '';
  const { primary, secondary } = getNflTeamColors(teamCode || '');

  // Deep-ink → team primary, 115° like the site composites. An accent pulls
  // both stops toward the status color so the band reads "team, but alarmed".
  let g1 = mixHex(primary, '#0b0e13', 0.62);
  let g2 = primary;
  let glow = hexToRgba(secondary, 0.4);
  if (opts.accent) {
    g1 = mixHex(mixHex(primary, opts.accent, 0.45), '#0b0e13', 0.55);
    g2 = mixHex(primary, opts.accent, 0.55);
    glow = hexToRgba(opts.accent, 0.38);
  }
  band.style.setProperty('--pmb-g1', g1);
  band.style.setProperty('--pmb-g2', g2);
  band.style.setProperty('--pmb-glow', glow);

  const ghost = band.querySelector<HTMLElement>('.pmb__ghost');
  if (ghost) {
    const pos = (player.position || '').toUpperCase();
    const nickname = teamCode && teamCode !== 'NFL' ? getNflTeamNickname(teamCode) : '';
    const text = opts.ghost ?? [pos !== 'DEF' ? pos : '', nickname].filter(Boolean).join(' ');
    ghost.textContent = text;
  }

  const cutout = band.querySelector<HTMLImageElement>('.pmb__cutout');
  if (cutout) {
    const url = resolveCutoutUrl(player);
    if (url) {
      band.classList.remove('pmb--no-cutout');
      cutout.style.display = '';
      cutout.onerror = () => {
        cutout.style.display = 'none';
        band.classList.add('pmb--no-cutout');
      };
      cutout.src = url;
    } else {
      cutout.onerror = null;
      cutout.removeAttribute('src');
      cutout.style.display = 'none';
      band.classList.add('pmb--no-cutout');
    }
  }
}
