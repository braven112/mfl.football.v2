/**
 * MFL Contract Writer
 *
 * Writes contract changes to MFL via the import?TYPE=salaries endpoint.
 * Includes pre-write backup, retry logic, and audit logging.
 *
 * CRITICAL: Always use APPEND=1 to prevent erasing all league salary data.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { mflFetch } from './mfl-fetch';

// Reads use api.myfantasyleague.com; writes go through mflFetch which handles redirects
const MFL_READ_HOST = process.env.MFL_HOST || 'https://api.myfantasyleague.com';
const MFL_LEAGUE_ID = process.env.MFL_LEAGUE_ID || '13522';

const BACKUP_DIR = join(process.cwd(), 'data/theleague/contract-backups');
const MAX_BACKUP_AGE_DAYS = 30;

export interface ContractWriteParams {
  playerId: string;
  salary: string;
  contractYear: string;
  contractInfo: string;
  /** The authenticated user's MFL_USER_ID cookie value */
  mflUserCookie: string;
  /** The authenticated user's MFL_IS_COMMISH cookie value (required for commissioner writes) */
  mflCommishCookie?: string;
}

export interface ContractWriteResult {
  success: boolean;
  error?: string;
  backupFile?: string;
  attempts: number;
}

interface MFLSalaryExport {
  salaries: {
    leagueUnit: {
      unit: string;
      player: Array<{
        id: string;
        salary: string;
        contractYear: string;
        contractInfo: string;
      }>;
    };
  };
}

function getYear(): string {
  return new Date().getFullYear().toString();
}

