/**
 * League-wide comparison utilities for aggregating and ranking franchise metrics
 */

export interface Player {
  id: string;
  name: string;
  position?: string;
  salary?: number;
  points?: number;
  franchiseId?: string;
  birthdate?: number;
  contractYears?: number;
  status?: string;
  nflTeam?: string;
}

export interface FranchiseMetrics {
  franchiseId: string;
  name: string;
  totalSalary: number;
  totalPoints: number;
  playerCount: number;
  avgAge?: number;
  positionBreakdown: {
    QB: { points: number; salary: number; count: number };
    RB: { points: number; salary: number; count: number };
    WR: { points: number; salary: number; count: number };
    TE: { points: number; salary: number; count: number };
    FLEX: { points: number; salary: number; count: number };
    DEF: { points: number; salary: number; count: number };
  };
}

export interface TeamRanking {
  franchiseId: string;
  name: string;
  [key: string]: number | string; // rank values for each position
}

/**
 * Normalize position to standard codes
 */
export function normalizePosition(pos?: string): string {
  if (!pos) return 'FLEX';
  const upper = pos.toUpperCase();

  // Map aliases
  const posMap = {
    'SWR': 'WR',
    'WR/TE': 'FLEX',
    'RB/WR': 'FLEX',
    'K': 'FLEX',
    'PK': 'FLEX',
  };

  return posMap[upper] || upper;
}

/**
 * Group players by franchise and aggregate metrics
 */
export function aggregateByFranchise(
  players: Player[],
  franchiseMap: Record<string, string>,
  deadMoneyMap?: Record<string, number>,
  irMap?: Record<string, boolean>
): FranchiseMetrics[] {
  const franchises = new Map<string, FranchiseMetrics>();

  // Initialize franchise entries
  Object.entries(franchiseMap).forEach(([id, name]) => {
    franchises.set(id, {
      franchiseId: id,
      name,
      totalSalary: 0,
      totalPoints: 0,
      playerCount: 0,
      avgAge: 0,
      positionBreakdown: {
        QB: { points: 0, salary: 0, count: 0 },
        RB: { points: 0, salary: 0, count: 0 },
        WR: { points: 0, salary: 0, count: 0 },
        TE: { points: 0, salary: 0, count: 0 },
        FLEX: { points: 0, salary: 0, count: 0 },
        DEF: { points: 0, salary: 0, count: 0 },
      },
    });
  });

  // Aggregate player data
  players.forEach((player) => {
    const fid = player.franchiseId;
    if (!fid || !franchises.has(fid)) return;

    const franchise = franchises.get(fid)!;
    const pos = normalizePosition(player.position);
    const salary = player.salary || 0;
    const points = player.points || 0;

    franchise.totalSalary += salary;
    franchise.totalPoints += points;
    franchise.playerCount += 1;

    if (franchise.positionBreakdown[pos]) {
      franchise.positionBreakdown[pos].points += points;
      franchise.positionBreakdown[pos].salary += salary;
      franchise.positionBreakdown[pos].count += 1;
    }
  });

  // Calculate average age
  players.forEach((player) => {
    if (!player.birthdate || !player.franchiseId) return;
    const fid = player.franchiseId;
    if (!franchises.has(fid)) return;

    const franchise = franchises.get(fid)!;
    // birthdate is unix timestamp in seconds
    const birthDateMs = player.birthdate * 1000;
    const age = (Date.now() - birthDateMs) / (365.25 * 24 * 60 * 60 * 1000);
    franchise.avgAge = (franchise.avgAge || 0) + age;
  });

  // Average out the ages
  franchises.forEach((franchise) => {
    if (franchise.playerCount > 0) {
      franchise.avgAge = franchise.avgAge! / franchise.playerCount;
    }
  });

  return Array.from(franchises.values());
}

/**
 * Rank franchises for each position (1-16, where 1 is best)
 */
