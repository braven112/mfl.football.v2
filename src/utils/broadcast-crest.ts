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
 * Everything that is NOT about the 68vh crest — the artwork order for a
 * normal-sized crest, the three outline signals, the dark-cut test, the
 * manifest index — lives in `dark-surface-crest.ts` and is shared with every
 * other dark-in-both-themes surface (the recap hero, the lineup faceoff
 * panels). What survives here is only the resolution-first BIG order and the
 * two-crest shape it forces on `DraftRoomTeam`.
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
  crestStrokeIndex,
  isDarkCut,
  resolveCrestStroke,
  type DarkSurfaceCrestTeam,
} from './dark-surface-crest';
import { preferredIconSrc } from './team-icon-dark-css';

/**
 * The crest-bearing fields this reads off a raw league-config team entry —
 * the same set every dark-in-both-themes surface reads, so it is the shared
 * shape rather than a second copy of it.
 */
export type BroadcastCrestTeam = DarkSurfaceCrestTeam;

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

/**
 * Build the `franchiseId -> stroke colour` lookup for one league, once per
 * page. The board's index is the site-wide one — kept under this name so the
 * two broadcast pages read as one unit.
 */
export const broadcastStrokeIndex = crestStrokeIndex;

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
  const measured = index ?? crestStrokeIndex(league, [team]);

  // Resolution first, then theme. See the header for why this order and the
  // small one below disagree.
  const large = team.groupMeDark || team.groupMe || team.iconDark || team.icon || '';
  // Theme first: nothing here is big enough for 100px to show.
  const small = team.groupMeDark || team.iconDark || team.groupMe || team.icon || '';

  const stroke = resolveCrestStroke(team, measured);

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
