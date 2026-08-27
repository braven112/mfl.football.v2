/**
 * Age analytics for the roster page's Analytics view.
 *
 * Extracted from the inline client script in `rosters.astro`. Pure, apart from
 * "today", which is injectable so the tests aren't hostage to the system clock
 * — the original read `new Date()` directly, which is why none of this was
 * testable before.
 *
 * See `docs/plans/rosters-page-split.md`.
 */

export interface AgedPlayer {
  /** MFL birthdates arrive as UNIX seconds, not milliseconds. */
  birthdate?: number | string | null;
  position?: string | null;
  [key: string]: unknown;
}

/**
 * Whole years old, birthday-aware. `null` for a player with no birthdate —
 * callers filter on that rather than getting a misleading 0.
 */
export function calculateAge(
  birthdate: number | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!birthdate) return null;
  const birthDate = new Date(Number(birthdate) * 1000);
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
}

function agesOf(players: AgedPlayer[], now: Date): number[] {
  return players
    .map((p) => calculateAge(p.birthdate, now))
    .filter((age): age is number => age !== null);
}

/** Mean age to one decimal, or `null` when nobody has a birthdate. */
export function calculateAverageAge(
  players: AgedPlayer[] = [],
  now: Date = new Date(),
): number | null {
  const ages = agesOf(players, now);
  if (ages.length === 0) return null;
  return Math.round((ages.reduce((sum, age) => sum + age, 0) / ages.length) * 10) / 10;
}

/** Mean age and headcount per position. Positions with no ages are omitted. */
export function calculateAverageAgeByPosition(
  players: AgedPlayer[] = [],
  now: Date = new Date(),
): Map<string, { avgAge: number; count: number }> {
  const byPosition = new Map<string, number[]>();
  players.forEach((player) => {
    const pos = String(player.position ?? 'UNK').toUpperCase();
    const age = calculateAge(player.birthdate, now);
    if (age === null) return;
    if (!byPosition.has(pos)) byPosition.set(pos, []);
    byPosition.get(pos)!.push(age);
  });

  const result = new Map<string, { avgAge: number; count: number }>();
  byPosition.forEach((ages, position) => {
    const avgAge = Math.round((ages.reduce((sum, age) => sum + age, 0) / ages.length) * 10) / 10;
    result.set(position, { avgAge, count: ages.length });
  });
  return result;
}

export interface AgeBucket {
  range: string;
  count: number;
  percentage: number;
}

/**
 * Histogram of ages in fixed-width buckets, ascending. Percentages are whole
 * numbers and therefore need not sum to exactly 100.
 */
export function getAgeDistribution(
  players: AgedPlayer[] = [],
  bucketSize = 5,
  now: Date = new Date(),
): AgeBucket[] {
  const ages = agesOf(players, now);
  if (ages.length === 0) return [];

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

/** Green (younger) through red (older); cycles if more buckets than colors. */
const AGE_RAMP = ['#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444'];

export function getAgeDistributionColors(count: number): string[] {
  if (count <= AGE_RAMP.length) return AGE_RAMP.slice(0, count);
  return Array.from({ length: count }, (_, i) => AGE_RAMP[i % AGE_RAMP.length]);
}
