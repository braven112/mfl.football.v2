/**
 * Contract Eligibility Engine
 *
 * Derives contract declaration eligibility from MFL transaction data.
 * Determines which players can have their contracts modified, what types
 * of modifications are available, and when deadlines expire.
 */

import { getContractWindow } from './contract-validation';
import type {
  DeclarationType,
  EligibilityResult,
  TransactionRecord,
  MFLRawTransaction,
  RosterPlayer,
  MFLPlayerInfo,
  DraftPick,
  TeamEligibilityResult,
} from '../types/contract-eligibility';

// Deadline durations in milliseconds
const IN_SEASON_DEADLINE_MS = 24 * 60 * 60 * 1000;  // 24 hours
const OFFSEASON_DEADLINE_MS = 48 * 60 * 60 * 1000;   // 48 hours

// Transaction types that represent new player acquisitions (not trades)
const ACQUISITION_TYPES = ['BBID_WAIVER', 'FREE_AGENT', 'AUCTION_WON'];

/**
 * Parse the MFL transaction string format into added/dropped player IDs.
 *
 * MFL formats:
 *   "|playerId,"          -> drop only
 *   "addId|dropId,"       -> add/drop swap
 *   "addId|,"             -> add only (no drop)
 *   "addId,|bbid|dropId," -> BBID add/drop with bid amount
 *   "playerId|amount|"    -> auction won (AUCTION_WON)
 *   ""                    -> empty (batch marker like BBID_AUTO_PROCESS_WAIVERS)
 */
export function parseTransactionString(txnString: string): {
  addedPlayerIds: string[];
  droppedPlayerIds: string[];
  bbidAmount?: number;
} {
  const addedPlayerIds: string[] = [];
  const droppedPlayerIds: string[] = [];
  let bbidAmount: number | undefined;

  if (!txnString || txnString.trim() === '') {
    return { addedPlayerIds, droppedPlayerIds };
  }

  // BBID format: "addId,|bbidAmount|dropId,"
  const bbidMatch = txnString.match(/^(\d+),\|(\d+)\|(\d+),$/);
  if (bbidMatch) {
    addedPlayerIds.push(bbidMatch[1]);
    bbidAmount = parseInt(bbidMatch[2], 10);
    droppedPlayerIds.push(bbidMatch[3]);
    return { addedPlayerIds, droppedPlayerIds, bbidAmount };
  }

  // BBID add-only: "addId,|bbidAmount|,"
  const bbidAddOnlyMatch = txnString.match(/^(\d+),\|(\d+)\|,$/);
  if (bbidAddOnlyMatch) {
    addedPlayerIds.push(bbidAddOnlyMatch[1]);
    bbidAmount = parseInt(bbidAddOnlyMatch[2], 10);
    return { addedPlayerIds, droppedPlayerIds, bbidAmount };
  }

  // Drop-only: "|playerId,"
  if (txnString.startsWith('|')) {
    const dropIds = txnString.split('|').filter(s => s.replace(',', '').trim());
    for (const id of dropIds) {
      const cleanId = id.replace(',', '').trim();
      if (cleanId && /^\d+$/.test(cleanId)) {
        droppedPlayerIds.push(cleanId);
      }
    }
    return { addedPlayerIds, droppedPlayerIds };
  }

  // Auction format: "playerId|amount|" (no commas, trailing pipe)
  const auctionMatch = txnString.match(/^(\d+)\|(\d+)\|$/);
  if (auctionMatch) {
    addedPlayerIds.push(auctionMatch[1]);
    bbidAmount = parseInt(auctionMatch[2], 10);
    return { addedPlayerIds, droppedPlayerIds, bbidAmount };
  }

  // Add/drop swap: "addId|dropId," or "addId|,"
  const parts = txnString.split('|');
  if (parts.length === 2) {
    const addId = parts[0].replace(',', '').trim();
    const dropId = parts[1].replace(',', '').trim();
    if (addId && /^\d+$/.test(addId)) addedPlayerIds.push(addId);
    if (dropId && /^\d+$/.test(dropId)) droppedPlayerIds.push(dropId);
  }

  return { addedPlayerIds, droppedPlayerIds, bbidAmount };
}

/**
 * Parse raw MFL transaction data into normalized TransactionRecord array.
 * Filters to only include acquisition types (BBID, FREE_AGENT) that have adds.
 * Excludes trades and empty batch markers.
 */
export function parseTransactions(
  rawTransactions: MFLRawTransaction[],
): TransactionRecord[] {
  const records: TransactionRecord[] = [];

  for (const raw of rawTransactions) {
    // Skip trades -- they don't trigger contract declarations
    if (raw.type === 'TRADE') continue;

    // Skip empty batch markers (BBID_AUTO_PROCESS_WAIVERS with empty transaction)
    if (!raw.transaction || raw.transaction.trim() === '') continue;

    // Skip non-acquisition types
    if (!ACQUISITION_TYPES.includes(raw.type)) continue;

    const { addedPlayerIds, droppedPlayerIds, bbidAmount } = parseTransactionString(raw.transaction);

    // Only include transactions that actually add a player
    if (addedPlayerIds.length === 0) continue;

    records.push({
      type: raw.type,
      franchise: raw.franchise,
      timestamp: parseInt(raw.timestamp, 10),
      addedPlayerIds,
      droppedPlayerIds,
      bbidAmount,
    });
  }

  return records;
}

