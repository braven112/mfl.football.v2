/**
 * Contract Declaration Storage
 *
 * Stores contract declarations in Upstash Redis (production/preview)
 * with filesystem fallback for local development.
 *
 * Each declaration is stored as a separate Redis hash field keyed by ID,
 * eliminating the read-all/modify/write-all race condition that plagued
 * the previous Vercel Blob implementation.
 */

import type { ContractDeclaration, DeclarationStatus } from '../types/contracts';

const REDIS_KEY = 'contract-declarations';

// --- Redis helpers ---

type RedisClient = {
  hget: <T>(key: string, field: string) => Promise<T | null>;
  hgetall: <T>(key: string) => Promise<Record<string, T> | null>;
  hset: (key: string, fieldValues: Record<string, unknown>) => Promise<number>;
  hdel: (key: string, ...fields: string[]) => Promise<number>;
};

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
    console.warn('[contract-storage] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

/** Read all declarations from Redis hash, sorted newest first */
async function readFromRedis(): Promise<ContractDeclaration[]> {
  const redis = await getRedis();
  if (!redis) {
    console.error('[contract-storage] Redis not configured — check UPSTASH_REDIS_REST_URL / KV_REST_API_URL env vars');
    return [];
  }

  try {
    const all = await redis.hgetall<ContractDeclaration>(REDIS_KEY);
    if (!all || Object.keys(all).length === 0) return [];

    const declarations = Object.values(all);
    declarations.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
    return declarations;
  } catch (err) {
    console.error('[contract-storage] Redis read error:', err);
    return [];
  }
}

/** Write a single declaration to Redis (atomic, no read-modify-write) */
async function writeOneToRedis(declaration: ContractDeclaration): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;

  try {
    await redis.hset(REDIS_KEY, { [declaration.id]: declaration });
    console.log('[contract-storage] Redis write OK:', declaration.id, 'status:', declaration.status);
    return true;
  } catch (err) {
    console.error('[contract-storage] Redis write error:', err);
    return false;
  }
}

// --- Filesystem fallback for local dev ---
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const DECLARATIONS_PATH = join(
  process.cwd(),
  'data/theleague/contract-declarations.json',
);

interface DeclarationsFile {
  version: string;
  lastUpdated: string;
  declarations: ContractDeclaration[];
}

