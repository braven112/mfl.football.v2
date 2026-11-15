/**
 * Server half of a franchise tag declaration (Brandon, 2026-11-15).
 *
 * A tag is QUEUED from Feb 1 to Feb 14 at 8:45pm PT and written to MFL on
 * Feb 15 by `scripts/apply-pending-contracts.mjs`, which writes whatever the
 * declaration says. So the declaration must carry the server's own terms,
 * never the browser's: this re-reads the contract from the live MFL roster,
 * checks the Constitution's tag rules and prices the tag itself.
 *
 * Constitution § PLAYER TAGS: one tag per team, on a player whose contract
 * has expired (his final year now); salary = the greater of the top-3 average
 * at his position and +20%; a 1-year contract.
 */
import { getCurrentLeagueYear } from './league-year';
import { calculateFranchiseTag } from './salary-calculations';
import { loadExtensionSalaryAverages } from './veteran-extension-server';
import { getCachedRosters } from './mfl-roster-cache';
import { getPlayerMap, preloadPlayerIdentity } from './player-map';
import { getTeamFranchiseTag } from './contract-storage';
import { isFranchiseTagOpen, nextFranchiseTagWindow } from './franchise-tag-window.mjs';

/** MFL's contract-info letter for a tagged player. */
export const FRANCHISE_TAG_CONTRACT_INFO = 'F';

/** Contract states a tag never applies to: already tagged, or a rookie deal. */
const NOT_TAGGABLE = new Set(['F', 'RC', 'TO']);

export type FranchiseTagCheck =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      currentYears: number;
      currentSalary: number;
      currentContractInfo: string;
      newSalary: number;
      newYears: number;
    };

export async function checkFranchiseTagOnServer(input: {
  leagueId: string;
  franchiseId: string;
  playerId: string;
  now?: Date;
}): Promise<FranchiseTagCheck> {
  const { leagueId, franchiseId, playerId } = input;
  const now = input.now ?? new Date();
  const refuse = (error: string, status = 400): FranchiseTagCheck => ({ ok: false, status, error });

  if (!isFranchiseTagOpen(now)) {
    const { opens } = nextFranchiseTagWindow(now);
    return refuse(
      `Franchise tags can be submitted Feb 1 to Feb 14 at 8:45 PM PT. The next window opens Feb 1, ${opens.getUTCFullYear()}.`,
    );
  }

  const leagueYear = getCurrentLeagueYear(now);
  const rosters = await getCachedRosters(String(leagueYear), leagueId);
  if (!rosters) return refuse('Could not read the live roster from MFL. Try again in a minute.', 503);
  const entry = rosters[String(playerId)];
  if (!entry || entry.franchiseId !== franchiseId) return refuse('That player is not on your roster.', 403);

  const currentYears = parseInt(entry.contractYear, 10) || 0;
  const currentContractInfo = String(entry.contractInfo ?? '').toUpperCase();
  if (currentYears !== 1) return refuse('Only a player in the last year of his contract can be tagged.');
  if (NOT_TAGGABLE.has(currentContractInfo)) {
    return refuse(currentContractInfo === 'F' ? 'That player is already tagged.' : 'A rookie contract cannot be tagged.');
  }

  const used = await getTeamFranchiseTag(franchiseId, now.getUTCFullYear());
  if (used && !(used.playerId === String(playerId) && used.status === 'pending')) {
    return refuse('Your team has already used its franchise tag this year.');
  }

  await preloadPlayerIdentity([leagueYear]).catch(() => undefined);
  const position = getPlayerMap(leagueYear).get(String(playerId))?.position;
  if (!position) return refuse('Could not find that player’s position.', 503);

  const averages = await loadExtensionSalaryAverages(leagueYear);
  if (!averages?.positions?.[position]) {
    return refuse('Salary averages are unavailable, so the tag cannot be priced.', 503);
  }

  const currentSalary = Number(entry.salary) || 0;
  const { newSalary, newYears } = calculateFranchiseTag(currentSalary, position, averages);
  return { ok: true, currentYears, currentSalary, currentContractInfo, newSalary, newYears };
}