function ensureBackupDir(): void {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

/**
 * Export current salary data from MFL as a pre-write backup.
 * Returns the backup file path on success, null on failure.
 */
export async function createPreWriteBackup(mflUserCookie: string): Promise<string | null> {
  if (!mflUserCookie) {
    console.error('No MFL user cookie provided, skipping backup');
    return null;
  }

  try {
    const year = getYear();
    const url = `${MFL_READ_HOST}/${year}/export?TYPE=salaries&L=${MFL_LEAGUE_ID}&JSON=1`;

    const response = await mflFetch({
      url,
      method: 'GET',
      mflUserCookie,
    });

    if (!response.ok) {
      console.error(`Backup fetch failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}-pre-write.json`;
    const filepath = join(BACKUP_DIR, filename);

    writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
    return filepath;
  } catch (error) {
    console.error('Failed to create pre-write backup:', error);
    return null;
  }
}

/**
 * Remove backup files older than MAX_BACKUP_AGE_DAYS.
 */
export function pruneOldBackups(): number {
  if (!existsSync(BACKUP_DIR)) return 0;

  const cutoff = Date.now() - MAX_BACKUP_AGE_DAYS * 24 * 60 * 60 * 1000;
  const files = readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json'));
  let removed = 0;

  for (const file of files) {
    // Extract ISO timestamp from filename (e.g., "2026-02-28T10-00-00-000Z-pre-write.json")
    const dateStr = file.replace(/-pre-write\.json$/, '').replace(/-/g, (m, offset) => {
      // Re-convert filename-safe format back to ISO for parsing
      if (offset === 4 || offset === 7) return '-'; // year-month-day separators
      if (offset === 13) return ':'; // hour:minute
      if (offset === 16) return ':'; // minute:second
      if (offset === 19) return '.'; // second.ms
      return m;
    });
    const fileDate = new Date(dateStr).getTime();

    if (fileDate && fileDate < cutoff) {
      try {
        unlinkSync(join(BACKUP_DIR, file));
        removed++;
      } catch {
        // Skip files we can't delete
      }
    }
  }

  return removed;
}

/**
 * Build the XML payload for MFL import?TYPE=salaries.
 *
 * CRITICAL: Always includes ALL current field values to prevent blanking.
 */
function buildSalaryXML(params: ContractWriteParams): string {
  const { playerId, salary, contractYear, contractInfo } = params;
  return (
    '<salaries><leagueUnit unit="LEAGUE">' +
    `<player id="${playerId}" salary="${salary}" contractYear="${contractYear}" contractInfo="${contractInfo}" />` +
    '</leagueUnit></salaries>'
  );
}

/**
 * Write a single player's contract data to MFL.
 * Includes pre-write backup and retry with exponential backoff.
 */
export async function writeContractToMFL(
  params: ContractWriteParams,
): Promise<ContractWriteResult> {
  const { mflUserCookie, mflCommishCookie } = params;

  if (!mflUserCookie) {
    return {
      success: false,
      error: 'No MFL user cookie — please log out and log back in',
      attempts: 0,
    };
  }

  // Create pre-write backup
  const backupFile = await createPreWriteBackup(mflUserCookie);

  const year = getYear();
  // Use api host — mflFetch handles the redirect to www49 and preserves cookies
  const url = `${MFL_READ_HOST}/${year}/import?TYPE=salaries&L=${MFL_LEAGUE_ID}&APPEND=1`;
  const xmlData = buildSalaryXML(params);
  const body = new URLSearchParams({ DATA: xmlData }).toString();

  const delays = [1000, 3000, 9000]; // Exponential backoff: 1s, 3s, 9s
  let lastError = '';

  for (let attempt = 0; attempt < delays.length; attempt++) {
    try {
      const response = await mflFetch({
        url,
        method: 'POST',
        mflUserCookie,
        mflCommishCookie,
        body,
      });

      const text = await response.text();

      if (response.ok) {
        // MFL returns XML; check for error indicators
        if (text.includes('error') || text.includes('Error')) {
          lastError = `MFL returned error response: ${text.slice(0, 200)}`;
          console.error(`MFL write attempt ${attempt + 1} failed:`, lastError);
        } else {
          return {
            success: true,
            backupFile: backupFile || undefined,
            attempts: attempt + 1,
          };
        }
      } else {
        lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
        console.error(`MFL write attempt ${attempt + 1} failed:`, lastError);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`MFL write attempt ${attempt + 1} error:`, lastError);
    }

    // Wait before retrying (skip wait after last attempt)
    if (attempt < delays.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    }
  }

  return {
    success: false,
    error: `Failed after ${delays.length} attempts: ${lastError}`,
    backupFile: backupFile || undefined,
    attempts: delays.length,
  };
}

/**
 * Write multiple players' contract data in a single MFL call.
 * More efficient than individual calls when updating several players at once.
 */
export async function writeMultipleContractsToMFL(
  players: ContractWriteParams[],
): Promise<ContractWriteResult> {
  if (players.length === 0) {
    return { success: true, attempts: 0 };
  }

  // Use cookies from the first player entry (all should share the same auth)
  const { mflUserCookie, mflCommishCookie } = players[0];

  if (!mflUserCookie) {
    return {
      success: false,
      error: 'No MFL user cookie — please log out and log back in',
      attempts: 0,
    };
  }

  const backupFile = await createPreWriteBackup(mflUserCookie);

  const year = getYear();
  const url = `${MFL_READ_HOST}/${year}/import?TYPE=salaries&L=${MFL_LEAGUE_ID}&APPEND=1`;

  const playerXml = players
    .map(
      p =>
        `<player id="${p.playerId}" salary="${p.salary}" contractYear="${p.contractYear}" contractInfo="${p.contractInfo}" />`,
    )
    .join('');
  const xmlData = `<salaries><leagueUnit unit="LEAGUE">${playerXml}</leagueUnit></salaries>`;
  const body = new URLSearchParams({ DATA: xmlData }).toString();

  const delays = [1000, 3000, 9000];
  let lastError = '';

  for (let attempt = 0; attempt < delays.length; attempt++) {
    try {
      const response = await mflFetch({
        url,
        method: 'POST',
        mflUserCookie,
        mflCommishCookie,
        body,
      });

      const text = await response.text();

      if (response.ok) {
        if (text.includes('error') || text.includes('Error')) {
          lastError = `MFL returned error response: ${text.slice(0, 200)}`;
          console.error(`MFL batch write attempt ${attempt + 1} failed:`, lastError);
        } else {
          return {
            success: true,
            backupFile: backupFile || undefined,
            attempts: attempt + 1,
          };
        }
      } else {
        lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
        console.error(`MFL batch write attempt ${attempt + 1} failed:`, lastError);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`MFL batch write attempt ${attempt + 1} error:`, lastError);
    }

    if (attempt < delays.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    }
  }

  return {
    success: false,
    error: `Failed after ${delays.length} attempts: ${lastError}`,
    backupFile: backupFile || undefined,
    attempts: delays.length,
  };
}

/**
 * Restore salary data from a backup file.
 * Reads the backup and writes each player's data back to MFL.
 */
export async function restoreFromBackup(
  backupFilePath: string,
  mflUserCookie: string,
  mflCommishCookie?: string,
): Promise<ContractWriteResult> {
  try {
    const data = JSON.parse(readFileSync(backupFilePath, 'utf-8')) as MFLSalaryExport;
    const players = data.salaries?.leagueUnit?.player;

    if (!players || players.length === 0) {
      return { success: false, error: 'No player data found in backup', attempts: 0 };
    }

    const params: ContractWriteParams[] = players.map(p => ({
      playerId: p.id,
      salary: p.salary,
      contractYear: p.contractYear,
      contractInfo: p.contractInfo,
      mflUserCookie,
      mflCommishCookie,
    }));

    return writeMultipleContractsToMFL(params);
  } catch (error) {
    return {
      success: false,
      error: `Failed to read backup: ${error instanceof Error ? error.message : String(error)}`,
      attempts: 0,
    };
  }
}
