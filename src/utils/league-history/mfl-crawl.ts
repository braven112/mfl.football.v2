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
	championFromBracket,
	championFromStandings,
	isMflHost,
	mflErrorText,
	parseFranchises,
	parseLeagueName,
	parseSeasonChain,
	pickChampionshipBracketId,
	type MflSeasonRef,
	type SeasonChampion,
	type SeasonFranchise,
} from './mfl-champions';

/** A crawled season: its result, and the franchises it had (for the admin's fix form). */
export interface CrawledSeason {
	result: SeasonChampion;
	franchises: SeasonFranchise[];
}

export const MFL_EXPORT_TYPES = ['league', 'playoffBrackets', 'playoffBracket', 'leagueStandings'] as const;
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
 * One season's champion. Three requests for a league with playoffs (league,
 * brackets, the championship bracket), three for one without (league,
 * brackets, standings).
 */
export async function crawlMflSeason(
	ref: MflSeasonRef,
	fetchExport: FetchExport,
	/**
	 * The season being played now (`getCurrentSeasonYear()`). Standings name a
	 * leader every week, so a no-bracket season this year or later is never
	 * decided by them: its "champion" would just be this week's leader. A
	 * bracket needs no such guard, since an unplayed final already reads as
	 * undecided.
	 */
	seasonInProgress: number,
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
	const bracketId = mflErrorText(brackets) ? null : pickChampionshipBracketId(brackets);
	if (bracketId) {
		const bracket = await fetchExport({ ...base, type: 'playoffBracket', bracketId });
		const err = mflErrorText(bracket);
		if (err) return done({ year: ref.year, method: 'unknown', champion: null, runnerUp: null, note: `MFL: ${err}` });
		return done(championFromBracket(ref.year, bracket, franchises));
	}

	if (ref.year >= seasonInProgress) {
		return done({ year: ref.year, method: 'unknown', champion: null, runnerUp: null, note: 'the season is still being played' });
	}
	const standings = await fetchExport({ ...base, type: 'leagueStandings' });
	if (mflErrorText(standings)) {
		return done({ year: ref.year, method: 'unknown', champion: null, runnerUp: null, note: 'no brackets, standings unavailable' });
	}
	return done(championFromStandings(ref.year, standings, franchises));
}
