/**
 * The roster header's SOLID band — one flat club colour, not a gradient.
 *
 * ## Why this is not `resolveHeroFranchiseSkin`
 *
 * The hero resolver produces a two-stop gradient plus a wash, and everything
 * it measures is measured against that: `accent` clears 3:1 over the copy
 * band, `accentPanel` 4.5:1 over the far end, and the two genuinely differ
 * because "a colour readable on one end is invisible on the other by
 * construction". A flat fill has one end, so all of that collapses — and the
 * header wanted the flat version.
 *
 * ## Why it reads the BAND brand rather than `colorPrimary`
 *
 * Seven of TheLeague's sixteen franchises and four of the AFL's carry
 * `#181818` as `colorPrimary`, so a solid fill taken from it paints eleven
 * identity-less near-black rectangles. `franchise-band-brand.ts` already
 * solved exactly this for the player-modal band: its `anchorHue` takes the
 * primary when it carries a hue at all and the SECONDARY when it does not,
 * which is why Maverick's band is gold, Computer Jocks' is green and
 * Vitside's is a red-black. It also carries `BAND_ART_DIRECTION` — the
 * per-club calls a human made — and resolves Throwback Week. Re-deriving any
 * of that here would be a second opinion on settled questions, and the two
 * would drift.
 *
 * ## The one thing this adds: a higher floor
 *
 * The band's anchor is floored to **3:1 against white**, which is correct for
 * the band: a deep-ink composite whose type is a large club name. This header
 * is mostly SMALL type — the meta line is 0.78rem, the stat values 0.95rem
 * bold (15.2px, under the 18.66px that would make bold type "large") — so it
 * owes 4.5:1. That is the same split `accent` / `accentPanel` already makes
 * in the hero resolver: one surface, two floors, because the type differs.
 *
 * Eighteen of the forty clubs move, by a mean ΔE of 5.5.
 *
 * ## And why the plate's ink is FULL strength
 *
 * The obvious way to keep a hierarchy between the club name and the meta line
 * is to dim the meta, which the gradient version did at 0.72 alpha. On a
 * solid band that is expensive in a way it is not on a gradient: every point
 * of dimming has to be paid for by darkening the fill, because the fill is
 * the only thing behind it. Measured across all forty clubs, flooring for
 * 0.72-alpha ink costs a mean ΔE of 14.2 and as much as 34.4 — Muck Juggling
 * Micks' green `#42a349` collapses to a murky `#255b29`. At full strength it
 * is 5.5 and 18.2.
 *
 * So the plate's hierarchy is carried by SIZE, WEIGHT and letter-spacing, and
 * every mark on it is full-strength ink. Dimming any of them again means
 * darkening every club's colour to pay for it.
 */

import type { CanonicalLeagueSlug } from '../config/leagues';
import type { LeagueSlug } from '../types/nav';
import { buildFranchiseBandBrands, type FranchiseBandBrandMap } from './franchise-band-brand';
import { ensureContrastOn, AA_BODY_TEXT_RATIO } from './team-color-contrast';

/**
 * The plate's ink, and the reference the fill is floored against.
 *
 * Not `#ffffff`: flooring against pure white leaves the real ink — which is
 * this, slightly cool and slightly off — landing at about 4.3:1, under the
 * bar it was supposed to clear. Floor against the colour you actually paint.
 */
export const ROSTER_PLATE_INK = '#f2f5f8';

export interface RosterHeaderSkin {
  /** The solid band. Flat, and dark enough for `ROSTER_PLATE_INK` at 4.5:1. */
  fill: string;
  /** The club's second hue — for a mark that wants the brand rather than ink. */
  glow: string;
  /** Oversized crest for the watermark; `''` when the club has no artwork. */
  crest: string;
  /** Measured white stroke, for a light crest that would vanish on the fill. */
  crestFilter?: string;
}

/** `CanonicalLeagueSlug` is the site's; the band map keys on the nav's. */
const BAND_SLUG: Partial<Record<CanonicalLeagueSlug, LeagueSlug>> = {
  theleague: 'theleague',
  'afl-fantasy': 'afl',
};

/**
 * One band map per league per process.
 *
 * `buildFranchiseBandBrands` walks a whole league, and TheLeague's roster page
 * asks for sixteen clubs on one render — the default plus fifteen swap
 * templates. Without this that is sixteen full walks per request.
 */
const cache = new Map<LeagueSlug, FranchiseBandBrandMap>();

export function resolveRosterHeaderSkin(
  franchiseId: string | null | undefined,
  league: CanonicalLeagueSlug,
): RosterHeaderSkin | null {
  if (!franchiseId) return null;
  const slug = BAND_SLUG[league];
  if (!slug) return null;

  let map = cache.get(slug);
  if (!map) {
    map = buildFranchiseBandBrands(slug);
    cache.set(slug, map);
  }
  const brand = map.teams[franchiseId];
  if (!brand) return null;

  return {
    fill: ensureContrastOn(brand.primary, ROSTER_PLATE_INK, AA_BODY_TEXT_RATIO),
    glow: brand.secondary,
    crest: brand.crest,
    crestFilter: brand.crestFilter,
  };
}
