/**
 * Per-franchise notification preferences (Upstash Redis).
 *
 *   key:   push:prefs:{mflLeagueId}:{franchiseId}
 *   value: { [categoryId]: boolean }   — only EXPLICIT choices are stored
 *
 * Absent means "use the category default", so a new category ships with its
 * intended default for everyone rather than arriving off for every owner who
 * has ever touched this page. Storing only explicit choices is what makes that
 * work — a snapshot of every toggle would freeze today's defaults forever.
 *
 * League + franchise ALWAYS come from the signed session JWT at the API layer,
 * never from a request body: the two leagues share franchise ids, so the
 * league id in the key is what keeps one league's preferences off another's
 * team. Same contract as push-subscriptions.ts.
 */

import { getRedis } from './redis-client';
import {
  isCategoryEnabled,
  notificationCategoryIds,
  type NotificationCategory,
  type NotificationLeague,
  type NotificationRecipient,
} from '../config/notification-categories';
import type { LeagueFeatures } from '../config/leagues';

export type PreferenceMap = Record<string, boolean>;

export function preferencesKey(leagueId: string, franchiseId: string): string {
  return `push:prefs:${leagueId}:${franchiseId}`;
}

/**
 * Read a franchise's explicit choices. Empty object when nothing is stored or
 * storage is unavailable — the caller then falls back to category defaults,
 * which is the safe direction: an owner keeps getting the alerts they were
 * always getting rather than silently going dark during an outage.
 */
export async function readPreferences(
  leagueId: string,
  franchiseId: string,
): Promise<PreferenceMap> {
  const redis = await getRedis();
  if (!redis) return {};
  try {
    const raw = await redis.get<PreferenceMap | string>(preferencesKey(leagueId, franchiseId));
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return sanitize(parsed);
  } catch (err) {
    console.error('[push-preferences] read failed:', err);
    return {};
  }
}

/** Replace a franchise's explicit choices. Returns false when nothing saved. */
export async function writePreferences(
  leagueId: string,
  franchiseId: string,
  prefs: PreferenceMap,
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  try {
    await redis.set(preferencesKey(leagueId, franchiseId), JSON.stringify(sanitize(prefs)));
    return true;
  } catch (err) {
    console.error('[push-preferences] write failed:', err);
    return false;
  }
}

/**
 * Keep only known categories with boolean values.
 *
 * Unknown keys are dropped rather than stored: a renamed or removed category
 * would otherwise leave dead entries that outlive the code and quietly grow
 * the record forever.
 */
export function sanitize(input: unknown): PreferenceMap {
  if (!input || typeof input !== 'object') return {};
  const known = new Set(notificationCategoryIds());
  const out: PreferenceMap = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (known.has(key) && typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/**
 * The full effective map an owner sees: every category this league offers,
 * with their explicit choice or the default.
 */
export function resolvePreferences(
  categories: NotificationCategory[],
  stored: PreferenceMap,
  league: NotificationLeague,
  recipient?: NotificationRecipient,
): PreferenceMap {
  const out: PreferenceMap = {};
  for (const category of categories) {
    out[category.id] = isCategoryEnabled(category.id, stored, league, recipient);
  }
  return out;
}
