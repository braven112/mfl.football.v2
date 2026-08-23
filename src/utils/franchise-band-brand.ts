/**
 * Franchise band brands — the FANTASY team's identity, packaged small enough
 * to hand the client.
 *
 * The player modals paint their header band client-side (see
 * `player-modal-band.ts`), so anything the band needs has to be serializable
 * and already resolved by the time the JS runs. This builder produces exactly
 * that: one flat record per franchise carrying the crest to draw and the two
 * hues the gradient reads from.
 *
 * Three decisions worth keeping:
 *
 * - **The crest is chosen server-side, and it is the DARK artwork when the
 *   franchise has any.** That looks like a violation of the never-pick-a-
 *   theme-server-side rule (`team-icon-dark-css.ts`), and it isn't: the band
 *   is a deep-ink composite, so its surface is dark in BOTH themes. There is
 *   no theme to resolve — the crest always lands on ink. Picking `iconDark`
 *   here also sidesteps the global `html.dark img[src="<light>"]` swap, since
 *   that rule keys on the LIGHT src and never matches what we render.
 * - **`crestFilter` carries the measured white stroke.** For a franchise with
 *   no `iconDark` whose crest measures illegible on ink
 *   (`crest-dark-stroke-manifest.json`), the global stroke rule only fires
 *   under `html.dark` — but our surface is dark in light mode too. The caller
 *   applies this as an INLINE style, which also beats the global rule so the
 *   stroke can never double up.
 * - **Throwback Week is resolved here, not in the band.** During a throwback
 *   week the map is rebuilt off each franchise's resolved legacy identity, so
 *   every surface reading this map (every player modal on the page) throws
 *   back together, with no client-side date logic.
 * - **The gradient anchor is floored for white ink.** Unlike NFL primaries,
 *   which are overwhelmingly dark, the franchise chart hues include a pure
 *   gold (Midwestside, 1.5:1 against white) and several pastels. The band is
 *   a deep-ink composite with white type, so the anchor is darkened just far
 *   enough to clear 3:1 — the hue survives, the ink stays readable.
 *
 * @example
 * ```ts
 * const brands = buildFranchiseBandBrands('theleague', {
 *   throwbackActive: true,
 *   throwbackOverrides: { '0001': 2014 },
 * });
 * brands['0001'].crest;   // the 2014-era crest
 * brands['0001'].primary; // the 2014-era hue
 * ```
 */

import theleagueConfig from '../data/theleague.config.json';
import aflConfig from '../../data/afl-fantasy/afl.config.json';
import bb1Config from '../../data/best-ball-1/bb1.config.json';
import type { LeagueSlug } from '../types/nav';
import { getTeamColorPrimary, getTeamColorSecondary } from './team-colors';
import { AA_LARGE_TEXT_RATIO, ensureContrastOn } from './team-color-contrast';
import { getThrowbackFranchiseBrand } from './franchise-brand';
import { preferredIconSrc } from './team-icon-dark-css';
import { crestStrokeFilter, withStrokeColors } from './crest-dark-stroke-css';

/** One franchise's band identity — everything the client band needs, nothing else. */
export interface FranchiseBandBrand {
  /** Display name (legacy name during a Throwback Week). */
  name: string;
  /** Crest to draw as the band watermark; `''` when the franchise has none. */
  crest: string;
  /** Gradient anchor hue, already floored to clear 3:1 against white ink. */
  primary: string;
  /** Glow / accent hue. */
  secondary: string;
  /** Inline `filter` for the crest, when it needs the measured stroke to read on ink. */
  crestFilter?: string;
}

export interface FranchiseBandBrandMap {
  league: LeagueSlug;
  /** True when the map was built off legacy identities. */
  throwback: boolean;
  teams: Record<string, FranchiseBandBrand>;
}

export interface BuildFranchiseBandBrandsOptions {
  /** Dress every franchise in its resolved legacy identity (TheLeague only). */
  throwbackActive?: boolean;
  /** franchiseId -> owner-chosen era `yearStart`, from the throwback store. */
  throwbackOverrides?: Record<string, number>;
}

const LEAGUE_TEAMS: Record<LeagueSlug, any[]> = {
  theleague: (theleagueConfig as any).teams ?? [],
  afl: (aflConfig as any).teams ?? [],
  bb1: (bb1Config as any).teams ?? [],
};

