/**
 * NFL week recap — the server side: reads Sleeper's weekly PPR stat lines and
 * the shared Sleeper player map, and hands the pure picker (nfl-week.ts) what
 * it needs. Server only.
 *
 * Source: Sleeper's public, keyless weekly stats
 * (`/v1/stats/nfl/regular/<season>/<week>`), whose lines carry `pts_ppr`.
 * Chosen because it is free (Brandon's rule: no paid feed where a free one
 * works) and the repo already reads Sleeper; ESPN alone is never the source.
 * If Sleeper stops serving it, BallDontLie (the planned paid feed) is the
 * fallback — swap `fetchWeekStats`, the picker does not change.
 *
 * Player names come from `loadSleeperPlayerMap` (cached a day in Redis),
 * never a fresh `/players/nfl`, which Sleeper asks be read at most daily.
 */
import { sleeperGet } from '../sleeper/client';
import { loadSleeperPlayerMap } from '../sleeper/players';
import { REGULAR_SEASON_WEEKS, nflWeekFor, nflWeekStartInstant } from '../nfl-week-starts.mjs';
import { pickNflWeek, type NflWeekFacts, type PlayerInfo, type WeekStats } from './nfl-week';

/** Earlier weeks never change once played, so a warm function reads each once. */
const memo = new Map<string, WeekStats>();

export async function fetchWeekStats(season: number, week: number): Promise<WeekStats | null> {
	const key = `${season}:${week}`;
	const hit = memo.get(key);
	if (hit) return hit;
	const body = await sleeperGet(`/stats/nfl/regular/${season}/${week}`);
	if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
	const stats = body as WeekStats;
	return stats;
}

/**
 * The week a recap is for, as of `now`: the latest week whose games have
 * started, in the regular season. On a Tuesday that is the week that just
 * ended, whichever day the next week turns over.
 */
export function recapWeekFor(season: number, now: Date): number {
	let w = nflWeekFor(season, now);
	if (w > 0 && now < nflWeekStartInstant(season, w)) w -= 1;
	return Math.max(1, Math.min(REGULAR_SEASON_WEEKS, w || 1));
}

export async function loadNflWeek(season: number, week: number): Promise<NflWeekFacts | null> {
	const [stats, players, ...earlier] = await Promise.all([
		fetchWeekStats(season, week),
		loadSleeperPlayerMap(season),
		...Array.from({ length: week - 1 }, (_, i) => fetchWeekStats(season, i + 1)),
	]);
	if (!stats || !Object.keys(stats).length) return null;
	// Only earlier weeks are memoized: the current one may still be filling in.
	earlier.forEach((w, i) => w && Object.keys(w).length && memo.set(`${season}:${i + 1}`, w));
	const info: Record<string, PlayerInfo> = {};
	for (const [id, p] of Object.entries(players)) info[id] = { name: p.name, position: p.position, team: p.team };
	return pickNflWeek({ season, week, stats, earlier: earlier.filter((w): w is WeekStats => !!w), players: info });
}
