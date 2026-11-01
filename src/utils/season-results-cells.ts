/**
 * Season Results (the player modal's game log) — what each cell SAYS, apart
 * from the markup the modal writes.
 *
 * Borrowed from Yahoo's player card (Nov 2026): a game log you can read at a
 * glance rather than one you have to do arithmetic on.
 *
 *  - The opponent cell carries the matchup difficulty INSIDE it ("at KC 25th",
 *    green or red), instead of two extra columns (Avg vs RB, Rank vs RB) that
 *    pushed the table sideways on a phone.
 *  - A played week's points are shaded against the player's OWN season
 *    average (better / typical / worse), so a good week for a backup and a
 *    good week for a star both read as good.
 *
 * Pure functions, unit-tested in tests/season-results-cells.test.ts, so the
 * thresholds are pinned in one place and the modal's script stays the DOM's.
 */

/** Opponent rank vs the position: 1 allows the MOST points, so 1 is easiest. */
export type MatchupTier = 'easy' | 'hard' | 'mid';

/** Top quarter of 32 is a soft matchup, bottom quarter a tough one. */
export const EASY_MAX_RANK = 8;
export const HARD_MIN_RANK = 25;

export function matchupTier(rank: number | null | undefined): MatchupTier | null {
  if (typeof rank !== 'number' || !Number.isFinite(rank) || rank < 1) return null;
  if (rank <= EASY_MAX_RANK) return 'easy';
  if (rank >= HARD_MIN_RANK) return 'hard';
  return 'mid';
}

/** 1 → "1st", 22 → "22nd", 13 → "13th". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export type PointsTier = 'better' | 'typical' | 'worse';

/**
 * How far from his average a week must land before it stops being "typical":
 * 25% of the average, but never less than 3 points. The floor is what keeps a
 * 4-point-a-week backup from flashing green for scoring 5.
 */
export const TYPICAL_BAND_PCT = 0.25;
export const TYPICAL_BAND_MIN = 3;

/** Mean of the weeks that have a score. Null when none do. */
export function seasonAverage(points: Array<number | null | undefined>): number | null {
  let total = 0;
  let games = 0;
  for (const p of points) {
    if (typeof p === 'number' && Number.isFinite(p)) {
      total += p;
      games++;
    }
  }
  return games > 0 ? total / games : null;
}

/**
 * Better / typical / worse against his own average. Null when there is
 * nothing to compare: no score this week, or fewer than two scored weeks (one
 * game IS the average, so every week would read "typical" and say nothing).
 */
export function pointsTier(
  points: number | null | undefined,
  average: number | null | undefined,
  gamesPlayed: number,
): PointsTier | null {
  if (typeof points !== 'number' || !Number.isFinite(points)) return null;
  if (typeof average !== 'number' || !Number.isFinite(average)) return null;
  if (gamesPlayed < 2) return null;
  const band = Math.max(Math.abs(average) * TYPICAL_BAND_PCT, TYPICAL_BAND_MIN);
  if (points >= average + band) return 'better';
  if (points <= average - band) return 'worse';
  return 'typical';
}
