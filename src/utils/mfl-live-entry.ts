/**
 * MFL Live's branded front door — `/live?from=<league slug>`.
 *
 * A league that sends its members to MFL Live (Archie's, from its MFL home
 * page, Oct 2026) links them to `/live?from=<slug>`. Signed out, that shows
 * the sign-in form under THAT league's own mark instead of the MFL Live sales
 * page, so it reads as their league's live scoring rather than a stranger's
 * product. Signed in, the parameter does nothing: everyone gets the same board.
 *
 * The parameter is a SLUG looked up in the registry, never a name or a logo
 * URL, so a crafted link can only ever show a league this site runs. And only
 * a league whose owners may sign in to MFL Live (`mflLiveSignInLeagueIds`):
 * branding the form for a best-ball league would invite owners the sign-in
 * then refuses.
 */
import { getLeagueBySlug, mflLiveSignInLeagueIds, type LeagueDefinition } from '../config/leagues';

/** The query parameter a league's link carries. */
export const MFL_LIVE_ENTRY_PARAM = 'from';

export function resolveMflLiveEntryLeague(
  slug: string | null | undefined,
): LeagueDefinition | null {
  if (typeof slug !== 'string') return null;
  const league = getLeagueBySlug(slug.trim().toLowerCase());
  if (!league) return null;
  return mflLiveSignInLeagueIds().includes(league.id) ? league : null;
}
