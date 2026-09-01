/**
 * Age calculation utilities for player rosters.
 *
 * Every function takes "today" as an optional last argument. It defaults to
 * `new Date()`, so no caller has to pass it — but without the seam none of this
 * is testable, because the answers change with the system clock. That is why
 * the rosters page's inline copies of these went untested for years.
 */

import type { RosterPlayer } from './roster-utils';

/** Anything with a birthdate. Looser than RosterPlayer so client-side rows
 *  (plain parsed JSON, not the full typed shape) can be passed directly. */
export interface HasBirthdate {
  birthdate?: number | string | null;
  position?: string | null;
}

/**
 * Calculate age from Unix timestamp birthdate
 * @param birthdate - Unix timestamp in SECONDS (from MFL API), not milliseconds
 * @param now - "Today"; injectable for tests
 * @returns Age in years (rounded down), or null when there is no birthdate —
 *          null rather than 0, so callers filter rather than averaging in a
 *          newborn
 */
export function calculateAge(
  birthdate?: number | string | null,
  now: Date = new Date(),
): number | null {
  if (!birthdate) return null;
  const birthDate = new Date(Number(birthdate) * 1000);
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

/**
 * Calculate average age of players
 * @param players - Array of roster players
 * @returns Average age rounded to 1 decimal place, or null if no valid ages
 */
export function calculateAverageAge(
  players: (RosterPlayer | HasBirthdate)[],
  now: Date = new Date(),
): number | null {
  const ages = players
    .map((p) => calculateAge(p.birthdate, now))
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
  players: (RosterPlayer | HasBirthdate)[],
  now: Date = new Date(),
): Map<string, { avgAge: number; count: number }> {
  const byPosition = new Map<string, number[]>();

  players.forEach((player) => {
    const pos = String(player.position ?? 'UNK').toUpperCase();
    const age = calculateAge(player.birthdate, now);
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
  players: (RosterPlayer | HasBirthdate)[],
  bucketSize: number = 5,
  now: Date = new Date(),
): Array<{ range: string; count: number; percentage: number }> {
  const ages = players
    .map((p) => calculateAge(p.birthdate, now))
    .filter((age): age is number => age !== null);

  if (ages.length === 0) {
    return [];
  }

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