/**
 * Find the most recent acquisition transaction for a player on a specific franchise.
 * Returns null if the player wasn't acquired via BBID/auction (e.g., via trade or draft).
 */
export function findAcquisitionTransaction(
  playerId: string,
  franchiseId: string,
  transactions: TransactionRecord[],
): TransactionRecord | null {
  // Search newest first (transactions are typically sorted newest-first)
  for (const txn of transactions) {
    if (txn.franchise === franchiseId && txn.addedPlayerIds.includes(playerId)) {
      return txn;
    }
  }
  return null;
}

/**
 * Calculate the declaration deadline timestamp for a player acquisition.
 */
export function calculateDeadline(
  acquisitionTimestamp: number,
  now: Date = new Date(),
): number {
  const window = getContractWindow(now);
  const durationMs = window.windowType === 'in-season'
    ? IN_SEASON_DEADLINE_MS
    : OFFSEASON_DEADLINE_MS;

  // Deadline = acquisition time + duration
  return (acquisitionTimestamp * 1000) + durationMs;
}

/**
 * Check if a player has RC (Rookie Contract) status.
 * RC is the only rookie designation going forward (R1 is retired).
 */
export function isRookieContractStatus(contractInfo: string): boolean {
  return contractInfo === 'RC';
}

/**
 * Check if a player is a rookie according to MFL data.
 * Requires BOTH our RC designation AND MFL's rookie status.
 */
export function isMFLRookie(
  player: MFLPlayerInfo | undefined,
  currentYear: number,
): boolean {
  if (!player) return false;
  return player.status === 'R' || player.draft_year === String(currentYear);
}

/**
 * Calculate the 3rd Sunday in August for a given year at 8:45 PM PT.
 * Used as the rookie contract override deadline (cutdown date).
 */
function getAugustCutdownDate(year: number): Date {
  const august1 = new Date(year, 7, 1); // August is month 7
  const dayOfWeek = august1.getDay();
  const daysToFirstSunday = (7 - dayOfWeek) % 7 || 7;
  const thirdSunday = new Date(year, 7, 1 + daysToFirstSunday + 14);
  thirdSunday.setHours(20, 45, 0, 0); // 8:45 PM PT
  return thirdSunday;
}

/** Salary averages used for franchise tag, extension, and team option calculations */
export interface SalaryAverages {
  franchiseSalaries?: Record<string, number>;
  extensionSalaries?: Record<string, number>;
  /** Top-10 positional averages — used for 1st-round team option salary */
  teamOptionSalaries?: Record<string, number>;
}

/**
 * Get the eligibility result for a single player.
 *
 * Checks all possible declaration types in priority order:
 * 1. New acquisition (BBID/auction within deadline)
 * 2. Rookie override (RC player before August cutdown)
 * 3. Team option (TO player before Year 4 begins)
 * 4. Franchise tag (1 year remaining, offseason, excluding RC/TO)
 * 5. Veteran extension (2+ years, not RC, not TO)
 * 6. Rookie extension (RC player with 2+ years, offseason)
 *
 * @param salaryAverages - Frozen position salary averages for tag/extension calculations
 */
