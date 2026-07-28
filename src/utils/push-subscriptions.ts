/**
 * Web push subscription storage (Upstash Redis).
 *
 * One Redis HASH per league+franchise:
 *   key:   push:subs:{mflLeagueId}:{franchiseId}
 *   field: sha256(endpoint) — stable id for a browser subscription
 *   value: StoredPushSubscription (JSON)
 *
 * League + franchise ALWAYS come from the signed session JWT
 * (getAuthUser) at the API layer — never from the request body. The two
 * leagues share franchise ids (AFL 0001 vs TheLeague 0001), so the league
 * id in the key is what keeps a push meant for one league's team from
 * reaching the other's.
 *
 * Degrades to null/false results when Redis is unavailable (same contract
 * as every other storage util built on getRedis()).
 */

import { createHash } from 'node:crypto';
import { getRedis } from './redis-client';

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface NormalizedPushSubscription {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

export interface StoredPushSubscription extends NormalizedPushSubscription {
  /** MFL user id of the session that created the subscription. */
  userId: string;
  /** ISO timestamp — used to prune the oldest when a franchise hits the cap. */
  createdAt: string;
}

/** Most browser subscriptions one franchise may keep (phone + desktop + spares). */
export const MAX_SUBSCRIPTIONS_PER_FRANCHISE = 8;

/** Redis key for a franchise's subscription hash. */
export function subscriptionsKey(leagueId: string, franchiseId: string): string {
  return `push:subs:${leagueId}:${franchiseId}`;
}

/** Stable hash id for an endpoint (hash field name). */
export function hashEndpoint(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

/**
 * Validate + normalize a client-supplied PushSubscription.toJSON() payload.
 * Returns null when the shape is wrong. Only the three fields web-push
 * needs are kept — anything else the client sent is dropped.
 */
export function validateSubscription(input: unknown): NormalizedPushSubscription | null {
  if (!input || typeof input !== 'object') return null;
  const sub = input as Record<string, unknown>;

  const endpoint = typeof sub.endpoint === 'string' ? sub.endpoint.trim() : '';
  if (!endpoint || endpoint.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  const keys = sub.keys as Record<string, unknown> | undefined;
  const p256dh = typeof keys?.p256dh === 'string' ? keys.p256dh.trim() : '';
  const auth = typeof keys?.auth === 'string' ? keys.auth.trim() : '';
  // base64 / base64url payloads; auth is 16 bytes (~22 chars), p256dh 65 bytes (~87 chars)
  const b64 = /^[A-Za-z0-9+/_-]+={0,2}$/;
  if (!p256dh || p256dh.length > 256 || !b64.test(p256dh)) return null;
  if (!auth || auth.length > 64 || !b64.test(auth)) return null;

  return { endpoint, keys: { p256dh, auth } };
}

/**
 * Given every stored subscription for a franchise, pick the hash-field ids
 * to evict so that after adding one more entry the count stays within
 * `max`. Oldest `createdAt` first; entries with missing/bad timestamps are
 * treated as oldest. Pure — unit-tested directly.
 */
export function selectSubscriptionsToEvict(
  entries: Array<{ field: string; createdAt?: string }>,
  max: number = MAX_SUBSCRIPTIONS_PER_FRANCHISE,
): string[] {
  const overflow = entries.length + 1 - max;
  if (overflow <= 0) return [];
  const ts = (e: { createdAt?: string }) => {
    const t = Date.parse(e.createdAt ?? '');
    return Number.isFinite(t) ? t : 0;
  };
  return [...entries]
    .sort((a, b) => ts(a) - ts(b))
    .slice(0, overflow)
    .map((e) => e.field);
}

function parseStored(value: unknown): StoredPushSubscription | null {
  // Upstash may hand back the object (auto-deserialized) or a JSON string.
  let obj: unknown = value;
  if (typeof value === 'string') {
    try {
      obj = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const normalized = validateSubscription(obj);
  if (!normalized) return null;
  const raw = obj as Record<string, unknown>;
  return {
    ...normalized,
    userId: typeof raw.userId === 'string' ? raw.userId : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
  };
}

/** True when subscription storage is reachable. */
export async function isPushStorageAvailable(): Promise<boolean> {
  return (await getRedis()) !== null;
}

/**
 * Save (upsert) a subscription for a franchise. Evicts the oldest
 * subscriptions when the franchise is at the cap. Returns false when
 * storage is unavailable.
 */
export async function saveSubscription(
  leagueId: string,
  franchiseId: string,
  subscription: NormalizedPushSubscription,
  userId: string,
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;

  const key = subscriptionsKey(leagueId, franchiseId);
  const field = hashEndpoint(subscription.endpoint);

  const existing = (await redis.hgetall(key)) ?? {};
  const entries = Object.entries(existing)
    .filter(([f]) => f !== field) // re-subscribing same endpoint never evicts
    .map(([f, v]) => ({ field: f, createdAt: parseStored(v)?.createdAt }));
  const evict = selectSubscriptionsToEvict(entries);
  if (evict.length > 0) {
    await redis.hdel(key, ...evict);
  }

  const stored: StoredPushSubscription = {
    ...subscription,
    userId,
    createdAt: new Date().toISOString(),
  };
  await redis.hset(key, { [field]: JSON.stringify(stored) });
  return true;
}

/**
 * Remove one subscription by endpoint. Returns false only when storage is
 * unavailable (removing an unknown endpoint is a success — idempotent).
 */
export async function removeSubscription(
  leagueId: string,
  franchiseId: string,
  endpoint: string,
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  await redis.hdel(subscriptionsKey(leagueId, franchiseId), hashEndpoint(endpoint));
  return true;
}

/** All valid stored subscriptions for a franchise ([] when none / no Redis). */
export async function getSubscriptions(
  leagueId: string,
  franchiseId: string,
): Promise<StoredPushSubscription[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const all = (await redis.hgetall(subscriptionsKey(leagueId, franchiseId))) ?? {};
  return Object.values(all)
    .map((v) => parseStored(v))
    .filter((s): s is StoredPushSubscription => s !== null);
}

/**
 * Remove dead subscriptions after the push service rejected them
 * (404/410). Best-effort — pruning failures are swallowed.
 */
export async function pruneSubscriptions(
  leagueId: string,
  franchiseId: string,
  endpoints: string[],
): Promise<void> {
  if (endpoints.length === 0) return;
  try {
    const redis = await getRedis();
    if (!redis) return;
    await redis.hdel(
      subscriptionsKey(leagueId, franchiseId),
      ...endpoints.map((e) => hashEndpoint(e)),
    );
  } catch (e) {
    console.warn('[push-subscriptions] prune failed:', e);
  }
}
