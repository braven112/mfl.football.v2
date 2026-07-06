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

/** One queued splash. `id` includes the playerId so an undo + re-pick of the same slot splashes again. */
export interface PickSplashItem {
  id: string;
  /** "1.03" style pick label */
  pickLabel: string;
  team?: DraftRoomTeam;
  player?: DraftRoomPlayer;
}

/**
 * Composites only work over transparent ESPN cutouts — MFL JPGs have baked
 * backgrounds, and DEF "players" are logos, not people. When this returns
 * false the splash shows its text treatment with no cutout.
 */
export function isSplashCutoutEligible(player?: DraftRoomPlayer): boolean {
  if (!player) return false;
  if (player.position?.toUpperCase() === 'DEF') return false;
  return !!player.headshot && player.headshot.includes('espncdn.com');
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

/**
 * Diff the current picks against the previously-seen filled set and return
 * the newly-landed picks in draft order.
 *
 * Returns [] (no splashes) when:
 * - `prevFilled` is null — first observation, the board is history not news
 * - the pick-slot array itself just appeared (`prevSlotCount` 0 → N) — a
 *   mock-session sync delivering the whole scaffold, not a live pick
 * - more than `maxBurst` picks landed in one update — a catch-up after a
 *   rejoin/refresh; replaying a backlog of splashes would be noise
 */
export function collectFreshPicks(
  prevFilled: ReadonlySet<number> | null,
  prevSlotCount: number,
  picks: DraftRoomPick[],
  maxBurst = 3
): DraftRoomPick[] {
  if (prevFilled === null) return [];
  if (prevSlotCount === 0 && picks.length > 0) return [];
  const fresh = picks
    .filter((p) => p.playerId && !prevFilled.has(p.overallPickNumber))
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
