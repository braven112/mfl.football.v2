/**
 * "Owner 6h ago" — how recently a club's owner was on the site.
 *
 * Both roster pages carried this same block (Phase 7 of
 * docs/plans/rosters-page-split.md, and a down payment on Phase 9): a
 * time-boxed Redis read, a silent failure, and a per-franchise lookup.
 *
 * Three properties are deliberate and easy to lose in a rewrite:
 *
 * - **The read is time-boxed and failure is SILENT.** This chip is decoration
 *   on a page whose job is the roster. If Redis is slow or down, the page
 *   renders without it; it must never be what makes a roster fail to load.
 * - **No activity means no chip, not "never seen".** A missing timestamp is
 *   almost always a gap in our own tracking rather than a fact about the
 *   owner, and a header is the wrong place to assert one.
 * - **The league id is REQUIRED.** Both leagues have a franchise 0001, so an
 *   unscoped read prints one league's owner presence on the other's crest.
 */
import { getAllActivity, getActivityLevel, formatLastSeen } from '../owner-activity';

export interface OwnerPresence {
  level: 'active' | 'idle' | 'dormant' | 'unknown';
  text: string;
}

/** Answers for one franchise; null means "nothing to say", never "never". */
export type OwnerPresenceLookup = (franchiseId: string) => OwnerPresence | null;

/** How long the page will wait on Redis before rendering without the chip. */
export const OWNER_PRESENCE_TIMEOUT_MS = 3000;

/**
 * Read every owner's last-seen stamp for one league, then hand back a lookup.
 *
 * Resolves to a lookup that returns null for everyone when the read fails —
 * the caller needs no error path, which is what keeps the silent-failure
 * property from being re-litigated at each call site.
 */
export async function resolveOwnerPresence(
  leagueId: string,
  timeoutMs: number = OWNER_PRESENCE_TIMEOUT_MS,
): Promise<OwnerPresenceLookup> {
  let activity: Record<string, number> = {};
  try {
    activity = await Promise.race([
      getAllActivity(leagueId),
      new Promise<Record<string, number>>((_, reject) =>
        setTimeout(() => reject(new Error('Redis timeout')), timeoutMs)),
    ]);
  } catch {
    /* Redis unavailable or timed out — the chip simply does not print */
  }

  return (franchiseId: string) => {
    const at = activity[franchiseId] ?? null;
    return at ? { level: getActivityLevel(at), text: formatLastSeen(at) } : null;
  };
}
