/**
 * Season video — reading a signed-in owner's season from MFL.
 *
 * SERVER ONLY. Reads with the owner's own MFL cookie, so a private league
 * works the same as a public one, and only for a league the owner's account
 * lists (the endpoint checks that with `requireOwnerLeague` first).
 *
 * Which season: the newest one the league has finished. An MFL league
 * renews into the new year in February, long before that year's games, so
 * "this league year" is usually a season not played yet; the league
 * export's history chain (`parseSeasonChain`) names every earlier year's id
 * and host, and querying an old year with today's id would read a different
 * league. The visitor can ask for any year in that chain.
 *
 * Logos come back as data: URLs. The browser draws them onto a canvas it
 * then records, and one cross-origin image would taint it.
 */
import { asArray, isMflHost, mflErrorText, parseLeagueName, parseSeasonChain, pickChampionshipBracketId, type MflSeasonRef } from '../league-history/mfl-champions';
import { formatMflName } from '../player-name-matching';
import { attachStandouts, fromMflExports, parseMflWeekStarters, pickVideoKind, type MflFranchiseInfo, type SeasonFacts, type SeasonVideoKind, type WeekLine } from './season';

export type ExportType = 'league' | 'leagueStandings' | 'playoffBrackets' | 'playoffBracket' | 'schedule' | 'weeklyResults' | 'players';

/** Fetch one MFL export as JSON; throws on network failure or a non-JSON page. */
export type FetchMflExport = (req: { host: string; year: number; leagueId: string; type: ExportType; bracketId?: string; players?: string }) => Promise<unknown>;

/** Fetch an image and return it as a data: URL, or null. */
export type FetchLogo = (url: string) => Promise<string | null>;

export interface SeasonVideoResponse {
	ok: true;
	facts: SeasonFacts;
	kind: SeasonVideoKind;
	/** Every year the league has played, newest first, for the season picker. */
	years: number[];
	franchiseId: string;
	franchises: { id: string; name: string }[];
	/** False while that season's final has not been played. */
	complete: boolean;
}

export type SeasonVideoError = { ok: false; error: 'no-season' | 'not-in-season' | 'mfl-unavailable'; message: string };

export function exportPath(req: Parameters<FetchMflExport>[0]): string {
	if (!isMflHost(req.host)) throw new Error(`not an MFL host: ${req.host}`);
	if (!/^\d{3,7}$/.test(req.leagueId)) throw new Error('bad league id');
	if (!Number.isInteger(req.year) || req.year < 1999 || req.year > 2100) throw new Error('bad year');
	const params = new URLSearchParams({ TYPE: req.type, L: req.leagueId, JSON: '1' });
	if (req.bracketId) {
		if (!/^\d{1,3}$/.test(req.bracketId)) throw new Error('bad bracket id');
		params.set('BRACKET_ID', req.bracketId);
	}
	// Every week's lineups in one call.
	if (req.type === 'weeklyResults') params.set('W', 'YTD');
	if (req.players) {
		if (!/^\d{1,6}(,\d{1,6}){0,299}$/.test(req.players)) throw new Error('bad player list');
		params.set('PLAYERS', req.players);
	}
	return `https://${req.host}/${req.year}/export?${params.toString()}`;
}

async function readSeason(
	ref: MflSeasonRef,
	leagueName: string,
	franchiseId: string,
	fetchExport: FetchMflExport,
) {
	const base = { host: ref.host, year: ref.year, leagueId: ref.leagueId };
	const [league, standings, brackets, schedule, weekly] = await Promise.all([
		fetchExport({ ...base, type: 'league' }),
		fetchExport({ ...base, type: 'leagueStandings' }),
		fetchExport({ ...base, type: 'playoffBrackets' }),
		fetchExport({ ...base, type: 'schedule' }),
		// The lineups only add the best and worst starter; a failure costs those, not the video.
		fetchExport({ ...base, type: 'weeklyResults' }).catch(() => null),
	]);
	const champId = mflErrorText(brackets) ? null : pickChampionshipBracketId(brackets);
	const championshipBracket = champId ? await fetchExport({ ...base, type: 'playoffBracket', bracketId: champId }) : null;
	return {
		league,
		base,
		weekly: weekly && !mflErrorText(weekly) ? weekly : null,
		result: fromMflExports({
			leagueName: mflErrorText(league) ? leagueName : parseLeagueName(league),
			season: ref.year,
			franchiseId,
			league,
			standings,
			brackets,
			championshipBracket: championshipBracket && !mflErrorText(championshipBracket) ? championshipBracket : null,
			schedule,
		}),
	};
}

export interface LoadSeasonInput {
	/** The owner's league, as `requireOwnerLeague` resolved it. */
	league: { leagueId: string; leagueName: string; franchiseId: string; year: number; host: string | null };
	year?: number | null;
	franchiseId?: string | null;
	fetchExport: FetchMflExport;
	fetchLogo: FetchLogo;
}

