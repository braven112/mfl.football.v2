/**
 * Pure view-model helpers for the live-scoring island.
 *
 * Everything the board derives from ESPN's real game data lives here rather
 * than inside LiveScoreboard.tsx, so it can be tested without a DOM and
 * without the network — the same reason the ESPN parsers are pure. Each
 * function below replaced something the island used to INVENT.
 */

import type {
  LivePlayerRow,
  LiveScoringPlay,
  NflGame,
  NflGameState,
  PlayerMeta,
} from '../types/live-scoring';

/**
 * The clock shown next to a starter.
 *
 * This replaces a fabrication. The island used to derive a quarter and a clock
 * by dividing MFL's `gameSecondsRemaining` by 900 — which produces a
 * confident-looking "Q3 7:24" that is not the real game clock and drifts from
 * it all afternoon, because the NFL clock stops and MFL's number does not
 * decrement in real time.
 *
 * With ESPN's own status in hand we print the real thing. Without it we print
 * the STATE and no numbers: "In progress" is honestly less than "Q3 7:24", and
 * that is the point — an invented clock is worse than a missing one.
 */
export function formatGameClock(state: NflGameState, game?: NflGame): string {
  if (game) {
    if (game.state === 'post') return 'Final';
    if (game.state === 'pre') return game.shortDetail || 'Yet to play';
    // ESPN's shortDetail is already "8:12 - 3rd"; fall back to assembling it
    // only if that string is missing.
    if (game.shortDetail) return game.shortDetail;
    if (game.period > 0) return `Q${game.period}${game.clock ? ` ${game.clock}` : ''}`;
    return 'In progress';
  }
  // No ESPN game matched (offseason, an unmapped team code, or a failed
  // scoreboard fetch). Fall back to what MFL's clock can honestly support.
  if (state === 'final') return 'Final';
  if (state === 'not-started') return 'Yet to play';
  return 'In progress';
}

/**
 * Is THIS player's team the one in the red zone?
 *
 * `isRedZone` belongs to the team that HAS THE BALL, not to the game. Reading
 * it off the game alone tells a receiver his team is in the red zone while his
 * team is actually on defense, which is exactly backwards and reads as a bug
 * the first time an owner sees it. Both the possession check and the
 * in-progress check are load-bearing: a `situation` can linger on a payload
 * whose game has ended.
 */
export function isPlayerInRedZone(game: NflGame | undefined, nflTeam: string): boolean {
  if (!game || game.state !== 'in' || !nflTeam) return false;
  const s = game.situation;
  if (!s?.isRedZone || !s.possession) return false;
  return s.possession === nflTeam;
}

/**
 * Down & distance for a starter's game — shown only while his team has the
 * ball, because "3rd & 7" is meaningless attached to a player on defense.
 */
export function playerDownDistance(game: NflGame | undefined, nflTeam: string): string {
  if (!game || game.state !== 'in' || !nflTeam) return '';
  const s = game.situation;
  if (!s?.possession || s.possession !== nflTeam) return '';
  return s.shortDownDistanceText || s.downDistanceText || '';
}

/** A real, attributed scoring play surfaced in a matchup's ticker. */
export interface LiveMoment {
  /** Stable across polls: one play can credit starters on both franchises. */
  key: string;
  playId: string;
  /** Franchise that started the credited player. */
  fid: string;
  /** MFL player id of the credited starter. */
  playerId: string;
  playerName: string;
  /** Canonical NFL team code of the scoring team. */
  team: string;
  /** ESPN's own summary of the play. */
  text: string;
  /** Real game clock, e.g. "Q1 11:49". Never fabricated. */
  clock: string;
  /** TD / FG / SF …; '' when ESPN omits it. */
  typeAbbrev: string;
}

/** "Q1 11:49" from a play's real period + clock; '' when neither is present. */
export function formatPlayClock(play: Pick<LiveScoringPlay, 'period' | 'clock'>): string {
  const q = play.period > 4 ? 'OT' : play.period > 0 ? `Q${play.period}` : '';
  if (q && play.clock) return `${q} ${play.clock}`;
  return q || play.clock || '';
}

/**
 * Turn the slate's scoring plays into the matchup ticker's rows.
 *
 * DERIVED, NOT ACCUMULATED. `/api/nfl-game-detail` returns every scoring play
 * in the slate on every poll, so recomputing from the current payload is
 * idempotent: a play cannot be emitted twice, and there is no seen-set to keep
 * in sync. The old ticker accumulated instead — it inferred a fantasy "delta"
 * by diffing each starter's points between two 60s polls, which meant a stat
 * correction could invent a scoring event and a point swing that spanned a
 * poll boundary was attributed to the wrong moment in the game.
 *
 * A play credits one row per ROSTERED starter on it, so a QB→WR touchdown
 * shows on both owners' tickers, and a play involving nobody rostered is
 * dropped rather than filling the ticker with league-wide noise.
 */
export function buildMoments(
  plays: readonly LiveScoringPlay[],
  players: Record<string, LivePlayerRow[]>,
  meta: Record<string, PlayerMeta>,
): LiveMoment[] {
  // MFL player id → the franchise starting him this week.
  const ownerOf = new Map<string, string>();
  for (const [fid, rows] of Object.entries(players)) {
    for (const row of rows) ownerOf.set(row.id, fid);
  }
  if (ownerOf.size === 0) return [];

  const out: LiveMoment[] = [];
  const seen = new Set<string>();
  for (const play of plays) {
    for (const playerId of play.playerIds) {
      const fid = ownerOf.get(playerId);
      if (!fid) continue;
      // One row per play per FRANCHISE, not per credited player. A play often
      // credits several athletes (rusher + kicker on a TD), and an owner who
      // starts two of them would otherwise see the identical line twice — that
      // shipped as a visible duplicate: "Derrick Henry 46 Yd Rush (Tyler Loop
      // PAT Failed)" listed twice for the owner who started both. Across
      // DIFFERENT franchises the play still appears once each, which is the
      // behavior we want for a QB→WR touchdown.
      const dedupeKey = `${play.playId}:${fid}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({
        key: dedupeKey,
        playId: play.playId,
        fid,
        playerId,
        playerName: meta[playerId]?.name ?? '',
        team: play.nflTeam,
        text: play.text,
        clock: formatPlayClock(play),
        typeAbbrev: play.typeAbbrev,
      });
    }
  }
  // Most recent first. The route hands us the slate in chronological order
  // (comparePlaysChronologically), so reversing is enough — and is why this
  // does NOT re-sort on `sequence`, which only orders within a single game.
  return out.reverse();
}
