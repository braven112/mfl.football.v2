/**
 * The two cards the Live Scoring header carries every week: the week's top
 * individual performance ("Player of the Week") and the closest matchup
 * ("Nail-Biter"). A seasonal theme renames them (LvWeekStats), never changes
 * what they pick: Halloween's Monster of the Week and Scariest Game, and
 * Christmas's Star of the Week and Naughty or Nice, are these same two.
 *
 * DERIVED from the panels the board already renders — nothing here fetches,
 * so the cards cannot disagree with the cards below them. Both read every
 * panel, not just a solo one: the AFL's board carries one panel per
 * conference, and the week's best performance is the best across all of them.
 *
 * Either answer can be null, and the header renders a card only for what it
 * has: a week that has not kicked off has no star and no game worth calling
 * close, and a 0-0 pairing is not a nail-biter.
 */
import type { LiveMatchup, LivePanel } from '../../types/live';
import type { PlayerMeta } from '../../types/live-scoring';
import { hasStarted, isMatchupFinal } from './standings-projection';
import { pairingKey } from './model';
import { buildLeaders } from './leaders';

export interface WeekStar {
  playerId: string;
  name: string;
  points: number;
  /** Every franchise starting him, short names, on one line (`ownersLine`). */
  owners: string;
}

export interface WeekCloseGame {
  /** Short names, in MFL's pairing order. */
  names: [string, string];
  /** Absolute score gap, live points. */
  margin: number;
  /** Starters still to play across both sides. 0 once the game is over. */
  yetToPlay: number;
  final: boolean;
  /** Where the board finds this matchup to open it: its panel and pairing. */
  leagueId: string;
  pairing: string;
}

export interface WeekStats {
  star: WeekStar | null;
  closest: WeekCloseGame | null;
}

function teamName(side: LiveMatchup['sides'][number]): string {
  return side.nameShort || side.name;
}

/**
 * Every franchise starting the star, on one line a phone can hold: a player
 * started across a whole league (Archie's had Joe Burrow in nine lineups)
 * names the first two and counts the rest.
 */
export function ownersLine(names: string[]): string {
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
}

/**
 * The top individual score across every OK panel. `buildLeaders` already
 * filters to positive scores and sorts, but this takes the max itself rather
 * than trusting position 0 of each panel, since it compares across panels.
 */
function findStar(panels: LivePanel[], meta: Record<string, PlayerMeta>): WeekStar | null {
  let best: WeekStar | null = null;
  for (const panel of panels) {
    if (panel.status !== 'ok') continue;
    // Only MFL Live's board fills `leaders`; the league boards leave it unset,
    // so derive it here from the panel's own starters when it is missing.
    const leaders = panel.leaders ?? buildLeaders(panel, { playerLimit: 1 });
    for (const row of leaders.players) {
      if (!(row.points > 0)) continue;
      if (best && row.points <= best.points) continue;
      best = {
        playerId: row.playerId,
        // The map can miss an id; name him by id rather than drop a real score.
        name: meta[row.playerId]?.name || `Player ${row.playerId}`,
        points: row.points,
        owners: ownersLine((row.owners ?? []).map((o) => o.franchiseName)),
      };
    }
  }
  return best;
}

/**
 * The closest matchup that has started. One still being played outranks any
 * finished one — a final margin can no longer scare anybody — and among equals
 * the smaller gap wins.
 */
function findClosest(panels: LivePanel[]): WeekCloseGame | null {
  let best: WeekCloseGame | null = null;
  for (const panel of panels) {
    if (panel.status !== 'ok') continue;
    for (const m of panel.matchups) {
      if (!hasStarted(m)) continue;
      const [a, b] = m.sides;
      const game: WeekCloseGame = {
        names: [teamName(a), teamName(b)],
        margin: Math.abs(a.live - b.live),
        yetToPlay: a.yetToPlay + b.yetToPlay,
        final: isMatchupFinal(m),
        leagueId: panel.leagueId,
        pairing: pairingKey(m),
      };
      if (!best) {
        best = game;
      } else if (best.final !== game.final) {
        if (!game.final) best = game;
      } else if (game.margin < best.margin) {
        best = game;
      }
    }
  }
  return best;
}

export function weekStats(panels: LivePanel[], meta: Record<string, PlayerMeta>): WeekStats {
  return { star: findStar(panels, meta), closest: findClosest(panels) };
}
