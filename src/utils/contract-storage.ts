/**
 * Contract Declaration Storage
 *
 * Reads and writes contract declarations to a JSON file.
 * Follows the existing codebase pattern of JSON file caching in data/theleague/.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ContractDeclaration, DeclarationStatus } from '../types/contracts';

const DECLARATIONS_PATH = join(
  process.cwd(),
  'data/theleague/contract-declarations.json',
);

interface DeclarationsFile {
  version: string;
  lastUpdated: string;
  declarations: ContractDeclaration[];
}

function ensureDirectoryExists(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readDeclarationsFile(): DeclarationsFile {
  try {
    const data = readFileSync(DECLARATIONS_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      declarations: [],
    };
  }
}

function writeDeclarationsFile(file: DeclarationsFile): void {
  ensureDirectoryExists(DECLARATIONS_PATH);
  file.lastUpdated = new Date().toISOString();
  writeFileSync(DECLARATIONS_PATH, JSON.stringify(file, null, 2), 'utf-8');
}

/** Generate a unique declaration ID */
export function generateDeclarationId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `DECL_${timestamp}_${random}`;
}

/** Get all declarations */
export function getDeclarations(): ContractDeclaration[] {
  return readDeclarationsFile().declarations;
}

/** Get declarations filtered by status */
export function getDeclarationsByStatus(status: DeclarationStatus): ContractDeclaration[] {
  return getDeclarations().filter(d => d.status === status);
}

/** Get pending declarations (for commissioner dashboard) */
export function getPendingDeclarations(): ContractDeclaration[] {
  return getDeclarationsByStatus('pending');
}

/** Get declarations for a specific franchise */
export function getDeclarationsByFranchise(franchiseId: string): ContractDeclaration[] {
  return getDeclarations().filter(d => d.franchiseId === franchiseId);
}

/** Get a single declaration by ID */
export function getDeclarationById(id: string): ContractDeclaration | undefined {
  return getDeclarations().find(d => d.id === id);
}

/** Add a new declaration */
export function addDeclaration(declaration: ContractDeclaration): ContractDeclaration {
  const file = readDeclarationsFile();
  file.declarations.unshift(declaration); // Newest first
  writeDeclarationsFile(file);
  return declaration;
}

/** Update an existing declaration */
export function updateDeclaration(
  id: string,
  updates: Partial<ContractDeclaration>,
): ContractDeclaration | null {
  const file = readDeclarationsFile();
  const index = file.declarations.findIndex(d => d.id === id);
  if (index === -1) return null;

  file.declarations[index] = { ...file.declarations[index], ...updates };
  writeDeclarationsFile(file);
  return file.declarations[index];
}

/**
 * Check if a team has already used their franchise tag for a given league year.
 * Returns the existing tag declaration if found.
 */
export function getTeamFranchiseTag(
  franchiseId: string,
  leagueYear: number,
): ContractDeclaration | undefined {
  return getDeclarations().find(
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
export function getFranchiseTagsByYear(leagueYear: number): ContractDeclaration[] {
  return getDeclarations().filter(
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
export function getTeamExtension(
  franchiseId: string,
  leagueYear: number,
): ContractDeclaration | undefined {
  return getDeclarations().find(
    d =>
      d.franchiseId === franchiseId &&
      (d.type === 'veteran-extension' || d.type === 'rookie-extension') &&
      d.status !== 'rejected' &&
      d.status !== 'expired' &&
      d.submittedAt.startsWith(String(leagueYear)),
  );
}

/**
 * Get pending declaration for a specific player (to support optimistic UI).
 * Returns the most recent non-rejected declaration for this player.
 */
export function getPendingDeclarationForPlayer(
  playerId: string,
  franchiseId: string,
): ContractDeclaration | undefined {
  return getDeclarations().find(
    d =>
      d.playerId === playerId &&
      d.franchiseId === franchiseId &&
      (d.status === 'pending' || d.status === 'approved'),
  );
}
