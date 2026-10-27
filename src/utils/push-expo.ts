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
 * Storage is per MFL ACCOUNT, not per session league, because one app sign-in
 * covers every league the account is in (the MFL Football app is for any
 * MFL owner, and most own teams in several leagues):
 *   push:expo:acct:{account}   HASH sha256(token) → StoredExpoToken (JSON)
 *   push:expo:league:{leagueId} HASH "{franchiseId}:{account}" → account
 *   push:expo:token:{sha256(token)} → account (a phone belongs to one account)
 * `account` is the hashed, lower-cased MFL username (`sleeperViewerKey`, the
 * same id every /live surface keys an owner on). The league index is rebuilt
 * from MFL's own `myleagues` list on every registration, so a team the owner
 * no longer has stops alerting. The league id in the index key is not
 * decoration: every league has a franchise 0001.
 *
 * Expo's API needs no credentials. When "enhanced push security" is turned on
 * in the Expo dashboard, set EXPO_PUSH_ACCESS_TOKEN and it is sent as Bearer.
 */

import { createHash } from 'node:crypto';
import { getRedis } from './redis-client';
import { selectSubscriptionsToEvict } from './push-subscriptions';
import { getNotificationCategory } from '../config/notification-categories';
import { sleeperViewerKey } from './sleeper/link';
import type { AuthUser } from './auth';
import type {
  MflLiveAppPushChannelId,
  MflLiveAppPushData,
  MflLiveAppPushPlatform,
} from '../../packages/shared-types/src/mfl-live-app-push';

export const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo accepts at most 100 messages per request. */
export const EXPO_PUSH_BATCH = 100;

/** Most phones one account may keep (phone, tablet, a reinstall or two). */
export const MAX_EXPO_TOKENS_PER_ACCOUNT = 8;

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

/**
 * The account a phone belongs to: the hashed, lower-cased MFL username, the
 * one id every /live surface already keys an owner on (Sleeper links, crowd
 * fixes). Never the MFL cookie (`user.id`), which is a credential.
 */
export function pushAccountKey(user: Pick<AuthUser, 'name'>): string | null {
  return sleeperViewerKey(user);
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
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
  };
}

export function accountTokensKey(account: string): string {
  return `push:expo:acct:${account}`;
}

export function leagueIndexKey(leagueId: string): string {
  return `push:expo:league:${leagueId}`;
}

function tokenOwnerKey(token: string): string {
  return `push:expo:token:${hashToken(token)}`;
}

/** Index fields for one account's teams. Pure. */
export function indexFields(account: string, teams: Array<{ franchiseId: string }>): string[] {
  return [...new Set(teams.filter((t) => t.franchiseId).map((t) => `${t.franchiseId}:${account}`))];
}

/** Accounts holding a franchise, from a league index hash. Pure. */
export function accountsForFranchise(index: Record<string, unknown>, franchiseId: string): string[] {
  const prefix = `${franchiseId}:`;
  return [
    ...new Set(
      Object.entries(index)
        .filter(([field, account]) => field.startsWith(prefix) && typeof account === 'string')
        .map(([, account]) => account as string),
    ),
  ];
}

/**
 * Upsert a phone's token under an account, evicting the oldest at the cap. A
 * token last registered by another account (someone signed out and a
 * different owner signed in on the same phone) leaves that account first, so
 * the previous owner's alerts stop reaching this phone. False when Redis is down.
 */
export async function saveExpoToken(
  account: string,
  token: string,
  platform: MflLiveAppPushPlatform,
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  const field = hashToken(token);
  const previous = await redis.get<string>(tokenOwnerKey(token));
  if (previous && previous !== account) await redis.hdel(accountTokensKey(previous), field);

  const key = accountTokensKey(account);
  const existing = (await redis.hgetall(key)) ?? {};
  const entries = Object.entries(existing)
    .filter(([f]) => f !== field)
    .map(([f, v]) => ({ field: f, createdAt: parseStored(v)?.createdAt }));
  const evict = selectSubscriptionsToEvict(entries, MAX_EXPO_TOKENS_PER_ACCOUNT);
  if (evict.length > 0) await redis.hdel(key, ...evict);
  const stored: StoredExpoToken = { token, platform, createdAt: new Date().toISOString() };
  await redis.hset(key, { [field]: JSON.stringify(stored) });
  await redis.set(tokenOwnerKey(token), account);
  return true;
}

/**
 * Point each league's index at this account's current teams, and drop the
 * account from `previousLeagueIds` it no longer has a team in. Pass the
 * previous list only when `teams` is MFL's complete answer — a failed
 * `myleagues` read must not un-index every league the owner is in.
 */
export async function indexAccountTeams(
  account: string,
  teams: Array<{ leagueId: string; franchiseId: string }>,
  previousLeagueIds: string[] = [],
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  const byLeague = new Map<string, Array<{ franchiseId: string }>>();
  for (const t of teams) {
    if (!t.leagueId) continue;
    byLeague.set(t.leagueId, [...(byLeague.get(t.leagueId) ?? []), t]);
  }
  for (const leagueId of new Set([...byLeague.keys(), ...previousLeagueIds])) {
    const key = leagueIndexKey(leagueId);
    const wanted = new Set(indexFields(account, byLeague.get(leagueId) ?? []));
    const existing = Object.keys((await redis.hgetall(key)) ?? {}).filter((f) => f.endsWith(`:${account}`));
    const drop = existing.filter((f) => !wanted.has(f));
    if (drop.length > 0) await redis.hdel(key, ...drop);
    if (wanted.size > 0) {
      await redis.hset(key, Object.fromEntries([...wanted].map((f) => [f, account])));
    }
  }
  await redis.set(accountLeaguesKey(account), [...byLeague.keys()]);
}

function accountLeaguesKey(account: string): string {
  return `push:expo:leagues:${account}`;
}

/** The league ids this account was last indexed under ([] when none / no Redis). */
export async function getIndexedLeagues(account: string): Promise<string[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const value = await redis.get<string[]>(accountLeaguesKey(account));
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
}

/** Forget one phone (sign-out, alerts turned off). Idempotent; false only when Redis is down. */
export async function removeExpoToken(account: string, token: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  await redis.hdel(accountTokensKey(account), hashToken(token));
  const owner = await redis.get<string>(tokenOwnerKey(token));
  if (owner === account) await redis.del(tokenOwnerKey(token));
  return true;
}

/** Every phone of every account holding this franchise, de-duplicated. */
export async function getFranchiseExpoTokens(
  leagueId: string,
  franchiseId: string,
): Promise<Array<{ account: string; token: string }>> {
  const redis = await getRedis();
  if (!redis) return [];
  const index = (await redis.hgetall(leagueIndexKey(leagueId))) ?? {};
  const out: Array<{ account: string; token: string }> = [];
  const seen = new Set<string>();
  for (const account of accountsForFranchise(index, franchiseId)) {
    const all = (await redis.hgetall(accountTokensKey(account))) ?? {};
    for (const value of Object.values(all)) {
      const stored = parseStored(value);
      if (stored && !seen.has(stored.token)) {
        seen.add(stored.token);
        out.push({ account, token: stored.token });
      }
    }
  }
  return out;
}

/** Best-effort removal of tokens Expo reported as dead. */
export async function pruneExpoTokens(
  dead: Array<{ account: string; token: string }>,
): Promise<void> {
  if (dead.length === 0) return;
  try {
    for (const { account, token } of dead) await removeExpoToken(account, token);
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
