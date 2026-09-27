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
import {
  buildFranchiseBandBrands,
  type BuildFranchiseBandBrandsOptions,
  type FranchiseBandBrandMap,
} from './franchise-band-brand';
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
  /**
   * The club's DISPLAY name — its legacy one during a Throwback Week.
   *
   * Carried here rather than left to the page because the plate must not be
   * a partial overlay: a header wearing era art under a modern name is the
   * same bug as the one that left era names over a modern crest, just
   * pointing the other way.
   */
  name: string;
  /** The small crest beside the name; the era's during a Throwback Week. */
  crestSmall: string;
  /** The solid band. Flat, and dark enough for `ROSTER_PLATE_INK` at 4.5:1. */
  fill: string;
  /** The club's second hue — for a mark that wants the brand rather than ink. */
  glow: string;
  /**
   * The crest for the watermark, at the largest cut available — 400×400 where
   * the club has one, which the plate scales past 200% and the 100×100 icon
   * visibly pixelated at.
   *
   * During a Throwback Week this is the ERA's art, which is usually only the
   * 100px icon: exactly one of the forty-two history entries carries its own
   * 400px cut. Softer and right beats sharp and wrong — keeping the current
   * club's `groupMe` here is the Aug 2026 bug that left the lineup watermark
   * modern while the name and colours around it threw back.
   */
  crest: string;
  /** Measured white stroke, for a light crest that would vanish on the fill. */
  crestFilter?: string;
}

/** `CanonicalLeagueSlug` is the site's; the band map keys on the nav's. */
const BAND_SLUG: Partial<Record<CanonicalLeagueSlug, LeagueSlug>> = {
  theleague: 'theleague',
  'afl-fantasy': 'afl',
  // The custom-site demo's keeper slot — its franchises, from its own config.
  keeper: 'keeper',
};

/**
 * One band map per league per process.
 *
 * `buildFranchiseBandBrands` walks a whole league, and TheLeague's roster page
 * asks for sixteen clubs on one render — the default plus fifteen swap
 * templates. Without this that is sixteen full walks per request.
 */
/**
 * Keyed on the league AND the throwback state, because one render asks this
 * up to twenty-four times — once per club in the switcher — and
 * `buildFranchiseBandBrands` walks the whole league each call. Caching only
 * the inactive case would make Throwback Week the one week it does that walk
 * twenty-four times per request.
 *
 * Bounded by hand: owner picks change a handful of times a season, so the key
 * space is tiny in practice, but it is derived from data rather than fixed, so
 * it gets a ceiling rather than trust.
 */
const CACHE_CEILING = 8;
const cache = new Map<string, FranchiseBandBrandMap>();

/**
 * `throwback` is the state `resolveThrowbackRequestState` returned for THIS
 * request, threaded down from the page. Without it the header is the one
 * surface left wearing modern art on the one week a year every other surface
 * throws back — and a franchise whose era keeps its NAME would show no
 * throwback at all, because the crest is its only tell.
 */
export function resolveRosterHeaderSkin(
  franchiseId: string | null | undefined,
  league: CanonicalLeagueSlug,
  throwback: BuildFranchiseBandBrandsOptions = {},
): RosterHeaderSkin | null {
  if (!franchiseId) return null;
  const slug = BAND_SLUG[league];
  if (!slug) return null;

  const key = throwback.throwbackActive
    ? `${slug}|tb|${JSON.stringify(throwback.throwbackOverrides ?? {})}`
    : slug;
  let map = cache.get(key);
  if (!map) {
    map = buildFranchiseBandBrands(slug, throwback);
    if (cache.size >= CACHE_CEILING) cache.clear();
    cache.set(key, map);
  }
  const brand = map.teams[franchiseId];
  if (!brand) return null;

  return {
    name: brand.name,
    crestSmall: brand.crest,
    fill: ensureContrastOn(brand.primary, ROSTER_PLATE_INK, AA_BODY_TEXT_RATIO),
    glow: brand.secondary,
    crest: brand.crestLarge || brand.crest,
    crestFilter: brand.crestFilter,
  };
}
