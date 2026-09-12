/**
 * Live Scoring Broadcast — the shapes that cross the boundaries.
 *
 * Three boundaries, and they are not the same:
 *  - SERVER → ISLAND, once, as `pageData` (identity, colours, crests, names).
 *    Everything expensive and everything that cannot change during a Sunday.
 *  - SERVER → ISLAND, every poll, as `BroadcastPollResponse`. Only numbers and
 *    events. No colour, no crest, no name — those never change mid-afternoon
 *    and re-sending them would multiply the payload by the number of leagues.
 *  - NEVER: an ESPN athlete id. `PlayerMeta.espnId` can hold a COLLEGE athlete
 *    id and college/NFL ids are both plain digits, so every join happens
 *    server-side against `PlayerIdentity.nflEspnId` and only MFL player ids
 *    reach the client.
 */

import type { LivePlayerRow, NflGame, PlayerMeta } from './live-scoring';
import type { BroadcastMoment, RedZoneAlert } from '../utils/broadcast-moments';

/** One franchise as the board draws it. */
export interface BroadcastTeam {
  franchiseId: string;
  /** Full name, for the widest density tiers. */
  name: string;
  /** `chooseTeamName(..., 'short')`, resolved server-side. */
  nameShort: string;
  /** `chooseTeamName(..., 'abbrev')`, resolved server-side. */
  abbrev: string;
  /** Big crest for a reveal — `resolveBroadcastCrest` resolution order. */
  icon: string;
  /** Small crest for a player row — the dark-first order. */
  iconSmall: string;
  /** Stroke index for the crest's inline ring; 0 when it needs none. */
  crestStroke: number;
  /** `toBroadcastPair().primary` — safe to paint white text on. */
  primary: string;
  /** `toBroadcastPair().secondary`. */
  secondary: string;
  /** `resolveBroadcastGradient(team)`, or '' when the franchise declares none. */
  gradient: string;
}

/**
 * One matchup on the board.
 *
 * `index` is its position within the league's week, so a doubleheader renders
 * "Game 1 / Game 2" without the component having to count. A doubleheader is
 * detected from the FEED — the viewer's franchise appearing in two of MFL's
 * pairings — never from the calendar: the late doubleheader week is whichever
 * of Week 12/13 is bye-free that year, and copying last year's number has
 * shipped a doubleheader onto a bye twice.
 */
export interface BroadcastMatchup {
  index: number;
  mine: BroadcastTeam;
  opponent: BroadcastTeam | null;
}

/** One league's panel in the fixed header. */
export interface BroadcastLeaguePanel {
  leagueId: string;
  leagueName: string;
  /** Registry slug, or '' for a league this site does not run. */
  slug: string;
  /** The viewer's franchise id in this league. */
  franchiseId: string;
  matchups: BroadcastMatchup[];
  /**
   * Why this panel has no numbers, when it has none. The panel KEEPS its full
   * height either way — removing one mid-afternoon re-lays out every other
   * panel, which is the exact motion a fixed header exists to prevent.
   */
  status: 'ok' | 'no-matchup' | 'unavailable';
}

/** The live numbers for one franchise. Everything here changes on a poll. */
export interface BroadcastTeamScore {
  live: number;
  projectedFinal: number;
  /** Projected points still to come. Feeds the win-probability spread. */
  remainingPoints: number;
  yetToPlay: number;
  /** Starter rows — the rows that score this matchup. Bench never appears. */
  players: LivePlayerRow[];
}

/** One league's live numbers, keyed by franchise id. */
export interface BroadcastLeagueScore {
  leagueId: string;
  /**
   * False when this league's upstream read failed. Distinct from "the feed is
   * healthy and says nothing" — an unplayed week is a full payload of zeros
   * and must not render as an outage, nor an outage as a shutout.
   */
  ok: boolean;
  /** True when MFL is actually scoring this week (`hasLiveSignal`). */
  live: boolean;
  teams: Record<string, BroadcastTeamScore>;
  /** Home win probability per matchup index, 0-1. */
  winProbability: number[];
}

/** What one poll returns. Numbers and events only. */
export interface BroadcastPollResponse {
  /**
   * False when the assembler itself failed. `{}` is truthy and `res.ok` is not
   * "the data is good" — both halves of the board gate on this flag, or a
   * healthy-looking poll wipes every score off a live screen.
   */
  ok: boolean;
  week: number;
  fetchedAt: string;
  leagues: BroadcastLeagueScore[];
  /** Reveal-worthy events across every enabled league, already sided. */
  moments: BroadcastMoment[];
  /** Drives in progress involving the viewer's players. Derived fresh, never latched. */
  redZone: RedZoneAlert[];
  /** The real NFL slate — the only source of a game clock this board will print. */
  games: NflGame[];
  /** Per-player identity for anyone new since the first paint (a promoted starter). */
  playerMeta?: Record<string, PlayerMeta>;
}

/** Everything the island needs once, at mount. */
export interface LiveBroadcastPageData {
  week: number;
  year: number;
  /** Enabled league ids, in board order. */
  enabled: string[];
  panels: BroadcastLeaguePanel[];
  /** Identity for every player on the board at first paint. */
  playerMeta: Record<string, PlayerMeta>;
  /** The first paint's numbers, so nothing waits on a client fetch. */
  initial: BroadcastPollResponse;
  /** Sound is opt-in; see `resolveBroadcastSound`. */
  sound: boolean;
  /** Every league the owner is in, for the picker. */
  available: { id: string; name: string; registered: boolean; enabled: boolean }[];
  /** Where the picker's links point. */
  pathname: string;
}