export async function loadMflSeason(input: LoadSeasonInput): Promise<SeasonVideoResponse | SeasonVideoError> {
	const { league, fetchExport, fetchLogo } = input;
	const host = league.host ? new URL(league.host).hostname : 'api.myfantasyleague.com';
	const head = await fetchExport({ host, year: league.year, leagueId: league.leagueId, type: 'league' });
	const chain = mflErrorText(head) ? [] : parseSeasonChain(head, league.year);
	if (chain.length === 0) return { ok: false, error: 'no-season', message: 'MFL did not return this league’s seasons.' };
	const years = chain.map((s) => s.year).sort((a, b) => b - a);
	const leagueName = parseLeagueName(head) || league.leagueName;

	// The requested year, else the newest season with its final played.
	const wanted = input.year && years.includes(input.year) ? [input.year] : years.slice(0, 2);
	const franchiseId = /^\d{4}$/.test(input.franchiseId ?? '') ? input.franchiseId! : league.franchiseId;

	let chosen: Awaited<ReturnType<typeof readSeason>> | null = null;
	for (const y of wanted) {
		const ref = chain.find((s) => s.year === y)!;
		const read = await readSeason(ref, leagueName, franchiseId, fetchExport);
		chosen = read;
		if (read.result?.complete || input.year) break;
	}
	const result = chosen?.result;
	if (!result) {
		return { ok: false, error: 'not-in-season', message: 'That team isn’t in this season’s standings.' };
	}

	const weeks = chosen?.weekly && result.facts.weeks?.length
		? await withStandouts(result.facts.weeks, chosen.weekly, franchiseId, chosen.base, fetchExport)
		: result.facts.weeks;

	// Logos: the team's and every opponent the cards show.
	const byId = new Map<string, MflFranchiseInfo>(result.franchises.map((f) => [f.id, f]));
	const ids = [result.logoIds.team, ...result.logoIds.opponents];
	const logos = new Map<string, string | null>();
	await Promise.all(
		ids.map(async (id) => {
			const url = byId.get(id)?.icon;
			logos.set(id, url ? await fetchLogo(url).catch(() => null) : null);
		}),
	);
	const withLogo = <T extends { oppId?: string }>(g: T): T => ({ ...g, oppLogo: g.oppId ? logos.get(g.oppId) ?? null : null });
	const facts: SeasonFacts = {
		...result.facts,
		weeks,
		teamLogo: logos.get(result.logoIds.team) ?? null,
		playoffs: result.facts.playoffs.map(withLogo),
		bestGame: result.facts.bestGame ? withLogo(result.facts.bestGame) : null,
		worstGame: result.facts.worstGame ? withLogo(result.facts.worstGame) : null,
	};

	return {
		ok: true,
		facts,
		kind: pickVideoKind(facts, result.complete),
		years,
		franchiseId,
		franchises: result.franchises.map((f) => ({ id: f.id, name: f.name })),
		complete: result.complete,
	};
}

/** MFL's players export takes a list; this many ids keeps the URL short. */
const PLAYERS_PER_CALL = 250;

/**
 * Each week's best and worst starter for the team. Names and positions for
 * every starter in the league (the averages need the whole league's), read
 * from MFL's players export for that year. Any failure leaves the weeks as
 * they were.
 */
async function withStandouts(
	weeks: WeekLine[],
	weekly: unknown,
	franchiseId: string,
	base: { host: string; year: number; leagueId: string },
	fetchExport: FetchMflExport,
): Promise<WeekLine[]> {
	try {
		const starters = parseMflWeekStarters(weekly);
		const ids = [...new Set([...starters.values()].flat().map((s) => s.id))].filter((id) => /^\d{1,6}$/.test(id));
		if (ids.length === 0) return weeks;
		const chunks: string[][] = [];
		for (let i = 0; i < ids.length; i += PLAYERS_PER_CALL) chunks.push(ids.slice(i, i + PLAYERS_PER_CALL));
		const bodies = await Promise.all(chunks.map((c) => fetchExport({ ...base, type: 'players', players: c.join(',') }).catch(() => null)));
		const people = new Map<string, { name: string; pos: string }>();
		for (const b of bodies) {
			for (const p of asArray((b as { players?: { player?: unknown } } | null)?.players?.player as { id?: string; name?: string; position?: string }[])) {
				if (p?.id && p.name && p.position) people.set(String(p.id), { name: formatMflName(p.name), pos: p.position });
			}
		}
		return attachStandouts(weeks, starters, franchiseId, (id) => people.get(id) ?? null);
	} catch {
		return weeks;
	}
}

/** What a logo may be: an image, small enough to embed. */
export const MAX_LOGO_BYTES = 600_000;
