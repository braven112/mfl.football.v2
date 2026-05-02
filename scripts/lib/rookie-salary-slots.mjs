/**
 * Rookie slot salary table — single source of truth.
 *
 * Imported by:
 *   - src/utils/draft-pick-cap-impact.ts (re-exports as ROOKIE_SALARIES_2026)
 *   - scripts/sync-draft-pick-contracts.mjs (auto-create draft pick contracts)
 *
 * Pick numbers in this table are OVERALL pick numbers (round 1: 1-17,
 * round 2: 18-35). Round 3+ uses ROUND_3_FLAT_RATE.
 */

export const ROOKIE_SALARIES_2026 = {
  // Round 1
  1: {
    1: { QB: 3000000, RB: 3400000, WR: 3500000, TE: 2500000, PK: 575000, DEF: 575000 },
    2: { QB: 2650000, RB: 3100000, WR: 3200000, TE: 2100000, PK: 525000, DEF: 525000 },
    3: { QB: 2300000, RB: 2600000, WR: 2900000, TE: 1800000, PK: 500000, DEF: 500000 },
    4: { QB: 1900000, RB: 2200000, WR: 2600000, TE: 1500000, PK: 450000, DEF: 450000 },
    5: { QB: 1600000, RB: 1800000, WR: 2300000, TE: 1250000, PK: 450000, DEF: 450000 },
    6: { QB: 1300000, RB: 1600000, WR: 2000000, TE: 1100000, PK: 450000, DEF: 450000 },
    7: { QB: 1100000, RB: 1400000, WR: 1850000, TE: 950000, PK: 450000, DEF: 450000 },
    8: { QB: 1000000, RB: 1200000, WR: 1675000, TE: 850000, PK: 450000, DEF: 450000 },
    9: { QB: 925000, RB: 1100000, WR: 1550000, TE: 775000, PK: 450000, DEF: 450000 },
    10: { QB: 875000, RB: 1000000, WR: 1400000, TE: 775000, PK: 450000, DEF: 450000 },
    11: { QB: 825000, RB: 900000, WR: 1350000, TE: 700000, PK: 450000, DEF: 450000 },
    12: { QB: 800000, RB: 850000, WR: 1225000, TE: 675000, PK: 450000, DEF: 450000 },
    13: { QB: 750000, RB: 800000, WR: 1150000, TE: 650000, PK: 450000, DEF: 450000 },
    14: { QB: 700000, RB: 750000, WR: 1075000, TE: 650000, PK: 450000, DEF: 450000 },
    15: { QB: 675000, RB: 725000, WR: 1000000, TE: 625000, PK: 450000, DEF: 450000 },
    16: { QB: 650000, RB: 700000, WR: 900000, TE: 625000, PK: 450000, DEF: 450000 },
    // Toilet Bowl Pick (Round 1, Pick 17)
    17: { QB: 625000, RB: 650000, WR: 800000, TE: 600000, PK: 450000, DEF: 450000 },
  },
  // Round 2
  2: {
    18: { QB: 575000, RB: 600000, WR: 700000, TE: 600000, PK: 425000, DEF: 425000 },
    19: { QB: 525000, RB: 575000, WR: 650000, TE: 550000, PK: 425000, DEF: 425000 },
    20: { QB: 525000, RB: 550000, WR: 625000, TE: 550000, PK: 425000, DEF: 425000 },
    21: { QB: 500000, RB: 525000, WR: 600000, TE: 525000, PK: 425000, DEF: 425000 },
    22: { QB: 475000, RB: 500000, WR: 575000, TE: 525000, PK: 425000, DEF: 425000 },
    23: { QB: 475000, RB: 500000, WR: 575000, TE: 500000, PK: 425000, DEF: 425000 },
    24: { QB: 475000, RB: 475000, WR: 550000, TE: 475000, PK: 425000, DEF: 425000 },
    25: { QB: 475000, RB: 475000, WR: 550000, TE: 475000, PK: 425000, DEF: 425000 },
    26: { QB: 475000, RB: 475000, WR: 525000, TE: 475000, PK: 425000, DEF: 425000 },
    27: { QB: 475000, RB: 475000, WR: 525000, TE: 475000, PK: 425000, DEF: 425000 },
    28: { QB: 475000, RB: 475000, WR: 525000, TE: 475000, PK: 425000, DEF: 425000 },
    29: { QB: 475000, RB: 475000, WR: 525000, TE: 475000, PK: 425000, DEF: 425000 },
    30: { QB: 475000, RB: 475000, WR: 525000, TE: 475000, PK: 425000, DEF: 425000 },
    31: { QB: 475000, RB: 475000, WR: 525000, TE: 475000, PK: 425000, DEF: 425000 },
    32: { QB: 475000, RB: 475000, WR: 525000, TE: 475000, PK: 425000, DEF: 425000 },
    33: { QB: 475000, RB: 475000, WR: 500000, TE: 475000, PK: 425000, DEF: 425000 },
    // Toilet Bowl Picks (Round 2, Pick 17 & 18)
    34: { QB: 475000, RB: 475000, WR: 500000, TE: 475000, PK: 425000, DEF: 425000 },
    35: { QB: 475000, RB: 475000, WR: 500000, TE: 475000, PK: 425000, DEF: 425000 },
  },
};

export const ROUND_3_FLAT_RATE = {
  QB: 450000, RB: 450000, WR: 475000, TE: 450000, PK: 425000, DEF: 425000,
};

const SUPPORTED_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'PK', 'DEF']);

/**
 * Convert (round, pickInRound) to overall pick number used by the salary table.
 * Round 1 picks 1-17 → overall 1-17. Round 2 picks 1-18 → overall 18-35.
 * Round 3+ doesn't matter; flat rate applies regardless of overall pick.
 */
export function overallPickFromRoundPick(round, pickInRound) {
  if (round === 1) return pickInRound;
  if (round === 2) return 17 + pickInRound;
  return pickInRound;
}

/**
 * Look up the slot-based rookie salary for a given (round, overallPick, position).
 * Falls back to round-3 flat rate when out-of-table.
 */
export function getRookieSlotSalary(round, overallPick, position) {
  const pos = String(position || '').toUpperCase();
  const basePos = SUPPORTED_POSITIONS.has(pos) ? pos : 'WR';

  if (round === 1 || round === 2) {
    const row = ROOKIE_SALARIES_2026[round]?.[overallPick];
    if (row) return row[basePos] ?? row.WR ?? 425000;
  }
  return ROUND_3_FLAT_RATE[basePos] ?? 425000;
}
