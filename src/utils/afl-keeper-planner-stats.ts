/**
 * Per-player stat enrichment for the AFL's Keeper Planner card list.
 *
 * The planner's cards showed only identity + age — no performance or
 * market data at all. This assembles, per player: last season's PPG and
 * games played, a leaguewide positional finish ("WR9"), and dynasty/redraft
 * ADP ranks (the raw material for the ascending/fading trend badge, which
 * KeeperPlanner.astro derives from the two ranks itself).
 *
 * Pure data assembly — reads the same committed feeds
 * front-office-keeper-data.ts already reads, keyed by the same league year
 * both KeeperPlanner call sites (rosters.astro, the Front Office panel)
 * already pass as `year`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { computeSeasonPoints, type MflPlayersFeed, type WeeklyResultsRaw } from './afl-keeper-analysis';

const loadFeedJson = (year: number, filename: string): any => {
  const feedPath = path.resolve(process.cwd(), `data/afl-fantasy/mfl-feeds/${year}/${filename}`);
  try {
    if (fs.existsSync(feedPath)) return JSON.parse(fs.readFileSync(feedPath, 'utf8'));
  } catch {
    // Missing/malformed feed — caller treats the year as having no data.
  }
  return null;
};

export interface KeeperPlannerPlayerStats {
  ppg: number | null;
  gamesPlayed: number;
  /** 1-based rank at this player's position among every leaguewide scorer that season. */
  positionalFinish: number | null;
  /** Lower = valued higher. Only populated for years the ADP feed covers (2025+). */
  dynastyAdpRank: number | null;
  redraftAdpRank: number | null;
}

const loadAdpRanks = (year: number, filename: string): Map<string, number> => {
  const data = loadFeedJson(year, filename);
  const map = new Map<string, number>();
  for (const p of (data?.adp?.player ?? []) as Array<{ id?: string; rank?: string }>) {
    const rank = parseInt(p?.rank ?? '', 10);
    if (p?.id && Number.isFinite(rank)) map.set(p.id, rank);
  }
  return map;
};

/**
 * Builds one season's stat line for every player who scored (plus anyone
 * ADP-ranked that year), keyed by player id. Degrades gracefully: a year
 * whose ADP feed doesn't exist (pre-2025) just returns null ADP ranks
 * rather than throwing — weekly results exist for every AFL year, ADP only
 * from 2025 on.
 */
export function buildKeeperPlannerStats(year: number): Map<string, KeeperPlannerPlayerStats> {
  const playersData = loadFeedJson(year, 'players.json') as MflPlayersFeed | null;
  const positionById = new Map<string, string>();
  for (const p of playersData?.players?.player ?? []) {
    if (p?.id) positionById.set(p.id, p.position || '?');
  }

  const weeklyRaw = (loadFeedJson(year, 'weekly-results-raw.json') ?? []) as WeeklyResultsRaw;
  const { points, games } = computeSeasonPoints(weeklyRaw);

  // Positional finish: rank 1 = most points at that position, leaguewide,
  // among everyone who actually scored (an unscored bench stash isn't
  // "last place at his position" — he just never got a finish).
  const byPosition = new Map<string, string[]>();
  for (const [pid, pts] of points) {
    if (pts <= 0) continue;
    const pos = positionById.get(pid) ?? '?';
    (byPosition.get(pos) ?? byPosition.set(pos, []).get(pos)!).push(pid);
  }
  const finishByPid = new Map<string, number>();
  for (const pids of byPosition.values()) {
    pids.sort((a, b) => (points.get(b) ?? 0) - (points.get(a) ?? 0) || a.localeCompare(b));
    pids.forEach((pid, i) => finishByPid.set(pid, i + 1));
  }

  const dynastyRanks = loadAdpRanks(year, 'adp-dynasty.json');
  const redraftRanks = loadAdpRanks(year, 'adp-redraft.json');

  const stats = new Map<string, KeeperPlannerPlayerStats>();
  const allIds = new Set([...points.keys(), ...dynastyRanks.keys(), ...redraftRanks.keys()]);
  for (const pid of allIds) {
    const pts = points.get(pid) ?? 0;
    const gp = games.get(pid) ?? 0;
    stats.set(pid, {
      ppg: gp > 0 ? pts / gp : null,
      gamesPlayed: gp,
      positionalFinish: finishByPid.get(pid) ?? null,
      dynastyAdpRank: dynastyRanks.get(pid) ?? null,
      redraftAdpRank: redraftRanks.get(pid) ?? null,
    });
  }
  return stats;
}
