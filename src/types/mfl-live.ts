/**
 * The MFL Live board's view model — what `/live` renders and what each poll
 * replaces.
 *
 * Deliberately NOT the broadcast board's shapes. The two boards share their
 * DATA layer (`cross-league-live.ts`) and nothing above it: `/broadcast` needs
 * reveal queues, takeover panels and burn-in state for a television, and this
 * needs a scannable list of rows that open. One set of types serving both
 * would be a type that describes neither.
 */

import type { LivePlayerRow, NflGame, PlayerMeta } from './live-scoring';
import type { BroadcastMoment, RedZoneAlert } from '../utils/broadcast-moments';
import type { IdentityRung } from '../utils/mfl-live-identity';

/** One franchise on the board: who they are, and what they have scored. */
export interface MflLiveTeam {
  franchiseId: string;
  name: string;
  nameShort: string;
  /** Up to two characters — the mark on the text rung, and the icon's fallback. */
  initials: string;
  /** Crest, NFL club mark, or '' when the identity ladder reached text. */
  icon: string;
  iconAlt: string;
  /** Which rung of the ladder answered, so the row can render it honestly. */
  rung: IdentityRung;
  live: number;
  projectedFinal: number;
  yetToPlay: number;
  /**
   * STARTERS only, for the expanded view. Bench rows travel in their own map
   * upstream precisely so nothing can sum them by accident — a bench row here
   * inflates the projected final with points that cannot be scored.
   */
  players: LivePlayerRow[];
}

export interface MflLiveMatchup {
  index: number;
  mine: MflLiveTeam;
  opponent: MflLiveTeam;
  /**
   * MY win probability, 0-1 — stated from the viewer's side, never "home".
   * A home-relative number means the opposite thing depending on which side of
   * the pairing MFL happened to put the owner on.
   */
  winProbability: number;
  /**
   * Split-bar colours, both themes, as CSS custom properties. Two of each
   * because this board has a light card and a dark one and the legible answer
   * differs — resolved server-side by `resolveTeamColorPair` against each
   * ground, exactly as the live-scoring island already does.
   */
  colorVars: Record<string, string>;
}

/**
 * Why a league has no matchups to show. FOUR states, not two — the whole
 * reason `hasSignal` rides alongside `ok`:
 *
 *  - `ok`          — matchups below.
 *  - `no-matchup`  — feed is fine and scoring, this owner simply has no
 *                    pairing this week. A bye is a fact, not a fault.
 *  - `not-played`  — feed is fine and nothing has kicked off. An unplayed
 *                    week is a well-formed payload of zeros, and printing it
 *                    as "0.0 – 0.0 final" is the bug this state exists to
 *                    prevent.
 *  - `unavailable` — we could not read it. Never conflated with the above:
 *                    "the feed says nothing" and "we could not reach the
 *                    feed" are different facts all the way to the UI.
 */
export type MflLiveLeagueStatus = 'ok' | 'no-matchup' | 'not-played' | 'unavailable';

export interface MflLiveLeaguePanel {
  leagueId: string;
  leagueName: string;
  franchiseId: string;
  /** Registry slug, or null for a league this site does not run. */
  slug: string | null;
  /** True when this site runs the league — drives the "not on this site" tag. */
  registered: boolean;
  status: MflLiveLeagueStatus;
  matchups: MflLiveMatchup[];
}

/** One assembly of the whole board. A poll replaces this wholesale. */
export interface MflLiveBoard {
  /**
   * False when the ASSEMBLER failed. An individual league's failure rides on
   * its own `status` — one dead feed is not an outage, and the island must be
   * able to keep its last good payload when this is false rather than wiping
   * a live screen.
   */
  ok: boolean;
  week: number;
  year: number;
  fetchedAt: string;
  leagues: MflLiveLeaguePanel[];
  /**
   * The NFL slate for the week — the rail across the top.
   *
   * ESPN's scoreboard is a WEEK, not a day: Thursday through Monday arrive
   * together. Anything deciding "is football happening" from this has to read
   * the CLOCK rather than count states, because "some game is `pre`" is true
   * from Thursday lunchtime to Monday night.
   */
  games: NflGame[];
  /**
   * Scoring and big plays, already attributed to an owner in a league.
   *
   * A play can legitimately appear MORE than once. The same NFL player is
   * routinely started in several of an owner's leagues — and in the AFL, whose
   * rosters duplicate players, by both sides of one matchup — so one touchdown
   * really is several pieces of news. Each row names its league and franchise,
   * which is what keeps that honest rather than confusing; collapsing them
   * would silently drop the credit from every league but one.
   */
  moments: BroadcastMoment[];
  /**
   * Teams of the viewer's with the ball inside the 20, right now.
   *
   * Derived fresh every poll rather than latched: a drive that ends in a
   * score, a turnover or a punt simply stops producing an alert and the
   * banner goes away by itself.
   */
  redZone: RedZoneAlert[];
  /**
   * Player identity for every starter on the board, keyed by MFL player id.
   * Shipped once alongside the rows rather than per row — the same player is
   * routinely started in several of an owner's leagues.
   *
   * `projected` here is always 0 and nothing reads it: a projection belongs to
   * a player IN A LEAGUE, and this map is shared across all of them.
   */
  playerMeta: Record<string, PlayerMeta>;
}

/** What the page hands the island once, on first paint. */
export interface MflLivePageProps {
  board: MflLiveBoard;
  /** Every league the account is in — including the ones switched off. */
  allLeagues: Array<{ id: string; name: string; registered: boolean }>;
  enabled: string[];
  ownerName: string;
}
