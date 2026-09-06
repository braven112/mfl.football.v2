/**
 * Viewer preferences — the Redis mirror that makes the choice follow an owner
 * to another device.
 *
 * Keyed by the REGISTRY league slug + franchise id, never by franchise alone:
 * both leagues have a franchise 0001, and the slug is the one identifier
 * every layer already has (same rule as `watch-list-keys.mjs`).
 *
 * The mirror is a convenience, never the authority. A cookie on the device
 * wins over it (see `viewer-preferences-page.ts`), and every failure here —
 * no Redis configured, a timeout, a garbage value — degrades to "no stored
 * preference", which the caller reads as the defaults.
 */

import { getRedis } from './redis-client';
import { parseViewerPreferences, type ViewerPreferences } from './viewer-preferences';

export const VIEWER_PREFS_KEY_PREFIX = 'vprefs';

/** @param leagueSlug registry slug (`theleague`, `afl-fantasy`) */
export function viewerPreferencesKey(leagueSlug: string, franchiseId: string): string {
  return `${VIEWER_PREFS_KEY_PREFIX}:${leagueSlug}:${franchiseId}`;
}

interface StoredViewerPreferences {
  country?: string;
  /** The viewer's own clock. Stored as one id; the league's PT is not stored — it is always beside it. */
  zoneId?: string;
  savedAt?: string;
}

export async function getStoredViewerPreferences(
  leagueSlug: string,
  franchiseId: string,
): Promise<ViewerPreferences | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get<StoredViewerPreferences>(viewerPreferencesKey(leagueSlug, franchiseId));
    if (!raw || typeof raw !== 'object' || !raw.country) return null;
    return parseViewerPreferences(raw.country, raw.zoneId);
  } catch (err) {
    console.error('Failed to load viewer preferences from KV:', err);
    return null;
  }
}

/** Write the owner's choice. Returns false when it could not be stored. */
export async function setStoredViewerPreferences(
  leagueSlug: string,
  franchiseId: string,
  prefs: ViewerPreferences,
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  try {
    await redis.set(viewerPreferencesKey(leagueSlug, franchiseId), {
      country: prefs.country,
      zoneId: prefs.zoneId,
      savedAt: new Date().toISOString(),
    } satisfies StoredViewerPreferences);
    return true;
  } catch (err) {
    console.error('Failed to save viewer preferences to KV:', err);
    return false;
  }
}
