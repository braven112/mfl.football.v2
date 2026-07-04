/**
 * Shape normalization for raw MFL feed data.
 *
 * MFL represents lists in three shapes: an array (2+ entries), a bare object
 * (exactly 1 entry), and an empty string — or a single object with
 * empty-string fields — when there are none (e.g. the off-season
 * projectedScores feed ships `playerScore: { id: "", score: "" }`).
 */

/**
 * Normalize any MFL list field to an array.
 *
 * Note: returns [] for ANY falsy value. Correct for MFL's object lists
 * (the zero-entry shape is `""`), but do not reuse for lists of scalars —
 * valid `0` / `false` / `""` entries would be dropped. The empty-field
 * sentinel object survives normalization, so consumers must still filter
 * by field presence (e.g. `if (entry.id)`).
 */
export function asArray<T>(value: T[] | T | '' | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
}
