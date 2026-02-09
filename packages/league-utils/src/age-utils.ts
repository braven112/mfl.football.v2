/**
 * Age calculation utilities for player rosters
 */

import type { RosterPlayer } from './roster-utils';

/**
 * Calculate age from Unix timestamp birthdate
 * @param birthdate - Unix timestamp in seconds (from MFL API)
 * @returns Age in years (rounded down)
 */
export function calculateAge(birthdate?: number): number | null {
  if (!birthdate) return null;
  const birthDate = new Date(birthdate * 1000);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

/**
 * Calculate average age of players
 * @param players - Array of roster players
 * @returns Average age rounded to 1 decimal place, or null if no valid ages
 */
export function calculateAverageAge(players: RosterPlayer[]): number | null {
  const ages = players
    .map((p) => calculateAge(p.birthdate))
    .filter((age): age is number => age !== null);

  if (ages.length === 0) return null;
  return Math.round((ages.reduce((sum, age) => sum + age, 0) / ages.length) * 10) / 10;
}

/**
 * Calculate average age by position
 * @param players - Array of roster players
 * @returns Map of position -> average age
 */
export function calculateAverageAgeByPosition(
  players: RosterPlayer[]
): Map<string, { avgAge: number; count: number }> {
  const byPosition = new Map<string, number[]>();

  players.forEach((player) => {
    const pos = (player.position ?? 'UNK').toUpperCase();
    const age = calculateAge(player.birthdate);
    if (age !== null) {
      if (!byPosition.has(pos)) {
        byPosition.set(pos, []);
      }
      byPosition.get(pos)!.push(age);
    }
  });

  const result = new Map<string, { avgAge: number; count: number }>();
  byPosition.forEach((ages, position) => {
    const avgAge = Math.round((ages.reduce((sum, age) => sum + age, 0) / ages.length) * 10) / 10;
    result.set(position, { avgAge, count: ages.length });
  });

  return result;
}

/**
 * Create age distribution buckets for chart
 * @param players - Array of roster players
 * @param bucketSize - Years per bucket (default 5)
 * @returns Array of {range: string, count: number, percentage: number}
 */
export function getAgeDistribution(
  players: RosterPlayer[],
  bucketSize: number = 5
): Array<{ range: string; count: number; percentage: number }> {
  const ages = players
    .map((p) => calculateAge(p.birthdate))
    .filter((age): age is number => age !== null);

  if (ages.length === 0) {
    return [];
  }

  const minAge = Math.min(...ages);
  const maxAge = Math.max(...ages);
  const buckets = new Map<number, number>();

  ages.forEach((age) => {
    const bucketStart = Math.floor(age / bucketSize) * bucketSize;
    buckets.set(bucketStart, (buckets.get(bucketStart) ?? 0) + 1);
  });

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStart, count]) => ({
      range: `${bucketStart}-${bucketStart + bucketSize - 1}`,
      count,
      percentage: Math.round((count / ages.length) * 100),
    }));
}

/**
 * Create color palette for age distribution bars
 * @param count - Number of bars needed
 * @returns Array of hex color codes
 */
export function getAgeDistributionColors(count: number): string[] {
  const colors = [
    '#22c55e', // green (younger)
    '#84cc16', // lime
    '#eab308', // yellow
    '#f97316', // orange
    '#ef4444', // red (older)
  ];
  if (count <= colors.length) {
    return colors.slice(0, count);
  }
  // If more colors needed, repeat the pattern
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(colors[i % colors.length]);
  }
  return result;
}