export function rankByPosition(
  metrics: FranchiseMetrics[],
  positions: (keyof FranchiseMetrics['positionBreakdown'])[] = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'DEF']
): TeamRanking[] {
  const rankings: TeamRanking[] = metrics.map((m) => ({
    franchiseId: m.franchiseId,
    name: m.name,
  }));

  // Rank by each position
  positions.forEach((pos) => {
    const sorted = [...metrics]
      .sort((a, b) => b.positionBreakdown[pos].points - a.positionBreakdown[pos].points)
      .map((m, idx) => ({ franchiseId: m.franchiseId, rank: idx + 1 }));

    sorted.forEach(({ franchiseId, rank }) => {
      const ranking = rankings.find((r) => r.franchiseId === franchiseId);
      if (ranking) {
        ranking[pos] = rank;
      }
    });
  });

  // Also rank by total points
  const totalSorted = [...metrics]
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .map((m, idx) => ({ franchiseId: m.franchiseId, rank: idx + 1 }));

  totalSorted.forEach(({ franchiseId, rank }) => {
    const ranking = rankings.find((r) => r.franchiseId === franchiseId);
    if (ranking) {
      ranking['TOTAL'] = rank;
    }
  });

  return rankings;
}

/**
 * Calculate cap health status based on metrics
 */
export function getCapHealthStatus(
  salary: number,
  points: number,
  deadMoney: number,
  capLimit: number = 45000000
): 'healthy' | 'mediocre' | 'disaster' {
  const capUsagePercent = (salary / capLimit) * 100;
  const deadMoneyPercent = (deadMoney / capLimit) * 100;
  const ppm = salary > 0 ? points / (salary / 1000000) : 0;

  // Healthy: under cap, good PPM, low dead money
  if (capUsagePercent <= 95 && ppm >= 0.8 && deadMoneyPercent <= 5) {
    return 'healthy';
  }

  // Disaster: over cap, low PPM, high dead money
  if (capUsagePercent >= 105 || ppm < 0.5 || deadMoneyPercent >= 15) {
    return 'disaster';
  }

  return 'mediocre';
}

/**
 * Calculate luck score (expected W/L vs actual)
 * Based on total points vs league average volatility
 */
export function calculateLuckScore(
  teamPoints: number,
  teamWeeklyAvg: number,
  teamStdDev: number,
  leagueAvgPoints: number,
  _weeks: number = 17
): number {
  if (teamStdDev === 0) return 0;

  // Luck = (actual - expected) / std dev
  // Expected is based on league average
  const expected = leagueAvgPoints * _weeks;
  const luck = (teamPoints - expected) / (teamStdDev * Math.sqrt(_weeks));

  return Math.round(luck * 100) / 100;
}

/**
 * Calculate draft pick value using Jimmy Johnson value chart approximation
 */
export function calculatePickValue(pickNumber: number, roundNumber?: number): number {
  // Simplified Jimmy Johnson chart values
  // Higher value = better pick
  const values: Record<number, number> = {
    1: 3200, 2: 2992, 3: 2784, 4: 2576, 5: 2368, 6: 2160, 7: 1952, 8: 1744, 9: 1536, 10: 1328,
    11: 1120, 12: 1012, 13: 904, 14: 796, 15: 688, 16: 580, 17: 472, 18: 364, 19: 256, 20: 148,
    21: 132, 22: 125, 23: 118, 24: 111, 25: 105, 26: 100, 27: 95, 28: 90, 29: 85, 30: 80, 31: 75, 32: 70,
  };

  return values[pickNumber] || 50;
}

/**
 * Get team logo path from theleague assets
 */
export function getTeamLogoPath(
  franchiseId: string,
  leagueAssets: Record<string, any>,
  type: 'icons' | 'banners' | 'group-me' = 'icons'
): string | null {
  const team = leagueAssets.teams?.find((t: any) => t.id === franchiseId);
  if (!team || !team.assets || !team.assets[type]) {
    return null;
  }
  return team.assets[type][0]?.relativePath || null;
}
