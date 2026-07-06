/**
 * Tag-window hero data — expiring-contract stars.
 *
 * The tag/extension window (champion crowned → Feb 14) is when owners decide
 * whether to franchise-tag or extend the players about to walk. The tag-worthy
 * face of that window is a STAR entering the final year of his contract
 * (`contractYear === '4'`): the exact player an owner has to make a call on.
 *
 * Reads the MFL rosters feed on disk (same feed the cut-watch / kickoff data
 * uses) and returns final-year rostered players sorted by salary DESC — the
 * priciest expiring contracts lead, because those are the ones the tag math
 * actually bites on.
 */

import fs from 'node:fs';
import path from 'node:path';

/** A rostered player entering the final year of his contract. */
export interface ExpiringContractStar {
  playerId: string;
  franchiseId: string;
  salary: number;
}

function readJsonFile(relativePath: string): any {
  try {
    const filePath = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Pure parse of a rosters feed → final-year (`contractYear === '4'`) rostered
 * players, sorted by salary DESC. Exported so tests can drive it with fixtures
 * (the on-disk feed is cron-regenerated and can't anchor assertions).
 *
 * Handles MFL's single-vs-array shape on both `franchise` and `player`.
 */
export function parseExpiringContractStars(rosterData: any): ExpiringContractStar[] {
  const franchises = rosterData?.rosters?.franchise;
  if (!franchises) return [];

  const stars: ExpiringContractStar[] = [];
  for (const franchise of Array.isArray(franchises) ? franchises : [franchises]) {
    const players = Array.isArray(franchise.player)
      ? franchise.player
      : franchise.player
        ? [franchise.player]
        : [];
    for (const p of players) {
      if (!p?.id || p.status !== 'ROSTER' || p.contractYear !== '4') continue;
      stars.push({
        playerId: p.id,
        franchiseId: franchise.id,
        salary: parseFloat(p.salary || '0') || 0,
      });
    }
  }

  return stars.sort((a, b) => b.salary - a.salary);
}

/**
 * Final-year rostered players for the given league year, priciest first.
 * Reads `data/theleague/mfl-feeds/{year}/rosters.json`.
 */
export function getExpiringContractStars(leagueYear: number): ExpiringContractStar[] {
  const rosterData = readJsonFile(`data/theleague/mfl-feeds/${leagueYear}/rosters.json`);
  return parseExpiringContractStars(rosterData);
}
