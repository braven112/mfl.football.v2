/**
 * The canonical live-scoring model — ONE shape for every live-scoring surface.
 *
 * Replaces the two that existed: `LiveScoringPageProps`' `home`/`away`
 * pairings (the per-league board, which shows every matchup in one league) and
 * `MflLiveMatchup`'s `mine`/`opponent` (MFL Live, which shows the viewer's
 * matchups across every league they are in).
 *
 * ── WHY `sides` AND NOT `mine`/`opponent`, OR `home`/`away` ───────────────
 * Both of the shapes this replaces name a side, and both names are lies on the
 * other board:
 *
 *  - **`mine`/`opponent` is a lie on a league board.** It shows the seven
 *    matchups the viewer is NOT in, and every one of them would carry a
 *    "mine". That is the exact shape of the composite-hero bug — "prefer your
 *    team, else the league" is what put a rival's player on somebody's own
 *    homepage (`docs/claude/insights/features/player-composites.md`).
 *  - **`home`/`away` is a lie on a cross-league board.** A home-relative win
 *    probability means the opposite thing depending on which side of the
 *    pairing MFL happened to put the owner on — which is precisely why both
 *    `scoreLeague` and `MflLiveMatchup` state theirs from the viewer instead.
 *
 * So the pairing is an ordered pair with no claim attached, and the viewer is
 * a separate, nullable INDEX into it. A board with a viewer reads `viewerSide`
 * and gets exactly what it has today; a board without one renders both sides
 * neutrally and cannot accidentally assert anything.
 *
 * `sides` is MFL's own pairing order and is never re-sorted — the same posture
 * as never re-sorting MFL's standings rows.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────
 * No slot labels. MFL's `liveScoring` says WHO is starting and never WHERE, so
 * a FLEX label has to be derived by filling the required slots and calling the
 * leftovers flex — and MFL returns arrays in nondeterministic order, so that
 * chip can swap between two polls of an unchanged lineup. Rows carry their
 * POSITION and are ordered by it (`orderLineupRows`).
 */

import type { CanonicalLeagueSlug } from '../config/leagues';
import type { LivePlayerRow, NflGame, PlayerMeta } from './live-scoring';
import type { IdentityRung } from '../utils/mfl-live-identity';
import type { RedZoneAlert } from '../utils/broadcast-moments';

/**
 * One franchise in one matchup: who they are, and what they have scored.
 *
 * Identity comes off the three-rung ladder (`resolveFranchiseIdentity`), which
 * is why `rung` travels with it — a row has to be able to render honestly. A
 * league we run always answers on rung 1, so the league boards never see the
 * other two.
 */
export interface LiveTeam {
  franchiseId: string;
  name: string;
  nameShort: string;
  /** Up to two characters — the mark on the text rung, and the icon's fallback. */
  initials: string;
  /** Crest, NFL club mark, or '' when the identity ladder reached text. */
  icon: string;
  iconAlt: string;
  rung: IdentityRung;

  /** Live fantasy points. */
  live: number;
  /** Live points plus the projection still tied to unplayed game-time. */
  projectedFinal: number;
  /** Projected points still to come. Drives the win-probability spread. */
  remainingPoints: number;
  /** Starters whose NFL game has not kicked off. */
  yetToPlay: number;

  /**
   * STARTERS only, in reading order: QB, RB, WR, TE, K, DEF.
   *
   * Bench rows travel SEPARATELY, below. Two lists rather than one list with a
   * flag, because everything downstream reads this one as "the rows that score
   * this matchup": a bench row folded in here inflates the projected final AND
   * the win-probability bar with points that cannot be scored, and puts bench
   * touchdowns in a matchup ticker. Two lists makes that impossible rather
   * than merely unlikely.
   */
  players: LivePlayerRow[];
  /** The bench, ordered the same way. Never summed into anything. */
  bench: LivePlayerRow[];
}

/**
 * One pairing. A franchise can legitimately appear in two of these in one
 * week — the AFL plays doubleheaders — and that comes from the FEED, never
 * from the calendar.
 */
export interface LiveMatchup {
  /** Position in the league's own matchup list. Stable within one read. */
  index: number;
  /** MFL's pairing order. Never re-sorted; carries no claim about either side. */
  sides: [LiveTeam, LiveTeam];
  /**
   * Which side the viewer owns, or null when they own neither.
   *
   * PER MATCHUP, not per board: a doubleheader week puts the viewer in several
   * matchups, and on a league board most matchups are nobody's.
   */
  viewerSide: 0 | 1 | null;
  /**
   * Probability that `sides[0]` wins, 0-1.
   *
   * Named for an INDEX rather than for "home" or "you", so it means the same
   * thing on a board with a viewer and a board without one. Read it through
   * `winProbabilityFor`, which flips it for side 1.
   */
  p0: number;
  /**
   * The two franchise colours as CSS custom properties, resolved SERVER-SIDE
   * and once PER THEME.
   *
   * Two of each, always. A single resolved colour bakes in one theme's ground
   * and this renders on a light card and a dark one: seven TheLeague
   * franchises are `#181818` and several NFL primaries are near-black, all
   * invisible on a dark card and perfectly fine on a light one. It cannot be
   * decided in frontmatter either — with `theme_pref: auto` the server does
   * not know the resolved theme.
   */
  colorVars: Record<string, string>;
}

