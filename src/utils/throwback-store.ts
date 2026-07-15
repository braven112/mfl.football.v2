/**
 * Upstash-backed storage for owner-chosen Throwback Week eras. Keyed by
 * throwback:{franchiseId} -> { yearStart }. Shared by the owner-facing
 * API route (src/pages/api/throwback-preference.ts) and the batch reader
 * used to render all 16 franchises' picks on live scoring / matchups.
 */

import { getRedis } from './redis-client';
export { getRedis };

export interface ThrowbackPreference {
  yearStart: number;
}

export function makeThrowbackKey(franchiseId: string): string {
  return `throwback:${franchiseId}`;
}

export async function getThrowbackPreference(franchiseId: string): Promise<ThrowbackPreference | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    return await redis.get<ThrowbackPreference>(makeThrowbackKey(franchiseId));
  } catch (err) {
    console.error('Failed to load throwback preference from KV:', err);
    return null;
  }
}

export async function setThrowbackPreference(franchiseId: string, yearStart: number): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  try {
    await redis.set(makeThrowbackKey(franchiseId), { yearStart } satisfies ThrowbackPreference);
    return true;
  } catch (err) {
    console.error('Failed to save throwback preference to KV:', err);
    return false;
  }
}

/**
 * Batch-read every franchise's stored pick in one round trip. Returns a map
 * of franchiseId -> yearStart, omitting franchises with no stored pick.
 */
export async function getAllThrowbackPreferences(
  franchiseIds: string[]
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  if (franchiseIds.length === 0) return result;

  const redis = await getRedis();
  if (!redis) return result;

  try {
    const keys = franchiseIds.map(makeThrowbackKey);
    const values = await redis.mget<ThrowbackPreference>(...keys);
    franchiseIds.forEach((franchiseId, i) => {
      const pref = values[i];
      if (pref && typeof pref.yearStart === 'number') {
        result[franchiseId] = pref.yearStart;
      }
    });
  } catch (err) {
    console.error('Failed to batch-load throwback preferences from KV:', err);
  }

  return result;
}
