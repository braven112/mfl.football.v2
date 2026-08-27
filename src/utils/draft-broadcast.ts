/**
 * Pure helpers for the AFL live draft broadcast board.
 *
 * Split from the React components (same reason as `pick-reveal.ts`) so the
 * value math and board-state derivation are unit-testable without a DOM. The
 * components own animation and layout; everything here is data → data.
 */

import type { DraftRoomPick, DraftRoomTeam } from '../types/draft-room';
import type { BroadcastPlayer, PickValue } from '../types/draft-broadcast';

/**
 * A selection this far from ADP is just the draft working as intended. Below
 * the threshold the board says "on script" rather than crying steal on a
 * two-pick wobble — a meter that fires on everything stops meaning anything.
 */
export const VALUE_THRESHOLD_PICKS = 8;

/**
 * Compare a selection to where the player normally goes.
 *
 * `averagePick` is preferred over `adpRank` because it's a real pick number on
 * the same scale as `overallPickNumber`. Rank is an ORDINAL — comparing "the
 * 14th-ranked player went 20th" is only coincidentally meaningful, and in a
 * 12-team league the two scales drift apart fast.
 *
 * Sign convention: positive delta = taken later than ADP = value gained.
 */
export function computePickValue(
  overallPickNumber: number,
  player?: Pick<BroadcastPlayer, 'adpAveragePick'>
): PickValue {
  const adp = player?.adpAveragePick;
  if (!adp || !Number.isFinite(adp) || !Number.isFinite(overallPickNumber)) {
    return { verdict: 'unknown', delta: 0 };
  }

  const delta = overallPickNumber - adp;
  if (Math.abs(delta) < VALUE_THRESHOLD_PICKS) {
    return { verdict: 'on-script', delta: Math.round(Math.abs(delta)), adp };
  }
  return {
    verdict: delta > 0 ? 'steal' : 'reach',
    delta: Math.round(Math.abs(delta)),
    adp,
  };
}

/** Room-facing copy for the value meter. Short — it's read from ten feet away. */
export function formatPickValue(value: PickValue): string | null {
  switch (value.verdict) {
    case 'steal':
      return `STEAL · ${value.delta} picks past ADP`;
    case 'reach':
      return `REACH · ${value.delta} picks early`;
    case 'on-script':
      return 'RIGHT ON SCRIPT';
    default:
      return null;
  }
}

/**
 * The next unfilled slot — who the room is waiting on.
 *
 * Scans for the first EMPTY slot rather than taking the last filled one + 1:
 * MFL lets a commissioner fill a slot out of order, and "one past the last
 * pick made" would then skip whoever is actually still on the clock.
 */
export function findOnTheClock(picks: DraftRoomPick[]): DraftRoomPick | null {
  return picks.find((p) => !p.playerId) ?? null;
}

/** The most recent selections, newest first, for the idle ticker. */
export function recentPicks(picks: DraftRoomPick[], limit = 4): DraftRoomPick[] {
  return picks
    .filter((p) => !!p.playerId)
    .sort((a, b) => b.overallPickNumber - a.overallPickNumber)
    .slice(0, limit);
}

/** The slots after the one on the clock — "next up" on the idle screen. */
export function upcomingPicks(picks: DraftRoomPick[], limit = 3): DraftRoomPick[] {
  const clock = findOnTheClock(picks);
  if (!clock) return [];
  return picks
    .filter((p) => !p.playerId && p.overallPickNumber > clock.overallPickNumber)
    .slice(0, limit);
}

/**
 * How many of `position` went in the last `window` picks — the "run" callout.
 *
 * Counts the window INCLUDING the pick just made, so the reveal can say "4th
 * RB in 6 picks" about itself. Returns 0 for an unknown position rather than
 * guessing.
 */
export function positionRunCount(
  picks: DraftRoomPick[],
  players: ReadonlyMap<string, BroadcastPlayer>,
  throughPickNumber: number,
  position: string,
  window = 8
): number {
  if (!position) return 0;
  const target = position.toUpperCase();
  const lowBound = throughPickNumber - window;
  return picks.filter((p) => {
    if (!p.playerId) return false;
    if (p.overallPickNumber > throughPickNumber || p.overallPickNumber <= lowBound) return false;
    return (players.get(p.playerId)?.position || '').toUpperCase() === target;
  }).length;
}

/**
 * Median of the ranks a player carries across the built-in sources.
 *
 * Median rather than mean because the source list mixes formats — the
 * superflex board ranks QBs 30+ slots above every other source, and one such
 * outlier moves a mean enough to make the chip wrong.
 */
export function medianRank(ranks: number[]): number | undefined {
  const valid = ranks.filter((r) => Number.isFinite(r)).sort((a, b) => a - b);
  if (valid.length === 0) return undefined;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0
    ? Math.round((valid[mid - 1] + valid[mid]) / 2)
    : valid[mid];
}

/** Index teams by franchise id for O(1) lookup during a reveal. */
export function teamMap(teams: DraftRoomTeam[]): Map<string, DraftRoomTeam> {
  return new Map(teams.map((t) => [t.franchiseId, t]));
}

/** Index players by MFL id. */
export function playerMap(players: BroadcastPlayer[]): Map<string, BroadcastPlayer> {
  return new Map(players.map((p) => [p.id, p]));
}

/**
 * Trim the board to the picks a rehearsal should have "already made".
 *
 * Used with `?rehearse=N` against a COMPLETED season so the page can be driven
 * end-to-end before draft night. Emptied slots keep their franchise and pick
 * numbers — only the player is cleared — so the board still knows who is on
 * the clock.
 */
export function applyRehearsal(picks: DraftRoomPick[], upTo: number): DraftRoomPick[] {
  return picks.map((p) =>
    p.overallPickNumber <= upTo ? p : { ...p, playerId: '', timestamp: '' }
  );
}