/**
 * Why a league has no matchups to show. FOUR states, not two:
 *
 *  - `ok`          — matchups below.
 *  - `no-matchup`  — the feed is fine and scoring; this viewer has no pairing
 *                    this week. A bye is a fact, not a fault.
 *  - `not-played`  — the feed is fine and nothing has kicked off. An unplayed
 *                    week is a well-formed payload of ZEROS — every franchise
 *                    present, every score "0.00", every player `nonstarter` —
 *                    and `res.ok`, `data.ok`, a shape check and a franchise
 *                    count all pass it. Only `hasLiveSignal` tells it from a
 *                    real 0-0, and printing it as "0.0 – 0.0" is the bug this
 *                    state exists to prevent.
 *  - `unavailable` — we could not read it. Never conflated with the above:
 *                    "the feed says nothing" and "we could not reach the feed"
 *                    stay different facts all the way to the UI.
 */
export type LiveLeagueStatus = 'ok' | 'no-matchup' | 'not-played' | 'unavailable';

/**
 * One league's worth of board. A league board renders exactly one of these
 * (chromeless); MFL Live renders one per league the viewer has switched on.
 */
export interface LivePanel {
  leagueId: string;
  leagueName: string;
  /** Registry slug, or null for a league this site does not run. */
  slug: CanonicalLeagueSlug | null;
  /** True when this site runs the league — drives the "not on this site" tag. */
  registered: boolean;
  /**
   * The viewer's franchise in THIS league, or null.
   *
   * League-scoped, and that is load-bearing: franchise ids collide across
   * leagues (all three registry leagues have an `0001`), so a session from one
   * league must never light up "YOUR MATCHUP" on another league's franchise.
   */
  viewerFranchiseId: string | null;
  status: LiveLeagueStatus;
  matchups: LiveMatchup[];
}

/**
 * One scoring play, credited to one franchise in one league.
 *
 * ── WHY THIS IS NOT `BroadcastMoment` ─────────────────────────────────────
 * That type carries `side: 'mine' | 'opponent'`, which is viewer-relative and
 * therefore a LIE on a league board: most of a 16-team board's matchups are
 * nobody's, and every moment on them would have to claim to be one or the
 * other. It is the same objection the canonical matchup answers with a
 * nullable `viewerSide`, so this answers it the same way — by not carrying the
 * claim at all. A caller that wants it asks the PANEL who the viewer is.
 *
 * Everything else is the same shape, and `fromMflLiveBoard` maps one to the
 * other by dropping `side`.
 */
export interface LiveMoment {
  /**
   * Stable across polls and unique per (play, league, franchise).
   *
   * The league id is load-bearing, not decoration: both leagues have a
   * franchise `0001`, so `playId:0001` would merge my TheLeague team's
   * touchdown with my AFL opponent's.
   */
  key: string;
  playId: string;
  leagueId: string;
  leagueName: string;
  /** The franchise that started the credited player, in THIS league. */
  franchiseId: string;
  franchiseName: string;
  playerId: string;
  playerName: string;
  /** Canonical NFL team code of the scoring team. */
  team: string;
  /** ESPN's own one-line summary. Never rewritten. */
  text: string;
  /** Real game clock, "Q3 4:08". '' when ESPN gave us neither period nor clock. */
  clock: string;
}

/** One assembly of a whole board. A poll replaces this wholesale. */
export interface LiveBoard {
  /**
   * False when the ASSEMBLER failed. An individual league's failure rides on
   * its own `status` — one dead feed is not an outage, and an island must be
   * able to keep its last good payload when this is false rather than wiping
   * a live screen.
   */
  ok: boolean;
  /** Which question this board answers. Drives nothing but the empty states. */
  scope: 'league' | 'cross-league';
  week: number;
  /** SEASON year. Everything here is results-shaped. */
  year: number;
  fetchedAt: string;
  panels: LivePanel[];
  /**
   * The NFL slate for the week — the rail across the top.
   *
   * ESPN's scoreboard is a WEEK, not a day: Thursday through Monday arrive
   * together, so anything deciding "is football happening" from this must read
   * the CLOCK rather than count states ("some game is `pre`" is true from
   * Thursday lunchtime to Monday night, and `[].every()` is true for an empty
   * slate, which is "nothing loaded" rather than "all final").
   */
  games: NflGame[];
  /**
   * Scoring and big plays, already attributed to a franchise in a league.
   *
   * DERIVED every poll, never accumulated — the whole slate's plays arrive
   * each time, so recomputing is idempotent and there is no seen-set to drift.
   *
   * A play can legitimately appear MORE than once: the same NFL player is
   * routinely started in several of an owner's leagues, and in the AFL — whose
   * rosters duplicate players — by both sides of one matchup. Each row names
   * its league and franchise, which is what keeps that honest; collapsing them
   * silently drops the credit from every league but one.
   */
  moments: LiveMoment[];
  /**
   * Teams with the ball inside the 20, right now.
   *
   * Possession-gated: `isRedZone` belongs to the team WITH THE BALL, not to
   * the game, or a receiver gets flagged while his team is on defense.
   * Derived fresh each poll rather than latched, so a drive that ends in a
   * score, a turnover or a punt simply stops producing an alert.
   */
  redZone: RedZoneAlert[];
  /**
   * Player identity for every row on the board, keyed by MFL player id.
   *
   * Resolved for starters AND bench in one pass: the bench renders the same
   * row component, so a bench id missing from here does not degrade
   * gracefully — it prints "Unknown Player" with no headshot and no team code,
   * which is the whole row.
   *
   * `projected` here is NOT read. A projection belongs to a player IN A
   * LEAGUE — the same back is worth different points under two rule sets — so
   * a map shared across leagues cannot hold one. That is what pinned every
   * win-probability bar on the first cross-league board to 100%.
   */
  playerMeta: Record<string, PlayerMeta>;
}
