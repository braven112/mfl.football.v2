/**
 * How many decimal places a league shows its fantasy points with.
 *
 * MFL's own league setting (`precision` on the `TYPE=league` export) is the
 * answer, never a constant here. The board printed one decimal while MFL
 * printed two, so a 135.43–135.18 final read as 135.4–135.2 and an owner
 * comparing the two sites saw numbers that did not match.
 *
 * Pure — the client imports this too.
 */

/** MFL's own display when a league's setting could not be read. */
export const DEFAULT_SCORE_PRECISION = 2;

/** A league's `precision` value as MFL serves it (a string), or undefined. */
export function parseScorePrecision(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 4 ? n : undefined;
}

export function formatScore(points: number, precision: number = DEFAULT_SCORE_PRECISION): string {
  return Number.isFinite(points) ? points.toFixed(precision) : (0).toFixed(precision);
}
