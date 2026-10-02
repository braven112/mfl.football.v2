/**
 * The Owners' Poll page's results half: which result to show, and whether the
 * viewer has earned it.
 *
 * The poll is its own feature (`/owners-poll`), separate from The Pecking
 * Order. The flow is vote → see the results: the full owner rankings sit
 * behind a ballot on file, which is the turnout lever every Claude post about
 * the poll points at. See docs/plans/owners-poll.md, "Its own page".
 */

import type { LeagueDefinition } from '../config/leagues';
import { activePollWindow, hasStandingBallot } from './owners-poll-store';

/** The slice of a Pecking Order issue file the results read. */
export interface PollResultIssue {
  year: number;
  week: number;
  ownersPoll?: {
    status?: string;
    ranked?: unknown[] | null;
  } | null;
}

/**
 * The newest issue whose poll closed WITH a consensus. A closed week nobody
 * voted in has nothing to show, so it is skipped rather than rendered empty —
 * the previous real result is still the room's latest word.
 */
export function latestPollResult<T extends PollResultIssue>(issues: T[]): T | null {
  return (
    [...issues]
      .filter((i) => i.ownersPoll?.status === 'closed' && (i.ownersPoll.ranked?.length ?? 0) > 0)
      .sort((a, b) => b.year - a.year || b.week - a.week)[0] ?? null
  );
}

/**
 * Whether the viewer sees the full rankings.
 *
 * Locked ONLY when we positively know there is an open poll and no ballot of
 * theirs in it. When voting is paused or out of season there is nothing to
 * vote in, so a lock could never be lifted; when Redis cannot be read we do
 * not know, and an engagement gate fails open rather than hiding the results
 * from the owners who did vote.
 */
export async function resolveResultsUnlocked(
  league: LeagueDefinition,
  franchiseId: string,
): Promise<boolean> {
  const window = await activePollWindow(league, league.navSlug);
  if (!window) return true;
  const voted = await hasStandingBallot(league.navSlug, window, franchiseId);
  return voted !== false;
}
