/**
 * A link that opens ONE matchup on a live-scoring board.
 *
 * The board's drill-in is island state, not a route (LiveBoard.tsx), so a
 * matchup has no URL of its own. The homepage scoreboard needs one: each game
 * on it opens that game on the league's live-scoring page. The board reads
 * this parameter once on load and opens the matching card.
 *
 * The value is the board's own `pairingKey` — both franchise ids, SORTED, so
 * home/away order can never make a link miss. A key the board cannot find
 * (a stale link from last week, a typo) just shows the board.
 */
export const LIVE_MATCHUP_PARAM = 'matchup';

/** The order-free key for one pairing, identical to `pairingKey` in model.ts. */
export function matchupLinkKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

/** `base` with the matchup parameter added; `base` is a path, never an origin. */
export function liveMatchupHref(base: string, a: string, b: string): string {
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${LIVE_MATCHUP_PARAM}=${encodeURIComponent(matchupLinkKey(a, b))}`;
}
