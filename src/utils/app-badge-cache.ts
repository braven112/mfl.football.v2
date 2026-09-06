/**
 * The app-badge cache key, and the one way to clear it.
 *
 * `/api/app-badge` caches a franchise's computed badge for 90 seconds so a
 * burst of ClientRouter navigations cannot turn into a burst of MFL calls.
 * That cache is invisible until an owner ACTS — answers the trade offer, fixes
 * the lineup, casts the ballot — and the badge on their icon sits there for up
 * to a minute and a half afterwards. A badge that outlives the thing it was
 * counting reads as broken, so every route that resolves a badged item clears
 * the key on its way out.
 *
 * Lives in its own module so those routes can invalidate without importing the
 * API route (which would pull the whole lineup-warnings + MFL fetch graph into
 * unrelated handlers).
 */

import { getRedis } from './redis-client';

export function appBadgeCacheKey(leagueId: string, franchiseId: string): string {
  return `app-badge:${leagueId}:${franchiseId}`;
}

/**
 * Drop a franchise's cached badge. Never throws and never awaits anything the
 * caller needs — an invalidation failure costs one stale badge, and must never
 * fail the action that triggered it.
 */
export async function invalidateAppBadge(
  leagueId: string | undefined,
  franchiseId: string | undefined,
): Promise<void> {
  if (!leagueId || !franchiseId) return;
  try {
    const redis = await getRedis();
    await redis?.del(appBadgeCacheKey(leagueId, franchiseId));
  } catch {
    // Deliberately silent.
  }
}
