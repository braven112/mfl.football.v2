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
import { compactSalaries } from './ask-careers.mjs';

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

/**
 * The roster-path extras Ask the History's stint and pick units read when a
 * league has them (ask-stints.mjs): its keeper sets (keeper-history.json, the
 * AFL) and its traced pick trades (pick-trades.json, the AFL). Optional: a
 * league without them derives what it can from the moves file alone.
 */
export function leagueHistoryExtraPaths(dataPath: string): { keepers: string; pickTrades: string } {
	const dir = `${dataPath}/derived`;
	return { keepers: `${dir}/keeper-history.json`, pickTrades: `${dir}/pick-trades.json` };
}

/** All three files, loaded in parallel, or null unless every one exists; plus the optional extras. */
export async function loadLeagueHistoryDataset(
	dataPath: string,
): Promise<{ history: any; players: any; moves: any; keepers: any; pickTrades: any } | null> {
	const paths = leagueHistoryPaths(dataPath);
	const extras = leagueHistoryExtraPaths(dataPath);
	const optional = (p: string) => (hasLeagueData(p) ? loadLeagueData(p) : Promise.resolve(null));
	const [history, players, moves, keepers, pickTrades] = await Promise.all([
		loadLeagueData(paths.history),
		loadLeagueData(paths.players),
		loadLeagueData(paths.moves),
		optional(extras.keepers),
		optional(extras.pickTrades),
	]);
	return history && players && moves ? { history, players, moves, keepers: keepers ?? null, pickTrades: pickTrades ?? null } : null;
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

/** Season salaries by player, compacted (ask-careers.mjs): `{ [year]: { [pid]: [salary, franchiseId] } }`. */
export type LeagueSalaries = Record<string, Record<string, [number, string]>>;

const salaryMemo = new Map<string, { raws: unknown[]; compact: LeagueSalaries }>();

/**
 * A salary league's season salaries (`<dataPath>/mfl-player-salaries-<year>.json`,
 * each the rostered players at that season's freeze week), for the career
 * unit's salary fields. Only a league whose registry says it keeps contracts
 * should ask (the AFL's files carry MFL's default salary, not a contract).
 * The compact copy is reused while the loader serves the same files.
 */
export async function loadLeagueSalaries(dataPath: string): Promise<LeagueSalaries | null> {
	const files = listLeagueData(`${dataPath}/mfl-player-salaries-*.json`);
	if (!files.length) return null;
	const raws = await Promise.all(files.map((p) => loadLeagueData<any>(p)));
	const memo = salaryMemo.get(dataPath);
	if (memo && memo.raws.length === raws.length && memo.raws.every((r, i) => r === raws[i])) return memo.compact;
	const compact = compactSalaries(files.map((p, i) => [/mfl-player-salaries-(\d{4})\.json$/.exec(p)?.[1] ?? '', raws[i]])) as LeagueSalaries;
	salaryMemo.set(dataPath, { raws, compact });
	return compact;
}