/**
 * Stroke color per franchise for the crests that need one, keyed by the LIGHT
 * `icon` src the manifest records. `withStrokeColors` already excludes every
 * franchise with an `iconDark`, so a crest can never get both treatments.
 */
function strokeFilterByFranchise(league: LeagueSlug, teams: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of withStrokeColors(league, teams)) {
    if (!entry?.franchiseId || entry.strokeColor === false) continue;
    out[entry.franchiseId] = crestStrokeFilter(entry.strokeColor || undefined);
  }
  return out;
}

/**
 * The era crest to actually render, or `''` to keep what the franchise wears
 * now.
 *
 * `resolveThrowbackIdentity` falls back to the CURRENT identity for a
 * franchise with no eligible era, and `getThrowbackFranchiseBrand` hands that
 * back as `icon` — the current LIGHT crest. Taking it would undo both of this
 * file's crest rules at once: the light src re-arms the global `html.dark`
 * swap (so the crest would change with the theme on a band that doesn't), and
 * the era branch clears `crestFilter`, stripping a stroke the light artwork
 * still needs.
 *
 * Split out and exported so the no-eligible-era case is testable. Every
 * franchise has an eligible era today, so a sweep over the real config can
 * only ever pass — one `THROWBACK_ASSET_CONFLICTS` entry is all it takes to
 * arm this, on the one week a year anyone would see it.
 */
export function resolveEraCrest(currentIcon: string, eraIcon: string): string {
  return eraIcon && eraIcon !== currentIcon ? eraIcon : '';
}

/**
 * Build the serializable franchise band map for one league.
 *
 * `throwbackActive` only does anything for TheLeague — it is the only league
 * with a `history[]` to throw back to, and the only one the throwback store
 * writes for.
 */
export function buildFranchiseBandBrands(
  league: LeagueSlug,
  options: BuildFranchiseBandBrandsOptions = {}
): FranchiseBandBrandMap {
  const teams = LEAGUE_TEAMS[league] ?? [];
  const throwback = !!options.throwbackActive && league === 'theleague';
  const overrides = options.throwbackOverrides ?? {};
  const strokes = strokeFilterByFranchise(league, teams);

  const map: Record<string, FranchiseBandBrand> = {};
  for (const team of teams) {
    const franchiseId = team?.franchiseId;
    if (!franchiseId) continue;

    // Current identity. `color` (the chart hue) is the anchor the site's other
    // franchise composites tint with (`franchiseGradient`); the AFL and
    // best-ball configs don't carry one, so fall through to the brand primary.
    let name: string = team.name ?? '';
    let crest: string = team.iconDark || team.icon || '';
    // `colorPrimary` is deliberately NOT the anchor: five franchises wear
    // #181818 there, and a band built off it is the same near-black for all
    // of them. The chart hue is the identifiable one — floor it instead.
    let primary: string = team.color || getTeamColorPrimary(franchiseId, league);
    let secondary: string = getTeamColorSecondary(franchiseId, league);
    // Only a crest rendered as its LIGHT artwork can need the stroke.
    let crestFilter = team.iconDark ? undefined : strokes[franchiseId];

    if (throwback) {
      const era = getThrowbackFranchiseBrand(franchiseId, true, overrides[franchiseId]);
      name = era.name;
      primary = era.color;
      secondary = era.colorSecondary;
      // Empty when this franchise has no eligible era to throw back to — see
      // resolveEraCrest for why taking `era.icon` there is wrong twice over.
      const eraCrest = resolveEraCrest(team.icon ?? '', era.icon ?? '');
      if (eraCrest) {
        // Era artwork has no dark variant and is not in the stroke manifest
        // (which measures current crests only), so it renders as authored.
        crest = eraCrest;
        crestFilter = undefined;
      }
    }

    map[franchiseId] = {
      name,
      crest: crest ? preferredIconSrc(crest) : '',
      primary: ensureContrastOn(primary, '#ffffff', AA_LARGE_TEXT_RATIO),
      secondary,
      ...(crestFilter ? { crestFilter } : {}),
    };
  }

  return { league, throwback, teams: map };
}
