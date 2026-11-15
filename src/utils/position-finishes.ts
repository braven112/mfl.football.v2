/**
 * Every player's best regular-season finish at the position in TheLeague's
 * history — "has this player ever been a top-10 QB?" — for the veteran extension card.
 *
 * Source: the derived League History files, read through the league-data
 * store (never a glob or JSON import):
 * - `derived/league-history-players.json`: one row per rostered player-week,
 *   2007 → now, `[year, week, franchiseId, playerId, score, flags]`, plus
 *   `players`: id → [name, position].
 * - `derived/league-history.json`: each season's `pw`, its first playoff week,
 *   so the regular season is every week before it.
 *
 * A finish ranks a player against every player ROSTERED in TheLeague that
 * year (the file holds no free agents) by regular-season points. The current
 * season counts with the weeks played so far.
 */
import { loadLeagueData, onLeagueDataChange } from './league-data';

export interface BestFinish {
  /** 1 = the most points at the position that season. */
  rank: number;
  year: number;
  position: string;
}

type PlayersFile = {
  players?: Record<string, [string, string]>;
  weeks?: Array<[number, number, string, string, number, number]>;
};
type HistoryFile = { seasons?: Array<{ y: number; pw?: number }> };

/** Pure: best finish per player id from the two files' contents. */
export function computeBestFinishes(playersFile: PlayersFile, historyFile: HistoryFile): Map<string, BestFinish> {
  const firstPlayoffWeek = new Map<number, number>();
  for (const s of historyFile.seasons ?? []) if (s.pw) firstPlayoffWeek.set(s.y, s.pw);

  const positions = playersFile.players ?? {};
  // year → position → playerId → points
  const totals = new Map<number, Map<string, Map<string, number>>>();
  for (const [year, week, , playerId, score] of playersFile.weeks ?? []) {
    const pw = firstPlayoffWeek.get(year) ?? 15;
    if (week >= pw) continue;
    const pos = String(positions[playerId]?.[1] ?? '').toUpperCase();
    if (!pos) continue;
    let byPos = totals.get(year);
    if (!byPos) totals.set(year, (byPos = new Map()));
    let byPlayer = byPos.get(pos);
    if (!byPlayer) byPos.set(pos, (byPlayer = new Map()));
    byPlayer.set(playerId, (byPlayer.get(playerId) ?? 0) + (Number(score) || 0));
  }

  const best = new Map<string, BestFinish>();
  for (const [year, byPos] of totals) {
    for (const [position, byPlayer] of byPos) {
      const ranked = [...byPlayer.entries()].sort((a, b) => b[1] - a[1]);
      ranked.forEach(([playerId], i) => {
        const rank = i + 1;
        const prior = best.get(playerId);
        if (!prior || rank < prior.rank || (rank === prior.rank && year > prior.year)) {
          best.set(playerId, { rank, year, position });
        }
      });
    }
  }
  return best;
}

const cache = new Map<string, Promise<Map<string, BestFinish>>>();
// A new live league-data pointer can carry new weeks: recompute from it.
onLeagueDataChange(() => cache.clear());

/** Best finishes for a league, read once per server instance. Empty on a read failure. */
export function loadBestFinishes(dataPath: string): Promise<Map<string, BestFinish>> {
  let hit = cache.get(dataPath);
  if (!hit) {
    hit = Promise.all([
      loadLeagueData<PlayersFile>(`${dataPath}/derived/league-history-players.json`).catch(() => null),
      loadLeagueData<HistoryFile>(`${dataPath}/derived/league-history.json`).catch(() => null),
    ]).then(([players, history]) => {
      if (players && history) return computeBestFinishes(players, history);
      // Do not remember a failed read: the next request tries again.
      cache.delete(dataPath);
      return new Map<string, BestFinish>();
    });
    cache.set(dataPath, hit);
  }
  return hit;
}
