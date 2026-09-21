/**
 * Team bands — a franchise colour used as a FULL-BLEED FILL, with ink on top.
 *
 * This is the background-fill half of the franchise-colour rules, and it is
 * deliberately NOT `--team-accent-<id>` (`team-accent-css.ts`). That token is
 * floored for FOREGROUND use: it shifts the brand colour until it clears 3:1
 * against the card, which is exactly wrong for a fill, where the colour IS the
 * surface and the thing that must clear a floor is the text sitting on it.
 * See `docs/claude/rules/theming-and-assets.md` § "Franchise colors as
 * foreground" — the section names this case as the exception it does not cover.
 *
 * The existing fill helpers do not cover it either, and each for a stated
 * reason: `toBroadcastPair` / `darkenForWhiteText` only ever DARKEN, because
 * they guarantee WHITE ink; `ensureFieldOn` walks the other way but is likewise
 * hard-wired to white. A standings band cannot assume white — three AFL clubs
 * wear a near-white primary (Avenging Amish `#e9e9e9`) and two wear a pure
 * gold/yellow (Chatmaster, Midwestside), which white ink fails outright. The
 * band flips its ink instead, which is what the reference design does: white on
 * the Micks' green, near-black on Chatmaster's gold.
 *
 * Two floors have to hold at once, and they pull in opposite directions:
 *
 *   1. INK on FILL ≥ 3:1, the WCAG AA floor for large text — which is a claim
 *      about the TYPE, not a convenient threshold, and the stylesheet has to
 *      keep it true: every text node inside a band row renders at ≥19px/700,
 *      clearing the 18.66px-bold definition of large text. That is the contract
 *      `tests/team-band-type-contract.test.ts` pins, because shrinking the stat
 *      columns one day would silently invalidate every ratio measured here.
 *      Measured at the body floor instead, eight AFL clubs — the Micks' green
 *      among them, at 3.20:1 — would flip to dark ink, which is not what the
 *      design is; measured at 3:1, no franchise in either league needs its
 *      brand colour touched AT ALL.
 *   2. FILL vs CARD ≥ 1.35:1. A fill that matches the page is not a band. Seven
 *      of TheLeague's sixteen franchises carry `#181818`, which measures 1.06:1
 *      against the dark card — an unfloored band renders those rows as holes in
 *      the table, the same failure `ensureFieldOn` was written for on the
 *      broadcast board.
 *
 * `solveBand` satisfies both by moving the FILL, never the ink, and only as far
 * as it must: a franchise whose colour already clears both floors is returned
 * byte-identical, which is the whole point — the band is supposed to be the
 * club's colour, not a computed approximation of it.
 *
 * Ink is WHITE-FIRST rather than best-contrast. On the fills that clear 3:1
 * both ways, white is what a football graphic wears, and picking "whichever
 * measures higher" would put dark ink on the Pigskins' red (6.19 white vs 2.94
 * dark — fine) but also on Ditkas red and Saints red the moment one of them is
 * re-sampled a shade lighter. A preference is stable under a colour tweak; a
 * comparison flips.
 *
 * Both themes are resolved here, together, and handed to CSS as custom
 * properties — never picked in frontmatter. With theme preference 'auto' the
 * server does not know the resolved theme; only a property keyed on `html.dark`
 * does. Same rule as the NFL logo swap and the accent token.
 *
 * @example
 *   const band = resolveTeamBand('0013', 'afl');
 *   band.fill;     // '#42a349' — untouched, already legible
 *   band.ink;      // '#ffffff'
 *   teamBandStyle(band); // '--band-fill:#42a349;--band-ink:#ffffff;…'
 */

import theleagueConfig from '../data/theleague.config.json';
import aflConfig from '../../data/afl-fantasy/afl.config.json';
import bb1Config from '../../data/best-ball-1/bb1.config.json';
import type { LeagueSlug } from '../types/nav';
import {
  AA_LARGE_TEXT_RATIO,
  contrastRatio,
  colorDistance,
  relativeLuminance,
  shiftLightness,
} from './team-color-contrast';

/** The two inks a band may wear. Near-black rather than pure black: the site
 *  writes no true `#000` text anywhere, and the difference is invisible at 4.5:1. */
export const BAND_INK_DARK = '#10161f';
export const BAND_INK_LIGHT = '#ffffff';

/** The card each theme's band sits on. `#262626` is the same dark surface
 *  `crest-dark-stroke-manifest.json` measured its crests against, so a crest
 *  ruled legible there is legible on a band that only had to clear 1.35:1 of it. */
export const BAND_SURFACE_LIGHT = '#ffffff';
export const BAND_SURFACE_DARK = '#262626';

/** Ink on fill. The large-text floor, which the band's ≥19px/700 type earns. */
export const BAND_INK_MIN_RATIO = AA_LARGE_TEXT_RATIO;
/** Fill vs card. Low on purpose: a band only has to be SEEN, not read. */
export const BAND_SURFACE_MIN_RATIO = 1.35;

