/**
 * The League History datasets for one league, read through the league-data
 * loader (src/utils/league-data.ts) per request — never imported. Every
 * league's copy of these files was compiled into the serverless function
 * (Ask the History alone was a 14 MB chunk); this reads only the league asked
 * about.
 *
 * Server-only (the loader reads node:fs locally and Vercel Blob in production).
 *
 * A league has the full League History product (Ask the History, the Record
 * Book share card) when its `<dataPath>/derived/` holds all three files the
 * build derives for it. A league with only `league-history.json` (rivalry
 * lines, owner pages) does not.
 */
import { hasLeagueData, listLeagueData, loadLeagueData } from '../league-data';

export interface LeagueHistoryPaths {
	/** league-history.json */
	history: string;
	/** league-history-players.json */
	players: string;
	/** league-history-moves.json */
	moves: string;
}

/** The three derived files' repo-relative paths, from the league's registry `dataPath`. */
export function leagueHistoryPaths(dataPath: string): LeagueHistoryPaths {
	const dir = `${dataPath}/derived`;
	return {
		history: `${dir}/league-history.json`,
		players: `${dir}/league-history-players.json`,
		moves: `${dir}/league-history-moves.json`,
	};
}

/** Whether the league has the full League History product — a cheap existence check, no read. */
export function hasLeagueHistoryProduct(dataPath: string): boolean {
	return Object.values(leagueHistoryPaths(dataPath)).every((p) => hasLeagueData(p));
}

/** league-history.json alone, or null. */
export function loadLeagueHistory<T = any>(dataPath: string): Promise<T | null> {
	return loadLeagueData<T>(leagueHistoryPaths(dataPath).history);
}

/** All three files, loaded in parallel, or null unless every one exists. */
export async function loadLeagueHistoryDataset(
	dataPath: string,
): Promise<{ history: any; players: any; moves: any } | null> {
	const paths = leagueHistoryPaths(dataPath);
	const [history, players, moves] = await Promise.all([
		loadLeagueData(paths.history),
		loadLeagueData(paths.players),
		loadLeagueData(paths.moves),
	]);
	return history && players && moves ? { history, players, moves } : null;
}

/**
 * The sources of the league's all-play side competition (Ask the History's
 * competition units, ask-competitions.mjs), or null when the league has none.
 * A league has one when its config declares `tierCompetition.firstSeason` and
 * its dataPath records the tiers in `tier-history.json`: data, never a slug.
 */
export async function loadLeagueCompetitions(
	dataPath: string,
	configPath: string | undefined,
): Promise<{ tierCompetition: any; tierHistory: any; awards: any; weekly: Record<string, any> } | null> {
	const tierPath = `${dataPath}/tier-history.json`;
	if (!configPath || !hasLeagueData(tierPath)) return null;
	const [config, tierHistory, awards] = await Promise.all([
		loadLeagueData<any>(configPath),
		loadLeagueData<any>(tierPath),
		loadLeagueData<any>(`${dataPath}/awards-history.json`),
	]);
	const tierCompetition = config?.tierCompetition;
	const first = Number(tierCompetition?.firstSeason);
	if (!Number.isInteger(first) || !tierHistory?.seasons) return null;
	const files = listLeagueData(`${dataPath}/mfl-feeds/*/weekly-results.json`).filter((p) => {
		const year = Number(p.split('/').at(-2));
		return Number.isInteger(year) && year >= first;
	});
	const loaded = await Promise.all(files.map(async (p) => [p.split('/').at(-2)!, await loadLeagueData<any>(p)] as const));
	const weekly: Record<string, any> = {};
	for (const [year, value] of loaded) if (value) weekly[year] = value;
	return { tierCompetition, tierHistory, awards, weekly };
}
