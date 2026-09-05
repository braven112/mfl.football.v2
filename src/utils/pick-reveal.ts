/**
 * Pick Reveal Splash — pure helpers for the draft-room pick-reveal moment.
 *
 * Split out of the React components so the composite hard rules
 * (espncdn-only cutouts, DEF exclusion) and the fresh-pick diffing that
 * drives the splash queue are unit-testable without a DOM.
 * See docs/claude/insights/features/player-composites.md for the rules.
 */

import type { DraftRoomPick, DraftRoomPlayer, DraftRoomTeam } from '../types/draft-room';
import { getNflTeamColors } from './nfl-team-colors';
import { normalizeTeamCode } from './nfl-logo';
import { isEspnCdnUrl } from './espn-cdn';

/** One queued splash. `id` includes the playerId so an undo + re-pick of the same slot splashes again. */
export interface PickSplashItem {
  id: string;
  /** "1.03" style pick label */
  pickLabel: string;
  team?: DraftRoomTeam;
  player?: DraftRoomPlayer;
}

/**
 * Does a player's origin line name his COLLEGE rather than his NFL team?
 *
 * Rookies read best with the school: their pro team is weeks old and the room
 * knows them by where they played. Everyone else gets the NFL team.
 *
 * Lives here, with the composite rules, because BOTH reveal surfaces ask it —
 * the draft room's splash and the broadcast card — and the two must never
 * disagree about the same pick. It is also what the broadcast's server gates a
 * school-logo lookup on, so a second copy would keep resolving marks for
 * players the card had started labelling with their pro team.
 */
export function usesCollegeOrigin(player?: {
  isRookie?: boolean;
  college?: string;
}): boolean {
  return Boolean(player?.isRookie && player.college);
}

/**
 * Composites only work over transparent ESPN cutouts — MFL JPGs have baked
 * backgrounds, and DEF "players" are logos, not people. When this returns
 * false the splash shows its text treatment with no cutout.
 */
export function isSplashCutoutEligible(player?: DraftRoomPlayer): boolean {
  if (!player) return false;
  if (player.position?.toUpperCase() === 'DEF') return false;
  return !!player.headshot && isEspnCdnUrl(player.headshot);
}

/**
 * Splash gradient colors: the drafting FRANCHISE brands the moment (rookies
 * usually have no NFL team at draft time), falling back to the player's NFL
 * team colors when the franchise has no brand color, then league blue.
 */
export function resolveSplashColors(
  team?: DraftRoomTeam,
  player?: DraftRoomPlayer
): { primary: string; secondary: string } {
  if (team?.colorPrimary) {
    return { primary: team.colorPrimary, secondary: team.colorSecondary || team.colorPrimary };
  }
  const code = player?.nflTeam ? normalizeTeamCode(player.nflTeam) : '';
  if (code) {
    const { primary, secondary } = getNflTeamColors(code);
    return { primary, secondary };
  }
  return { primary: '#1c497c', secondary: '#0e2440' };
}

/** On a slot-array sync, picks older than this are history, not news. */
const SYNC_NEWS_WINDOW_SECONDS = 120;

/**
 * Diff the current picks against the previously-seen filled set and return
 * the newly-landed picks in draft order.
 *
 * Returns [] (no splashes) when:
 * - `prevFilled` is null — first observation, the board is history not news
 * - more than `maxBurst` picks landed in one update — a catch-up after a
 *   rejoin/refresh; replaying a backlog of splashes would be noise
 *
 * When the pick-slot array itself just appeared (`prevSlotCount` 0 → N —
 * a mock-session sync, or live mode's feed publishing at draft start),
 * already-filled picks only count as fresh if their timestamp is recent:
 * joining an in-progress mock shouldn't replay history, but a first pick
 * landing in the same update that publishes the scaffold still splashes.
 *
 * BROADCAST MODE: pass `maxBurst = Infinity` to disable the burst drop. The
 * default exists because a laptop rejoining mid-draft shouldn't replay 40
 * splashes at a user who was reading the board — but on the AFL's TV board
 * (DraftBroadcast.tsx) dropping is the worse failure: a live room that picks
 * fast enough to land 4 selections inside one poll would see NOTHING, and the
 * room notices a missing reveal far more than a slightly delayed one. There it
 * queues and accelerates instead. The slot-sync guard above still applies, so
 * opening the page mid-draft is still history, not a reveal storm.
 */
export function collectFreshPicks(
  prevFilled: ReadonlySet<number> | null,
  prevSlotCount: number,
  picks: DraftRoomPick[],
  maxBurst = 3,
  nowMs = Date.now()
): DraftRoomPick[] {
  if (prevFilled === null) return [];
  const isSlotSync = prevSlotCount === 0 && picks.length > 0;
  const fresh = picks
    .filter((p) => {
      if (!p.playerId || prevFilled.has(p.overallPickNumber)) return false;
      if (!isSlotSync) return true;
      const madeAtSec = parseInt(p.timestamp, 10);
      return (
        Number.isFinite(madeAtSec) &&
        nowMs / 1000 - madeAtSec <= SYNC_NEWS_WINDOW_SECONDS
      );
    })
    .sort((a, b) => a.overallPickNumber - b.overallPickNumber);
  return fresh.length > maxBurst ? [] : fresh;
}

/** Build the splash payload for a landed pick. */
export function buildSplashItem(
  pick: DraftRoomPick,
  teamMap: ReadonlyMap<string, DraftRoomTeam>,
  playerMap: ReadonlyMap<string, DraftRoomPlayer>
): PickSplashItem {
  return {
    id: `${pick.overallPickNumber}-${pick.playerId}`,
    pickLabel: `${pick.round}.${String(pick.pickInRound).padStart(2, '0')}`,
    team: teamMap.get(pick.franchiseId),
    player: playerMap.get(pick.playerId),
  };
}
