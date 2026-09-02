/**
 * Which franchise crest to paint on a surface that is DARK IN BOTH THEMES,
 * and whether that crest needs an outline to survive there.
 *
 * The site's crest machinery is all keyed on `html.dark`: the artwork swap in
 * `team-icon-dark-css.ts` (`html.dark img[src="<light>"] { content: url(<dark>) }`)
 * and the measured white ring in `crest-dark-stroke-css.ts` both fire only for
 * a viewer whose SITE THEME resolved to dark. That is exactly right for a card
 * that follows the theme, and it does nothing at all for the growing set of
 * surfaces that paint deep ink in both themes — a composite hero, the lineup
 * faceoff panel, the draft broadcast board. A light-theme owner looking at one
 * of those gets the light crest on near-black, with no ring, forever.
 *
 * So those surfaces resolve the crest SERVER-SIDE instead. That looks like a
 * violation of the never-pick-a-theme-on-the-server rule, and it isn't: there
 * is no theme to resolve, because the surface has only one. This module is the
 * one place that decision is written down.
 *
 * **The order is theme first: `groupMeDark → iconDark → groupMe → icon`.**
 * The dark cuts are hand-authored 100x100 (`iconDark`) or 400x400
 * (`groupMeDark`); the light art is 100x100 (`icon`) or 400x400 (`groupMe`).
 * Every surface using this renders the crest somewhere between ~40px and
 * ~300px, where a 100px source upscales at most ~3x and — at the 0.12-0.35
 * watermark opacities these surfaces use — shows nothing. Getting the right
 * ARTWORK is the whole game at that size.
 *
 * The draft broadcast is the one caller that cannot take this order for every
 * crest, and `broadcast-crest.ts` says why: its reveal crest is 68vh (~734px
 * on a 1080p TV), where the same 100px cut is a 7x upscale. It keeps a second,
 * resolution-first order for that ONE image and buys the legibility back with
 * the outline below. It shares every other primitive in this file.
 *
 * Two quiet guarantees, both load-bearing:
 *
 * - **This can never render the light `icon` of a franchise that HAS an
 *   `iconDark`** — the dark cut outranks it. That matters because
 *   `TeamIconDarkStyles` ships in the shared layout head on every page, so
 *   that exact src WOULD swap under `html.dark`, and the crest would change
 *   with the viewer's theme on a surface that has none.
 * - **The stroke is applied by the caller as an INLINE `filter`**, which also
 *   outranks the global `html.dark` rule keyed on the same src — so a light
 *   crest on one of these surfaces can never end up wearing two rings.
 *
 * Era artwork (a Throwback Week crest) has no dark variant and is not in the
 * measured manifest, so it is resolved by handing this a record carrying only
 * the era `icon`/`groupMe` and no `franchiseId` — see
 * `franchise-band-brand.ts#resolveEraCrest` for the same reasoning spelled out
 * at the band.
 */

import {
  DEFAULT_CREST_STROKE_COLOR,
  crestStrokeFilter,
  withStrokeColors,
} from './crest-dark-stroke-css';
import { preferredIconSrc } from './team-icon-dark-css';

/** The crest-bearing fields this reads off a raw league-config team entry. */
export interface DarkSurfaceCrestTeam {
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
   * `boolean`, and a page passing `config.teams` straight in is the common
   * call. That makes `true` type-legal, so it has to MEAN something: it opts
   * the crest in at the default colour, which is what `withStrokeColors`
   * already does with any truthy value. One config field must not mean two
   * different things to its two readers.
   */
  iconStrokeDark?: string | boolean;
}

/** One franchise's crest for a dark-in-both-themes surface. */
export interface DarkSurfaceCrest {
  /** The artwork to render; `''` when the franchise has no crest at all. */
  src: string;
  /**
   * Inline `filter` to put on the `<img>`, set only when `src` is LIGHT art
   * that needs the ring to read on ink. Absent for a dark cut, and for a
   * franchise a human opted out.
   */
  filter?: string;
  /** The ring colour behind `filter`, for callers composing their own filter. */
  strokeColor?: string;
}

