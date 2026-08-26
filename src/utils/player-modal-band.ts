/**
 * Player Modal Band — mini composite hero for player modal headers.
 *
 * Client-side counterpart to the composite heroes (FeatureCompositeHero et
 * al): team-color gradient + ghost wordmark + glow + crest watermark +
 * transparent ESPN cutout, at modal-header height. The player modals are
 * populated at open time from client data, so the band is applied here rather
 * than server-rendered. Styles live in src/styles/player-modal-band.css
 * (`.pmb` prefix).
 *
 * WHOSE COLORS: a ROSTERED player wears the FANTASY franchise that owns him —
 * its hues drive the gradient and its crest is the watermark. That is the
 * whole point of opening the modal from a roster: the NFL identity is already
 * carried as real text (team logo + city in the meta row, nickname in the
 * ghost wordmark), so spending the band on it said nothing the row didn't.
 * A player with no `franchiseId` — a free agent, or a modal opened from a
 * league-less surface — falls back to the NFL team colors, which is also what
 * happens when the page never emitted a brand map.
 *
 * The brand map is server-rendered once per page by
 * `src/components/FranchiseBandBrands.astro` and is already Throwback
 * Week-resolved, so the band throws back with everything else and needs no
 * date logic of its own.
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

import { getNflTeamColors, getNflTeamNickname, hexToRgba, mixHex } from './nfl-team-colors';
import { normalizeTeamCode } from './nfl-logo';
import type { FranchiseBandBrand, FranchiseBandBrandMap } from './franchise-band-brand';
import { pickBrandHue } from './franchise-hue';

/** Element id of the JSON island written by `FranchiseBandBrands.astro`. */
export const FRANCHISE_BAND_BRANDS_ID = 'franchise-band-brands';

export interface BandPlayer {
  name?: string | null;
  position?: string | null;
  nflTeam?: string | null;
  espnId?: string | null;
  headshot?: string | null;
  /** Fantasy franchise that rosters the player, when there is one. */
  franchiseId?: string | null;
}

export interface BandOptions {
  /** Blend the gradient toward a status accent (e.g. injury red) */
  accent?: string;
  /** Override the ghost wordmark (defaults to "POS NICKNAME") */
  ghost?: string;
}

/** True only when the URL's actual hostname is ESPN's CDN (or a subdomain) */
function isEspnCdnUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'espncdn.com' || host.endsWith('.espncdn.com');
  } catch {
    return false;
  }
}

/**
 * Resolve the transparent-cutout URL for a player, or null when the band
 * must stay gradient-only (DEF, or no ESPN source available).
 */
export function resolveCutoutUrl(player: BandPlayer): string | null {
  if ((player.position || '').toUpperCase() === 'DEF') return null;
  const shot = player.headshot || '';
  if (shot) {
    // A caller-resolved headshot is authoritative: when it isn't an ESPN CDN
    // URL (e.g. the roster avatar already fell back to the MFL JPG after an
    // ESPN 404), don't re-derive the known-bad ESPN URL from espnId.
    return isEspnCdnUrl(shot) ? shot : null;
  }
  if (player.espnId) {
    return `https://a.espncdn.com/i/headshots/nfl/players/full/${player.espnId}.png`;
  }
  return null;
}

/**
 * Read the page's server-rendered franchise brand map.
 *
 * Deliberately re-parsed on EVERY call rather than cached at module scope.
 * With the ClientRouter one module instance survives a navigation from one
 * league's page to another's, so a captured map would paint the previous
 * league's crest onto this league's franchise — the same trap
 * `rankings-scope.ts` documents. The payload is a couple of KB; the parse is
 * not worth a correctness bug.
 */
export function readFranchiseBandBrands(): FranchiseBandBrandMap | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(FRANCHISE_BAND_BRANDS_ID);
  if (!el?.textContent) return null;
  try {
    const parsed = JSON.parse(el.textContent) as FranchiseBandBrandMap;
    return parsed && typeof parsed === 'object' && parsed.teams ? parsed : null;
  } catch {
    return null;
  }
}

/** This page's brand entry for a franchise, or null when there isn't one. */
export function getFranchiseBandBrand(
  franchiseId?: string | null
): FranchiseBandBrand | null {
  if (!franchiseId) return null;
  const map = readFranchiseBandBrands();
  return map?.teams?.[franchiseId] ?? null;
}

/**
 * The hue that reads as this franchise's color OFF the band — a tint, a chip,
 * a border on the modal's light card.
 *
 * Not `brand.primary`: that is the band's gradient anchor, and for the
 * franchises that lead with a near-black it is a near-black. On deep ink that
 * is the point; at 12% on a white card it is grey. `pickBrandHue` applies the
 * same neutral test the band map itself uses, so the two can't drift apart.
 */
export function franchiseTintHue(brand: FranchiseBandBrand): string {
  return pickBrandHue(brand.primary, brand.secondary);
}

/**
 * Paint a modal header band for the given player: gradient stops + glow via
 * CSS custom props, ghost wordmark text, the franchise crest watermark, and
 * the cutout image (shown only when a transparent ESPN source exists; hidden
 * again on 404).
 *
 * The band element is expected to contain `.pmb__ghost`, `.pmb__glow`,
 * `.pmb__crest` and `.pmb__cutout` children (any may be omitted).
 */
export function applyPlayerModalBand(
  band: HTMLElement | null,
  player: BandPlayer,
  opts: BandOptions = {}
): void {
  if (!band) return;

  const teamCode = player.nflTeam ? normalizeTeamCode(player.nflTeam) : '';

  // Franchise first, NFL team as the fallback (see WHOSE COLORS above).
  const franchise = getFranchiseBandBrand(player.franchiseId);
  const nfl = getNflTeamColors(teamCode || '');
  const primary = franchise ? franchise.primary : nfl.primary;
  const secondary = franchise ? franchise.secondary : nfl.secondary;

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

  // Crest watermark — the franchise's mark, sitting behind the cutout the way
  // the draft-room splash and the lineup faceoff panels wear theirs.
  const crest = band.querySelector<HTMLImageElement>('.pmb__crest');
  if (crest) {
    if (franchise?.crest) {
      crest.src = franchise.crest;
      crest.alt = '';
      // Inline, not a class: the global `html.dark img[src=…]` stroke rule
      // would otherwise win in dark mode and double the treatment, and it
      // never fires in light mode — where this band is dark all the same.
      crest.style.filter = franchise.crestFilter ?? '';
      crest.style.display = '';
    } else {
      crest.removeAttribute('src');
      crest.style.filter = '';
      crest.style.display = 'none';
    }
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
