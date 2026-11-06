/**
 * League History — the network half of reading an MFL league's champions.
 * The rules live in mfl-champions.ts; this file only fetches and calls them.
 *
 * Everything here takes a `fetchExport` so tests drive it with recorded
 * responses. The real one, `mflExportFetcher`, enforces three things:
 *
 *  - It only ever talks to MFL. The host comes from MFL's own history urls
 *    (validated by `isMflHost`), the league id is digits, and the TYPE is
 *    from a fixed list, so no part of a request is free text from a visitor.
 *  - A throttle is not an answer. MFL throttles hard and may reply 429, 5xx,
 *    or a 200 with a non-JSON body (docs/claude/insights/domains/mfl-api.md).
 *    Those throw `MflRetryLater`, so the caller stores nothing for that
 *    season and tries again; they are never recorded as "no champion".
 *  - A bounded timeout, so one slow host cannot hold a request open.
 */
import {
	bracketNeedsGames,
	bracketTeams,
	championFromBracket,
	championFromGames,
	isMflHost,
	laterBrackets,
	mflErrorText,
	parseFranchises,
	parseLeagueName,
	parseSeasonChain,
	rankChampionshipBrackets,
	type MflSeasonRef,
	type SeasonChampion,
	type SeasonFranchise,
} from './mfl-champions';

/** A crawled season: its result, and the franchises it had (for the admin's fix form). */
export interface CrawledSeason {
	result: SeasonChampion;
	franchises: SeasonFranchise[];
}

export const MFL_EXPORT_TYPES = ['league', 'playoffBrackets', 'playoffBracket', 'weeklyResults'] as const;
export type MflExportType = (typeof MFL_EXPORT_TYPES)[number];

export interface ExportRequest {
	host: string;
	year: number;
	type: MflExportType;
	leagueId: string;
	bracketId?: string;
}

export type FetchExport = (req: ExportRequest) => Promise<unknown>;

/** MFL is busy or unreachable: try this season again later, record nothing. */
export class MflRetryLater extends Error {}

/** The league does not exist, or MFL refused it (private, wrong id). */
export class MflLeagueNotFound extends Error {}

const TIMEOUT_MS = 8000;

export function exportUrl(req: ExportRequest): string {
	if (!isMflHost(req.host)) throw new Error(`not an MFL host: ${req.host}`);
	if (!/^\d{3,7}$/.test(req.leagueId)) throw new Error('bad league id');
	if (!Number.isInteger(req.year) || req.year < 1999 || req.year > 2100) throw new Error('bad year');
	if (!MFL_EXPORT_TYPES.includes(req.type)) throw new Error('bad export type');
	const params = new URLSearchParams({ TYPE: req.type, L: req.leagueId, JSON: '1' });
	// Every week played so far, in one response (`allWeeklyResults`).
	if (req.type === 'weeklyResults') params.set('W', 'YTD');
	if (req.bracketId) {
		if (!/^\d{1,3}$/.test(req.bracketId)) throw new Error('bad bracket id');
		params.set('BRACKET_ID', req.bracketId);
	}
	return `https://${req.host}/${req.year}/export?${params.toString()}`;
}

/** The real fetcher. Follows MFL's own api→wwwNN redirect; refuses any other host. */
export const mflExportFetcher: FetchExport = async (req) => {
	const url = exportUrl(req);
	let res: Response;
	try {
		res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
	} catch (err) {
		throw new MflRetryLater(`MFL unreachable: ${(err as Error).message}`);
	}
	if (!isMflHost(new URL(res.url || url).hostname)) throw new Error('MFL redirected off its own hosts');
	if (res.status === 429 || res.status >= 500) throw new MflRetryLater(`MFL answered ${res.status}`);
	if (!res.ok) throw new MflLeagueNotFound(`MFL answered ${res.status}`);
	const text = await res.text();
	try {
		return JSON.parse(text);
	} catch {
		// A 200 that is not JSON is MFL's throttled/degraded page, not an answer.
		throw new MflRetryLater('MFL returned a non-JSON page');
	}
};

export interface LeaguePlan {
	leagueId: string;
	name: string;
	seasons: MflSeasonRef[];
	/** Franchise id → the name it wears in the newest season. */
	latestNames: Record<string, string>;
}

/**
 * Discover a league from the id a visitor typed: its name, every season's
 * id and host, and today's franchise names. Tries `year` first, then the year
 * before (a league not yet renewed for the new MFL year still answers there).
 */
