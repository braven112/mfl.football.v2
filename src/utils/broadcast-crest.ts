/**
 * Which franchise crest the draft broadcast paints, and whether it needs an
 * outline to survive on the board.
 *
 * The broadcast is DARK IN BOTH THEMES (see the header of
 * `draft-broadcast.css`), so none of the site's `html.dark` crest machinery
 * reaches it: the icon swap in `team-icon-dark-css.ts` and the measured stroke
 * in `crest-dark-stroke-css.ts` both only fire for a viewer whose site theme is
 * dark, and a light-theme owner driving the TV would get neither. The crest has
 * to be resolved server-side instead — same call, and the same reasoning, as
 * `franchise-band-brand.ts` makes for the player modal band.
 *
 * Where this surface DIFFERS from the band, and why there are two crests:
 *
 * - **The reveal crest is 68vh** — ~734px on a 1080p TV — and the idle board's
 *   is ~367px. The hand-authored `iconDark` cuts are 100x100; the GroupMe art
 *   is 400x400. Swapping a 400px light crest for a 100px dark one to get the
 *   right theme trades a 1.8x upscale for a 7x one, which on the only screen
 *   this page exists for is the more visible failure of the two (Brandon's
 *   call, Sep 2026, off a side-by-side of Music City at reveal size). So the
 *   BIG surfaces take the highest-resolution art and buy the legibility back
 *   with an outline instead.
 * - **The small surfaces have no such tension.** The panel crest is ~151px and
 *   the rail icons ~40px, so a 100px dark cut costs nothing there and is
 *   simply the right artwork.
 *
 * `groupMeDark` leads BOTH orders, so every 400x400 dark cut added to a league
 * config from here on takes over the big crest on its own and drops that
 * franchise's outline — this file needs no edit, only the file and the config
 * field.
 *
 * One quiet guarantee worth keeping: neither order can ever render the light
 * `icon` for a franchise that HAS an `iconDark`, because the dark cut sits
 * above it in both. That matters because the global swap
 * (`html.dark img[src="<icon>"] { content: url(<iconDark>) }`) ships on this
 * page via `TeamIconDarkStyles` in the layout head — rendering that exact light
 * src would make the crest change with the VIEWER's theme, on a board that
 * doesn't.
 */

import {
  DEFAULT_CREST_STROKE_COLOR,
  withStrokeColors,
} from './crest-dark-stroke-css';
import { preferredIconSrc } from './team-icon-dark-css';

/** The crest-bearing fields this reads off a raw league-config team entry. */
export interface BroadcastCrestTeam {
  franchiseId?: string;
  /** 100x100 light crest. */
  icon?: string;
  /** 100x100 hand-authored dark cut, when the franchise has one. */
  iconDark?: string;
  /** 400x400 light avatar. */
  groupMe?: string;
  /** 400x400 hand-authored dark cut — the best of both, when it exists. */
  groupMeDark?: string;
  /**
   * Outline colour override from the league config. A string opts the crest in
   * (and picks the colour); `false` opts it out of the stroke entirely. See
   * `CrestStrokeEntry.strokeColor` for the reasoning on both directions.
   *
   * Typed `string | boolean` rather than `string | false` so the raw config
   * array assigns without a cast — TypeScript widens a JSON `false` to
   * `boolean`, and a page passing `config.teams` straight in is the only way
   * this is ever called. `true` is not a meaningful value; it falls through to
   * the same signals a franchise that set nothing gets.
   */
  iconStrokeDark?: string | boolean;
}

export interface BroadcastCrest {
  /**
   * The reveal card's and idle board's crest: the highest-resolution art
   * available, dark cut only where it costs no resolution.
   */
  icon: string;
  /**
   * The panel and rail crest: the dark cut whenever there is one, since at
   * ~40-150px a 100px source is not upscaled enough to show.
   */
  iconSmall: string;
  /** Outline colour for `icon`, set only when that art is a LIGHT cut. */
  iconStroke?: string;
  /** Outline colour for `iconSmall`, set only when that art is a LIGHT cut. */
  iconSmallStroke?: string;
}

/** True when `src` is one of the franchise's hand-authored dark cuts. */
function isDarkCut(team: BroadcastCrestTeam, src: string): boolean {
  return !!src && (src === team.groupMeDark || src === team.iconDark);
}

/**
 * Whether a LIGHT crest needs an outline on the board, and in what colour.
 *
 * Three signals, most specific first:
 *
 * 1. `iconStrokeDark` in the config — a human's answer in either direction, so
 *    it outranks everything (`false` is an opt-out, not a falsy colour).
 * 2. The franchise HAS an `iconDark`. That is already a human saying this
 *    franchise's light artwork does not survive on a dark surface — the exact
 *    question being asked here. The site-wide manifest never measures these
 *    crests (`measure-crest-contrast.mjs` skips any team with an `iconDark`,
 *    correctly, since everywhere else they swap), so without this clause the
 *    ~14 franchises the big-crest resolution rule leaves on light art would
 *    come back with no signal at all.
 * 3. The measured manifest, via `withStrokeColors` — the same list the rest of
 *    the site strokes under `html.dark`.
 */
function resolveStroke(
  team: BroadcastCrestTeam,
  measured: Map<string, string | false | undefined>
): string | undefined {
  const configured = team.iconStrokeDark;
  if (configured === false) return undefined;
  if (typeof configured === 'string' && configured) return configured;
  if (team.iconDark) return DEFAULT_CREST_STROKE_COLOR;
  const franchiseId = team.franchiseId ?? '';
  if (!measured.has(franchiseId)) return undefined;
  return measured.get(franchiseId) || DEFAULT_CREST_STROKE_COLOR;
}

/**
 * Build the `franchiseId -> stroke colour` lookup for one league, once per
 * page. Split out so the per-team resolver stays cheap in a `.map()`.
 */
export function broadcastStrokeIndex(
  league: string,
  teams: BroadcastCrestTeam[]
): Map<string, string | false | undefined> {
  const index = new Map<string, string | false | undefined>();
  for (const entry of withStrokeColors(league, teams as any[])) {
    if (entry?.franchiseId) index.set(entry.franchiseId, entry.strokeColor);
  }
  return index;
}

/**
 * Resolve one franchise's broadcast crests. `league` is the manifest's league
 * key (`theleague` | `afl`), matching `withStrokeColors`.
 *
 * Pass `index` when resolving a whole league in a loop; it is built on demand
 * otherwise so a single-team caller needs no ceremony.
 */
export function resolveBroadcastCrest(
  team: BroadcastCrestTeam,
  league: string,
  index?: Map<string, string | false | undefined>
): BroadcastCrest {
  const measured = index ?? broadcastStrokeIndex(league, [team]);

  // Resolution first, then theme. See the header for why this order and the
  // small one below disagree.
  const large = team.groupMeDark || team.groupMe || team.iconDark || team.icon || '';
  // Theme first: nothing here is big enough for 100px to show.
  const small = team.groupMeDark || team.iconDark || team.groupMe || team.icon || '';

  const stroke = resolveStroke(team, measured);

  return {
    // AFL configs carry absolute production URLs on some `icon` fields — take
    // the same-origin form so the crest rides the page's own connection and
    // does not 404 against a live site that has not deployed the asset yet.
    icon: large ? preferredIconSrc(large) : '',
    iconSmall: small ? preferredIconSrc(small) : '',
    ...(large && !isDarkCut(team, large) && stroke ? { iconStroke: stroke } : {}),
    ...(small && !isDarkCut(team, small) && stroke ? { iconSmallStroke: stroke } : {}),
  };
}
