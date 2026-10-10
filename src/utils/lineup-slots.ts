/**
 * The Set Lineup page's starting slots, derived from a league's MFL starter
 * rules (`league.json` → `league.starters`).
 *
 * The page used to hard-code one layout — QB, RB, WR, TE, three FLEX, PK, DEF
 * — which is TheLeague's and the AFL's. Archie's starts 9 with no kicker and a
 * second QB allowed (QB 1-2, RB/WR/TE 1-5, Def 1), so that layout would have
 * demanded a kicker nobody rosters and refused a legal two-QB lineup.
 *
 * Derivation: every position gets its MINIMUM as fixed slots; the rest of the
 * starting count are FLEX slots, open to every position whose maximum exceeds
 * its minimum; and each position's MAXIMUM caps how many may start in total
 * (`positionMax`), so a FLEX can take a second QB but never a third.
 */

/** The shape MFL exports as `league.starters`. */
export interface MflStarterRules {
  count?: string | number;
  position?: { name?: string; limit?: string | number } | { name?: string; limit?: string | number }[];
}

export interface LineupSlotLayout {
  /** One entry per starting slot, in display order ('FLEX' for a flex slot). */
  positions: string[];
  /** The positions a slot accepts, keyed by slot position. */
  eligibility: Record<string, string[]>;
  /** The most players of a position that may start, across every slot. */
  positionMax: Record<string, number>;
}

/** TheLeague's and the AFL's layout — what the page showed before it read the rules. */
export const DEFAULT_LINEUP_SLOTS: LineupSlotLayout = {
  positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'PK', 'DEF'],
  eligibility: {
    QB: ['QB'],
    RB: ['RB'],
    WR: ['WR'],
    TE: ['TE'],
    FLEX: ['RB', 'WR', 'TE'],
    PK: ['PK'],
    DEF: ['DEF'],
  },
  positionMax: { QB: 1, RB: 4, WR: 4, TE: 4, PK: 1, DEF: 1 },
};

/** Display order; FLEX sits after the skill positions, before PK and DEF. */
const ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'PK', 'DEF'];

/** MFL's position names → the page's (`Def` → `DEF`, `K` → `PK`). */
export function normalizeLineupPosition(name: string): string {
  return String(name).trim().replace(/^Def$/i, 'DEF').replace(/^K$/i, 'PK').toUpperCase();
}

/** `"1-4"` → [1, 4]; `"1"` → [1, 1]; anything else → null. */
function parseRange(limit: string | number | undefined): [number, number] | null {
  const m = String(limit ?? '').trim().match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] === undefined ? lo : Number(m[2]);
  return hi >= lo ? [lo, hi] : null;
}

/**
 * The slot layout for a league's starter rules, or null when the page cannot
 * offer one: missing or unreadable rules, or rules that do not total exactly 9
 * starters — the lineup API takes nine, so a layout of any other size could
 * not be submitted. A package league's route 404s on null rather than show
 * a layout its league would reject.
 */
export function lineupSlotsFor(rules: MflStarterRules | null | undefined): LineupSlotLayout | null {
  if (!rules?.position) return null;
  const list = Array.isArray(rules.position) ? rules.position : [rules.position];
  const count = parseRange(rules.count);
  if (!count) return null;
  // A ranged count ("1-9") is a cap: the page always seats the maximum.
  const total = count[1];
  if (total !== 9) return null;

  const ranges = new Map<string, [number, number]>();
  for (const p of list) {
    const range = parseRange(p?.limit);
    if (!p?.name || !range) return null;
    const pos = normalizeLineupPosition(p.name);
    if (!ORDER.includes(pos) || pos === 'FLEX') return null;
    ranges.set(pos, range);
  }

  const fixed = [...ranges.entries()].flatMap(([pos, [lo]]) => Array<string>(lo).fill(pos));
  const flexCount = total - fixed.length;
  const flexEligible = ORDER.filter((pos) => {
    const r = ranges.get(pos);
    return r !== undefined && r[1] > r[0];
  });
  if (flexCount < 0 || (flexCount > 0 && flexEligible.length === 0)) return null;

  const positions = [...fixed, ...Array<string>(flexCount).fill('FLEX')].sort(
    (a, b) => ORDER.indexOf(a) - ORDER.indexOf(b),
  );
  const eligibility: Record<string, string[]> = {};
  for (const pos of ranges.keys()) eligibility[pos] = [pos];
  if (flexCount > 0) eligibility.FLEX = flexEligible;
  const positionMax: Record<string, number> = {};
  for (const [pos, [, hi]] of ranges) positionMax[pos] = hi;
  return { positions, eligibility, positionMax };
}

/** As lineupSlotsFor, falling back to TheLeague's and the AFL's layout. */
export function deriveLineupSlots(rules: MflStarterRules | null | undefined): LineupSlotLayout {
  return lineupSlotsFor(rules) ?? DEFAULT_LINEUP_SLOTS;
}

/** The slot types a player of `position` may fill under `layout`. */
export function eligibleSlotsFor(position: string, layout: LineupSlotLayout): string[] {
  return Object.entries(layout.eligibility)
    .filter(([, accepts]) => accepts.includes(position))
    .map(([slot]) => slot);
}

/**
 * Whether seating a player of `position` would start more of that position
 * than the league allows. `seatedPositions` is every OTHER filled slot's
 * player position (leave out the slot being replaced).
 */
export function exceedsPositionMax(
  position: string,
  seatedPositions: readonly string[],
  positionMax: Readonly<Record<string, number>>,
): boolean {
  const max = positionMax[position];
  if (max === undefined) return false;
  return seatedPositions.filter((p) => p === position).length >= max;
}
