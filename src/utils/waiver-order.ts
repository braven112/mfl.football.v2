/**
 * Waiver priority — reading MFL's live order and ranking it the ONE way that
 * means anything.
 *
 * MFL stores priority as a per-franchise `waiverSortOrder` on
 * `export?TYPE=league`. Two things about it are load-bearing and are the whole
 * reason this file exists rather than a `.sort()` at the call site:
 *
 * 1. **The number is a flat 1..N across the whole league, but the CONTEST is
 *    per-conference.** The AFL is a duplicate-player league scoped by
 *    conference (registry: `duplicatePlayers: true`, `playerLimitUnit:
 *    CONFERENCE`), so the same player can be held by one team in EACH
 *    conference and two teams in different conferences never contend for the
 *    same claim. MFL serializes the two conference blocks one after the other
 *    (American 1-12, National 13-24), so an owner's raw `waiverSortOrder` of
 *    13 is FIRST in their conference, not thirteenth in line. Showing the flat
 *    number to a National owner would be a lie about their odds. See
 *    docs/claude/afl-rules.md § Setting the waiver order — "anything comparing
 *    orders must compare WITHIN a conference, never the flat 1-24 list, or it
 *    breaks the moment MFL renumbers the blocks."
 *
 * 2. **The order is ROLLING and MFL mutates it all season** as claims are
 *    awarded. That is why the API route reads it live instead of trusting the
 *    synced `league.json` feed: a cached order is wrong the moment somebody's
 *    claim processes, which is precisely when an owner opens this.
 *
 * `rankWithinConference` therefore never shows the raw number — it renumbers
 * the members it was given from 1, in MFL's own relative order.
 */

export interface WaiverOrderEntry {
  franchiseId: string;
  /** MFL's raw league-wide `waiverSortOrder`. Kept for debugging, never shown. */
  sortOrder: number;
}

export interface RankedWaiverTeam {
  franchiseId: string;
  /** 1-based position among the members passed in — the number that decides claims. */
  rank: number;
}

/**
 * Pull `{ franchiseId, sortOrder }` out of an `export?TYPE=league` payload.
 *
 * Tolerant of MFL's two shapes (`franchise` is an array normally, a bare
 * object in a one-franchise league) and drops any franchise whose
 * `waiverSortOrder` is missing or non-numeric rather than coercing it to 0 —
 * a 0 would sort to the front and hand somebody a first-in-line badge they
 * do not have.
 */
export function readWaiverSortOrder(payload: unknown): WaiverOrderEntry[] {
  const raw = (payload as any)?.league?.franchises?.franchise;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];

  const entries: WaiverOrderEntry[] = [];
  for (const f of list) {
    const franchiseId = typeof f?.id === 'string' ? f.id : null;
    if (!franchiseId) continue;
    // `Number('')` is 0, not NaN — an empty waiverSortOrder would otherwise
    // sort to the FRONT and hand that franchise a first-in-line badge it does
    // not have. Require digits before trusting the value.
    const rawOrder = f?.waiverSortOrder;
    if (typeof rawOrder !== 'number' && !(typeof rawOrder === 'string' && rawOrder.trim() !== '')) continue;
    const sortOrder = Number(rawOrder);
    if (!Number.isFinite(sortOrder)) continue;
    entries.push({ franchiseId, sortOrder });
  }
  return entries;
}

/**
 * Rank `memberIds` against each other, 1-based, by MFL's order.
 *
 * `memberIds` is the conference the viewer is actually competing in — pass the
 * whole league for a single-pool league. Members MFL has no order for sort
 * last (stable among themselves) rather than being dropped, so the list stays
 * a complete picture of who the owner is up against.
 */
export function rankWithinConference(
  entries: WaiverOrderEntry[],
  memberIds: readonly string[],
): RankedWaiverTeam[] {
  const orderById = new Map(entries.map((e) => [e.franchiseId, e.sortOrder]));
  const members = [...memberIds];

  return members
    .map((franchiseId, index) => ({
      franchiseId,
      // Unknown → after every known order, tie-broken by the caller's own
      // ordering so the render is stable across reloads.
      sortOrder: orderById.get(franchiseId) ?? Number.POSITIVE_INFINITY,
      index,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index)
    .map(({ franchiseId }, i) => ({ franchiseId, rank: i + 1 }));
}
