/**
 * Normalize Position
 *
 * Shared position normalization for all ranking/import utilities.
 * Converts common position variations to MFL-canonical forms.
 */

/** Map common position variations to canonical MFL forms */
const POSITION_MAP: Record<string, string> = {
  QB: 'QB',
  QUARTERBACK: 'QB',
  RB: 'RB',
  HB: 'RB',
  'RUNNING BACK': 'RB',
  RUNNINGBACK: 'RB',
  WR: 'WR',
  'WIDE RECEIVER': 'WR',
  WIDERECEIVER: 'WR',
  RECEIVER: 'WR',
  TE: 'TE',
  'TIGHT END': 'TE',
  TIGHTEND: 'TE',
  K: 'PK',
  PK: 'PK',
  KICKER: 'PK',
  DST: 'DEF',
  DEF: 'DEF',
  'D/ST': 'DEF',
  DEFENSE: 'DEF',
};

/**
 * Normalize a position string to MFL-canonical form.
 *
 * Handles:
 * - Case insensitivity ("wr" → "WR")
 * - Trailing digits from DLF-style positions ("WR1" → "WR")
 * - Verbose names ("RUNNING BACK" → "RB")
 * - Common abbreviation variants ("K" → "PK", "DST" → "DEF")
 */
export function normalizePosition(pos: string): string {
  // Strip trailing digits (DLF uses "WR1", "RB2", "QB1" etc.)
  const upper = (pos ?? '').toUpperCase().trim().replace(/\d+$/, '');
  return POSITION_MAP[upper] ?? upper;
}
