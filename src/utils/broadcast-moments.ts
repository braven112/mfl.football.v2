/**
 * Broadcast moments — what takes the screen, for whom, and for how long.
 *
 * PURE. The board is a display with no input, so everything it decides has to
 * be decidable from a payload: which plays are worth interrupting for, whose
 * they are, which of several simultaneous ones goes first, and when a moment
 * has gone stale enough that showing it would be a lie about the present.
 *
 * This is the cross-league sibling of `buildMoments` in `live-scoring-view.ts`,
 * and it is NOT a generalization of it — the two answer different questions.
 * `buildMoments` fills one league's matchup ticker, where every row is history
 * and staleness is irrelevant. This decides what a television interrupts
 * itself for RIGHT NOW, across every league at once, which adds three problems
 * that ticker never had:
 *
 *  1. **A play belongs to different people in different leagues.** The same
 *     NFL touchdown can be scored by my starter in TheLeague and by my
 *     opponent's starter in the AFL. It is one play and two moments, with
 *     opposite meanings, and they must not collapse into each other.
 *  2. **Age is real here.** A ticker row from the first quarter is fine at
 *     4pm. A full-screen reveal of it is not.
 *  3. **Not every scoring play deserves the screen.** See `classifyPlay`.
 */

import type { LiveScoringPlay, NflGame, PlayerMeta } from '../types/live-scoring';
import { formatPlayClock } from './live-scoring-view';

/**
 * How old a play may be and still be worth taking the screen for.
 *
 * The draft board's `REVEAL_MAX_AGE_MS` is the same idea for the same reason:
 * a board opened mid-event must not narrate its way through everything it
 * missed. Here the stakes are higher, because the owner is watching the actual
 * game on the other television — a reveal of a touchdown he watched three
 * minutes ago is not just late, it actively misinforms him about what is
 * happening now.
 */
export const MOMENT_MAX_AGE_MS = 90_000;

/** A moment's owner relative to the viewer. */
export type MomentSide = 'mine' | 'opponent';

/**
 * What kind of thing happened. Drives the reveal's art and its copy, and
 * nothing else — the SIDE decides how big the card is, not the kind.
 */
export type MomentKind =
  | 'touchdown'
  | 'two-point'
  | 'field-goal'
  | 'safety'
  | 'big-play'
  | 'turnover';

/** One reveal-worthy event, already attributed to one owner in one league. */
export interface BroadcastMoment {
  /**
   * Stable across polls and unique per (play, league, franchise).
   *
   * The league id is load-bearing, not decoration: both leagues have a
   * franchise `0001`, so `playId:0001` would merge my TheLeague team's
   * touchdown with my AFL opponent's — the exact collision this module exists
   * to keep apart.
   */
  key: string;
  playId: string;
  leagueId: string;
  leagueName: string;
  /** The franchise that started the credited player, in THIS league. */
  franchiseId: string;
  franchiseName: string;
  side: MomentSide;
  kind: MomentKind;
  playerId: string;
  playerName: string;
  /** Canonical NFL team code of the scoring team. */
  team: string;
  /** ESPN's own one-line summary. Never rewritten. */
  text: string;
  /** Real game clock, "Q3 4:08". '' when ESPN gave us neither period nor clock. */
  clock: string;
  /** ESPN's real-world timestamp; '' when absent (then never reveal-eligible). */
  wallclock: string;
  /** Points the play scored, 0 for a non-scoring big play. */
  scoreValue: number;
  /** Yards gained; 0 when unknown. */
  yards: number;
}

/**
 * Who the viewer is in one league, and who they are playing.
 *
 * Both sides are required. A league where we cannot name the opponent still
 * produces `mine` moments — missing the opponent must never cost the owner his
 * own touchdowns.
 */
export interface LeagueViewer {
  leagueId: string;
  leagueName: string;
  /** The viewer's franchise in this league. */
  franchiseId: string;
  franchiseName: string;
  /**
   * Franchise ids the viewer is playing this week. A LIST because a
   * doubleheader week pairs one franchise against two opponents, and both of
   * them scoring against you is two pieces of bad news, not one.
   */
  opponentIds: string[];
  /** Display names for the opponents, keyed by franchise id. */
  opponentNames?: Record<string, string>;
  /** Starter rows per franchise in this league — `LiveSnapshot.players`. */
  players: Record<string, { id: string }[]>;
}