const NEUTRAL_FILL = '#6b7280';
const isHex = (c?: string): c is string => !!c && /^#?[0-9a-f]{6}$/i.test(c.trim());
const normalizeHex = (c: string): string => (c.trim().startsWith('#') ? c.trim() : `#${c.trim()}`);

/** One franchise's band, resolved for both themes. */
export interface TeamBand {
  /** Fill on the light card. The config colour untouched wherever it clears both floors. */
  fill: string;
  /** Ink on `fill` — `BAND_INK_LIGHT` wherever it is legible, else `BAND_INK_DARK`. */
  ink: string;
  /** Fill on the dark card — the same `colorPrimary`, lifted only as far as the
   *  darker card requires. See `resolveTeamBand` on why NOT `colorPrimaryDark`. */
  fillDark: string;
  /** Ink on `fillDark`. Resolved independently — the two themes can disagree. */
  inkDark: string;
}

interface Solved {
  fill: string;
  ink: string;
  /** How far the fill had to move from the config colour (ΔE). 0 = untouched. */
  drift: number;
}

/**
 * Walk `fill` away from `ink` until the ink is legible on it, then away from
 * `surface` until the band separates from the card — the second walk never
 * allowed to undo the first.
 *
 * Returns `null` when the ink cannot be satisfied at all (a mid-tone that fails
 * both inks is possible in principle; no franchise in any league hits it today,
 * and `tests/team-band.test.ts` fails the build if one ever does).
 */
function solveBand(fill: string, ink: string, surface: string): Solved | null {
  const original = fill;
  let out = fill;

  // 1. Ink legibility. Dark ink wants a lighter fill and vice versa.
  const inkDir = relativeLuminance(ink) < 0.5 ? 1 : -1;
  if (contrastRatio(ink, out) < BAND_INK_MIN_RATIO) {
    let solved = false;
    for (let step = 0.04; step <= 1.0001; step += 0.04) {
      const candidate = shiftLightness(original, inkDir * step);
      if (contrastRatio(ink, candidate) >= BAND_INK_MIN_RATIO) {
        out = candidate;
        solved = true;
        break;
      }
    }
    if (!solved) return null;
  }

  // 2. Separation from the card, which must never cost the ink. A band that is
  //    hard to distinguish from the page is a cosmetic failure; a band whose
  //    numbers cannot be read is a real one, so the ink floor wins ties.
  if (contrastRatio(out, surface) < BAND_SURFACE_MIN_RATIO) {
    const surfaceDir = relativeLuminance(surface) < 0.5 ? 1 : -1;
    const base = out;
    for (let step = 0.03; step <= 1.0001; step += 0.03) {
      const candidate = shiftLightness(base, surfaceDir * step);
      if (contrastRatio(ink, candidate) < BAND_INK_MIN_RATIO) break;
      out = candidate;
      if (contrastRatio(out, surface) >= BAND_SURFACE_MIN_RATIO) break;
    }
  }

  return { fill: out, ink, drift: colorDistance(original, out) };
}

/**
 * The band for one colour on one card surface.
 *
 * White ink wins wherever it is legible on the brand colour as it stands; dark
 * ink takes the fills white cannot hold (the golds, the near-whites). Only when
 * NEITHER ink clears the floor on the untouched colour does the fill move, and
 * then it moves the smaller distance of the two. No franchise in any league
 * reaches that branch today — it exists so a future re-colour degrades into a
 * nudged fill rather than into unreadable text.
 */
export function bandFor(color: string, surface: string): { fill: string; ink: string } {
  const fill = isHex(color) ? normalizeHex(color) : NEUTRAL_FILL;

  for (const ink of [BAND_INK_LIGHT, BAND_INK_DARK]) {
    if (contrastRatio(ink, fill) >= BAND_INK_MIN_RATIO) {
      const solved = solveBand(fill, ink, surface);
      if (solved) return { fill: solved.fill, ink: solved.ink };
    }
  }

  const solvedBoth = [
    solveBand(fill, BAND_INK_LIGHT, surface),
    solveBand(fill, BAND_INK_DARK, surface),
  ].filter((c): c is Solved => c !== null);
  if (solvedBoth.length === 0) {
    // Unreachable for every franchise on file; a neutral band is still readable.
    return { fill: NEUTRAL_FILL, ink: BAND_INK_LIGHT };
  }
  solvedBoth.sort((a, b) => a.drift - b.drift);
  return { fill: solvedBoth[0].fill, ink: solvedBoth[0].ink };
}

function teamEntry(franchiseId: string, league: LeagueSlug): any {
  const teams: any[] =
    league === 'afl'
      ? ((aflConfig as any).teams ?? [])
      : league === 'bb1'
        ? ((bb1Config as any).teams ?? [])
        : ((theleagueConfig as any).teams ?? []);
  return teams.find((t) => t?.franchiseId === franchiseId) ?? {};
}

