/**
 * My Watch List — the Redis mirror.
 *
 * MFL holds the list of record, but only an owner's own cookie can read it,
 * which rules out every server-side reader that is not the owner's own
 * request: the Schefter page highlighting a post, the push sender deciding
 * who to alert, a cron. The mirror is what those read. It is written by the
 * API route whenever an owner's session reads from or writes to MFL, so it is
 * as fresh as the owner's last visit — good enough for "highlight what I
 * watch", and the route re-reads MFL whenever a page asks.
 *
 * Every function here is best-effort and never throws: a Redis outage must
 * degrade a page to "no highlights", not to a 500.
 */

import { getRedis } from './redis-client';
import { watchListKey, mirrorPlayerIds } from './watch-list-keys.mjs';

export interface WatchListMirror {
  playerIds: string[];
  /** ISO timestamp of the last time this mirror was reconciled with MFL. */
  syncedAt: string;
}

export async function readWatchListMirror(
  leagueSlug: string,
  franchiseId: string,
): Promise<WatchListMirror | null> {
  try {
    const redis = await getRedis();
    if (!redis) return null;
    const raw = await redis.get<WatchListMirror>(watchListKey(leagueSlug, franchiseId));
    if (!raw || typeof raw !== 'object') return null;
    return {
      playerIds: mirrorPlayerIds(raw),
      syncedAt: typeof raw.syncedAt === 'string' ? raw.syncedAt : '',
    };
  } catch (err) {
    console.error('[watch-list] mirror read failed:', err);
    return null;
  }
}

export async function writeWatchListMirror(
  leagueSlug: string,
  franchiseId: string,
  playerIds: string[],
): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) return false;
    const value: WatchListMirror = { playerIds, syncedAt: new Date().toISOString() };
    await redis.set(watchListKey(leagueSlug, franchiseId), value);
    return true;
  } catch (err) {
    console.error('[watch-list] mirror write failed:', err);
    return false;
  }
}

/**
 * The watched ids for a franchise, or an empty array when nothing is known.
 * For page frontmatter: never distinguishes "unwatched" from "mirror missing",
 * because a page cannot do anything different with the distinction.
 */
export async function getWatchedPlayerIds(
  leagueSlug: string,
  franchiseId: string | null | undefined,
): Promise<string[]> {
  if (!franchiseId) return [];
  const mirror = await readWatchListMirror(leagueSlug, franchiseId);
  return mirror?.playerIds ?? [];
}
