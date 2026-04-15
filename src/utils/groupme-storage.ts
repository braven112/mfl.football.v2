/**
 * GroupMe Storage
 *
 * Stores GroupMe messages in Upstash Redis using a sorted set.
 * Key: groupme:messages — scored by createdAt timestamp (ms).
 * Follows the schefter-replies-storage.ts pattern.
 */

import type { GroupMeMessage } from '../types/groupme';
import type { SchefterPost } from '../types/schefter';

type RedisClient = {
  zadd: (key: string, ...args: unknown[]) => Promise<number>;
  zrange: <T>(key: string, min: number, max: number, opts?: { rev?: boolean }) => Promise<T[]>;
  zrangebyscore: <T>(key: string, min: number | string, max: number | string, opts?: { offset?: number; count?: number }) => Promise<T[]>;
  zrevrangebyscore: <T>(key: string, max: number | string, min: number | string, opts?: { offset?: number; count?: number }) => Promise<T[]>;
  zremrangebyrank: (key: string, start: number, stop: number) => Promise<number>;
  zcard: (key: string) => Promise<number>;
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown, opts?: { ex?: number }) => Promise<string>;
  hset: (key: string, fieldValues: Record<string, unknown>) => Promise<number>;
  hget: <T>(key: string, field: string) => Promise<T | null>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
  del: (key: string) => Promise<number>;
};

const KEYS = {
  messages: 'groupme:messages',
  lastMessageId: 'groupme:last_message_id',
  lastSyncTs: 'groupme:last_sync_ts',
  userMapPrefix: 'groupme:user:',
  sendRatePrefix: 'groupme:send-rate:',
  tokenPrefix: 'groupme:token:',
  connectedPrefix: 'groupme:connected:',
} as const;

const MAX_MESSAGES = 500;

let _redis: RedisClient | null | undefined;

async function getRedis(): Promise<RedisClient | null> {
  if (_redis !== undefined) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN;
  if (!url || !token) {
    _redis = null;
    return null;
  }

  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token }) as unknown as RedisClient;
    return _redis;
  } catch (err) {
    console.warn('[groupme-storage] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

/** Store messages in the sorted set, scored by createdAt timestamp */
export async function storeMessages(messages: GroupMeMessage[]): Promise<number> {
  const redis = await getRedis();
  if (messages.length === 0) return 0;
  if (!redis) {
    console.error('[groupme-storage] Redis not available for storeMessages');
    return -1; // Distinguish "no redis" from "no messages"
  }

  let stored = 0;
  for (const msg of messages) {
    // Score is createdAt in milliseconds for precise ordering
    await redis.zadd(KEYS.messages, { score: msg.createdAt * 1000, member: JSON.stringify(msg) });
    stored++;
  }

  // Trim to keep only the most recent MAX_MESSAGES
  const count = await redis.zcard(KEYS.messages);
  if (count > MAX_MESSAGES) {
    await redis.zremrangebyrank(KEYS.messages, 0, count - MAX_MESSAGES - 1);
  }

  return stored;
}

/** Get recent messages, newest first */
export async function getRecentMessages(limit = 50): Promise<GroupMeMessage[]> {
  const redis = await getRedis();
  if (!redis) return [];

  try {
    // zrange with rev:true returns highest-score first (newest)
    const raw = await redis.zrange<string>(KEYS.messages, 0, limit - 1, { rev: true });
    return raw.map(item => {
      const parsed = typeof item === 'string' ? JSON.parse(item) : item;
      return parsed as GroupMeMessage;
    });
  } catch (err) {
    console.error('[groupme-storage] Failed to get messages:', err);
    return [];
  }
}

/** Get messages after a specific timestamp (for polling) */
export async function getMessagesSince(sinceTimestampMs: number, limit = 50): Promise<GroupMeMessage[]> {
  const redis = await getRedis();
  if (!redis) return [];

  try {
    const raw = await redis.zrangebyscore<string>(
      KEYS.messages,
      sinceTimestampMs + 1,
      '+inf',
      { offset: 0, count: limit },
    );
    return raw.map(item => {
      const parsed = typeof item === 'string' ? JSON.parse(item) : item;
      return parsed as GroupMeMessage;
    });
  } catch (err) {
    console.error('[groupme-storage] Failed to get messages since:', err);
    return [];
  }
}

/** Get/set the last processed GroupMe message ID (watermark) */
export async function getLastMessageId(): Promise<string | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    return await redis.get<string>(KEYS.lastMessageId);
  } catch { return null; }
}

