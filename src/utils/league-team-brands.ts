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
 * Static imports, not an `fs` read through the registry's `configPath`: these
 * compile into the bundle (typed, and traceable by Vercel), whereas a
 * `process.cwd()` join is a path the file tracer cannot follow.
 */
import theLeagueConfig from '../data/theleague.config.json';
import aflConfig from '../../data/afl-fantasy/afl.config.json';

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

const CONFIGS: Record<string, { teams?: any[] }> = {
  theleague: theLeagueConfig as unknown as { teams?: any[] },
  'afl-fantasy': aflConfig as unknown as { teams?: any[] },
};

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
 * Every franchise's brand in this league, keyed by MFL franchise id.
 * Throws on a league this module doesn't know.
 */
export function getLeagueTeamBrands(slug: string): Record<string, TeamBrand> {
  const config = CONFIGS[slug];
  if (!config) throw new Error(`getLeagueTeamBrands: no config wired for league "${slug}"`);
  const brands: Record<string, TeamBrand> = {};
  for (const t of config.teams ?? []) {
    if (!t?.franchiseId) continue;
    brands[t.franchiseId] = brandOf(t);
  }
  return brands;
}
