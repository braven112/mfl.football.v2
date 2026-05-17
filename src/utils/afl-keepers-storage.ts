/**
 * AFL Keeper Plan Storage.
 *
 * AFL doesn't have a formal "keeper" league construct on MFL — the
 * offseason auction wipes the slate every year. But owners want a
 * private scratchpad: drag 7 players above the line, see who's getting
 * cut, finalize when they're ready and watch the bulk-cut go.
 *
 * One plan per franchise per year, scoped to leagueId so test leagues
 * never collide with production AFL. Stored in Upstash Redis in
 * production (Vercel) with a filesystem fallback for local dev.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const KEEPER_LIMIT = 7;

export interface KeeperPlan {
  leagueId: string;
  year: number;
  franchiseId: string;
  /** Ordered list of MFL player IDs the owner intends to keep. Capped at KEEPER_LIMIT. */
  keepers: string[];
  /** ISO 8601 timestamp of the last write. */
  lastUpdated: string;
  /** Schema version — bump when the shape changes. */
  version: 1;
}

const REDIS_KEY = 'afl-keepers';

type RedisClient = {
  hget: <T>(key: string, field: string) => Promise<T | null>;
  hset: (key: string, fieldValues: Record<string, unknown>) => Promise<number>;
  hdel: (key: string, ...fields: string[]) => Promise<number>;
};

let _redis: RedisClient | null | undefined;

async function getRedis(): Promise<RedisClient | null> {
  if (_redis !== undefined) return _redis;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.STORAGE_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.STORAGE_REST_API_TOKEN;
  if (!url || !token) {
    _redis = null;
    return null;
  }
  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token }) as unknown as RedisClient;
    return _redis;
  } catch (err) {
    console.warn('[afl-keepers] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

/** Hash field key — keeps every (league, year, franchise) tuple distinct. */
function planKey(leagueId: string, year: number, franchiseId: string): string {
  return `${leagueId}:${year}:${franchiseId}`;
}

// --- Filesystem fallback (dev) ---
const DEV_PATH = join(
  process.cwd(),
  'data/afl-fantasy/keeper-plans.json'
);

interface DevFile {
  version: 1;
  plans: Record<string, KeeperPlan>;
}

function readDevFile(): DevFile {
  try {
    return JSON.parse(readFileSync(DEV_PATH, 'utf-8'));
  } catch {
    return { version: 1, plans: {} };
  }
}

function writeDevFile(file: DevFile): void {
  const dir = dirname(DEV_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(DEV_PATH, JSON.stringify(file, null, 2), 'utf-8');
}

function useRedis(): boolean {
  return !!process.env.VERCEL || !!process.env.UPSTASH_REDIS_REST_URL;
}

/** Sanitize/cap a list of player IDs to KEEPER_LIMIT, dedupe, drop non-numeric. */
export function sanitizeKeeperIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const str = String(id ?? '').trim();
    if (!/^\d+$/.test(str)) continue;
    if (seen.has(str)) continue;
    seen.add(str);
    out.push(str);
    if (out.length >= KEEPER_LIMIT) break;
  }
  return out;
}

/** Read a single franchise's plan. Returns null if no plan saved yet. */
export async function getKeeperPlan(
  leagueId: string,
  year: number,
  franchiseId: string
): Promise<KeeperPlan | null> {
  const key = planKey(leagueId, year, franchiseId);

  if (useRedis()) {
    const redis = await getRedis();
    if (!redis) return null;
    try {
      const plan = await redis.hget<KeeperPlan>(REDIS_KEY, key);
      return plan ?? null;
    } catch (err) {
      console.error('[afl-keepers] Redis read error:', err);
      return null;
    }
  }

  const file = readDevFile();
  return file.plans[key] ?? null;
}

/** Save a franchise's plan. The plan replaces any existing one. */
export async function saveKeeperPlan(
  leagueId: string,
  year: number,
  franchiseId: string,
  keepers: string[]
): Promise<KeeperPlan> {
  const plan: KeeperPlan = {
    leagueId,
    year,
    franchiseId,
    keepers: sanitizeKeeperIds(keepers),
    lastUpdated: new Date().toISOString(),
    version: 1,
  };

  const key = planKey(leagueId, year, franchiseId);

  if (useRedis()) {
    const redis = await getRedis();
    if (!redis) throw new Error('Redis not available');
    await redis.hset(REDIS_KEY, { [key]: plan });
    return plan;
  }

  const file = readDevFile();
  file.plans[key] = plan;
  writeDevFile(file);
  return plan;
}

/** Delete a franchise's plan (used by Reset). */
export async function deleteKeeperPlan(
  leagueId: string,
  year: number,
  franchiseId: string
): Promise<void> {
  const key = planKey(leagueId, year, franchiseId);

  if (useRedis()) {
    const redis = await getRedis();
    if (!redis) return;
    await redis.hdel(REDIS_KEY, key);
    return;
  }

  const file = readDevFile();
  delete file.plans[key];
  writeDevFile(file);
}
