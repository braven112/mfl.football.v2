/**
 * The two cards the Halloween header carries on Live Scoring: the week's top
 * individual performance ("Monster of the Week") and the closest matchup
 * ("Scariest Game").
 *
 * DERIVED from the panels the board already renders — nothing here fetches,
 * so the cards cannot disagree with the cards below them. Both read every
 * panel, not just a solo one: the AFL's board carries one panel per
 * conference, and the week's best performance is the best across all of them.
 *
 * Either answer can be null, and the header renders a card only for what it
 * has: a week that has not kicked off has no monster and no game worth calling
 * close, and a 0-0 pairing is not a nail-biter.
 */
import type { LiveMatchup, LivePanel } from '../../types/live';
import type { PlayerMeta } from '../../types/live-scoring';
import { hasStarted, isMatchupFinal } from './standings-projection';

export interface HauntedMonster {
  playerId: string;
  name: string;
  points: number;
  /** Every franchise starting him, short names, joined for one line. */
  owners: string;
}

export interface HauntedGame {
  /** Short names, in MFL's pairing order. */
  names: [string, string];
  /** Absolute score gap, live points. */
  margin: number;
  /** Starters still to play across both sides. 0 once the game is over. */
  yetToPlay: number;
  final: boolean;
}

export interface HauntedStats {
  monster: HauntedMonster | null;
  scariest: HauntedGame | null;
}

function teamName(side: LiveMatchup['sides'][number]): string {
  return side.nameShort || side.name;
}

/**
 * The top individual score across every OK panel. `buildLeaders` already
 * filters to positive scores and sorts, but this takes the max itself rather
 * than trusting position 0 of each panel, since it compares across panels.
 */
function findMonster(panels: LivePanel[], meta: Record<string, PlayerMeta>): HauntedMonster | null {
  let best: HauntedMonster | null = null;
  for (const panel of panels) {
    if (panel.status !== 'ok') continue;
    for (const row of panel.leaders?.players ?? []) {
      if (!(row.points > 0)) continue;
      if (best && row.points <= best.points) continue;
      best = {
        playerId: row.playerId,
        // The map can miss an id; name him by id rather than drop a real score.
        name: meta[row.playerId]?.name || `Player ${row.playerId}`,
        points: row.points,
        owners: (row.owners ?? []).map((o) => o.franchiseName).join(', '),
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
function findScariest(panels: LivePanel[]): HauntedGame | null {
  let best: HauntedGame | null = null;
  for (const panel of panels) {
    if (panel.status !== 'ok') continue;
    for (const m of panel.matchups) {
      if (!hasStarted(m)) continue;
      const [a, b] = m.sides;
      const game: HauntedGame = {
        names: [teamName(a), teamName(b)],
        margin: Math.abs(a.live - b.live),
        yetToPlay: a.yetToPlay + b.yetToPlay,
        final: isMatchupFinal(m),
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

export function hauntedStats(panels: LivePanel[], meta: Record<string, PlayerMeta>): HauntedStats {
  return { monster: findMonster(panels, meta), scariest: findScariest(panels) };
}