function readDeclarationsFileSync(): DeclarationsFile {
  try {
    const data = readFileSync(DECLARATIONS_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { version: '1.0', lastUpdated: new Date().toISOString(), declarations: [] };
  }
}

function writeDeclarationsFileSync(file: DeclarationsFile): void {
  const dir = dirname(DECLARATIONS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  file.lastUpdated = new Date().toISOString();
  writeFileSync(DECLARATIONS_PATH, JSON.stringify(file, null, 2), 'utf-8');
}

// --- Unified async read/write ---

/** Read from Vercel Blob and migrate to Redis (runs once per cold start) */
let _blobMigrated = false;
async function migrateFromBlobIfNeeded(): Promise<void> {
  if (_blobMigrated) return;
  _blobMigrated = true;

  try {
    const { list: listBlobs } = await import('@vercel/blob');
    const { blobs } = await listBlobs({ prefix: 'data/contract-declarations.json', limit: 1 });
    if (blobs.length === 0) return;

    const fetchUrl = blobs[0].downloadUrl || blobs[0].url;
    const res = await fetch(fetchUrl, { cache: 'no-store' });
    if (!res.ok) return;
    const blobData = await res.json() as ContractDeclaration[];
    if (blobData.length === 0) return;

    // Read existing Redis data to find missing records
    const redisData = await readFromRedis();
    const redisIds = new Set(redisData.map(d => d.id));
    const missing = blobData.filter(d => !redisIds.has(d.id));

    if (missing.length > 0) {
      const redis = await getRedis();
      if (!redis) return;
      const fieldValues: Record<string, ContractDeclaration> = {};
      for (const d of missing) fieldValues[d.id] = d;
      await redis.hset(REDIS_KEY, fieldValues);
      console.log(`[contract-storage] Migrated ${missing.length} declarations from Blob to Redis`);
    }
  } catch (err) {
    console.warn('[contract-storage] Blob migration skipped:', err);
  }
}

async function readAllDeclarations(): Promise<ContractDeclaration[]> {
  if (process.env.VERCEL) {
    await migrateFromBlobIfNeeded();
    return readFromRedis();
  }
  return readDeclarationsFileSync().declarations;
}

async function writeAllDeclarations(declarations: ContractDeclaration[]): Promise<void> {
  if (process.env.VERCEL) {
    const redis = await getRedis();
    if (!redis) throw new Error('Redis not available');

    const fieldValues: Record<string, ContractDeclaration> = {};
    for (const d of declarations) {
      fieldValues[d.id] = d;
    }
    if (Object.keys(fieldValues).length > 0) {
      await redis.hset(REDIS_KEY, fieldValues);
    }
    return;
  }
  writeDeclarationsFileSync({
    version: '1.0',
    lastUpdated: new Date().toISOString(),
    declarations,
  });
}

// --- Public API (all async) ---

/** Generate a unique declaration ID */
export function generateDeclarationId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `DECL_${timestamp}_${random}`;
}

/** Get all declarations */
export async function getDeclarations(): Promise<ContractDeclaration[]> {
  return readAllDeclarations();
}

/** Get declarations filtered by status */
export async function getDeclarationsByStatus(status: DeclarationStatus): Promise<ContractDeclaration[]> {
  const all = await readAllDeclarations();
  return all.filter(d => d.status === status);
}

/** Get pending declarations (for commissioner dashboard) */
export async function getPendingDeclarations(): Promise<ContractDeclaration[]> {
  return getDeclarationsByStatus('pending');
}

/** Get declarations for a specific franchise */
export async function getDeclarationsByFranchise(franchiseId: string): Promise<ContractDeclaration[]> {
  const all = await readAllDeclarations();
  return all.filter(d => d.franchiseId === franchiseId);
}

/** Get a single declaration by ID */
export async function getDeclarationById(id: string): Promise<ContractDeclaration | undefined> {
  if (process.env.VERCEL) {
    const redis = await getRedis();
    if (redis) {
      const decl = await redis.hget<ContractDeclaration>(REDIS_KEY, id);
      return decl ?? undefined;
    }
  }
  const all = await readAllDeclarations();
  return all.find(d => d.id === id);
}

/** Add a new declaration */
export async function addDeclaration(declaration: ContractDeclaration): Promise<ContractDeclaration> {
  if (process.env.VERCEL) {
    const ok = await writeOneToRedis(declaration);
    if (!ok) throw new Error('Failed to write declaration to Redis');
    return declaration;
  }
  const file = readDeclarationsFileSync();
  file.declarations.unshift(declaration);
  writeDeclarationsFileSync(file);
  return declaration;
}

/** Update an existing declaration (atomic — no read-modify-write race) */
export async function updateDeclaration(
  id: string,
  updates: Partial<ContractDeclaration>,
): Promise<ContractDeclaration | null> {
  if (process.env.VERCEL) {
    const redis = await getRedis();
    if (!redis) return null;

    const existing = await redis.hget<ContractDeclaration>(REDIS_KEY, id);
    if (!existing) {
      console.error('[contract-storage] updateDeclaration: not found in Redis:', id);
      return null;
    }

    const updated = { ...existing, ...updates };
    await redis.hset(REDIS_KEY, { [id]: updated });
    console.log('[contract-storage] updateDeclaration OK:', id, 'status:', updated.status);
    return updated;
  }

  // Filesystem fallback
  const file = readDeclarationsFileSync();
  const index = file.declarations.findIndex(d => d.id === id);
  if (index === -1) {
    console.error('[contract-storage] updateDeclaration: not found:', id);
    return null;
  }
  file.declarations[index] = { ...file.declarations[index], ...updates };
  writeDeclarationsFileSync(file);
  return file.declarations[index];
}

/** Delete a declaration by ID (for testing/cleanup) */
export async function deleteDeclaration(id: string): Promise<boolean> {
  if (process.env.VERCEL) {
    const redis = await getRedis();
    if (!redis) return false;
    const deleted = await redis.hdel(REDIS_KEY, id);
    console.log('[contract-storage] deleteDeclaration:', id, 'deleted:', deleted);
    return deleted > 0;
  }

  // Filesystem fallback
  const file = readDeclarationsFileSync();
  const index = file.declarations.findIndex(d => d.id === id);
  if (index === -1) return false;
  file.declarations.splice(index, 1);
  writeDeclarationsFileSync(file);
  return true;
}

/**
 * Check if a team has already used their franchise tag for a given league year.
 * Returns the existing tag declaration if found.
 */
export async function getTeamFranchiseTag(
  franchiseId: string,
  leagueYear: number,
): Promise<ContractDeclaration | undefined> {
  const all = await readAllDeclarations();
  return all.find(
    d =>
      d.franchiseId === franchiseId &&
      d.type === 'franchise-tag' &&
      d.status !== 'rejected' &&
      d.status !== 'expired' &&
      d.submittedAt.startsWith(String(leagueYear)),
  );
}

/**
 * Get all active franchise tags for a given league year (all teams).
 * Used for the franchise tags listing page.
 */
export async function getFranchiseTagsByYear(leagueYear: number): Promise<ContractDeclaration[]> {
  const all = await readAllDeclarations();
  return all.filter(
    d =>
      d.type === 'franchise-tag' &&
      d.status !== 'rejected' &&
      d.status !== 'expired' &&
      d.submittedAt.startsWith(String(leagueYear)),
  );
}

/**
 * Check if a team has already used their extension for a given league year.
 * Returns the existing extension declaration if found.
 */
export async function getTeamExtension(
  franchiseId: string,
  leagueYear: number,
): Promise<ContractDeclaration | undefined> {
  const all = await readAllDeclarations();
  return all.find(
    d =>
      d.franchiseId === franchiseId &&
      (d.type === 'veteran-extension' || d.type === 'rookie-extension' || d.type === 'team-option') &&
      d.status !== 'rejected' &&
      d.status !== 'expired' &&
      d.submittedAt.startsWith(String(leagueYear)),
  );
}

/**
 * Get pending declaration for a specific player (to support optimistic UI).
 * Returns the most recent non-rejected declaration for this player.
 */
export async function getPendingDeclarationForPlayer(
  playerId: string,
  franchiseId: string,
): Promise<ContractDeclaration | undefined> {
  const all = await readAllDeclarations();
  return all.find(
    d =>
      d.playerId === playerId &&
      d.franchiseId === franchiseId &&
      (d.status === 'pending' || d.status === 'approved'),
  );
}

