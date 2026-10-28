/**
 * The network half of the free all-play report: find the league's season,
 * then read its teams and weekly results. Same fetcher, host checks and
 * error classes as League History's crawl (league-history/mfl-crawl.ts), so a
 * visitor's input can only ever become an MFL export request.
 */
import { mflErrorText, parseFranchises, parseLeagueName } from './league-history/mfl-champions';
import { MflLeagueNotFound, planMflLeague, type FetchExport } from './league-history/mfl-crawl';
import { computeAllPlayReport, type AllPlayReport } from './mfl-all-play-report';

export interface LoadedAllPlay extends AllPlayReport {
	leagueId: string;
	year: number;
	leagueName: string;
}

/** A league id as typed: digits only, MFL's length. Null for anything else. */
export function parseLeagueIdInput(raw: string | null | undefined): string | null {
	const v = String(raw ?? '').trim();
	// Accept a pasted league URL too: .../2026/home/12345
	const fromUrl = /myfantasyleague\.com\/\d{4}\/[a-z_]+\/(\d{3,7})/i.exec(v);
	const id = fromUrl ? fromUrl[1] : v;
	return /^\d{3,7}$/.test(id) ? id : null;
}

/**
 * `leagueId` is read as the id the league has NOW (`idYear`, today's MFL
 * year), because that is the id a commissioner copies from their league's
 * address. An older `year` is then reached through the league's own history
 * chain, never by asking MFL for that year with today's id, which can
 * silently return a different league (mfl-champions.ts, "WHY A LEAGUE IS A
 * CHAIN OF IDS").
 */
export async function loadAllPlay(
	leagueId: string,
	year: number,
	idYear: number,
	fetchExport: FetchExport,
): Promise<LoadedAllPlay> {
	const plan = await planMflLeague(leagueId, idYear, fetchExport);
	const season = plan.seasons.find((s) => s.year === year);
	if (!season) throw new MflLeagueNotFound(`This league has no ${year} season on MFL`);
	const base = { host: season.host, year, leagueId: season.leagueId };
	const leagueBody = await fetchExport({ ...base, type: 'league' });
	const leagueErr = mflErrorText(leagueBody);
	if (leagueErr) throw new MflLeagueNotFound(leagueErr);
	const resultsBody = await fetchExport({ ...base, type: 'weeklyResults' });
	const resultsErr = mflErrorText(resultsBody);
	if (resultsErr) throw new MflLeagueNotFound(resultsErr);
	return {
		leagueId,
		year,
		leagueName: parseLeagueName(leagueBody) || plan.name,
		...computeAllPlayReport(resultsBody, parseFranchises(leagueBody)),
	};
}
