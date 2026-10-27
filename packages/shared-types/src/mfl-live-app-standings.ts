/**
 * MFL Live standings as the mobile app reads them — the wire contract between
 * `/api/live-standings?source=mfl` and `apps/mobile`.
 *
 * A strict SUBSET of the site's `MflLiveStandings`
 * (src/utils/live/mfl-live-standings.ts): only the fields the app renders.
 * `src/types/mfl-live-app-standings-contract.ts` asserts the site's type stays
 * assignable to this one, so a field renamed on the server breaks the build
 * rather than the app on someone's phone.
 *
 * The app never computes a view itself: every view it may show arrives
 * ready-built in `views`, and a view the viewer may not see is absent.
 *
 * Types only, no runtime code: the app imports it with `import type`.
 */

import type { MflLiveAppIdentityRung } from './mfl-live-app';

/** The three views of a table. Only `final` is MFL's official standing. */
export type MflLiveAppStandingsMode = 'projected' | 'live' | 'final';

export interface MflLiveAppStandingsRow {
  franchiseId: string;
  /** Position in THIS view. */
  rank: number;
  /** MFL's own, official position. Equal to `rank` in `final`. */
  officialRank: number;
  /** officialRank minus rank: positive climbed, negative fell. */
  move: number;
  /** This week's result is added into the record in this view. */
  includesWeek: boolean;
  name: string;
  nameShort: string;
  initials: string;
  /** A site-relative path or an absolute URL; '' when there is none. */
  icon: string;
  iconAlt: string;
  /** Never 'nfl' in store mode. */
  rung: MflLiveAppIdentityRung;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  /** The signed-in owner's own team in this league. */
  isViewer: boolean;
}

export interface MflLiveAppStandingsLeague {
  leagueId: string;
  leagueName: string;
  /**
   * Every view this viewer may see. Null when the league's standings could
   * not be read — show "couldn't read the standings", not an empty table.
   */
  views?: Partial<Record<MflLiveAppStandingsMode, MflLiveAppStandingsRow[]>> | null;
}

export interface MflLiveAppStandings {
  /** False when the server could not assemble the tables; keep the last good ones. */
  ok: boolean;
  week?: number;
  year?: number;
  /** True between seasons and before the Week 1 kickoff. */
  preSeason?: boolean;
  /** Live and Projected need MFL Live Pro; when true they are absent from `views`. */
  proLocked?: boolean;
  leagues?: MflLiveAppStandingsLeague[];
}