/**
 * Is this play worth interrupting the screen for, and as what?
 *
 * `null` means no. The bar is deliberately not "did it score": an extra point
 * is a scoring play and nobody has ever wanted their television to shout about
 * one, while an interception scores nothing and is the play of the game.
 *
 * Field goals are IN, at any distance, because a kicker is a starter in both
 * leagues and his three points are the whole of his contribution — the one
 * position for which scoring plays are the entire job.
 */
export function classifyPlay(play: LiveScoringPlay): MomentKind | null {
  const abbrev = (play.typeAbbrev || '').toUpperCase();
  const typeText = (play.typeText || '').toLowerCase();

  if (play.twoPoint === true) return 'two-point';
  if (abbrev === 'TD' || /touchdown/.test(typeText)) return 'touchdown';
  if (abbrev === 'SF' || /safety/.test(typeText)) return 'safety';
  if (abbrev === 'FG' || /field goal good/.test(typeText)) return 'field-goal';

  // Non-scoring: the notable-play parse already applied the type allowlist and
  // the distance threshold (see espn-game-detail.ts — a missed 58-yard field
  // goal clears 40 yards and is not a big play). Re-deriving that rule here
  // would be a second copy of it, so this reads the flags it produced.
  if (play.isTurnover === true) return 'turnover';
  if ((play.yards ?? 0) > 0 && play.scoreValue === 0) return 'big-play';

  // A scoring play we could not classify — an extra point, most often. It
  // scored, so it is real, and it is not worth a television.
  return null;
}

/**
 * Every play in the slate, turned into per-owner moments across every league.
 *
 * The ownership map is per LEAGUE and its values are LISTS, and both halves of
 * that are bugs that shipped elsewhere in this repo:
 *
 *  - **Per league**, because a franchise id alone is ambiguous across leagues.
 *  - **A list**, because the AFL runs duplicate-player conferences: one NFL
 *    player is routinely started by two franchises in the same league (85 of
 *    131 starters in a real AFL week), and a `Map<playerId, fid>` keeps only
 *    the last one written. On a ticker that looks like a touchdown not
 *    counting; here it looks like the television ignoring your player.
 *
 * A play involving nobody the viewer has a stake in yields nothing. This board
 * is about the owner's teams, so a touchdown by a player neither he nor his
 * opponents started is correctly invisible — that is the whole editorial
 * premise, not an omission.
 */
export function buildBroadcastMoments(
  plays: readonly LiveScoringPlay[],
  leagues: readonly LeagueViewer[],
  meta: Record<string, PlayerMeta>,
): BroadcastMoment[] {
  const out: BroadcastMoment[] = [];
  const seen = new Set<string>();

  for (const league of leagues) {
    const mine = league.franchiseId;
    const opponents = new Set(league.opponentIds);

    // playerId -> franchises in THIS league that start him and that the viewer
    // has a stake in. Everyone else in the league is not this board's business.
    const stake = new Map<string, string[]>();
    for (const [fid, rows] of Object.entries(league.players ?? {})) {
      if (fid !== mine && !opponents.has(fid)) continue;
      for (const row of rows ?? []) {
        const list = stake.get(row.id);
        if (list) {
          if (!list.includes(fid)) list.push(fid);
        } else {
          stake.set(row.id, [fid]);
        }
      }
    }
    if (stake.size === 0) continue;

    for (const play of plays) {
      const kind = classifyPlay(play);
      if (!kind) continue;

      for (const playerId of play.playerIds ?? []) {
        const holders = stake.get(playerId);
        if (!holders) continue;

        // Which franchises this play produces a moment for.
        //
        // If the viewer holds him, that is the ONE moment: a player started by
        // both sides of the same matchup — legal in the AFL, where the
        // conferences duplicate rosters — is a wash on the scoreboard, and it
        // reveals as MINE. His own player scoring is the fact he is watching
        // for; burying it under "your opponent scored" would be the wrong half
        // of the truth, and printing both would be the same news twice.
        //
        // If he does NOT hold him, every opponent holding him gets a moment of
        // their own. Taking `holders[0]` here would be the `Map<playerId, fid>`
        // bug wearing a different hat: on a doubleheader week both opponents
        // can start the same man, and that is two pieces of bad news, not one.
        const isMine = holders.includes(mine);
        const credited = isMine ? [mine] : holders;

        for (const franchiseId of credited) {
          const side: MomentSide = franchiseId === mine ? 'mine' : 'opponent';
          const key = `${play.playId}:${league.leagueId}:${franchiseId}`;
          if (seen.has(key)) continue;
          seen.add(key);

          out.push({
            key,
            playId: play.playId,
            leagueId: league.leagueId,
            leagueName: league.leagueName,
            franchiseId,
            franchiseName:
              side === 'mine'
                ? league.franchiseName
                : league.opponentNames?.[franchiseId] ?? '',
            side,
            kind,
            playerId,
            playerName: meta[playerId]?.name ?? '',
            team: play.nflTeam,
            text: play.text,
            clock: formatPlayClock(play),
            wallclock: play.wallclock ?? '',
            scoreValue: play.scoreValue ?? 0,
            yards: play.yards ?? 0,
          });
        }
      }
    }
  }

  return out;
}

