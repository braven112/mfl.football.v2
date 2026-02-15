/**
 * Trade simulation calculation utilities
 * Thin composition layer over salary-calculations.ts for trade-specific scenarios
 */

import {
  SALARY_CAP,
  SALARY_YEARS,
  getCapPercent,
  calculateVeteranExtension,
} from './salary-calculations';

import type {
  TradeBuilderPlayer,
  TradeBuilderTeam,
  TeamTradeImpact,
  PositionChange,
  RookieExtensionSim,
  PositionSalaryAverages,
} from '../types/trade-builder';

/**
 * Calculate a single player's cap hit for each year in SALARY_YEARS.
 * Accounts for status (taxi = 50% current year) and 10% annual escalation.
 */
export function calculatePlayerCapHitByYear(
  salary: number,
  contractYears: number,
  normalizedStatus: 'ACTIVE' | 'PRACTICE' | 'INJURED'
): number[] {
  return SALARY_YEARS.map((_, yearIndex) => {
    if (contractYears <= yearIndex) return 0;
    const isCurrent = yearIndex === 0;
    const percent = getCapPercent(normalizedStatus, isCurrent);
    const escalatedSalary = salary * Math.pow(1.10, yearIndex);
    return Math.round(escalatedSalary * percent);
  });
}

/**
 * Given a team's current cap charges and players being traded away/received,
 * compute the post-trade cap charges for each year.
 */
export function calculatePostTradeCapCharges(
  currentCapCharges: number[],
  playersOut: { capHitByYear: number[] }[],
  playersIn: { capHitByYear: number[] }[]
): number[] {
  return SALARY_YEARS.map((_, yearIndex) => {
    const traded = playersOut.reduce(
      (sum, p) => sum + (p.capHitByYear[yearIndex] ?? 0),
      0
    );
    const received = playersIn.reduce(
      (sum, p) => sum + (p.capHitByYear[yearIndex] ?? 0),
      0
    );
    return currentCapCharges[yearIndex] - traded + received;
  });
}

/**
 * Calculate cap space for each year given cap charges and dead money
 */
export function calculateCapSpaceByYear(
  capCharges: number[],
  deadMoney: number[],
  capLimit: number = SALARY_CAP
): number[] {
  return capCharges.map(
    (charge, i) => capLimit - charge - (deadMoney[i] ?? 0)
  );
}

/**
 * Check if a player has a rookie contract based on contractInfo
 */
export function isRookieContract(contractInfo: string): boolean {
  return contractInfo.startsWith('R');
}

/**
 * Simulate a rookie contract extension after trade.
 * Uses the veteran extension formula from salary-calculations.ts.
 */
export function simulateRookieExtension(
  player: { salary: number; contractYears: number; position: string },
  extensionYears: number,
  positionAverages: PositionSalaryAverages
): RookieExtensionSim {
  const top5Average = positionAverages[player.position]?.top5Average ?? 0;

  const result = calculateVeteranExtension(
    player.contractYears,
    player.position,
    extensionYears,
    player.salary,
    { positions: positionAverages }
  );

  const capHitByYear = SALARY_YEARS.map((_, yearIndex) => {
    if (result.newYears <= yearIndex) return 0;
    return Math.round(result.newSalary * Math.pow(1.10, yearIndex));
  });

  return {
    newSalary: result.newSalary,
    newContractYears: result.newYears,
    extensionYears,
    capHitByYear,
  };
}

/**
 * Compute position depth changes from a trade
 */
export function calculatePositionChanges(
  playersOut: TradeBuilderPlayer[],
  playersIn: TradeBuilderPlayer[]
): PositionChange[] {
  const positions = new Set<string>();
  playersOut.forEach((p) => positions.add(p.position));
  playersIn.forEach((p) => positions.add(p.position));

  return Array.from(positions)
    .map((position) => {
      const lost = playersOut.filter((p) => p.position === position).length;
      const gained = playersIn.filter((p) => p.position === position).length;
      return { position, lost, gained, netChange: gained - lost };
    })
    .filter((p) => p.netChange !== 0)
    .sort((a, b) => a.position.localeCompare(b.position));
}

