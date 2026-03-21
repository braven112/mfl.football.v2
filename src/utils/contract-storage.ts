/**
 * Contract Declaration Storage
 *
 * Stores contract declarations in Upstash Redis (production/Vercel)
 * with filesystem fallback for local development.
 * Follows the same pattern as custom-rankings-storage / cr.ts.
 */

import type { ContractDeclaration, DeclarationStatus } from '../types/contracts';

const REDIS_KEY = 'contract-declarations';

type RedisClient = {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown) => Promise<unknown>;
};

let _redis: RedisClient | null | undefined;

async function getRedis(): Promise<RedisClient | null> {
  if (_redis !== undefined) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    _redis = null;
    return null;
  }

  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token });
    return _redis;
  } catch {
    _redis = null;
    return null;
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

async function readAllDeclarations(): Promise<ContractDeclaration[]> {
  const redis = await getRedis();
  if (redis) {
    const data = await redis.get<ContractDeclaration[]>(REDIS_KEY);
    return data ?? [];
  }
  return readDeclarationsFileSync().declarations;
}

async function writeAllDeclarations(declarations: ContractDeclaration[]): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    await redis.set(REDIS_KEY, declarations);
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
  const all = await readAllDeclarations();
  return all.find(d => d.id === id);
}

/** Add a new declaration */
export async function addDeclaration(declaration: ContractDeclaration): Promise<ContractDeclaration> {
  const all = await readAllDeclarations();
  all.unshift(declaration); // Newest first
  await writeAllDeclarations(all);
  return declaration;
}

/** Update an existing declaration */
export async function updateDeclaration(
  id: string,
  updates: Partial<ContractDeclaration>,
): Promise<ContractDeclaration | null> {
  const all = await readAllDeclarations();
  const index = all.findIndex(d => d.id === id);
  if (index === -1) return null;

  all[index] = { ...all[index], ...updates };
  await writeAllDeclarations(all);
  return all[index];
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