export async function setLastMessageId(messageId: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.set(KEYS.lastMessageId, messageId);
  } catch (err) {
    console.error('[groupme-storage] Failed to set last message ID:', err);
  }
}

/** Get/set last sync timestamp */
export async function getLastSyncTs(): Promise<number | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const ts = await redis.get<string>(KEYS.lastSyncTs);
    return ts ? Number(ts) : null;
  } catch { return null; }
}

export async function setLastSyncTs(): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.set(KEYS.lastSyncTs, String(Date.now()));
  } catch { /* ignore */ }
}

/** Map a GroupMe userId to a franchiseId */
export async function setUserFranchiseMap(groupMeUserId: string, franchiseId: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.set(`${KEYS.userMapPrefix}${groupMeUserId}`, franchiseId);
  } catch (err) {
    console.error('[groupme-storage] Failed to set user map:', err);
  }
}

/** Look up franchiseId for a GroupMe userId */
export async function getUserFranchiseId(groupMeUserId: string): Promise<string | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    return await redis.get<string>(`${KEYS.userMapPrefix}${groupMeUserId}`);
  } catch { return null; }
}

/** Rate limit: 20 sends per hour per franchise */
const SEND_RATE_LIMIT_MAX = 20;
const SEND_RATE_LIMIT_WINDOW = 3600;