export async function planMflLeague(leagueId: string, year: number, fetchExport: FetchExport): Promise<LeaguePlan> {
	let lastError = 'MFL has no league with that id';
	for (const y of [year, year - 1]) {
		const body = await fetchExport({ host: 'api.myfantasyleague.com', year: y, type: 'league', leagueId });
		const err = mflErrorText(body);
		if (err) {
			lastError = err;
			continue;
		}
		const seasons = parseSeasonChain(body, y);
		if (seasons.length === 0) {
			lastError = 'MFL returned the league without any seasons';
			continue;
		}
		return {
			leagueId,
			name: parseLeagueName(body),
			seasons,
			latestNames: Object.fromEntries(parseFranchises(body)),
		};
	}
	throw new MflLeagueNotFound(lastError);
}

/**
 * One season's champion: the league export (for that season's teams), its
 * brackets, and the championship bracket. A season with no brackets is
 * unknown; nothing else is inferred (mfl-champions.ts, "HOW A CHAMPION IS
 * DECIDED").
 *
 * `finished` says the season is over (its year is before the current MFL
 * league year, so its Super Bowl has been played). Only then does the crawl
 * go past the first-ranked bracket's own export: it reads a seeds-only final
 * from the recorded games (`championFromGames`), and moves to the next-ranked
 * bracket while one cannot name a winner. A season still being played keeps
 * to the bracket MFL has filled in, so a live score is never read as a final.
 */
export async function crawlMflSeason(
	ref: MflSeasonRef,
	fetchExport: FetchExport,
	opts: { finished?: boolean } = {},
): Promise<CrawledSeason> {
	const base = { host: ref.host, year: ref.year, leagueId: ref.leagueId };
	const leagueBody = await fetchExport({ ...base, type: 'league' });
	const leagueErr = mflErrorText(leagueBody);
	if (leagueErr) {
		return {
			result: { year: ref.year, method: 'unknown', champion: null, runnerUp: null, note: `MFL: ${leagueErr}` },
			franchises: [],
		};
	}
	const franchises = parseFranchises(leagueBody);
	const list = [...franchises].map(([id, name]) => ({ id, name }));
	const done = (result: SeasonChampion): CrawledSeason => ({ result, franchises: list });

	const brackets = await fetchExport({ ...base, type: 'playoffBrackets' });
	const ranked = mflErrorText(brackets) ? [] : rankChampionshipBrackets(brackets);
	if (ranked.length === 0) {
		return done({
			year: ref.year,
			method: 'unknown',
			champion: null,
			runnerUp: null,
			note: 'MFL has no playoff bracket for this season',
		});
	}

	let weekly: unknown;
	const read = new Map<string, { bracket: unknown; result: SeasonChampion }>();
	const readBracket = async (bracketId: string) => {
		const cached = read.get(bracketId);
		if (cached) return cached;
		const bracket = await fetchExport({ ...base, type: 'playoffBracket', bracketId });
		const err = mflErrorText(bracket);
		let result: SeasonChampion = err
			? { year: ref.year, method: 'unknown', champion: null, runnerUp: null, note: `MFL: ${err}` }
			: championFromBracket(ref.year, bracket, franchises);
		if (!err && result.method === 'unknown' && opts.finished && bracketNeedsGames(bracket)) {
			weekly ??= await fetchExport({ ...base, type: 'weeklyResults' });
			if (!mflErrorText(weekly)) result = championFromGames(ref.year, bracket, weekly, franchises);
		}
		const entry = { bracket: err ? null : bracket, result };
		read.set(bracketId, entry);
		return entry;
	};

	let first: SeasonChampion | null = null;
	for (const bracketId of ranked.slice(0, opts.finished ? MAX_BRACKETS_TRIED : 1)) {
		const { result } = await readBracket(bracketId);
		if (result.method !== 'unknown') return done(await playOn(bracketId, result));
		first ??= result;
	}
	return done(first!);

	/**
	 * A bracket's champion who plays on in a later bracket won a division or
	 * conference, not the league: follow them (`laterBrackets`). If that later
	 * bracket cannot name a winner yet, neither can the season.
	 */
	async function playOn(fromId: string, result: SeasonChampion): Promise<SeasonChampion> {
		let at = fromId;
		for (let hop = 0; hop < MAX_BRACKETS_TRIED; hop++) {
			let moved = false;
			for (const laterId of laterBrackets(brackets, at).slice(0, 2)) {
				const later = await readBracket(laterId);
				const champ = result.champion!.id;
				// A seeds-only bracket names its teams only through the final read from the games.
				const inIt =
					!!later.bracket &&
					(bracketTeams(later.bracket).has(champ) ||
						later.result.champion?.id === champ ||
						later.result.runnerUp?.id === champ);
				if (!inIt) continue;
				if (later.result.method === 'unknown') {
					return { ...later.result, note: `the title bracket cannot name a winner yet (${later.result.note})` };
				}
				result = later.result;
				at = laterId;
				moved = true;
				break;
			}
			if (!moved) break;
		}
		return result;
	}
}

/** A finished season reads at most this many candidate title brackets. */
const MAX_BRACKETS_TRIED = 3;
