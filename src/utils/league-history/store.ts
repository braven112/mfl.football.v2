/**
 * League History — storage, and the step-by-step build of a league's record.
 *
 * Redis only: a league's history is data, never a file in this public repo.
 *
 *   league-history:mfl:<id>            the league record (StoredLeagueHistory)
 *   league-history:mfl:<id>:overrides  hash year → ChampionOverride (admin fixes)
 *   league-history:lock:mfl:<id>       a 30 s build lock, so one league is never
 *                                      crawled twice at once
 *   league-history:index               zset of `mfl:<id>` by first-built time
 *
 * ── WHY A BUILD IS STEPS, NOT ONE CALL ────────────────────────────────────
 * A 20-season league is ~60 MFL requests, and MFL throttles hard. One
 * request cannot hold that inside a serverless function's 30 s, so
 * `advanceMflHistory` does a few seasons per call and the setup page calls it
 * until `done`. A finished season is never fetched again; an undecided one in
 * the latest two years is re-checked at most every six hours, so a page
 * catches its new champion without a rebuild.
 */
import { getRedis } from '../redis-client';
import {
	tallyChampions,
	type ChampionTally,
	type MflSeasonRef,
	type SeasonChampion,
	type SeasonFranchise,
} from './mfl-champions';
import { crawlMflSeason, MflRetryLater, planMflLeague, type FetchExport } from './mfl-crawl';

export interface StoredSeason extends SeasonChampion {
	franchises: SeasonFranchise[];
	crawledAt: string;
}

export interface StoredLeagueHistory {
	platform: 'mfl';
	leagueId: string;
	name: string;
	chain: MflSeasonRef[];
	latestNames: Record<string, string>;
	seasons: Record<string, StoredSeason>;
	createdAt: string;
	updatedAt: string;
}

export interface ChampionOverride {
	/** null = "no champion that season" (e.g. a cancelled year). */
	championId: string | null;
	runnerUpId: string | null;
	setAt: string;
}

const KEY = (id: string) => `league-history:mfl:${id}`;
const OVERRIDES = (id: string) => `league-history:mfl:${id}:overrides`;
const LOCK = (id: string) => `league-history:lock:mfl:${id}`;
const INDEX = 'league-history:index';

export const SEASONS_PER_STEP = 3;
const RECHECK_MS = 6 * 60 * 60 * 1000;

export function isMflLeagueId(value: string): boolean {
	return /^\d{3,7}$/.test(value);
}

export async function readMflHistory(leagueId: string): Promise<StoredLeagueHistory | null> {
	if (!isMflLeagueId(leagueId)) return null;
	const redis = await getRedis();
	if (!redis) return null;
	return (await redis.get<StoredLeagueHistory>(KEY(leagueId))) ?? null;
}

export async function readOverrides(leagueId: string): Promise<Record<string, ChampionOverride>> {
	const redis = await getRedis();
	if (!redis || !isMflLeagueId(leagueId)) return {};
	return (await redis.hgetall<ChampionOverride>(OVERRIDES(leagueId))) ?? {};
}

/** Every league built so far, newest first: `{ leagueId, name }`. */
export async function listMflHistories(limit = 50): Promise<{ leagueId: string; name: string }[]> {
	const redis = await getRedis();
	if (!redis) return [];
	const members = await redis.zrange<string>(INDEX, 0, limit - 1, { rev: true });
	const ids = (members ?? []).map((m) => String(m).replace(/^mfl:/, '')).filter(isMflLeagueId);
	if (ids.length === 0) return [];
	const records = await redis.mget<StoredLeagueHistory>(...ids.map(KEY));
	return ids.flatMap((id, i) => (records[i] ? [{ leagueId: id, name: records[i]!.name }] : []));
}

/** Seasons this step should (re)fetch, oldest first. */
export function seasonsToCrawl(record: StoredLeagueHistory, now: number): MflSeasonRef[] {
	const newest = Math.max(...record.chain.map((s) => s.year));
	return record.chain.filter((ref) => {
		const stored = record.seasons[String(ref.year)];
		if (!stored) return true;
		if (stored.method !== 'unknown' || ref.year < newest - 1) return false;
		return now - Date.parse(stored.crawledAt) > RECHECK_MS;
	});
}

export type AdvanceResult =
	| { status: 'done' | 'progress'; name: string; built: number; total: number }
	| { status: 'busy' | 'retry-later'; built: number; total: number; message: string }
	| { status: 'not-found' | 'no-storage'; message: string };

/**
 * One build step for an MFL league: plan it if new, then crawl up to
 * `SEASONS_PER_STEP` seasons. Safe to call repeatedly and concurrently (the
 * lock makes a second caller answer 'busy').
 */
