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
import { hasLeagueData, loadLeagueData } from '../league-data';

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
