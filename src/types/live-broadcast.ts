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

/**
 * One marquee defender standing in for a team defense on the takeover.
 *
 * A team defense is a CLUB, not a person, so it has no cutout of its own — the
 * reveal shows two of its stars instead, the way the draft board does. One man
 * reads as an ordinary player card with the wrong name over it.
 *
 * Carries a RESOLVED URL and never an `espnId`, which is this file's headline
 * rule three paragraphs up. The draft board's equivalent
 * (`BroadcastDefenseFace`) ships the id and builds the URL in its island; that
 * is deliberately not copied here — the join stays server-side, exactly as it
 * does for `PlayerMeta.headshot`.
 */
export interface BroadcastDefenderFace {
  name: string;
  /** Real NFL position (DT/LB/CB/S…), shown beside the name. */
  position: string;
  /** `a.espncdn.com` cutout, resolved server-side and gated on `isEspnCdnUrl`. */
  headshot: string;
}

/** One franchise as the board draws it. */
export interface BroadcastTeam {
  franchiseId: string;
  /** Full name, for the widest density tiers. */
  name: string;
  /** `chooseTeamName(..., 'short')`, resolved server-side. */
  nameShort: string;
  /** `chooseTeamName(..., 'abbrev')`, resolved server-side. */
  abbrev: string;
  /**
   * Big crest for a reveal — `resolveBroadcastCrest`'s RESOLUTION-first order
   * (`groupMeDark → groupMe → iconDark → icon`).
   *
   * The takeover paints this at 68vh, ~734px on a 1080p TV. The hand-authored
   * `iconDark` cuts are 100x100 and the GroupMe art is 400x400, so taking the
   * dark cut here to get the theme right would trade a 1.8x upscale for a 7x
   * one. Both fields were assigned the same small `brand.icon` until Sep 2026,
   * which is exactly the 7x upscale this order exists to avoid.
   */
  icon: string;
  /** Small crest for a player row — `resolveBroadcastCrest`'s theme-first order. */
  iconSmall: string;
  /** Outline colour for `icon`, set only when that art is a LIGHT cut. */
  iconStroke?: string;
  /** Outline colour for `iconSmall`, set only when that art is a LIGHT cut. */
  iconSmallStroke?: string;
  /**
   * The takeover's field, lifted until it separates from the board's GROUND
   * while keeping white ink legible (`ensureFieldOn`).
   *
   * Not the raw brand colour, and not `toBroadcastPair`'s output alone: that
   * helper only ever darkens, so the seven TheLeague franchises whose
   * `colorPrimary` is `#181818` came back untouched at 1.14:1 against the
   * board's `#05070b` — a full-screen "field of the club's colour" rendered
   * as a black rectangle indistinguishable from the idle screen.
   */
  primary: string;
  /** The field's second stop — the franchise's real secondary, same treatment. */
  secondary: string;
  /**
   * The MARK colour: this franchise on the `--lbc-panel` header, for the
   * win-probability bar and the lower third's rule. A different question from
   * `primary` (which is a field you write on) and it needs its own answer —
   * a brand that reads fine as a full-screen field can still vanish as a
   * 0.7vh bar on a panel two shades away from it.
   */
  swatch: string;
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
  /**
   * `?demo=1` — run the scripted ten-minute rehearsal instead of polling.
   *
   * The board cannot otherwise be SEEN outside a live NFL window: with no
   * plays there is no reveal, no red-zone banner and no queue, so the only
   * thing judgeable is how it looks when nothing is happening. The demo
   * badges itself on screen and the real poller does not run while it is on.
   */
  demo: boolean;
  /**
   * NFL club → its marquee defenders, for a team-defense takeover.
   *
   * Keyed by the code `PlayerMeta.nflTeam` carries, so the island needs no
   * normalizer. PAGE DATA, never the poll: it cannot change during a Sunday,
   * and re-shipping it every eight seconds for eight hours would be absurd.
   */
  defenseFaces: Record<string, BroadcastDefenderFace[]>;
  /** Every league the owner is in, for the picker. */
  available: { id: string; name: string; registered: boolean; enabled: boolean }[];
  /** Where the picker's links point. */
  pathname: string;
}
