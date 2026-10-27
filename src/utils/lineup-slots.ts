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

export interface LineupSlotsOptions {
  /**
   * Accept any MFL league's rules: any starter count and any position
   * (IDP included). The MFL Football app sets lineups in leagues that aren't
   * ours, whose import takes their own count; the site's pages and API take
   * nine and stay on the strict default.
   */
  anyLeague?: boolean;
}

/**
 * The slot layout for a league's starter rules, or null when the page cannot
 * offer one: missing or unreadable rules, or rules that do not total exactly 9
 * starters — the lineup API takes nine, so a layout of any other size could
 * not be submitted. A package league's route 404s on null rather than show
 * a layout its league would reject.
 */
export function lineupSlotsFor(
  rules: MflStarterRules | null | undefined,
  opts: LineupSlotsOptions = {},
): LineupSlotLayout | null {
  if (!rules?.position) return null;
  const list = Array.isArray(rules.position) ? rules.position : [rules.position];
  const count = parseRange(rules.count);
  if (!count) return null;
  // A ranged count ("1-9") is a cap: the page always seats the maximum.
  const total = count[1];
  if (!opts.anyLeague && total !== 9) return null;

  const ranges = new Map<string, [number, number]>();
  for (const p of list) {
    const range = parseRange(p?.limit);
    if (!p?.name || !range) return null;
    const pos = normalizeLineupPosition(p.name);
    if (pos === 'FLEX') return null;
    if (!ORDER.includes(pos) && !opts.anyLeague) return null;
    ranges.set(pos, range);
  }
  // Positions the site's leagues never start (IDP: DL, LB, DB…) sort after
  // DEF in MFL's own order. Only reachable with `anyLeague`.
  const order = [...ORDER, ...[...ranges.keys()].filter((pos) => !ORDER.includes(pos))];

  const fixed = [...ranges.entries()].flatMap(([pos, [lo]]) => Array<string>(lo).fill(pos));
  const flexCount = total - fixed.length;
  const flexEligible = order.filter((pos) => {
    const r = ranges.get(pos);
    return r !== undefined && r[1] > r[0];
  });
  if (flexCount < 0 || (flexCount > 0 && flexEligible.length === 0)) return null;

  const positions = [...fixed, ...Array<string>(flexCount).fill('FLEX')].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b),
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

export interface SlotCandidate {
  id: string;
  position: string;
  gameLocked: boolean;
}

export interface AssignedSlot {
  position: string;
  index: number;
  playerId: string | null;
  locked: boolean;
}

/**
 * Seat `candidates` (already filtered and ordered: a saved lineup's starters,
 * or legal starters best-projection first) into the layout's slots. Fixed
 * positions fill first, then each FLEX takes the best remaining flex-eligible
 * player without starting more of a position than the league allows.
 *
 * Shared by the Set Lineup page and the MFL Football app's lineup endpoint,
 * so the phone opens on the same lineup the page would.
 */
export function assignLineupSlots(candidates: readonly SlotCandidate[], layout: LineupSlotLayout): AssignedSlot[] {
  const slots: AssignedSlot[] = layout.positions.map((position, index) => ({
    position,
    index,
    playerId: null,
    locked: false,
  }));
  const used = new Set<string>();
  const byId = new Map(candidates.map((p) => [p.id, p]));

  // Pass 1: position-specific slots (non-FLEX)
  for (const slot of slots) {
    if (slot.position === 'FLEX') continue;
    const player = candidates.find((p) => p.position === slot.position && !used.has(p.id));
    if (player) {
      used.add(player.id);
      slot.playerId = player.id;
      slot.locked = player.gameLocked;
    }
  }

  // Pass 2: FLEX slots, never past a position's maximum (a FLEX may take a
  // second QB in Archie's, never a third).
  for (const slot of slots) {
    if (slot.position !== 'FLEX') continue;
    const seated = slots
      .filter((s) => s.playerId)
      .map((s) => byId.get(s.playerId as string)?.position ?? '');
    const player = candidates.find((p) =>
      !used.has(p.id)
      && eligibleSlotsFor(p.position, layout).includes('FLEX')
      && !exceedsPositionMax(p.position, seated, layout.positionMax));
    if (player) {
      used.add(player.id);
      slot.playerId = player.id;
      slot.locked = player.gameLocked;
    }
  }
  return slots;
}
