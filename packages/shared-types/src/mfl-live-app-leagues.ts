/**
 * Which leagues MFL Live watches, as the mobile app reads and changes it — the
 * wire contract between `/api/live-leagues` and `apps/mobile`'s Leagues tab.
 *
 * The choice is stored per MFL account on the server, so the phone and
 * `/live/settings` show and change the same answer. Only MFL leagues are
 * listed: the app is store-safe and never shows a Sleeper league, but the
 * server keeps any Sleeper leagues the owner switched on for the web.
 *
 * `src/types/mfl-live-app-leagues-contract.ts` asserts the server's response
 * still fits these types, so a renamed field breaks the site's type check
 * rather than the app on someone's phone.
 *
 * Types only, no runtime code: the app imports it with `import type`.
 */

/** One switch on the Leagues tab. */
export interface MflLiveAppLeagueChoice {
  /** MFL league id. */
  id: string;
  name: string;
  /** The owner's own team in that league; '' when MFL did not name it. */
  franchiseName: string;
  enabled: boolean;
  /**
   * True for the only league still switched on. It cannot be switched off:
   * an empty selection means "the default", which is every league, so the tap
   * would turn them all back on. Show the switch disabled.
   */
  locked: boolean;
}

/** `GET /api/live-leagues` (and a successful POST). */
export interface MflLiveAppLeagues {
  ok: true;
  leagues: MflLiveAppLeagueChoice[];
  /**
   * False while the owner has never chosen: everything is on, and a league
   * they join later will appear switched on by itself.
   */
  explicit: boolean;
}

/** `POST /api/live-leagues` body from the app: switch one league on or off. */
export interface MflLiveAppLeagueToggle {
  league: string;
  enabled: boolean;
}

export type MflLiveAppLeaguesErrorReason =
  | 'unauthenticated'
  | 'bad-selection'
  | 'unknown-league'
  | 'last-league'
  | 'load-failed'
  | 'save-failed';

export interface MflLiveAppLeaguesError {
  ok: false;
  reason: MflLiveAppLeaguesErrorReason;
}
