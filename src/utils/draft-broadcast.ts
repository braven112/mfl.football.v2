/**
 * Pure helpers for the AFL live draft broadcast board.
 *
 * Split from the React components (same reason as `pick-reveal.ts`) so the
 * board-state derivation is unit-testable without a DOM. The components own
 * animation and layout; everything here is data → data.
 */

import type { DraftRoomPick, DraftRoomTeam } from '../types/draft-room';
import type { BroadcastPlayer } from '../types/draft-broadcast';

/**
 * Where a player stood among what was ACTUALLY still on the board when he was
 * taken — the number the reveal leads with.
 *
 * Replaces an earlier STEAL/REACH meter that compared the pick number straight
 * against redraft ADP. That was wrong twice over in a keeper league. The AFL
 * keeps 7 per franchise, so 84 players are gone before 1.01 is called and the
 * AFL's 1.01 is really the 85th pick of a from-scratch draft — which made the
 * whole first round read as a reach. And once that scale was corrected the
 * deeper problem showed: past round one the AFL does not draft to redraft ADP
 * at all (its median pick is the ~84th-best available by ADP), so no rescaling
 * makes a verdict honest. A rank is a fact and needs no calibration: taking the
 * top man left still reads as a win, and taking the 90th-best available is
 * visibly a reach without the screen having to say so.
 *
 * Counts only players carrying a `boardRank`, so keepers — who never had one —
 * cannot inflate the position. Returns undefined when the player himself is
 * unranked, which is the honest answer rather than a fabricated placing.
 */
export function bestAvailableAt(
  picks: DraftRoomPick[],
  players: ReadonlyMap<string, BroadcastPlayer>,
  throughPickNumber: number,
  playerId: string
): number | undefined {
  const self = players.get(playerId);
  if (!self?.boardRank) return undefined;

  // Everyone taken BEFORE this pick is off the board. Anything at or after it
  // has not happened yet from this reveal's point of view — a queued reveal
  // must not be re-ranked by picks that landed while it waited its turn.
  const goneBefore = new Set(
    picks
      .filter((p) => p.playerId && p.overallPickNumber < throughPickNumber)
      .map((p) => p.playerId)
  );

  let better = 0;
  for (const p of players.values()) {
    if (!p.boardRank || p.id === playerId) continue;
    if (goneBefore.has(p.id)) continue;
    if (p.boardRank < self.boardRank) better += 1;
  }
  return better + 1;
}

/** English ordinal — 1st, 2nd, 3rd, 11th, 21st. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Room-facing copy. Short — it is read from ten feet away. */
export function formatBestAvailable(rank?: number): string | null {
  if (!rank || !Number.isFinite(rank) || rank < 1) return null;
  return rank === 1 ? 'BEST AVAILABLE' : `${ordinal(rank)} BEST AVAILABLE`;
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
