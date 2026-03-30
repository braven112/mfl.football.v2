import {
  findAcquisitionTransaction,
  getTeamEligibility,
  parseTransactions,
} from './contract-eligibility';
import type {
  MFLPlayerInfo,
  MFLRawTransaction,
  RosterPlayer,
} from '../types/contract-eligibility';

export interface DashboardPlayerContext {
  id: string;
  name: string;
  position: string;
  nflTeam?: string;
  headshot?: string;
}

export interface UnsignedFaAlert {
  playerId: string;
  name: string;
  position: string;
  nflTeam?: string;
  headshot?: string;
  salary: number;
  acquisitionTimestamp: number;
  deadlineTimestamp: number;
  acquisitionType: 'FREE_AGENT' | 'BBID_WAIVER' | 'AUCTION_WON';
  bidAmount?: number;
  hoursRemaining: number;
  urgent: boolean;
}

interface ResolveUnsignedFaAlertsParams {
  franchiseId?: string;
  rosterPlayers: RosterPlayer[];
  rawTransactions: MFLRawTransaction[];
  playersMap: Map<string, MFLPlayerInfo>;
  playerContextById?: Map<string, DashboardPlayerContext>;
  currentYear: number;
  referenceDate?: Date;
}

export interface ContextualRowsResult<T> {
  rows: T[];
  userIndex: number;
  start: number;
  end: number;
  isContextual: boolean;
}

export function getContextualRows<T extends { id: string }>(
  rows: T[],
  userId?: string,
  radius = 2,
  fallbackCount = 6,
): ContextualRowsResult<T> {
  const safeFallbackCount = Math.max(1, fallbackCount);
  const userIndex = userId ? rows.findIndex((row) => row.id === userId) : -1;

  if (userIndex === -1) {
    const end = Math.min(rows.length, safeFallbackCount);
    return {
      rows: rows.slice(0, end),
      userIndex,
      start: 0,
      end,
      isContextual: false,
    };
  }

  const windowSize = Math.min(rows.length, radius * 2 + 1);
  let start = Math.max(0, userIndex - radius);
  let end = Math.min(rows.length, start + windowSize);
  start = Math.max(0, end - windowSize);

  return {
    rows: rows.slice(start, end),
    userIndex,
    start,
    end,
    isContextual: rows.length > windowSize,
  };
}

export function resolveUnsignedFaAlerts({
  franchiseId,
  rosterPlayers,
  rawTransactions,
  playersMap,
  playerContextById = new Map<string, DashboardPlayerContext>(),
  currentYear,
  referenceDate = new Date(),
}: ResolveUnsignedFaAlertsParams): UnsignedFaAlert[] {
  if (!franchiseId || rosterPlayers.length === 0 || rawTransactions.length === 0) {
    return [];
  }

  const parsedTransactions = parseTransactions(rawTransactions);
  const teamEligibility = getTeamEligibility(
    franchiseId,
    rosterPlayers,
    rawTransactions,
    playersMap,
    currentYear,
    referenceDate,
  );

  return teamEligibility.players
    .filter((player) =>
      player.eligible
      && player.declarationType === 'new-acquisition'
      && player.currentYears === 1
      && !player.contractInfo
      && !!player.deadlineTimestamp,
    )
    .map((player) => {
      const acquisition = findAcquisitionTransaction(player.playerId, franchiseId, parsedTransactions);
      if (!acquisition || !player.deadlineTimestamp) return null;

      const msRemaining = (player.deadlineTimestamp * 1000) - referenceDate.getTime();
      if (msRemaining <= 0) return null;

      const displayContext = playerContextById.get(player.playerId);
      const playerInfo = playersMap.get(player.playerId);

      return {
        playerId: player.playerId,
        name: displayContext?.name ?? playerInfo?.name ?? `Player ${player.playerId}`,
        position: displayContext?.position ?? playerInfo?.position ?? '',
        nflTeam: displayContext?.nflTeam ?? playerInfo?.team ?? '',
        headshot: displayContext?.headshot,
        salary: player.currentSalary,
        acquisitionTimestamp: acquisition.timestamp,
        deadlineTimestamp: player.deadlineTimestamp,
        acquisitionType: acquisition.type as UnsignedFaAlert['acquisitionType'],
        bidAmount: acquisition.bbidAmount,
        hoursRemaining: msRemaining / (60 * 60 * 1000),
        urgent: msRemaining <= 12 * 60 * 60 * 1000,
      };
    })
    .filter((alert): alert is UnsignedFaAlert => alert !== null)
    .sort((a, b) => a.deadlineTimestamp - b.deadlineTimestamp);
}
