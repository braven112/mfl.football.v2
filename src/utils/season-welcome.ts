/**
 * Seasonal theme welcome — the once-per-device "your team's Christmas look"
 * popup (SeasonWelcomeModal), the seasonal counterpart of the Throwback Week
 * welcome (throwback-welcome.ts).
 *
 * Shown to a signed-in owner while a season that sets `welcome` is open
 * (`activeSeasonalTheme`, so `?seasonPreview=` previews it), on a league whose
 * set draws their franchise. The crest is the season's own file, read
 * straight from the marks directory: the page's swap rules do the same for
 * every other crest, but a drawn mark shown as the SUBJECT should not depend
 * on them.
 *
 * The band colours come from the same map the player-modal bands paint from
 * (`buildFranchiseBandBrands`), so the popup matches the rest of the page.
 */

import type { LeagueSlug } from '../types/nav';
import { buildFranchiseBandBrands } from './franchise-band-brand';
import { seasonalMarkIds, seasonalMarkSet } from './seasonal-mark-css';
import { hexToRgba, mixHex } from './nfl-team-colors';

type CivilDate = { y: number; m: number; d: number };
/** The fields of a SEASONAL_THEMES entry (src/config/seasonal-themes.mjs) this reads. */
type SeasonLike = {
  id: string;
  marks: string | null;
  name?: string;
  welcome?: boolean;
  window: (year: number) => { start: CivilDate; end: CivilDate };
};

export interface SeasonWelcome {
  /** localStorage key — one sighting per device, per league, per season and year. */
  storageKey: string;
  /** The season's display name ("Christmas Week"). */
  seasonName: string;
  /** Watermark word behind the crest ("Christmas"). */
  ghost: string;
  /** The owner's franchise name. */
  name: string;
  /** The season's drawn mark for this franchise, cache-busted by its content hash. */
  crest: string;
  bandStart: string;
  bandEnd: string;
  bandGlow: string;
  /** The day the normal logos return, e.g. "Tuesday, Dec 29". */
  returns: string;
}

export interface SeasonWelcomeInput {
  /** Nav slug: the marks live under public/assets/<league>/. */
  league: LeagueSlug;
  /** The SESSION franchise for this league — never the preference cookie. */
  franchiseId: string | null;
  /** The season open on this page (`activeSeasonalTheme`), or null. */
  season: SeasonLike | null | undefined;
  now: Date;
}

/** Null whenever there is nothing to announce. */
export function buildSeasonWelcome(input: SeasonWelcomeInput): SeasonWelcome | null {
  const { league, franchiseId, season, now } = input;
  if (!franchiseId || !season?.welcome || !season.marks) return null;
  if (!seasonalMarkIds(league, season.id).has(franchiseId)) return null;

  const brand = buildFranchiseBandBrands(league).teams[franchiseId];
  if (!brand?.name) return null;

  const set = seasonalMarkSet(league, season.id) as { _v?: Record<string, string> } | null;
  const v = set?._v?.[franchiseId];
  const crest = `/assets/${league}/${season.marks}/${franchiseId}.png${v && /^[0-9a-f]+$/.test(v) ? `?v=${v}` : ''}`;

  // The window is keyed by the year it opens in; a preview outside it still
  // names this year's return date.
  const year = now.getFullYear();
  const { end } = season.window(year);
  const back = new Date(Date.UTC(end.y, end.m - 1, end.d + 1, 12));
  const returns = back.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });

  const seasonName = season.name ?? season.id;
  return {
    storageKey: `season-welcome:${league}:${season.id}:${year}`,
    seasonName,
    ghost: seasonName.split(' ')[0],
    name: brand.name,
    crest,
    bandStart: mixHex(brand.primary, '#0b0e13', 0.62),
    bandEnd: brand.primary,
    bandGlow: hexToRgba(brand.secondary, 0.4),
    returns,
  };
}