/** epoch ms for an ISO wallclock; null when absent or unparseable. */
export function momentTime(moment: Pick<BroadcastMoment, 'wallclock'>): number | null {
  if (!moment.wallclock) return null;
  const t = Date.parse(moment.wallclock);
  return Number.isFinite(t) ? t : null;
}

/**
 * Is this moment still worth the screen?
 *
 * A moment we cannot DATE is never fresh. That asymmetry is deliberate: ESPN
 * omits `wallclock` on a small number of plays, and the two ways to be wrong
 * are not equal. Treating an undateable play as fresh risks a full-screen
 * reveal of something that happened in the first quarter — the single failure
 * this whole staleness rule exists to prevent — while treating it as stale
 * costs at most one missed reveal of a play the scoreboard already reflects.
 *
 * A moment from the FUTURE is also rejected. Clock skew between ESPN's
 * timestamps and the viewer's machine is real, and a play stamped two minutes
 * ahead would otherwise stay "fresh" for two minutes past its actual window.
 */
export function isMomentFresh(
  moment: Pick<BroadcastMoment, 'wallclock'>,
  now: number,
  maxAgeMs: number = MOMENT_MAX_AGE_MS,
): boolean {
  const t = momentTime(moment);
  if (t === null) return false;
  const age = now - t;
  return age >= -maxAgeMs && age <= maxAgeMs;
}

export interface RevealQueueOptions {
  now: number;
  /** Keys already shown this session — a reveal fires once, not once per poll. */
  shown?: ReadonlySet<string>;
  maxAgeMs?: number;
}

/**
 * The reveals to play, in the order to play them.
 *
 * DERIVED, NOT ACCUMULATED — the same discipline `buildMoments` keeps. The
 * detail route hands back the whole slate's plays every poll, so recomputing
 * is idempotent and there is no running queue to drift. The only state the
 * caller keeps is `shown`, and that is a set of keys, not a queue of payloads:
 * a moment that has had its moment must not come back, but nothing else about
 * it needs remembering.
 *
 * Order is OLDEST FIRST. A queue is a backlog, and a backlog played newest
 * first tells the story of the drive backwards. Two touchdowns 20 seconds
 * apart should play in the order they happened.
 */
