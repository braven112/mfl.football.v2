/**
 * Upstash-backed storage for owner-chosen Throwback Week eras.
 *
 * Keyed by `throwback:{franchiseId}` in TheLeague and
 * `throwback:afl:{franchiseId}` in the AFL -> { yearStart }. The scope is
 * load-bearing, not decoration: BOTH leagues have a franchise 0001, and they
 * are different teams with different `history[]` arrays, so the bare key was
 * genuinely ambiguous the moment the AFL gained eras. `scopedThrowbackKey`
 * owns that decision and keeps TheLeague's existing keys byte-identical so no
 * owner loses the era they already picked.
 *
 * Shared by the owner-facing API route
 * (src/pages/api/throwback-preference.ts) and the batch reader used to render
 * every franchise's pick on live scoring / matchups.
 */

import { getRedis } from './redis-client';
import {
  DEFAULT_THROWBACK_SCOPE,
  scopedThrowbackKey,
  type ThrowbackScope,
} from './throwback-scope';
export { getRedis };

export interface ThrowbackPreference {
  yearStart: number;
  /**
   * Set only when the pick is an era inherited from a franchise slot this
   * team used to occupy, where `yearStart` alone is ambiguous. Absent on
   * every preference written before that was possible, which is why it is
   * optional rather than nullable — an old record stays valid as-is.
   */
  sourceFranchiseId?: string;
}

export function makeThrowbackKey(
  franchiseId: string,
  scope: ThrowbackScope = DEFAULT_THROWBACK_SCOPE
): string {
  return scopedThrowbackKey(franchiseId, scope);
}

export async function getThrowbackPreference(
  franchiseId: string,
  scope: ThrowbackScope = DEFAULT_THROWBACK_SCOPE
): Promise<ThrowbackPreference | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    return await redis.get<ThrowbackPreference>(makeThrowbackKey(franchiseId, scope));
  } catch (err) {
    console.error('Failed to load throwback preference from KV:', err);
    return null;
  }
}

export async function setThrowbackPreference(
  franchiseId: string,
  pick: ThrowbackPreference,
  scope: ThrowbackScope = DEFAULT_THROWBACK_SCOPE
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  try {
    // Written without the key when it is not an inherited era, so a plain
    // pick round-trips to exactly the record shape that already exists.
    const value: ThrowbackPreference = pick.sourceFranchiseId
      ? { yearStart: pick.yearStart, sourceFranchiseId: pick.sourceFranchiseId }
      : { yearStart: pick.yearStart };
    await redis.set(makeThrowbackKey(franchiseId, scope), value);
    return true;
  } catch (err) {
    console.error('Failed to save throwback preference to KV:', err);
    return false;
  }
}

/**
 * Batch-read every franchise's stored pick in one round trip. Returns a map
 * of franchiseId -> pick, omitting franchises with no stored pick.
 */
export async function getAllThrowbackPreferences(
  franchiseIds: string[],
  scope: ThrowbackScope = DEFAULT_THROWBACK_SCOPE
): Promise<Record<string, ThrowbackPreference>> {
  const result: Record<string, ThrowbackPreference> = {};
  if (franchiseIds.length === 0) return result;

  const redis = await getRedis();
  if (!redis) return result;

  try {
    const keys = franchiseIds.map((id) => makeThrowbackKey(id, scope));
    const values = await redis.mget<ThrowbackPreference>(...keys);
    franchiseIds.forEach((franchiseId, i) => {
      const pref = values[i];
      if (pref && typeof pref.yearStart === 'number') {
        result[franchiseId] = typeof pref.sourceFranchiseId === 'string'
          ? { yearStart: pref.yearStart, sourceFranchiseId: pref.sourceFranchiseId }
          : { yearStart: pref.yearStart };
      }
    });
  } catch (err) {
    console.error('Failed to batch-load throwback preferences from KV:', err);
  }

  return result;
}
