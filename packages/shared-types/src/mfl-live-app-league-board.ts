/**
 * One league's board as the mobile app reads it — the wire contract between
 * `/api/league-board?mfl=<id>&source=mfl` and the app's league screen.
 *
 * Every matchup in the league, the week's top scorers and MFL's own standings,
 * like `/live/league/<id>` on the web. A strict SUBSET of the site's
 * `LiveBoard` (src/types/live.ts): only the fields the app renders. The site's
 * type must stay assignable to this one, and
 * `src/types/mfl-live-app-league-board-contract.ts` asserts that at type-check
 * time, so a field renamed on the server breaks the build rather than the app
 * on someone's phone.
 *
 * Types only, no runtime code: the app imports it with `import type`.
 */

import type {
  MflLiveAppIdentityRung,
  MflLiveAppLeagueStatus,
  MflLiveAppPlayerMeta,
  MflLiveAppTeam,
} from './mfl-live-app';

/**
 * One pairing. Unlike the Matchups board there is no "mine" and "opponent":
 * most matchups on a league board are other people's, so the two sides are
 * listed in MFL's order and `viewerSide` says which one, if either, is the
 * viewer's.
 */
export interface MflLiveAppBoardMatchup {
  index: number;
  sides: [MflLiveAppTeam, MflLiveAppTeam];
  /** Which side is the viewer's franchise, or null when neither is. */
  viewerSide: 0 | 1 | null;
  /** Side 0's win probability, 0-1. */
  p0: number;
  /** No projections in this league: do not draw win probability or projected finals. */
  noProjections?: boolean;
}

/**
 * One row of MFL's standings, in MFL's order. Never re-sort these rows: MFL's
 * order already applies the league's tiebreakers.
 */
export interface MflLiveAppStandingsRow {
  franchiseId: string;
  /** 1-based position in MFL's order. */
  rank: number;
  name: string;
  nameShort: string;
  initials: string;
  icon: string;
  iconAlt: string;
  rung: MflLiveAppIdentityRung;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  isViewer: boolean;
}

export interface MflLiveAppLeaderTeam {
  franchiseId: string;
  name: string;
  nameShort: string;
  initials: string;
  icon: string;
  iconAlt: string;
  rung: MflLiveAppIdentityRung;
  live: number;
  yetToPlay: number;
}

/** A top individual score. The name comes from `playerMeta[playerId]`. */
export interface MflLiveAppLeaderPlayer {
  playerId: string;
  /** Every franchise starting him — never empty. */
  owners: Array<{ franchiseId: string; franchiseName: string }>;
  points: number;
  /** 0 once his game is final. */
  secondsRemaining: number;
}

export interface MflLiveAppLeaders {
  teams: MflLiveAppLeaderTeam[];
  players: MflLiveAppLeaderPlayer[];
}

export interface MflLiveAppBoardPanel {
  leagueId: string;
  leagueName: string;
  registered: boolean;
  /** The viewer's franchise in THIS league, or null. */
  viewerFranchiseId: string | null;
  status: MflLiveAppLeagueStatus;
  matchups: MflLiveAppBoardMatchup[];
  /** Decimal places the league shows points with; absent means the default. */
  scorePrecision?: number;
  /** `null` means the standings could not be read — not an empty league. */
  standings?: MflLiveAppStandingsRow[] | null;
  leaders?: MflLiveAppLeaders | null;
}

export interface MflLiveAppLeagueBoard {
  /** False when the board could not be assembled; keep the last good one. */
  ok: boolean;
  /** 0 when no NFL week is running (the offseason and before Week 1). */
  week: number;
  year: number;
  fetchedAt: string;
  /** Exactly one panel: this league. */
  panels: MflLiveAppBoardPanel[];
  playerMeta: Record<string, MflLiveAppPlayerMeta>;
}

/**
 * Everything the endpoint can answer with a 200. A failed read is
 * `{ ok: false }` with nothing else, so check `ok` before reading `panels`.
 */
export type MflLiveAppLeagueBoardResponse = MflLiveAppLeagueBoard | { ok: false; error?: string };
