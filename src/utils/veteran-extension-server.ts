/**
 * Server half of the Veteran Extension rule: loads the facts the pure rule
 * in `veteran-extension-rules.ts` needs, from sources the browser cannot
 * touch — the live MFL roster, the players feed for the position, the frozen
 * salary averages and the declaration store.
 *
 * Why the server re-derives everything: the declare endpoint used to take
 * the salary, years and price the browser sent and store them as they came.
 * A veteran extension is now written to MFL without a commissioner looking
 * at it first, so nothing the page sends is trusted except WHICH player and
 * HOW MANY years to add.
 */
import { loadLeagueData } from './league-data';
import { getFrozenSalaryAveragesYear } from './salary-calculations';
import { getCachedRosters } from './mfl-roster-cache';
import { getPlayerMap, preloadPlayerIdentity } from './player-map';
import { getTeamVeteranExtension } from './contract-storage';
import {
  checkVeteranExtensionRequest,
  type VeteranExtensionPlayer,
  type VeteranExtensionRequestResult,
} from './veteran-extension-rules';

/**
 * The salary averages an extension is priced from, in MFL's nested
 * `{ positions: { QB: { top5Average } } }` shape — the same frozen year the
 * Front Office planner prices from (`front-office-planner-data.ts`), so the
 * number the owner confirmed is the number that gets written.
 */
export async function loadExtensionSalaryAverages(leagueYear: number): Promise<any | null> {
  const currentName = `mfl-salary-averages-${leagueYear}.json`;
  const current = await loadLeagueData<any>(`src/data/${currentName}`).catch(() => null);
  const year = getFrozenSalaryAveragesYear({ [currentName]: current }, (d) => d);
  if (year === leagueYear) return current;
  return loadLeagueData<any>(`src/data/mfl-salary-averages-${year}.json`).catch(() => null);
}

export interface VeteranExtensionServerCheck {
  result: VeteranExtensionRequestResult;
  /** The player as the server read him; null when the roster was unreadable. */
  player: (VeteranExtensionPlayer & { franchiseId: string }) | null;
}

/**
 * Everything the endpoint needs to decide one request. Refuses — rather than
 * guessing — when the live roster or the averages cannot be read: an
 * extension written from a stale contract is a wrong contract on MFL.
 */
export async function checkVeteranExtensionOnServer(input: {
  leagueId: string;
  leagueYear: number;
  franchiseId: string;
  playerId: string;
  addedYears: number;
}): Promise<VeteranExtensionServerCheck> {
  const { leagueId, leagueYear, franchiseId, playerId, addedYears } = input;
  const fail = (error: string): VeteranExtensionServerCheck => ({ result: { ok: false, error }, player: null });

  const rosters = await getCachedRosters(String(leagueYear), leagueId);
  if (!rosters) return fail('Could not read the live roster from MFL. Try again in a minute.');
  const entry = rosters[String(playerId)];
  if (!entry || entry.franchiseId !== franchiseId) return fail('That player is not on your roster.');

  await preloadPlayerIdentity([leagueYear]).catch(() => undefined);
  const identity = getPlayerMap(leagueYear).get(String(playerId));
  if (!identity?.position) return fail('Could not find that player’s position.');

  const salaryAverages = await loadExtensionSalaryAverages(leagueYear);
  if (!salaryAverages?.positions) return fail('Salary averages are unavailable, so the extension cannot be priced.');

  const player = {
    franchiseId,
    contractYears: parseInt(entry.contractYear, 10) || 0,
    contractInfo: entry.contractInfo ?? '',
    salary: Number(entry.salary) || 0,
    position: identity.position,
  };

  const used = await getTeamVeteranExtension(franchiseId, leagueYear);
  // A pending request for THIS player is a change of mind, not a second
  // extension. Once it is applied the slot is spent, for that player too — the live
  // roster already shows the extended contract, so re-filing would extend
  // the extension.
  const sameAndOpen = used && used.playerId === String(playerId) && used.status === 'pending';
  const teamAlreadyUsed = used && !sameAndOpen ? { playerName: used.playerName } : null;

  return {
    result: checkVeteranExtensionRequest({ player, addedYears, leagueYear, salaryAverages, teamAlreadyUsed }),
    player,
  };
}
