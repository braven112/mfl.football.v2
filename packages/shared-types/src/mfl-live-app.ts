/**
 * The MFL Live board as the mobile app reads it — the wire contract between
 * `/api/live-board?source=mfl` and `apps/mobile`.
 *
 * A strict SUBSET of the site's `MflLiveBoard` (src/types/mfl-live.ts): only
 * the fields the app renders. The site's type must stay assignable to this
 * one, and `src/types/mfl-live-app-contract.ts` asserts that at type-check
 * time, so a field renamed on the server breaks the build rather than the
 * app on someone's phone.
 *
 * Types only, no runtime code: the app imports it with `import type`, so
 * nothing from outside `apps/mobile` is bundled into the app.
 */

/** Why a league has no matchups — see the site's `MflLiveLeagueStatus`. */
export type MflLiveAppLeagueStatus = 'ok' | 'no-matchup' | 'not-played' | 'unavailable';

/** Which rung of the identity ladder named a franchise. Never 'nfl' in store mode. */
export type MflLiveAppIdentityRung = 'league' | 'mfl' | 'nfl' | 'text';

/** One starter or bench row. Name and position come from `playerMeta`. */
export interface MflLiveAppPlayerRow {
  id: string;
  live: number;
  /** Seconds of the player's NFL game left; 0 once it is final. */
  secondsRemaining: number;
  status: string;
  /** This league's projection for the player, when it has one. */
  projected?: number;
}

export interface MflLiveAppTeam {
  franchiseId: string;
  name: string;
  nameShort: string;
  /** Up to two characters, for when there is no icon. */
  initials: string;
  /** A site-relative path or an absolute URL; '' when there is none. */
  icon: string;
  iconAlt: string;
  rung: MflLiveAppIdentityRung;
  live: number;
  projectedFinal: number;
  yetToPlay: number;
  /** Starters only, in lineup order. Never sum the bench into a score. */
  players: MflLiveAppPlayerRow[];
  bench: MflLiveAppPlayerRow[];
}

export interface MflLiveAppMatchup {
  index: number;
  mine: MflLiveAppTeam;
  opponent: MflLiveAppTeam;
  /** MY win probability, 0-1. */
  winProbability: number;
  /** No projections in this league: do not draw win probability or projected finals. */
  noProjections?: boolean;
}

export interface MflLiveAppLeaguePanel {
  leagueId: string;
  leagueName: string;
  franchiseId: string;
  registered: boolean;
  status: MflLiveAppLeagueStatus;
  matchups: MflLiveAppMatchup[];
}

export interface MflLiveAppPlayerMeta {
  id: string;
  name: string;
  position: string;
  /** NFL team code (KC, WSH, …), shown as text only. */
  nflTeam: string;
}

export interface MflLiveAppBoard {
  /** False when the server could not assemble the board; keep the last good one. */
  ok: boolean;
  week: number;
  year?: number;
  fetchedAt?: string;
  /** True between seasons and before the Week 1 kickoff. */
  preSeason?: boolean;
  leagues: MflLiveAppLeaguePanel[];
  playerMeta: Record<string, MflLiveAppPlayerMeta>;
}

/** What `/api/auth/login` answers the app. */
export interface MflLiveAppLoginResponse {
  success: boolean;
  message?: string;
  /** The session token, present only for `client: 'mfl-live-app'`. */
  token?: string;
  user?: {
    userId: string;
    username: string;
    franchiseId: string;
    leagueId: string;
    role: string;
  };
}