export function getPlayerEligibility(
  playerId: string,
  franchiseId: string,
  rosterPlayer: RosterPlayer,
  transactions: TransactionRecord[],
  playerInfo: MFLPlayerInfo | undefined,
  currentYear: number,
  now: Date = new Date(),
  salaryAverages?: SalaryAverages,
): EligibilityResult {
  const currentYears = parseInt(rosterPlayer.contractYear, 10) || 1;
  const currentSalary = parseFloat(rosterPlayer.salary) || 0;
  const contractInfo = rosterPlayer.contractInfo || '';
  const isRC = isRookieContractStatus(contractInfo);

  const base: EligibilityResult = {
    playerId,
    franchiseId,
    eligible: false,
    declarationType: null,
    currentYears,
    currentSalary,
    contractInfo,
    isRookieContract: isRC,
  };

  const window = getContractWindow(now);

  // 1. Check for new acquisition within deadline
  const acquisition = findAcquisitionTransaction(playerId, franchiseId, transactions);
  if (acquisition) {
    const deadlineMs = calculateDeadline(acquisition.timestamp, now);
    const nowMs = now.getTime();
    const isExpired = nowMs > deadlineMs;

    // If still within deadline, player can declare (regardless of current contract years)
    if (!isExpired && !isRC) {
      return {
        ...base,
        eligible: true,
        declarationType: 'new-acquisition',
        acquisitionTimestamp: acquisition.timestamp,
        deadlineTimestamp: Math.floor(deadlineMs / 1000),
        isExpired: false,
        yearOptions: [1, 2, 3, 4, 5],
      };
    }
  }

  // 2. Check for rookie override (RC or TO player before August cutdown)
  // Rookies drafted in our league this year — including 1st-rounders who carry
  // the TO (Team Option) tag — can adjust their initial contract length until
  // the 3rd Sunday in August. All rookies may declare 1–4 years so an owner
  // can always revert to the default 4-year deal even after a prior override.
  const isFirstRoundRookieTag = contractInfo === 'TO';
  if ((isRC || isFirstRoundRookieTag) && isMFLRookie(playerInfo, currentYear)) {
    const cutdownDate = getAugustCutdownDate(now.getFullYear());
    if (now < cutdownDate && window.windowType === 'offseason') {
      return {
        ...base,
        eligible: true,
        declarationType: 'rookie-override',
        deadlineTimestamp: Math.floor(cutdownDate.getTime() / 1000),
        isExpired: false,
        yearOptions: [1, 2, 3, 4],
      };
    }
  }

  // 3. Check for team option (TO player before Year 4 begins)
  // Team options are intentionally available outside the generic contract window
  // because owners need to plan ahead and the league rule is tied to contract state,
  // not the current month.
  if (contractInfo === 'TO' && currentYears >= 2) {
    const position = (playerInfo?.position ?? '').toUpperCase();
    const teamOptionSalary = salaryAverages?.teamOptionSalaries?.[position] ?? 0;
    const extensionSalary = Math.round(currentSalary * Math.pow(1.10, currentYears));
    const extensionYears = currentYears + 2;
    return {
      ...base,
      eligible: true,
      declarationType: 'team-option',
      teamOptionSalary,
      extensionSalary,
      extensionYears,
    };
  }

  // The remaining types require an active contract window
  if (!window.inWindow) return base;

  // 4. Check for franchise tag eligibility (1 year remaining, offseason only)
  if (
    currentYears === 1 &&
    window.windowType === 'offseason' &&
    contractInfo !== 'F' &&
    !isRC &&
    contractInfo !== 'TO'
  ) {
    const position = (playerInfo?.position ?? '').toUpperCase();
    const top3Avg = salaryAverages?.franchiseSalaries?.[position] ?? 0;
    const increased = currentSalary * 1.2;
    const tagSalary = Math.round(Math.max(increased, top3Avg));
    const tagBasis: 'top 3 average' | '20% increase' = top3Avg > increased ? 'top 3 average' : '20% increase';
    return {
      ...base,
      eligible: true,
      declarationType: 'franchise-tag',
      tagSalary,
      tagBasis,
    };
  }

  // 5. Check for veteran extension (2+ years, NOT RC, NOT TO)
  // TO players are handled above in check #3; exclude them here to prevent fallthrough
  if (currentYears >= 2 && !isRC && contractInfo !== 'TO' && window.windowType === 'offseason') {
    // Extension salary = currentSalary escalated to the extension point (10% per current year)
    const extensionSalary = Math.round(currentSalary * Math.pow(1.10, currentYears));
    const extensionYears = currentYears + 2;
    return {
      ...base,
      eligible: true,
      declarationType: 'veteran-extension',
      extensionSalary,
      extensionYears,
    };
  }

  // 6. Check for rookie extension (RC player with 2+ years, offseason)
  // TO players are handled above so the action-select flow can present the option decision.
  if (isRC && currentYears >= 2 && window.windowType === 'offseason') {
    const extensionSalary = Math.round(currentSalary * Math.pow(1.10, currentYears));
    const extensionYears = currentYears + 2;
    return {
      ...base,
      eligible: true,
      declarationType: 'rookie-extension',
      extensionSalary,
      extensionYears,
    };
  }

  return base;
}

/**
 * Get eligibility results for all players on a team's roster.
 *
 * @param salaryAverages - Frozen position salary averages for tag/extension calculations
 */
export function getTeamEligibility(
  franchiseId: string,
  rosterPlayers: RosterPlayer[],
  rawTransactions: MFLRawTransaction[],
  playersMap: Map<string, MFLPlayerInfo>,
  currentYear: number,
  now: Date = new Date(),
  salaryAverages?: SalaryAverages,
): TeamEligibilityResult {
  const transactions = parseTransactions(rawTransactions);

  const players = rosterPlayers.map(rp =>
    getPlayerEligibility(
      rp.id,
      franchiseId,
      rp,
      transactions,
      playersMap.get(rp.id),
      currentYear,
      now,
      salaryAverages,
    ),
  );

  const eligible = players.filter(p => p.eligible);
  const fourHoursMs = 4 * 60 * 60 * 1000;
  const nowMs = now.getTime();
  const urgent = eligible.filter(
    p => p.deadlineTimestamp && (p.deadlineTimestamp * 1000 - nowMs) < fourHoursMs,
  );

  return {
    franchiseId,
    players,
    eligibleCount: eligible.length,
    urgentCount: urgent.length,
  };
}