/** True when `src` is one of the franchise's hand-authored dark cuts. */
export function isDarkCut(team: DarkSurfaceCrestTeam, src: string): boolean {
  return !!src && (src === team.groupMeDark || src === team.iconDark);
}

/**
 * Whether a LIGHT crest needs an outline on a dark surface, and in what colour.
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
 *    franchises a resolution-first order strands on light art (the broadcast's
 *    big crest) would come back with no signal at all.
 * 3. The measured manifest, via `withStrokeColors` — the same list the rest of
 *    the site strokes under `html.dark`.
 */
export function resolveCrestStroke(
  team: DarkSurfaceCrestTeam,
  measured: Map<string, string | false | undefined>
): string | undefined {
  const configured = team.iconStrokeDark;
  if (configured === false) return undefined;
  if (typeof configured === 'string' && configured) return configured;
  // `true` opts in at the default colour — the same reading `withStrokeColors`
  // gives any truthy value. Handled HERE rather than left to the index lookup
  // below so the config field's meaning does not depend on which team array the
  // caller happened to build the index from.
  if (configured === true) return DEFAULT_CREST_STROKE_COLOR;
  if (team.iconDark) return DEFAULT_CREST_STROKE_COLOR;
  const franchiseId = team.franchiseId ?? '';
  if (!measured.has(franchiseId)) return undefined;
  const entry = measured.get(franchiseId);
  // Re-check the opt-out here, not just on `team.iconStrokeDark` above. The two
  // normally agree — the index is built from the same config objects — but the
  // index is passed IN, so a caller can hand us a team record that has been
  // rebuilt without the field (the way `franchise-band-brand.ts` rebuilds a
  // franchise off its throwback identity). `false || DEFAULT` would then ring a
  // crest a human explicitly opted out of.
  if (entry === false) return undefined;
  // Only a STRING is a colour. `withStrokeColors` copies `iconStrokeDark`
  // through verbatim, so a `true` in the config arrives here as a boolean — and
  // `entry || DEFAULT` would hand it straight out as the stroke colour. It then
  // reaches CSS as an invalid `drop-shadow(… true)`, which makes the whole
  // composed `filter` invalid at computed-value time, so the crest loses its
  // drop shadow as well as its ring. Caught by Codex in review.
  return typeof entry === 'string' && entry ? entry : DEFAULT_CREST_STROKE_COLOR;
}

/**
 * Build the `franchiseId -> stroke colour` lookup for one league, once per
 * page. Split out so the per-team resolver stays cheap in a `.map()`.
 *
 * `league` is the manifest's league key (`theleague` | `afl`), matching
 * `withStrokeColors` — NOT the route directory (`afl-fantasy`).
 */
export function crestStrokeIndex(
  league: string,
  teams: DarkSurfaceCrestTeam[]
): Map<string, string | false | undefined> {
  const index = new Map<string, string | false | undefined>();
  for (const entry of withStrokeColors(league, teams as any[])) {
    if (entry?.franchiseId) index.set(entry.franchiseId, entry.strokeColor);
  }
  return index;
}

/**
 * Resolve one franchise's crest for a surface that is dark in both themes.
 *
 * Pass `index` when resolving a whole league in a loop; it is built on demand
 * otherwise so a single-team caller needs no ceremony.
 */
export function resolveDarkSurfaceCrest(
  team: DarkSurfaceCrestTeam,
  league: string,
  index?: Map<string, string | false | undefined>
): DarkSurfaceCrest {
  const measured = index ?? crestStrokeIndex(league, [team]);
  const src = team.groupMeDark || team.iconDark || team.groupMe || team.icon || '';
  if (!src) return { src: '' };

  const stroke = isDarkCut(team, src) ? undefined : resolveCrestStroke(team, measured);
  return {
    // AFL configs carry absolute production URLs on some `icon` fields — take
    // the same-origin form so the crest rides the page's own connection and
    // does not 404 against a live site that has not deployed the asset yet.
    src: preferredIconSrc(src),
    ...(stroke ? { filter: crestStrokeFilter(stroke), strokeColor: stroke } : {}),
  };
}
