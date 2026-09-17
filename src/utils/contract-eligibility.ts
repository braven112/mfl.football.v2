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

// Transaction types that represent new player acquisitions (not trades).
// Exported so consumers that must apply the same trade-exclusion rule
// (e.g. august-cut-selection.ts's "last added" ordering) share this list
// instead of re-declaring it.
export const ACQUISITION_TYPES = ['BBID_WAIVER', 'FREE_AGENT', 'AUCTION_WON'];

/**
 * MFL's legacy "nothing was cut" marker in the drop segment of a pre-2017
 * BBID row ("8838|425000|0000"). It is a SENTINEL, not a player: no season of
 * either league has a player with that id, it never appears in a FREE_AGENT
 * row or in any post-2016 shape, and it sits exactly where the modern format
 * writes an empty segment. 276 rows carry it. Read as an id it becomes a
 * dropped player nobody can look up — which in the Schefter scanner resolves
 * to the literal prose "Player 0000", the same placeholder-ships-unread
 * failure as #1156. Shared with scripts/lib/roster-move-parse.mjs.
 */
const NO_DROP_SENTINEL = '0000';

/** Extract numeric player ids from one comma-delimited transaction segment. */
function idsIn(segment: string | undefined): string[] {
  return (segment ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(part => /^\d+$/.test(part) && part !== NO_DROP_SENTINEL);
}

/**
 * Parse the MFL transaction string format into added/dropped player IDs.
 *
 * MFL formats:
 *   "|playerId,"          -> drop only
 *   "|a,b,"               -> several players cut in one move
 *   "addId,|dropId,"      -> add/drop swap
 *   "addId,|"             -> add only (no drop)
 *   "addId,|bbid|dropId," -> BBID add/drop with bid amount
 *   "addId,|bbid|"        -> BBID add with NO drop (winning claim, nothing cut)
 *   "addId,|bbid|a,b,"    -> BBID add with more than one cut
 *   "addId|bbid|dropId"   -> the same BBID claim, pre-2017, without the commas
 *   "addId|bbid|0000"     -> pre-2017 BBID claim with NOTHING cut (see the
 *                            sentinel above -- "0000" is not a player)
 *   "addId|1525000.00|x"  -> pre-2012 BBID claim, bid written as a decimal
 *   "playerId|amount|"    -> auction won (AUCTION_WON), with or without a cut
 *   "playerId|amount"     -> the same auction win, pre-2017 (needs `type`)
 *   ""                    -> empty (batch marker like BBID_AUTO_PROCESS_WAIVERS)
 *
 * The segments are POSITIONAL and an empty segment is meaningful: a claim that
 * needed no corresponding cut ends at the pipe ("16778,|500000|"), it does not
 * carry a placeholder comma after it. Reading these shapes strictly is what
 * broke this parser once already -- see the priced branch below.
 *
 * `type` is the row's MFL transaction type. It is OPTIONAL because only one
 * shape is ambiguous without it (two segments: a cut list on a roster move, a
 * price on a pre-2017 auction win) -- but pass it wherever it is known.
 *
 * scripts/lib/roster-move-parse.mjs parses the same MFL field for the Schefter
 * scanner. The two must agree; tests/contract-eligibility.test.ts runs both
 * over a shared corpus of real strings recorded off MFL by
 * scripts/record-transaction-shapes.mjs. That corpus held ONE league's ONE
 * season until #1158, which is why it could not see the drift it existed to
 * catch -- widen it, never trim it.
 */
export function parseTransactionString(txnString: string, type?: string): {
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

  // PRICED shape: "addId|price|drops" — ONE branch for the BBID claim and the
  // auction win alike, because at three segments they are the same grammar:
  // the middle segment is a PRICE, never a player, and the third is the cut
  // list. Splitting them into a "BBID" branch that required the comma and an
  // "auction" branch that forbade it was the drift #1158 F2 went looking for:
  // a census of both leagues' 20 seasons finds 738 of 1307 BBID_WAIVER rows
  // written WITHOUT the comma (2007-2016), so the label was simply wrong, and
  // the 17 rows carrying a DECIMAL bid ("7598|1525000.00|0000") matched
  // neither integer-only pattern and fell through to the swap branch — which
  // sees three segments, returns zero adds, and is therefore discarded whole
  // by parseTransactions() below. That is the exact end state of the
  // drop-free-claim bug this parser was already fixed for once.
  //
  // So: the comma after the add id is OPTIONAL, the price may be DECIMAL, and
  // the drop segment is read with idsIn — comma-delimited, possibly empty,
  // possibly several ids. Enumerating shapes is what left the no-drop case
  // out in the first place; do not go back to it.
  const pricedMatch = txnString.match(/^(\d+),?\|(\d+(?:\.\d*)?)\|(.*)$/);
  if (pricedMatch) {
    addedPlayerIds.push(pricedMatch[1]);
    bbidAmount = parseInt(pricedMatch[2], 10);
    droppedPlayerIds.push(...idsIn(pricedMatch[3]));
    return { addedPlayerIds, droppedPlayerIds, bbidAmount };
  }

  // Drop-only: "|playerId," -- and MFL cuts more than one player in a single
  // move ("|17064,16191,"), so the segment is comma-delimited, not one id.
  // Stripping only the first comma turned that into "1706416191," and lost
  // both ids.
  if (txnString.startsWith('|')) {
    for (const segment of txnString.split('|')) {
      droppedPlayerIds.push(...idsIn(segment));
    }
    return { addedPlayerIds, droppedPlayerIds };
  }

  // TWO segments, "addId|rest" — and this is the one shape the string alone
  // CANNOT resolve. On a roster move the second segment is the cut list
  // ("11957,|9122,"); on a pre-2017 auction win it is the price with no cut
  // ("8925|625000", 1410 rows, plus 334 more in MFL's scientific notation
  // "6616|1.525e+06"). Both are bare digits, so only `type` separates them,
  // and without it the auction's PRICE is reported as a dropped player id.
  // Callers that know the type should pass it; the type-less default keeps
  // the historical positional reading.
  const parts = txnString.split('|');
  if (parts.length === 2) {
    addedPlayerIds.push(...idsIn(parts[0]));
    if (type === 'AUCTION_WON') {
      const price = parseFloat(parts[1]);
      if (Number.isFinite(price)) bbidAmount = Math.trunc(price);
    } else {
      droppedPlayerIds.push(...idsIn(parts[1]));
    }
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

    // Pass the type: "8925|625000" is an auction PRICE, not a dropped player.
    const { addedPlayerIds, droppedPlayerIds, bbidAmount } = parseTransactionString(raw.transaction, raw.type);

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
 * Used as the rookie contract override deadline (cutdown date), and by the
 * August cut automation as the single source of truth for the deadline.
 */
export function getAugustCutdownDate(year: number): Date {
  const august1 = new Date(year, 7, 1); // August is month 7
  const dayOfWeek = august1.getDay();
  // (7 - dayOfWeek) % 7 is 0 when Aug 1 IS a Sunday — that's correct (the
  // first Sunday is Aug 1). The old `|| 7` guard wrongly pushed those years
  // (2027, 2032) to the 4th Sunday (Aug 22 instead of Aug 15).
  // tests/august-cutdown-date.test.ts locks in the fix and cross-checks this
  // function against the script twin in scripts/lib/august-cutdown.mjs.
  const daysToFirstSunday = (7 - dayOfWeek) % 7;
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
