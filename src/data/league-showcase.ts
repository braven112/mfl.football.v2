/**
 * How MFL.football presents the leagues it runs, on its own marketing pages
 * (the shared host's homepage and MFL Live's landing at `/live`).
 *
 * Presentation only. Ids, slugs, names and logos come from the league
 * registry; this adds the line a visitor reads about each one. A league with
 * no entry here is simply not showcased.
 */
import { ALL_LEAGUES, type CanonicalLeagueSlug } from '../config/leagues';

export interface ShowcaseMeta {
	/** The name as a marketing line uses it ("Archie's", not the full registry name). */
	short: string;
	estYear: number;
	teams: number;
	/** One short phrase about how the league plays. */
	format: string;
}

const SHOWCASE: Partial<Record<CanonicalLeagueSlug, ShowcaseMeta>> = {
	theleague: { short: 'The League', estYear: 2007, teams: 16, format: 'Dynasty · contracts and salary cap' },
	'afl-fantasy': { short: 'AFL', estYear: 2003, teams: 24, format: 'Two conferences · keepers' },
	archies: { short: "Archie's", estYear: 2021, teams: 99, format: 'Nine divisions · redraft' },
};

export type ShowcaseLeague = (typeof ALL_LEAGUES)[number] & { showcase: ShowcaseMeta };

/**
 * The leagues a public page may SHOW (logos, example boards, league rows):
 * full-management leagues with a showcase entry, minus any package league
 * whose owner has not agreed to be listed (`advertiseOnSharedHost: false`,
 * the same rule the splash follows). Registry order.
 */
export function showcaseLeagues(): ShowcaseLeague[] {
	return ALL_LEAGUES.filter((l) => !l.bestBall && l.advertiseOnSharedHost !== false && SHOWCASE[l.slug]).map(
		(l) => ({ ...l, showcase: SHOWCASE[l.slug]! }),
	);
}

/**
 * The short names of every league whose owners have MFL Live Pro included —
 * every full-management league, listed or not. Naming who it is free for is
 * the offer itself, not an advertisement of the league, so this is wider than
 * `showcaseLeagues`.
 */
export function mflLiveIncludedNames(): string[] {
	return ALL_LEAGUES.filter((l) => !l.bestBall).map((l) => SHOWCASE[l.slug]?.short ?? l.name);
}
