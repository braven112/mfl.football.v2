/**
 * Roster row shaping — ordering and the divider/striping flags the table reads.
 *
 * These lived twice in `rosters.astro`: once in the frontmatter for the
 * server-rendered first paint, once in the inline client script for every
 * re-render after hydration. The two copies had drifted, which is the whole
 * argument for this module existing.
 *
 * Where they drifted, the difference is an explicit option here rather than a
 * silent difference between two function bodies. Each call site passes the
 * behavior it has today, so extracting changed nothing — but the divergence is
 * now visible in a signature instead of buried in a duplicate, and whoever
 * decides which variant is correct can do it in one place.
 *
 * See `docs/plans/rosters-page-split.md`.
 */

export interface RosterRowLike {
  position?: string | null;
  salary?: unknown;
  displayTag?: string | null;
  [key: string]: unknown;
}

/**
 * Rank a position against the league's configured ordering. Anything unknown
 * or empty sorts last, which is why the fallback is the array length rather
 * than -1.
 */
export function getPositionRank(pos: string | null | undefined, positionOrder: string[]): number {
  if (!pos) return positionOrder.length;
  const rank = positionOrder.indexOf(String(pos).toUpperCase());
  return rank === -1 ? positionOrder.length : rank;
}

export interface SortByPositionOptions {
  /**
   * How to read a salary for the tiebreak.
   *
   * The server copy ran salaries through `parseNumber` because feed values can
   * arrive as strings like "5,000,000"; the client copy used `salary ?? 0`
   * because by then they are already numeric. Passing the reader keeps both
   * call sites exactly as they behave today.
   */
  readSalary?: (value: unknown) => number;
}

/** Position order first, then salary descending within a position. */
export function sortByPosition<T extends RosterRowLike>(
  list: T[],
  positionOrder: string[],
  { readSalary = (v) => Number(v ?? 0) || 0 }: SortByPositionOptions = {},
): T[] {
  return list.slice().sort((a, b) => {
    const diff =
      getPositionRank(a.position ?? '', positionOrder)
      - getPositionRank(b.position ?? '', positionOrder);
    if (diff !== 0) return diff;
    return readSalary(b.salary) - readSalary(a.salary);
  });
}

export interface PositionDividerOptions {
  /**
   * Whether row 0 gets a leading divider.
   *
   * Server said yes, client said no — so the SSR first paint drew a rule above
   * the first player and the hydrated re-render did not. Both behaviors are
   * preserved by their call sites; unifying them is a deliberate decision, not
   * something to do by accident while extracting.
   */
  dividerOnFirstRow?: boolean;
  /**
   * Whether the LAST row counts as ending its position group.
   *
   * Server said no (`!!next && …`), client said yes (`!next || …`). Same
   * situation as above.
   */
  dividerEndOnLastRow?: boolean;
}

/**
 * Flag the first and last row of each position group so the table can draw
 * group rules.
 */
export function annotatePositionDividers<T extends RosterRowLike>(
  rows: T[] = [],
  { dividerOnFirstRow = false, dividerEndOnLastRow = true }: PositionDividerOptions = {},
): Array<T & { positionDivider: boolean; positionDividerEnd: boolean; _positionGroup: string }> {
  const normalized = rows.map((player, index) => {
    const prevPosition = index > 0 ? String(rows[index - 1].position ?? '').toUpperCase() : null;
    const current = String(player.position ?? '').toUpperCase();
    const changed = index > 0 && current !== prevPosition;
    return {
      ...player,
      positionDivider: (dividerOnFirstRow && index === 0) || changed,
      _positionGroup: current,
    };
  });

  return normalized.map((player, index) => {
    const next = normalized[index + 1];
    const positionDividerEnd = next
      ? (next._positionGroup ?? '') !== (player._positionGroup ?? '')
      : dividerEndOnLastRow;
    return { ...player, positionDividerEnd };
  });
}

/**
 * Flag the boundary where the roster crosses out of the active bucket into
 * practice squad / IR. Note the `!== 'active'` guard: crossing BACK to active
 * never draws a rule.
 */
export function annotateTierDividers<T extends RosterRowLike>(
  rows: T[] = [],
): Array<T & { tierDivider: boolean }> {
  let lastTag: string | null = null;
  return rows.map((player) => {
    const currentTag = String(player.displayTag ?? 'active');
    const tierDivider = lastTag !== null && currentTag !== lastTag && currentTag !== 'active';
    lastTag = currentTag;
    return { ...player, tierDivider };
  });
}

/**
 * Zebra-stripe the active rows only — the counter deliberately does not
 * advance on practice/IR rows, so striping stays continuous across them.
 */
export function annotateActiveStriping<T extends RosterRowLike>(
  rows: T[] = [],
): Array<T & { activeStripe: boolean }> {
  let activeIndex = 0;
  return rows.map((player) => {
    if (String(player.displayTag ?? 'active') === 'active') {
      const striped = activeIndex % 2 === 1;
      activeIndex += 1;
      return { ...player, activeStripe: striped };
    }
    return { ...player, activeStripe: false };
  });
}
