/**
 * The homepage Top Players promo: who to put on the poster.
 *
 * Pure, so the casting is testable without rendering. Reads the same
 * derived file the Top Players page does (data/<league>/derived/top-players.json),
 * so the promo can never disagree with the page it sells.
 */
import type { TopPlayerRow, TopPlayersFile } from '../types/top-players';

/** The poster's lineup, left to right. Kickers and defenses don't sell a page. */
export const PROMO_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;

export interface TopPlayersPromo {
  seasonYear: number;
  /** The last week counted, or null before any week is complete. */
  throughWeek: number;
  /** Highest-scoring player on the poster: the headline. */
  leader: TopPlayerRow;
  /** One per position, in PROMO_POSITIONS order. */
  players: TopPlayerRow[];
}

/**
 * The best-ranked player at each poster position who has an ESPN photo (the
 * poster is pictures; a missing face is a hole in it). Null until a week has
 * been played, or when fewer than three positions can be filled.
 */
export function pickTopPlayersPromo(data: TopPlayersFile | null | undefined): TopPlayersPromo | null {
  if (!data?.completedWeeks?.length || !data.players?.length) return null;
  const players: TopPlayerRow[] = [];
  for (const pos of PROMO_POSITIONS) {
    const best = data.players
      .filter((p) => p.position === pos && p.espnId && /^\d+$/.test(p.espnId))
      .sort((a, b) => a.posRank - b.posRank)[0];
    if (best) players.push(best);
  }
  if (players.length < 3) return null;
  const leader = [...players].sort((a, b) => b.total - a.total)[0];
  return {
    seasonYear: data.seasonYear,
    throughWeek: Math.max(...data.completedWeeks),
    leader,
    players,
  };
}
