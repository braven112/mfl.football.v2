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
import { chroma, mixHex } from './nfl-team-colors';
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
 * Minimum channel spread for a color to count as a HUE rather than a neutral.
 * `#181818` scores 0 and `#8b8f93` scores 8 — the two shades that collapse
 * whole groups of franchises into one band; every real brand color in any
 * league's config clears this comfortably.
 */
const MIN_ANCHOR_CHROMA = 20;

/**
 * The gradient anchor AND the glow for a franchise, resolved together so the
 * two are never the same hue: the brand primary when it carries a hue at all,
 * otherwise the secondary — and then the neutral primary becomes the glow.
 *
 * Deliberately NOT `pickBrandAccent`, which answers a similar-looking question
 * for the SSR panels. That helper also imposes a luminance floor, so it treats
 * a dark-but-saturated navy as unusable and swaps it out — which flips Cowboy
 * Up off their navy and onto red. Here the band's left half is deep ink
 * anyway, white ink has its own floor applied downstream
 * (`ensureContrastOn`), and a navy band reads perfectly well. The only thing
 * that actually breaks this surface is a GREY, so chroma is the whole test.
 */
function resolveBandPair(
  primary: string,
  secondary: string
): { anchor: string; glow: string } {
  if (chroma(primary) >= MIN_ANCHOR_CHROMA) return { anchor: primary, glow: secondary };
  // The primary is a neutral, so the secondary carries the band — and the
  // NEUTRAL becomes the glow. Returning `secondary` for both would set `--pmb-g2`
  // and `--pmb-glow` to the same hex, and the band would render as one flat
  // colour with an invisible glow; four franchises land here.
  if (chroma(secondary) >= MIN_ANCHOR_CHROMA) return { anchor: secondary, glow: primary };
  return { anchor: primary, glow: secondary };
}

/**
 * Band art direction that the automatic hue rule cannot derive.
 *
 * `anchorHue` reads the brand pair, which is right for thirteen of sixteen
 * franchises. These three want something the pair does not say, and no rule
 * gets there — it is which of a franchise's OWN colours the band should lead
 * with, which is a judgement, not a measurement:
 *
 * - **Midwestside** is gold-on-black, and its `colorPrimary` IS the gold, so
 *   nothing in the config says the black leads. It does; the gold is trim
 *   (their crest already carries a gold stroke).
 * - **Vitside** would resolve to its red — correct family, wrong lead. The
 *   black carries it and the red accents.
 * - **Gridiron Geeks** resolve to the right blue on their own; the override
 *   only deepens it and swaps the muted `colorSecondary` orange for the vivid
 *   one, so the accent is visible at all.
 *
 * The near-blacks are tinted ~10% toward each franchise's accent rather than
 * set flat. Two reasons, and both matter: it is literally what "black with a
 * bit of gold" asks for, and a flat `#181818` on both Midwestside and Vitside
 * would make their bands identical — the thing
 * `tests/franchise-band-brand.test.ts` exists to prevent.
 *
 * Applied to the CURRENT identity only. A Throwback Week overwrites both
 * colours from the era below, which is correct: this is art direction for the
 * brand a franchise wears today, not for one it wore in 2013.
 */
const MIDWESTSIDE_BAND = { primary: mixHex('#181818', '#ffcd00', 0.1), secondary: '#ffcd00' };
const VITSIDE_BAND = { primary: mixHex('#181818', '#aa322b', 0.1), secondary: '#aa322b' };

const BAND_ART_DIRECTION: Partial<Record<LeagueSlug, Record<string, { primary: string; secondary: string }>>> = {
  // Midwestside and Vitside are the SAME franchises in both leagues, with
  // identical brand colours in both configs — so the call about which colour
  // leads has to be made in both, or the same team wears two different bands
  // depending on which roster you opened it from. (Franchise ids differ per
  // league; there is no shared key.) Gridiron Geeks has no AFL entry.
  afl: {
    '0011': MIDWESTSIDE_BAND,
    '0009': VITSIDE_BAND,
  },
  theleague: {
    // Midwestside Connection — black, with the gold as trim and glow.
    '0011': MIDWESTSIDE_BAND,
    // Vitside Mafia — black with red, which is its real colorPrimary/Secondary
    // pair; the pink it was using is a chart hue only.
    '0012': VITSIDE_BAND,
    // Gridiron Geeks — the blue leads, the orange accents. The blue is
    // deepened ~30%: at its raw #1274ba the band is bright enough that both
    // accents wash out against it — the orange glow barely registers and the
    // crest watermark loses its edges. Every other band in the league carries
    // its accent on a darker field; this brings the blue to the same footing
    // without changing which colour it is.
    '0013': { primary: mixHex('#1274ba', '#0b0e13', 0.3), secondary: '#d45500' },
  },
};

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

    let name: string = team.name ?? '';
    let crest: string = team.iconDark || team.icon || '';
    let secondary: string = getTeamColorSecondary(franchiseId, league);
    // The BRAND pair, never the chart hue. `color` is chosen for distinctness
    // on a bar graph and `design-system.md` says in as many words not to
    // repurpose it as brand identity — this band did, and it showed: Vitside
    // Mafia, a black-and-red franchise, opened in a pink that appears nowhere
    // in its brand, because pink is what reads well next to fifteen other
    // lines on a chart.
    //
    // `colorPrimary` alone is not enough either — five TheLeague franchises
    // and three AFL ones wear #181818 there, and a band built off it is the
    // same identity-less near-black for all of them. Hence `anchorHue`: the
    // primary when it carries a hue at all, the secondary when it doesn't.
    const pair = resolveBandPair(getTeamColorPrimary(franchiseId, league), secondary);
    let primary: string = pair.anchor;
    secondary = pair.glow;
    // Owner-directed override, where the automatic pick leads with the wrong
    // one of the franchise's own colours (see BAND_ART_DIRECTION).
    const directed = BAND_ART_DIRECTION[league]?.[franchiseId];
    if (directed) {
      primary = directed.primary;
      secondary = directed.secondary;
    }
    // Only a crest rendered as its LIGHT artwork can need the stroke.
    let crestFilter = team.iconDark ? undefined : strokes[franchiseId];

    if (throwback) {
      const era = getThrowbackFranchiseBrand(franchiseId, true, overrides[franchiseId]);
      name = era.name;
      // Same treatment as the current identity above — a few eras are
      // monochrome (the palette sampler falls back to a dark neutral for
      // character-heavy art), and those bands need the era secondary too.
      // `era.colorPrimary`, NOT `era.color`. getThrowbackFranchiseBrand only
      // overwrites `color` for a franchise that actually threw back
      // (`isHistorical && colorPrimary`), so for one with no eligible era it
      // is still the CURRENT chart hue — the exact field this file stopped
      // anchoring on, sneaking back in on the one week a year it shows. Same
      // shape as the crest bug `resolveEraCrest` guards.
      const eraPair = resolveBandPair(era.colorPrimary, era.colorSecondary);
      primary = eraPair.anchor;
      secondary = eraPair.glow;
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
