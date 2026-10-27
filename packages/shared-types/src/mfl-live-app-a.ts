/**
 * The Matchups screen's board — what `/api/live-board?source=mfl` answers the
 * MFL Live app, on top of the base contract in `mfl-live-app.ts`.
 *
 * Everything here is a DECISION the web board makes in site code the app may
 * not import: which state a player's game is in, a row's projected final,
 * whether a matchup is over, how many decimals the score shows, and when to
 * ask again. The server makes each one with the web's own functions and ships
 * the answer, so the phone renders what `/live` renders instead of keeping a
 * second copy of the rules that can drift.
 *
 * Every field is OPTIONAL on the wire: the app ships ahead of the server (a
 * staging build talks to production until the weekly promotion), so it must
 * render an older board that carries none of them.
 *
 * Types only, no runtime code — the app imports this with `import type`.
 * `src/types/mfl-live-app-a-contract.ts` asserts the server's view stays
 * assignable to it.
 */

import type {
  MflLiveAppBoard,
  MflLiveAppLeaguePanel,
  MflLiveAppMatchup,
  MflLiveAppPlayerRow,
  MflLiveAppTeam,
} from './mfl-live-app';

/** MFL's clock for one player's NFL game. Never a fabricated game clock. */
export type MflLiveAppGameState = 'not-started' | 'in-progress' | 'final';

export interface MflLiveAppLiveRow extends MflLiveAppPlayerRow {
  gameState?: MflLiveAppGameState;
  /**
   * Live points plus the league's projection for the game time left; equal
   * to `live` once final. Absent when the league has no projection for him.
   */
  projectedFinal?: number;
}

export interface MflLiveAppLiveTeam extends Omit<MflLiveAppTeam, 'players' | 'bench'> {
  players: MflLiveAppLiveRow[];
  bench: MflLiveAppLiveRow[];
}

export interface MflLiveAppLiveMatchup extends Omit<MflLiveAppMatchup, 'mine' | 'opponent'> {
  mine: MflLiveAppLiveTeam;
  opponent: MflLiveAppLiveTeam;
  /** Every starter's game is over: show Final and drop the win-probability bar. */
  isFinal?: boolean;
}

export interface MflLiveAppLivePanel extends Omit<MflLiveAppLeaguePanel, 'matchups'> {
  matchups: MflLiveAppLiveMatchup[];
  /** Decimal places for every score in this league, as the web board prints them. */
  scorePrecision?: number;
}

export interface MflLiveAppLiveBoard extends Omit<MflLiveAppBoard, 'leagues'> {
  leagues: MflLiveAppLivePanel[];
  /** An NFL game is being played right now (the web's "Live" pill). */
  live?: boolean;
  /**
   * When to ask for the board again, in milliseconds, read off the real NFL
   * schedule: short while games are on or about to kick off, longer when not.
   */
  pollAfterMs?: number;
}
