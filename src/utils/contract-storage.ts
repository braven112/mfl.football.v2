/**
 * Contract Declaration Storage
 *
 * Stores contract declarations in Vercel Blob (production/preview)
 * with filesystem fallback for local development.
 */

import type { ContractDeclaration, DeclarationStatus } from '../types/contracts';

const BLOB_PATH = 'data/contract-declarations.json';

// --- Vercel Blob helpers ---

async function readFromBlob(): Promise<ContractDeclaration[] | null> {
  try {
    const { list: listBlobs } = await import('@vercel/blob');
    const { blobs } = await listBlobs({ prefix: BLOB_PATH, limit: 1 });
    if (blobs.length === 0) return [];

    // Use downloadUrl to bypass Vercel Blob CDN caching entirely.
    // The CDN url serves stale data even with cache-busting query params,
    // causing new declarations to not appear on the manage page.
    const fetchUrl = blobs[0].downloadUrl || blobs[0].url;
    const res = await fetch(fetchUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json() as ContractDeclaration[];
    return data;
  } catch (err) {
    console.error('[contract-storage] Blob read error:', err);
    return null;
  }
}

async function writeToBlob(declarations: ContractDeclaration[]): Promise<boolean> {
  try {
    const { put } = await import('@vercel/blob');
    const result = await put(BLOB_PATH, JSON.stringify(declarations), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
    console.log('[contract-storage] Blob write OK:', result.url, '— entries:', declarations.length);
    return true;
  } catch (err) {
    console.error('[contract-storage] Blob write error:', err);
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

async function readAllDeclarations(): Promise<ContractDeclaration[]> {
  if (process.env.VERCEL) {
    const data = await readFromBlob();
    if (data === null) {
      console.error('[contract-storage] readFromBlob returned null — blob read failed');
    }
    return data ?? [];
  }
  return readDeclarationsFileSync().declarations;
}

async function writeAllDeclarations(declarations: ContractDeclaration[]): Promise<void> {
  if (process.env.VERCEL) {
    const ok = await writeToBlob(declarations);
    if (!ok) throw new Error('Failed to write declarations to Vercel Blob');
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
  console.log('[contract-storage] updateDeclaration: read', all.length, 'declarations, looking for', id);
  const index = all.findIndex(d => d.id === id);
  if (index === -1) {
    console.error('[contract-storage] updateDeclaration: declaration not found!', id);
    return null;
  }

  all[index] = { ...all[index], ...updates };
  await writeAllDeclarations(all);
  console.log('[contract-storage] updateDeclaration: wrote updated declaration', id, 'status:', all[index].status);
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