export async function checkSendRateLimit(franchiseId: string): Promise<{ allowed: boolean; count: number }> {
  const redis = await getRedis();
  if (!redis) return { allowed: true, count: 0 };

  try {
    const key = `${KEYS.sendRatePrefix}${franchiseId}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, SEND_RATE_LIMIT_WINDOW);
    }
    return { allowed: count <= SEND_RATE_LIMIT_MAX, count };
  } catch {
    return { allowed: true, count: 0 };
  }
}

/**
 * Convert GroupMe messages to SchefterPost-compatible objects for feed intermingling.
 * GroupMe messages use type 'groupme' and authorId 'groupme-{franchiseId}'.
 */
export function toSchefterPosts(messages: GroupMeMessage[], teamConfig: TeamConfig[]): SchefterPost[] {
  return messages
    .filter(m => m.senderType === 'user' && m.text) // Skip bots and system messages
    .map(msg => {
      const team = msg.franchiseId
        ? teamConfig.find(t => t.franchiseId === msg.franchiseId)
        : null;

      return {
        id: `gm_${msg.id}`,
        timestamp: new Date(msg.createdAt * 1000).toISOString(),
        type: 'groupme' as SchefterPost['type'],
        tier: 'standard' as const,
        headline: '',
        body: msg.text,
        franchiseIds: msg.franchiseId ? [msg.franchiseId] : [],
        authorId: msg.franchiseId ? `groupme-${msg.franchiseId}` : 'groupme',
        league: 'theleague' as const,
        // Extra fields for GroupMe rendering
        _groupMe: {
          name: team?.name ?? msg.name,
          avatar: team?.icon ?? msg.avatarUrl ?? '',
          likeCount: msg.likeCount,
          senderName: msg.name,
        },
      } as SchefterPost & { _groupMe: GroupMePostMeta };
    });
}

export interface GroupMePostMeta {
  name: string;
  avatar: string;
  likeCount: number;
  senderName: string;
}

interface TeamConfig {
  franchiseId: string;
  name: string;
  icon: string;
}

/** Check if a franchise has linked their GroupMe account */
export async function isLinked(franchiseId: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  try {
    const val = await redis.get<string>(`${KEYS.connectedPrefix}${franchiseId}`);
    return val === '1';
  } catch { return false; }
}

/** Get the linked GroupMe user ID for a franchise */
export async function getLinkedGroupMeUserId(franchiseId: string): Promise<string | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    return await redis.get<string>(`groupme:franchise:${franchiseId}`);
  } catch { return null; }
}

/** Link a franchise to a GroupMe user ID (bidirectional mapping) */
export async function linkFranchise(franchiseId: string, groupMeUserId: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  try {
    await redis.set(`${KEYS.userMapPrefix}${groupMeUserId}`, franchiseId);
    await redis.set(`groupme:franchise:${franchiseId}`, groupMeUserId);
    await redis.set(`${KEYS.connectedPrefix}${franchiseId}`, '1');
    return true;
  } catch (err) {
    console.error('[groupme-storage] Failed to link franchise:', err);
    return false;
  }
}

/** Unlink a franchise from their GroupMe account */
export async function unlinkFranchise(franchiseId: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  try {
    const groupMeUserId = await redis.get<string>(`groupme:franchise:${franchiseId}`);
    if (groupMeUserId) {
      await redis.del(`${KEYS.userMapPrefix}${groupMeUserId}`);
    }
    await redis.del(`groupme:franchise:${franchiseId}`);
    await redis.del(`${KEYS.connectedPrefix}${franchiseId}`);
    return true;
  } catch (err) {
    console.error('[groupme-storage] Failed to unlink franchise:', err);
    return false;
  }
}

/** Get all linked franchises (for showing who's already claimed) */
export async function getAllLinkedUserIds(): Promise<Record<string, string>> {
  const redis = await getRedis();
  if (!redis) return {};
  try {
    const teamConfig = await loadTeamConfig();
    const result: Record<string, string> = {};
    for (const team of teamConfig) {
      const gmUserId = await redis.get<string>(`groupme:franchise:${team.franchiseId}`);
      if (gmUserId) {
        result[gmUserId] = team.franchiseId;
      }
    }
    return result;
  } catch { return {}; }
}

/**
 * Hardcoded GroupMe user → franchise mappings.
 * Maintained by commissioner — update here when membership changes.
 */
const GROUPME_FRANCHISE_MAP: Record<string, string> = {
  '84883733': '0001', // Pacific Pigskins (Brandon)
  '16291586': '0002', // Da Dangsters (DDang)
  '40592442': '0003', // Maverick
  '84975567': '0004', // Dead Cap Walking (JoBu)
  '7252038':  '0005', // The Mariachi Ninjas (Junior)
  '84966064': '0006', // Music City Mafia (James)
  '121438191': '0007', // Fire Ready Aim (Jim Kubek)
  '84969747': '0008', // Bring The Pain (Todd)
  '54045522': '0009', // Wascawy Wabbits (Nick)
  '22601344': '0010', // Computer Jocks (Jomar)
  '10114594': '0011', // Midwestside Connection (Nate)
  '84947761': '0012', // Vitside Mafia
  '37386080': '0013', // Gridiron Geeks (Bob)
  '84947778': '0014', // Cowboy Up (Ross)
  '49905080': '0014', // Cowboy Up (Shawn) — co-owner
  '89377289': '0015', // Dark Magicians of Chaos (Dan)
  '84961628': '0016', // Running down the Dream (Kevin)
};

/** Seed all franchise mappings into Redis. Idempotent — safe to call on every sync. */
export async function seedFranchiseMappings(): Promise<number> {
  const redis = await getRedis();
  if (!redis) return 0;

  let seeded = 0;
  for (const [groupMeUserId, franchiseId] of Object.entries(GROUPME_FRANCHISE_MAP)) {
    try {
      await redis.set(`${KEYS.userMapPrefix}${groupMeUserId}`, franchiseId);
      await redis.set(`groupme:franchise:${franchiseId}`, groupMeUserId);
      await redis.set(`${KEYS.connectedPrefix}${franchiseId}`, '1');
      seeded++;
    } catch (err) {
      console.error(`[groupme-storage] Failed to seed mapping ${groupMeUserId} → ${franchiseId}:`, err);
    }
  }
  return seeded;
}

/** Look up franchiseId from the hardcoded map (no Redis needed) */
export function getFranchiseIdFromMap(groupMeUserId: string): string | undefined {
  return GROUPME_FRANCHISE_MAP[groupMeUserId];
}

/** Helper to load team config for mapping */
export async function loadTeamConfig(): Promise<TeamConfig[]> {
  try {
    const config = await import('../data/theleague.config.json');
    const teams = config.default?.teams ?? config.teams ?? [];
    return teams.map((t: { franchiseId: string; name: string; icon?: string }) => ({
      franchiseId: t.franchiseId,
      name: t.name,
      icon: t.icon ?? '',
    }));
  } catch {
    return [];
  }
}
