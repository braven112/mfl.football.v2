/**
 * Per-franchise BRAND (short name, colours, crest) for any league in the
 * registry — the small slice of a league config that matchup UI needs.
 *
 * Why this exists rather than another caller-side lookup: the two lineup pages
 * each hand `buildMatchupCards` their own `brandFor`, one reading
 * `getFranchiseBrand` (TheLeague only) and one indexing the AFL config by
 * hand. Anything SHARED between the leagues — the Schedule Release reveal, for
 * one — would have had to re-derive that split a third time. The two configs
 * already carry the same team shape, so one accessor covers both.
 *
 * Selection is a slug-keyed map that THROWS on an unknown league, matching
 * `schefter-league-data.ts`: a third league added to the registry must be
 * wired here deliberately, not silently served TheLeague's crests.
 *
 * Configs come from `league-config.ts`, which bundles every league's
 * `configPath` file through an eager glob (typed into the bundle and
 * traceable by Vercel, like the static imports it replaced), so a new
 * league is wired by its registry entry alone.
 */
import { ALL_LEAGUES } from '../config/leagues-data.mjs';
import { getLeagueConfig } from './league-config';

/** One franchise's brand, as the matchup UI consumes it. */
export interface TeamBrand {
  franchiseId: string;
  name: string;
  nameShort: string;
  /** Brand primary; `colorPrimaryDark` when the team defines one for dark surfaces. */
  colorPrimary: string;
  colorPrimaryDark: string;
  /**
   * Crest, LIGHT artwork only. Dark mode needs nothing extra here:
   * `TeamIconDarkStyles` (shared layout <head>) swaps in a team's `iconDark`
   * and white-strokes the illegible ones, keyed on `src` alone so it reaches
   * React islands too. Shipping `iconDark` as well would invite a second,
   * divergent swap at every call site.
   */
  icon: string;
}

/** A registry league's config, or undefined for a slug the registry doesn't know. */
function configFor(slug: string): { teams?: any[]; structure?: string } | undefined {
  return ALL_LEAGUES.some((l) => l.slug === slug) ? getLeagueConfig(slug) : undefined;
}

/**
 * The config's declared `structure` (`'divisions'`, `'two-conference'`), or
 * null where the config states none (TheLeague, Best Ball). Package leagues
 * get it from `scripts/suggest-league-branding.mjs`.
 */
export function getLeagueConfigStructure(slug: string): string | null {
  return configFor(slug)?.structure ?? null;
}

/** Neutral stand-in so a franchise missing from a config renders, never throws. */
const FALLBACK_COLOR = '#64748b';

const brandOf = (t: any): TeamBrand => ({
  franchiseId: t.franchiseId,
  name: t.name ?? `Franchise ${t.franchiseId}`,
  nameShort: t.nameShort || t.nameMedium || t.name || `Franchise ${t.franchiseId}`,
  colorPrimary: t.colorPrimary || t.color || FALLBACK_COLOR,
  // Falls back to the light primary — the same rule LiveScoreboard's
  // `themeColors` applies, so a team with no dark variant looks identical in
  // both places instead of picking up a second, divergent fallback.
  colorPrimaryDark: t.colorPrimaryDark || t.colorPrimary || t.color || FALLBACK_COLOR,
  icon: t.icon ?? '',
});

/**
 * One franchise's RAW config entry — every field the config carries, not the
 * `TeamBrand` slice above.
 *
 * `resolveHeroFranchiseBackdrop` needs `colorSecondary`, `broadcastGradient`
 * and the crest fields that `TeamBrand` deliberately drops, and the alternative
 * was a third call site re-importing both league configs by hand. Returns
 * undefined for an unknown league or franchise rather than throwing: every
 * caller is a hero deciding whether it can paint itself in a club's colours,
 * and "no" is a normal answer there.
 */
export function getLeagueTeamConfig(slug: string, franchiseId: string): any | undefined {
  return configFor(slug)?.teams?.find((t) => t?.franchiseId === franchiseId);
}

/**
 * Every franchise's RAW config entry for one league, in config order.
 *
 * The plural of `getLeagueTeamConfig`, for callers that need the whole list
 * rather than one row — `crestStrokeIndex` walks a league's full team array to
 * build its measured-stroke map. Returns [] for an unknown league, matching
 * the singular's "no is a normal answer" contract rather than the brands
 * accessor's throw.
 */
export function getLeagueTeamConfigs(slug: string): any[] {
  return configFor(slug)?.teams ?? [];
}

/**
 * Every franchise's brand in this league, keyed by MFL franchise id.
 * Throws on a slug the registry doesn't know.
 */
export function getLeagueTeamBrands(slug: string): Record<string, TeamBrand> {
  const config = configFor(slug);
  if (!config) throw new Error(`getLeagueTeamBrands: unknown league "${slug}"`);
  const brands: Record<string, TeamBrand> = {};
  for (const t of config.teams ?? []) {
    if (!t?.franchiseId) continue;
    brands[t.franchiseId] = brandOf(t);
  }
  return brands;
}
