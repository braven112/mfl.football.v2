/**
 * Per-league keys the shared Set Lineup page (components/shared/lineup/
 * LineupPage.astro) needs on the CLIENT, resolved server-side and stamped on
 * the page root so the controller never carries a league literal.
 *
 * Both are frozen by history rather than derived cleanly, which is why they
 * live here and not inline: each league's lineup page shipped as its own file
 * with its own strings, and changing either string now breaks something an
 * owner already has.
 */
import { DEFAULT_LEAGUE_SLUG, getLeagueBySlug } from '../config/leagues';

/**
 * The lineup API route for a league. The default league's route predates the
 * per-league directories and lives at the bare `/api/lineup`
 * (`src/pages/api/lineup.ts`); every other league has `/api/<slug>/lineup`.
 * Each route pins its own league (see `createLineupRoute`), so posting to the
 * wrong one writes a lineup into the wrong league.
 */
export function lineupApiPath(slug: string): string {
  return slug === DEFAULT_LEAGUE_SLUG ? '/api/lineup' : `/api/${slug}/lineup`;
}

/**
 * The localStorage key for an owner's unsubmitted lineup draft. The default
 * league kept the original unsuffixed key and the AFL its `-afl` suffix
 * (its navSlug) when the pages were unified, so no owner loses a saved draft;
 * any other league keys on its slug.
 */
export function lineupDraftStorageKey(slug: string): string {
  if (slug === DEFAULT_LEAGUE_SLUG) return 'lineup-draft';
  const league = getLeagueBySlug(slug);
  if (league?.navSlug === 'afl') return 'lineup-draft-afl';
  return `lineup-draft-${slug}`;
}
