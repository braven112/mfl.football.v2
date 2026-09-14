/**
 * The order a matchup's players read in on MFL Live.
 *
 * QB, RB, WR, TE, K, DEF — starters first in that order, then the bench in the
 * same one. Several of a position simply sit together (two backs under RB,
 * three receivers under WR); there is deliberately no FLEX group.
 *
 * ── WHY NO FLEX ───────────────────────────────────────────────────────────
 * Two reasons, and the first is the disqualifying one.
 *
 * WHICH player is the flex would be arbitrary. MFL's `liveScoring` says WHO is
 * starting, never WHERE, so a flex label has to be derived by filling the
 * required slots and calling the leftovers flex — which means the "flex" is
 * whichever back the feed happened to list second. MFL returns arrays in
 * nondeterministic order (docs/claude/rules/storage-and-build.md), so that
 * label can move between two polls of an unchanged lineup. A chip that swaps
 * while you watch is worse than no chip.
 *
 * And it would cost a request per league. Flex cannot be derived without that
 * league's starting requirements, and this board is routinely looking at
 * leagues this site has never heard of — so every one of them would need a
 * `TYPE=league` export purely to label a chip. Position comes free with
 * `PlayerMeta`.
 *
 * ── WHY THE TIEBREAK IS THE PLAYER ID, NOT THE FEED ORDER ─────────────────
 * Same nondeterminism. A sort that falls back to the row's index in the feed
 * is only as stable as the feed's order, so an all-zero lineup on a Sunday
 * morning can reshuffle itself between polls having changed nothing. The id is
 * stable for as long as the player is.
 */

import type { LivePlayerRow, PlayerMeta } from '../types/live-scoring';

/**
 * Reading order. MFL's own vocabulary — `PK` for the kicker and `DEF` for a
 * team defence — because that is what the player feed says; `normalizePosition`
 * maps the spellings that reach us from elsewhere onto it.
 */
export const MFL_LIVE_POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'] as const;

/** What the chip says. `PK` is an MFL-ism no owner calls a kicker. */
const POSITION_LABELS: Record<string, string> = { PK: 'K' };

/**
 * Fold the spellings of one position together.
 *
 * MFL is not self-consistent: `league.starters` spells a team defence `Def`
 * while the player feed spells it `DEF`, and a kicker is `PK` in both but `K`
 * everywhere a human writes it. An unrecognised position is returned as-is and
 * sorts last rather than being forced into a bucket it is not in — a rookie
 * the player map has not caught up with is the least trustworthy row on the
 * board, and filing him under TE because that is where a fallback landed would
 * be a quiet lie about exactly the row that deserves none.
 */
export function normalizePosition(raw: string | null | undefined): string {
  const pos = (raw ?? '').trim().toUpperCase();
  if (!pos) return '';
  if (pos === 'K') return 'PK';
  if (pos === 'DST' || pos === 'D/ST' || pos === 'DEFENSE') return 'DEF';
  return pos;
}

/** The chip's text for a position. */
export function positionLabel(raw: string | null | undefined): string {
  const pos = normalizePosition(raw);
  return POSITION_LABELS[pos] ?? pos;
}

/** Where a position sorts. Unknown positions go last, together. */
export function positionRank(raw: string | null | undefined): number {
  const i = (MFL_LIVE_POSITION_ORDER as readonly string[]).indexOf(normalizePosition(raw));
  return i === -1 ? MFL_LIVE_POSITION_ORDER.length : i;
}

/**
 * Order one list of rows — a lineup or a bench, the same way.
 *
 * Position first, then the highest scorer within each position, then the
 * player id so the result cannot depend on how MFL happened to order the feed.
 * Pure, and it never mutates the input.
 */
export function orderLineupRows(
  rows: readonly LivePlayerRow[],
  meta: Record<string, PlayerMeta>,
): LivePlayerRow[] {
  return [...rows].sort((a, b) => {
    const byPosition = positionRank(meta[a.id]?.position) - positionRank(meta[b.id]?.position);
    if (byPosition !== 0) return byPosition;
    const aLive = Number.isFinite(a.live) ? a.live : 0;
    const bLive = Number.isFinite(b.live) ? b.live : 0;
    if (aLive !== bLive) return bLive - aLive;
    return a.id.localeCompare(b.id);
  });
}