export async function advanceMflHistory(
	leagueId: string,
	deps: { fetchExport: FetchExport; leagueYear: number; seasonInProgress: number; now?: () => number },
): Promise<AdvanceResult> {
	const redis = await getRedis();
	if (!redis) return { status: 'no-storage', message: 'History storage is unavailable right now.' };
	const now = deps.now ?? Date.now;

	const locked = await redis.set(LOCK(leagueId), '1', { nx: true, ex: 30 });
	if (!locked) {
		const existing = await readMflHistory(leagueId);
		const total = existing?.chain.length ?? 0;
		return { status: 'busy', built: existing ? Object.keys(existing.seasons).length : 0, total, message: 'Already building.' };
	}

	try {
		let record = await readMflHistory(leagueId);
		if (!record) {
			let plan;
			try {
				plan = await planMflLeague(leagueId, deps.leagueYear, deps.fetchExport);
			} catch (err) {
				if (err instanceof MflRetryLater) {
					return { status: 'retry-later', built: 0, total: 0, message: 'MFL is busy. Trying again shortly.' };
				}
				return { status: 'not-found', message: (err as Error).message };
			}
			const stamp = new Date(now()).toISOString();
			record = {
				platform: 'mfl',
				leagueId,
				name: plan.name,
				chain: plan.seasons,
				latestNames: plan.latestNames,
				seasons: {},
				createdAt: stamp,
				updatedAt: stamp,
			};
			await redis.set(KEY(leagueId), record);
			await redis.zadd(INDEX, { score: now(), member: `mfl:${leagueId}` });
		}

		const todo = seasonsToCrawl(record, now()).slice(0, SEASONS_PER_STEP);
		for (const ref of todo) {
			try {
				const { result, franchises } = await crawlMflSeason(ref, deps.fetchExport, deps.seasonInProgress);
				record.seasons[String(ref.year)] = { ...result, franchises, crawledAt: new Date(now()).toISOString() };
			} catch (err) {
				if (!(err instanceof MflRetryLater)) throw err;
				await saveRecord(record, now);
				return {
					status: 'retry-later',
					built: Object.keys(record.seasons).length,
					total: record.chain.length,
					message: 'MFL is busy. Trying again shortly.',
				};
			}
		}
		await saveRecord(record, now);
		const remaining = seasonsToCrawl(record, now()).length;
		return {
			status: remaining === 0 ? 'done' : 'progress',
			name: record.name,
			built: Object.keys(record.seasons).length,
			total: record.chain.length,
		};
	} finally {
		await redis.del(LOCK(leagueId));
	}
}

async function saveRecord(record: StoredLeagueHistory, now: () => number): Promise<void> {
	const redis = await getRedis();
	if (!redis) return;
	record.updatedAt = new Date(now()).toISOString();
	await redis.set(KEY(record.leagueId), record);
}

/** Set or clear an admin's fix for one season. `override: null` removes it. */
export async function writeOverride(
	leagueId: string,
	year: number,
	override: Omit<ChampionOverride, 'setAt'> | null,
): Promise<boolean> {
	const redis = await getRedis();
	if (!redis || !isMflLeagueId(leagueId)) return false;
	if (override === null) {
		await redis.hdel(OVERRIDES(leagueId), String(year));
	} else {
		await redis.hset(OVERRIDES(leagueId), { [String(year)]: { ...override, setAt: new Date().toISOString() } });
	}
	return true;
}

export interface EffectiveSeason extends SeasonChampion {
	franchises: SeasonFranchise[];
	/** The crawler's own answer, kept when an override replaced it. */
	crawled?: SeasonChampion;
}

/** The seasons as the page shows them: newest first, admin fixes applied. */
export function effectiveSeasons(
	record: StoredLeagueHistory,
	overrides: Record<string, ChampionOverride>,
): EffectiveSeason[] {
	return record.chain
		.map((ref) => {
			const stored = record.seasons[String(ref.year)];
			const base: EffectiveSeason = stored
				? { ...stored }
				: { year: ref.year, method: 'unknown', champion: null, runnerUp: null, note: 'not read yet', franchises: [] };
			const fix = overrides[String(ref.year)];
			if (!fix) return base;
			const name = (id: string | null) =>
				id ? { id, name: base.franchises.find((f) => f.id === id)?.name ?? record.latestNames[id] ?? `Franchise ${id}` } : null;
			return {
				...base,
				method: 'override' as const,
				champion: name(fix.championId),
				runnerUp: name(fix.runnerUpId),
				note: undefined,
				crawled: { year: base.year, method: base.method, champion: base.champion, runnerUp: base.runnerUp, note: base.note },
			};
		})
		.sort((a, b) => b.year - a.year);
}

export function trophyCase(record: StoredLeagueHistory, seasons: EffectiveSeason[]): ChampionTally[] {
	return tallyChampions(seasons, new Map(Object.entries(record.latestNames)));
}