export function selectRevealQueue(
  moments: readonly BroadcastMoment[],
  opts: RevealQueueOptions,
): BroadcastMoment[] {
  const { now, shown } = opts;
  const maxAgeMs = opts.maxAgeMs ?? MOMENT_MAX_AGE_MS;

  return moments
    .filter((m) => !shown?.has(m.key))
    .filter((m) => isMomentFresh(m, now, maxAgeMs))
    .sort((a, b) => {
      const ta = momentTime(a) ?? 0;
      const tb = momentTime(b) ?? 0;
      if (ta !== tb) return ta - tb;
      // Same instant (a play credited to two of the viewer's leagues at once):
      // his own news leads. Then a stable tiebreak so two polls of identical
      // data never reorder the queue under a running reveal.
      if (a.side !== b.side) return a.side === 'mine' ? -1 : 1;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
}

/**
 * How long one moment holds the screen.
 *
 * Two rules, from the product decisions: the owner's own scores get the full
 * moment and his opponents' get a shorter lower-third card, and a backlog
 * catches up rather than running further behind — the draft board's
 * `REVEAL_RUSH_MS` idea, for the same reason.
 */
export const REVEAL_MINE_MS = 10_000;
export const REVEAL_OPPONENT_MS = 5_000;
/** Queue depth past which every reveal is rushed to catch up. */
export const REVEAL_RUSH_THRESHOLD = 3;
export const REVEAL_RUSH_MS = 4_000;

export function revealDuration(moment: Pick<BroadcastMoment, 'side'>, queueDepth: number): number {
  if (queueDepth > REVEAL_RUSH_THRESHOLD) return REVEAL_RUSH_MS;
  return moment.side === 'mine' ? REVEAL_MINE_MS : REVEAL_OPPONENT_MS;
}

// ── red zone ───────────────────────────────────────────────────────────────

/** One team of the viewer's with the ball inside the 20, right now. */
export interface RedZoneAlert {
  /** Canonical NFL team code that has the ball. */
  team: string;
  /** "1st & Goal at WSH 8", or '' when ESPN omits it. */
  downDistance: string;
  /** The viewer's players on that NFL team, by league. */
  players: {
    leagueId: string;
    leagueName: string;
    side: MomentSide;
    playerId: string;
    playerName: string;
    position: string;
  }[];
}

/**
 * Which of the viewer's players are in a red-zone drive right now.
 *
 * `isRedZone` belongs to the team WITH THE BALL, not to the game. Reading it
 * off the game alone flags a receiver while his team is on defense, which is
 * exactly backwards — the rule `isPlayerInRedZone` already encodes for the
 * live-scoring board, restated here because this banner is keyed on the TEAM
 * rather than on one player row.
 *
 * The banner is persistent by design: it is on screen for as long as the drive
 * lasts, so it has to be derived fresh from the scoreboard every poll rather
 * than latched. A drive that ends — in a score, a turnover, or a punt — simply
 * stops producing an alert, and the banner goes away on its own.
 */
export function selectRedZoneAlerts(
  games: readonly NflGame[],
  leagues: readonly LeagueViewer[],
  meta: Record<string, PlayerMeta>,
): RedZoneAlert[] {
  const byTeam = new Map<string, RedZoneAlert>();

  for (const game of games) {
    // A `situation` can linger on a payload whose game has ended, so the
    // in-progress check is load-bearing, not belt-and-braces.
    if (game.state !== 'in') continue;
    const s = game.situation;
    if (!s?.isRedZone || !s.possession) continue;

    byTeam.set(s.possession, {
      team: s.possession,
      downDistance: s.shortDownDistanceText || s.downDistanceText || '',
      players: [],
    });
  }
  if (byTeam.size === 0) return [];

  for (const league of leagues) {
    const opponents = new Set(league.opponentIds);
    for (const [fid, rows] of Object.entries(league.players ?? {})) {
      const isMine = fid === league.franchiseId;
      if (!isMine && !opponents.has(fid)) continue;
      for (const row of rows ?? []) {
        const who = meta[row.id];
        if (!who?.nflTeam) continue;
        const alert = byTeam.get(who.nflTeam);
        if (!alert) continue;
        // One row per player per league. The same player on both sides of an
        // AFL matchup is the viewer's own first, as in `buildBroadcastMoments`.
        if (alert.players.some((p) => p.leagueId === league.leagueId && p.playerId === row.id)) {
          continue;
        }
        alert.players.push({
          leagueId: league.leagueId,
          leagueName: league.leagueName,
          side: isMine ? 'mine' : 'opponent',
          playerId: row.id,
          playerName: who.name,
          position: who.position,
        });
      }
    }
  }

  // A red-zone drive with none of the viewer's players in it is not his
  // business — the board only ever speaks about his own teams.
  return [...byTeam.values()].filter((a) => a.players.length > 0);
}