/**
 * Compute full trade impact for one team.
 *
 * @param team - The team's current data
 * @param playersOut - Players this team is sending away
 * @param playersIn - Players this team is receiving
 * @param rookieExtensions - Any rookie extension overrides (keyed by player id)
 */
export function computeTeamTradeImpact(
  team: TradeBuilderTeam,
  playersOut: TradeBuilderPlayer[],
  playersIn: TradeBuilderPlayer[],
  rookieExtensions: Record<string, RookieExtensionSim>
): TeamTradeImpact {
  // Build effective capHit arrays, substituting rookie extension overrides for incoming players
  const effectivePlayersIn = playersIn.map((p) => {
    const ext = rookieExtensions[p.id];
    if (ext) return { capHitByYear: ext.capHitByYear };
    return { capHitByYear: p.capHitByYear };
  });

  const postTradeCapCharges = calculatePostTradeCapCharges(
    team.capCharges,
    playersOut,
    effectivePlayersIn
  );

  const preTradeCapSpace = calculateCapSpaceByYear(
    team.capCharges,
    team.deadMoney
  );
  const postTradeCapSpace = calculateCapSpaceByYear(
    postTradeCapCharges,
    team.deadMoney
  );

  const capDelta = postTradeCapSpace.map(
    (post, i) => post - preTradeCapSpace[i]
  );
  const isOverCap = postTradeCapSpace.map((space) => space < 0);

  const totalSalaryTraded = playersOut.reduce((s, p) => s + p.salary, 0);
  const totalSalaryReceived = playersIn.reduce((s, p) => s + p.salary, 0);

  return {
    preTradeCapCharges: team.capCharges,
    postTradeCapCharges,
    preTradeCapSpace,
    postTradeCapSpace,
    capDelta,
    isOverCap,
    totalSalaryTraded,
    totalSalaryReceived,
    rosterCountDelta: playersIn.length - playersOut.length,
    positionBreakdown: calculatePositionChanges(playersOut, playersIn),
  };
}

/**
 * Serialize trade state to URL search params for sharing
 */
export function serializeTradeToParams(state: {
  teamAId: string | null;
  teamBId: string | null;
  teamAPlayerIds: string[];
  teamBPlayerIds: string[];
  teamADraftPicks: { year: string; round: string; originalPickFor: string }[];
  teamBDraftPicks: { year: string; round: string; originalPickFor: string }[];
}): URLSearchParams {
  const params = new URLSearchParams();
  if (state.teamAId) params.set('a', state.teamAId);
  if (state.teamBId) params.set('b', state.teamBId);
  if (state.teamAPlayerIds.length)
    params.set('ap', state.teamAPlayerIds.join(','));
  if (state.teamBPlayerIds.length)
    params.set('bp', state.teamBPlayerIds.join(','));
  if (state.teamADraftPicks.length)
    params.set(
      'ad',
      state.teamADraftPicks
        .map((p) => `${p.year}-${p.round}-${p.originalPickFor}`)
        .join(',')
    );
  if (state.teamBDraftPicks.length)
    params.set(
      'bd',
      state.teamBDraftPicks
        .map((p) => `${p.year}-${p.round}-${p.originalPickFor}`)
        .join(',')
    );
  return params;
}

/**
 * Deserialize trade state from URL search params
 */
export function deserializeTradeFromParams(params: URLSearchParams): {
  teamAId: string | null;
  teamBId: string | null;
  teamAPlayerIds: string[];
  teamBPlayerIds: string[];
  teamADraftPicks: { year: string; round: string; originalPickFor: string }[];
  teamBDraftPicks: { year: string; round: string; originalPickFor: string }[];
} {
  const parsePicks = (val: string | null) => {
    if (!val) return [];
    return val.split(',').map((entry) => {
      const [year, round, originalPickFor] = entry.split('-');
      return { year, round, originalPickFor };
    });
  };

  return {
    teamAId: params.get('a'),
    teamBId: params.get('b'),
    teamAPlayerIds: params.get('ap')?.split(',').filter(Boolean) ?? [],
    teamBPlayerIds: params.get('bp')?.split(',').filter(Boolean) ?? [],
    teamADraftPicks: parsePicks(params.get('ad')),
    teamBDraftPicks: parsePicks(params.get('bd')),
  };
}