/**
 * A franchise's band in both themes.
 *
 * BOTH themes start from `colorPrimary`, and `colorPrimaryDark` is deliberately
 * ignored. That field is a hand-tuned lift of the primary for FOREGROUND use on
 * a dark card — for several TheLeague clubs it is a different hue entirely (the
 * Ninjas' near-black primary has a green dark value), which as a fill would
 * hand the same franchise two different identities depending on the reader's
 * theme. A band is the club's colour; the only thing the dark theme changes is
 * how far that colour has to be lifted off a darker card.
 */
export function resolveTeamBand(franchiseId: string, league: LeagueSlug = 'theleague'): TeamBand {
  const team = teamEntry(franchiseId, league);
  const primary: string = isHex(team.colorPrimary) ? team.colorPrimary : NEUTRAL_FILL;

  const light = bandFor(primary, BAND_SURFACE_LIGHT);
  const dark = bandFor(primary, BAND_SURFACE_DARK);

  return {
    fill: light.fill,
    ink: light.ink,
    fillDark: dark.fill,
    inkDark: dark.ink,
  };
}

/**
 * The band as an inline custom-property declaration, for a row's `style`.
 *
 * Both themes ride along and the stylesheet picks under `html.dark`; see the
 * module note on why the choice cannot be made here.
 */
export function teamBandStyle(band: TeamBand): string {
  return [
    `--band-fill:${band.fill}`,
    `--band-ink:${band.ink}`,
    `--band-fill-dark:${band.fillDark}`,
    `--band-ink-dark:${band.inkDark}`,
  ].join(';');
}

/**
 * Attach each team's band to a list that already carries franchise ids.
 *
 * For a surface whose markup is built in the BROWSER — the waiver order is
 * re-rendered from `/api/waiver-order` on every open — the band cannot be
 * resolved where it is drawn: this module reads the league configs, which the
 * browser does not have. Resolving it onto the team list instead means the
 * band travels with the team it belongs to, through whatever config blob that
 * surface already ships, and the two can never disagree about which colour
 * goes with which franchise.
 *
 * Client code should import `TeamBand` as a TYPE ONLY. A value import would
 * pull all three league configs into the browser bundle for the sake of a
 * record that is already serialized in the page.
 */
export function withTeamBands<T extends { franchiseId: string; icon?: string }>(
  teams: T[],
  league: LeagueSlug,
): Array<T & { band: TeamBand }> {
  return teams.map((team) => {
    const band = resolveTeamBand(team.franchiseId, league);
    // An `icon` is swapped to the cut that reads on THIS fill, for the same
    // reason `bandCrestSrc` exists at all — and here rather than at the call
    // sites because a team prepared for a band needs both halves or neither.
    // A near-black fill with the light crest on it is the Computer Jocks
    // vanishing into their own row.
    const icon =
      typeof team.icon === 'string' && team.icon
        ? bandCrestSrc(team.icon, league, band.ink === BAND_INK_LIGHT)
        : team.icon;
    return { ...team, icon, band };
  });
}

/**
 * The crest artwork a band should render, chosen by the FILL rather than by the
 * theme — the same reasoning `franchise-band-brand.ts` records for the player
 * modal's band, arrived at from the opposite direction. There the surface is
 * deep ink in both themes, so the dark cut always wins; here the surface is the
 * club's own colour, which may be gold or near-black, so the cut has to be
 * picked per franchise. Chatmaster is the case that proves it: its light crest
 * is the AIM runner in a GOLD FRAME, which vanishes on that club's gold band,
 * while the dark cut reads cleanly on it.
 *
 * Keyed off the icon src the caller already resolved, so an archived season
 * that renders an era crest keeps that era's artwork instead of snapping back
 * to today's — the map holds every `icon`/`iconDark` pair in the league config,
 * history entries included.
 *
 * @param icon the light-mode icon src the page resolved for this team/season.
 * @param inkIsLight true when the band wears WHITE ink, i.e. the fill is dark.
 */
export function bandCrestSrc(icon: string, league: LeagueSlug, inkIsLight: boolean): string {
  if (!icon || !inkIsLight) return icon;
  return darkCrestMap(league)[icon] ?? icon;
}

const DARK_CREST_MAPS = new Map<LeagueSlug, Record<string, string>>();

function darkCrestMap(league: LeagueSlug): Record<string, string> {
  const cached = DARK_CREST_MAPS.get(league);
  if (cached) return cached;

  const teams: any[] =
    league === 'afl'
      ? ((aflConfig as any).teams ?? [])
      : league === 'bb1'
        ? ((bb1Config as any).teams ?? [])
        : ((theleagueConfig as any).teams ?? []);

  const map: Record<string, string> = {};
  const add = (light?: string, dark?: string) => {
    if (typeof light === 'string' && typeof dark === 'string' && light && dark) map[light] = dark;
  };
  for (const team of teams) {
    add(team?.icon, team?.iconDark);
    for (const era of team?.history ?? []) add(era?.icon, era?.iconDark);
  }
  DARK_CREST_MAPS.set(league, map);
  return map;
}
