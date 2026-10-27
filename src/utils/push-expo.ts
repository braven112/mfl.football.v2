/**
 * Native push for the MFL Live phone app, through Expo's push service.
 *
 * The app registers its Expo push token (`ExponentPushToken[…]`) here, and
 * `sendPushToFranchise` delivers every alert to those tokens as well as to the
 * franchise's browser subscriptions. One door, one set of preferences: an
 * owner who turned an alert off on the website does not start getting it on
 * their phone, and every alert the site already sends reaches the app with no
 * second sender to keep in sync.
 *
 * Storage mirrors push-subscriptions.ts — one Redis HASH per league+franchise:
 *   key:   push:expo:{mflLeagueId}:{franchiseId}
 *   field: sha256(token)
 *   value: StoredExpoToken (JSON)
 * League + franchise come from the signed session, never the request body.
 * The league id in the key is not decoration: both leagues have a 0001.
 *
 * Expo's API needs no credentials. When "enhanced push security" is turned on
 * in the Expo dashboard, set EXPO_PUSH_ACCESS_TOKEN and it is sent as Bearer.
 */

import { createHash } from 'node:crypto';
import { getRedis } from './redis-client';
import { selectSubscriptionsToEvict } from './push-subscriptions';
import { getNotificationCategory } from '../config/notification-categories';
import type {
  MflLiveAppPushChannelId,
  MflLiveAppPushData,
  MflLiveAppPushPlatform,
} from '../../packages/shared-types/src/mfl-live-app-push';

export const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo accepts at most 100 messages per request. */
export const EXPO_PUSH_BATCH = 100;

/** Most app installs one franchise may keep (phone, tablet, a reinstall or two). */
export const MAX_EXPO_TOKENS_PER_FRANCHISE = 8;

/**
 * Android notification channels, one per settings group, so an owner can also
 * silence a whole group from the phone's own settings. The app creates these
 * same ids at start-up (apps/mobile/src/push/); a message for a channel the
 * device has never created falls back to Android's "Miscellaneous" channel.
 */
export const EXPO_CHANNELS: readonly MflLiveAppPushChannelId[] = [
  'your-team',
  'league-news',
  'live',
  'ops',
];

export interface StoredExpoToken {
  token: string;
  platform: MflLiveAppPushPlatform;
  /** MFL user id of the session that registered the token. */
  userId: string;
  /** ISO timestamp — the oldest is evicted when a franchise hits the cap. */
  createdAt: string;
}

/** What a send hands Expo — the subset of Expo's message format we use. */
export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: MflLiveAppPushData;
  sound: 'default';
  channelId: MflLiveAppPushChannelId;
  priority: 'default' | 'high';
  /** Seconds Expo/FCM keep trying an offline device. */
  ttl: number;
}

export interface ExpoSendResult {
  sent: number;
  failed: number;
  /** Tokens Expo says will never deliver again (DeviceNotRegistered). */
  deadTokens: string[];
}

// Expo issues `ExponentPushToken[…]`; newer SDKs may say `ExpoPushToken[…]`.
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/;

export function expoTokensKey(leagueId: string, franchiseId: string): string {
  return `push:expo:${leagueId}:${franchiseId}`;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The trimmed token when it is a well-formed Expo push token, else null. */
export function validateExpoToken(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const token = input.trim();
  return EXPO_TOKEN_RE.test(token) ? token : null;
}

export function validatePlatform(input: unknown): MflLiveAppPushPlatform | null {
  return input === 'android' || input === 'ios' ? input : null;
}

function parseStored(value: unknown): StoredExpoToken | null {
  let obj: unknown = value;
  if (typeof value === 'string') {
    try {
      obj = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const raw = obj as Record<string, unknown>;
  const token = validateExpoToken(raw.token);
  const platform = validatePlatform(raw.platform);
  if (!token || !platform) return null;
  return {
    token,
    platform,
    userId: typeof raw.userId === 'string' ? raw.userId : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
  };
}

/** Upsert a token, evicting the oldest at the cap. False when Redis is down. */
export async function saveExpoToken(
  leagueId: string,
  franchiseId: string,
  token: string,
  platform: MflLiveAppPushPlatform,
  userId: string,
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  const key = expoTokensKey(leagueId, franchiseId);
  const field = hashToken(token);
  const existing = (await redis.hgetall(key)) ?? {};
  const entries = Object.entries(existing)
    .filter(([f]) => f !== field)
    .map(([f, v]) => ({ field: f, createdAt: parseStored(v)?.createdAt }));
  const evict = selectSubscriptionsToEvict(entries, MAX_EXPO_TOKENS_PER_FRANCHISE);
  if (evict.length > 0) await redis.hdel(key, ...evict);
  const stored: StoredExpoToken = { token, platform, userId, createdAt: new Date().toISOString() };
  await redis.hset(key, { [field]: JSON.stringify(stored) });
  return true;
}

/** Remove one token (idempotent). False only when Redis is down. */
export async function removeExpoToken(
  leagueId: string,
  franchiseId: string,
  token: string,
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  await redis.hdel(expoTokensKey(leagueId, franchiseId), hashToken(token));
  return true;
}

export async function getExpoTokens(
  leagueId: string,
  franchiseId: string,
): Promise<StoredExpoToken[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const all = (await redis.hgetall(expoTokensKey(leagueId, franchiseId))) ?? {};
  return Object.values(all)
    .map((v) => parseStored(v))
    .filter((t): t is StoredExpoToken => t !== null);
}

/** Best-effort removal of tokens Expo reported as dead. */
export async function pruneExpoTokens(
  leagueId: string,
  franchiseId: string,
  tokens: string[],
): Promise<void> {
  if (tokens.length === 0) return;
  try {
    const redis = await getRedis();
    if (!redis) return;
    await redis.hdel(expoTokensKey(leagueId, franchiseId), ...tokens.map(hashToken));
  } catch (e) {
    console.warn('[push-expo] prune failed:', e);
  }
}

/**
 * One message per token. Pure — the payload arrives already scrubbed by the
 * sender. The channel follows the category's settings group; an unknown
 * category never gets this far (the sender refuses it first).
 */
export function buildExpoMessages(
  tokens: string[],
  payload: { title: string; body: string; url?: string; tag?: string },
  category: string,
  leagueId: string,
): ExpoPushMessage[] {
  const group = getNotificationCategory(category)?.group ?? 'your-team';
  const data: MflLiveAppPushData = { category, leagueId };
  if (payload.url) data.url = payload.url;
  if (payload.tag) data.tag = payload.tag;
  return tokens.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    data,
    sound: 'default',
    channelId: group,
    // Game-day alerts are only worth anything on time; the rest can wait for
    // the phone's next wake-up rather than spend its high-priority budget.
    priority: group === 'live' || group === 'your-team' ? 'high' : 'default',
    ttl: 60 * 60 * 24,
  }));
}

/**
 * Read Expo's push tickets. Tickets come back in message order; a ticket
 * with `DeviceNotRegistered` marks its token dead. Pure.
 */
export function readExpoTickets(
  messages: ExpoPushMessage[],
  response: unknown,
): ExpoSendResult {
  const result: ExpoSendResult = { sent: 0, failed: 0, deadTokens: [] };
  const tickets = (response as { data?: unknown })?.data;
  if (!Array.isArray(tickets)) {
    result.failed = messages.length;
    return result;
  }
  messages.forEach((message, i) => {
    const ticket = tickets[i] as { status?: string; details?: { error?: string } } | undefined;
    if (ticket?.status === 'ok') {
      result.sent += 1;
    } else if (ticket?.details?.error === 'DeviceNotRegistered') {
      result.deadTokens.push(message.to);
    } else {
      result.failed += 1;
    }
  });
  return result;
}

/** POST messages to Expo in batches of 100. Never throws. */
export async function sendExpoMessages(
  messages: ExpoPushMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<ExpoSendResult> {
  const total: ExpoSendResult = { sent: 0, failed: 0, deadTokens: [] };
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  const accessToken = process.env.EXPO_PUSH_ACCESS_TOKEN;
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  for (let i = 0; i < messages.length; i += EXPO_PUSH_BATCH) {
    const batch = messages.slice(i, i + EXPO_PUSH_BATCH);
    try {
      const res = await fetchImpl(EXPO_PUSH_SEND_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.warn(`[push-expo] Expo answered HTTP ${res.status}`);
        total.failed += batch.length;
        continue;
      }
      const part = readExpoTickets(batch, await res.json());
      total.sent += part.sent;
      total.failed += part.failed;
      total.deadTokens.push(...part.deadTokens);
    } catch (e) {
      console.warn('[push-expo] send failed:', e);
      total.failed += batch.length;
    }
  }
  return total;
}
