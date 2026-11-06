/**
 * Season video — reading a season from ESPN.
 *
 * Two ways in (Brandon, 2026-11-05: "public by ID + paste for private"):
 *  - PUBLIC league: the owner types the league id (or pastes the league's
 *    URL) and the server reads ESPN's league endpoint. No login.
 *  - PRIVATE league: ESPN answers only to a signed-in member's browser
 *    (`AUTH_LEAGUE_NOT_VISIBLE`, the same wall src/utils/espn-history.ts
 *    documents). So the page hands the owner ONE link (`espnVideoUrl`), they
 *    open it while signed in to ESPN, copy what it shows and paste it back.
 *    We never ask for, hold or forward an ESPN login or cookie (espn_s2/SWID).
 *
 * ESPN's league API is unofficial and undocumented, so every field below is
 * optional and a missing one degrades a fact rather than failing the read.
 * Team-level data only (records, scores, logos), never player data — the
 * free tier's rule, and the ESPN licensing line (see the data-replacement
 * work: we read the owner's own league results, not ESPN's player data).
 *
 * How ESPN maps onto `SeasonFacts`:
 *  - Record and points: `teams[].record.overall`.
 *  - Finish: `playoffSeed`, which ESPN assigns to EVERY team as its final
 *    regular-season place; when it is missing, wins then points for.
 *  - Playoffs: schedule rows whose `playoffTierType` is WINNERS_BRACKET.
 *    Consolation ladders are not the road to the title and are left out; a
 *    row with no `away` side is a bye. A matchup period may span two NFL
 *    weeks, and `totalPoints` already sums them.
 *  - Champion: the final's `winner`, else `rankCalculatedFinal === 1`.
 *
 * Pure parsing (tests/season-video-espn.test.ts); `loadEspnSeason` is the only
 * network part and takes its fetcher as an argument.
 */
import { pickVideoKind, pointsRankOf, roundLabel, type SeasonFacts, type SeasonGame, type SeasonVideoKind } from './season';
import type { FetchLogo } from './mfl-source';

const ESPN_API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
/** ESPN serves seasons before this from a different endpoint (/leagueHistory) with a different shape. */
export const ESPN_FIRST_SEASON = 2018;
export const ESPN_LEAGUE_ID = /^\d{1,12}$/;
/** A full season with these views is well under 1 MB; anything bigger is not one. */
export const MAX_ESPN_PASTE_CHARS = 3_000_000;

/** The views one video needs, in one request: teams + records, scores, league settings. */
const VIEWS = ['mTeam', 'mMatchupScore', 'mSettings'] as const;

/** The one link the owner opens: the season's teams, scores and settings. */
export function espnVideoUrl(leagueId: string, season: number): string {
	const url = new URL(`${ESPN_API}/seasons/${season}/segments/0/leagues/${leagueId}`);
	for (const v of VIEWS) url.searchParams.append('view', v);
	return url.href;
}

/** ESPN numbers a season by the year it starts: September–December is that year, January–August the one before. */
export function currentEspnSeason(now: Date): number {
	return now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

/**
 * The league id (and season, when it says) from what an owner types: a bare
 * id, or any ESPN fantasy URL carrying `leagueId=` (and maybe `seasonId=`).
 */
export function parseEspnLeagueInput(text: string): { leagueId: string; season: number | null } | null {
	const t = text.trim();
	if (ESPN_LEAGUE_ID.test(t)) return { leagueId: t, season: null };
	const id = /[?&#]leagueId=(\d{1,12})(?!\d)/i.exec(t);
	if (!id) return null;
	const season = /[?&#]seasonId=(\d{4})(?!\d)/i.exec(t);
	return { leagueId: id[1], season: season ? Number(season[1]) : null };
}

// ── ESPN's shapes (all optional) ──────────────────────────────────────────

interface EspnTeam {
	id?: number;
	name?: string;
	location?: string;
	nickname?: string;
	abbrev?: string;
	logo?: string;
	playoffSeed?: number;
	rankCalculatedFinal?: number;
	record?: { overall?: { wins?: number; losses?: number; ties?: number; pointsFor?: number } };
}
interface EspnSide {
	teamId?: number;
	totalPoints?: number;
}
interface EspnMatchup {
	matchupPeriodId?: number;
	home?: EspnSide;
	away?: EspnSide;
	winner?: string;
	playoffTierType?: string;
}
export interface EspnSeasonRaw {
	id?: number | string;
	seasonId?: number;
	teams?: EspnTeam[];
	schedule?: EspnMatchup[];
	settings?: {
		name?: string;
		scheduleSettings?: { matchupPeriodCount?: number; playoffTeamCount?: number };
	};
	status?: { isActive?: boolean };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function espnTeamName(t: EspnTeam | undefined): string {
	if (!t) return 'Team';
	if (t.name?.trim()) return t.name.trim();
	const joined = [t.location, t.nickname].filter(Boolean).join(' ').trim();
	return joined || (t.abbrev?.trim() ? t.abbrev.trim() : `Team ${t.id ?? ''}`.trim());
}

const pf = (t: EspnTeam) => num(t.record?.overall?.pointsFor);
const seedOf = (t: EspnTeam) => (typeof t.playoffSeed === 'number' && t.playoffSeed > 0 ? t.playoffSeed : null);

/** Teams in regular-season order: ESPN's seeds when every team has one, else wins then points for. */
export function rankEspnTeams(teams: readonly EspnTeam[]): EspnTeam[] {
	const valid = teams.filter((t) => typeof t.id === 'number');
	if (valid.length && valid.every((t) => seedOf(t) !== null)) {
		return [...valid].sort((a, b) => seedOf(a)! - seedOf(b)!);
	}
	return [...valid].sort(
		(a, b) => num(b.record?.overall?.wins) - num(a.record?.overall?.wins) || pf(b) - pf(a) || (a.id ?? 0) - (b.id ?? 0),
	);
}

export interface EspnSeasonResult {
	facts: SeasonFacts;
	/** ESPN team ids whose logos the facts reference (team first). */
	logoIds: { team: number; opponents: number[] };
	complete: boolean;
}

const isPlayoff = (m: EspnMatchup, regularWeeks: number) =>
	m.playoffTierType ? m.playoffTierType !== 'NONE' : regularWeeks > 0 && num(m.matchupPeriodId) > regularWeeks;

/** One team's season from an ESPN league response. Null if the team is not in it. */
export function fromEspn(raw: EspnSeasonRaw, teamId: number): EspnSeasonResult | null {
	const teams = (raw.teams ?? []).filter((t) => typeof t.id === 'number');
	const me = teams.find((t) => t.id === teamId);
	if (!me) return null;
	const byId = new Map(teams.map((t) => [t.id as number, t]));
	const nameOf = (id: number) => espnTeamName(byId.get(id));
	const regularWeeks = num(raw.settings?.scheduleSettings?.matchupPeriodCount);
	const playoffTeams = num(raw.settings?.scheduleSettings?.playoffTeamCount);
	const schedule = (raw.schedule ?? []).filter((m) => typeof m.home?.teamId === 'number' && typeof m.matchupPeriodId === 'number');

	// The road to the title: the winners bracket, in matchup-period order.
	const bracket = schedule.filter(
		(m) => isPlayoff(m, regularWeeks) && (m.playoffTierType ? m.playoffTierType === 'WINNERS_BRACKET' : true),
	);
	const periods = [...new Set(bracket.map((m) => m.matchupPeriodId as number))].sort((a, b) => a - b);
	const lastPeriod = periods[periods.length - 1];
	const finals = bracket.filter((m) => m.matchupPeriodId === lastPeriod && typeof m.away?.teamId === 'number');
	const final = finals.length === 1 ? finals[0] : undefined;
	const championId =
		final && (final.winner === 'HOME' || final.winner === 'AWAY')
			? (final.winner === 'HOME' ? final.home!.teamId : final.away!.teamId)
			: teams.find((t) => t.rankCalculatedFinal === 1)?.id;
	const complete = championId !== undefined;

	const sideOf = (m: EspnMatchup) => (m.home?.teamId === teamId ? 'home' : m.away?.teamId === teamId ? 'away' : null);
	const playoffs: SeasonGame[] = [];
	const opponents: number[] = [];
	for (const m of [...bracket].sort((a, b) => num(a.matchupPeriodId) - num(b.matchupPeriodId))) {
		const side = sideOf(m);
		if (!side || typeof m.away?.teamId !== 'number') continue; // not mine, or a bye
		const mine = num(m[side]!.totalPoints);
		const opp = side === 'home' ? m.away : m.home!;
		const theirs = num(opp.totalPoints);
		const decided = m.winner === 'HOME' || m.winner === 'AWAY' || m.winner === 'TIE';
		if (!decided && mine === 0 && theirs === 0) continue; // not played yet
		const roundIndex = periods.indexOf(m.matchupPeriodId as number);
		playoffs.push({
			label: m === final ? 'The Final' : roundLabel(roundIndex, periods.length),
			score: round2(mine),
			oppName: nameOf(opp.teamId as number),
			oppScore: round2(theirs),
			oppId: String(opp.teamId),
		});
		opponents.push(opp.teamId as number);
	}

	const ranked = rankEspnTeams(teams);
	const finish = ranked.indexOf(me) + 1;
	const seed = seedOf(me);
	const madeIt = playoffs.length > 0 || (playoffTeams > 0 && seed !== null && seed <= playoffTeams && periods.length > 0);
	let outcome: SeasonFacts['outcome'] = madeIt ? 'playoffs' : 'missed';
	if (!complete && !madeIt) outcome = 'in-progress';
	if (complete && final && sideOf(final)) outcome = championId === teamId ? 'champion' : 'runner-up';
	else if (complete && championId === teamId) outcome = 'champion';

	// Best and worst regular-season games.
	const regular: { week: number; score: number; oppId: number; oppScore: number }[] = [];
	for (const m of schedule) {
		if (isPlayoff(m, regularWeeks)) continue;
		const side = sideOf(m);
		if (!side || typeof m.away?.teamId !== 'number') continue;
		const mine = num(m[side]!.totalPoints);
		const opp = side === 'home' ? m.away : m.home!;
		if (mine === 0 && num(opp.totalPoints) === 0) continue;
		regular.push({ week: m.matchupPeriodId as number, score: mine, oppId: opp.teamId as number, oppScore: num(opp.totalPoints) });
	}
	const toGame = (g: (typeof regular)[number] | undefined): SeasonGame | null =>
		g ? { label: `Week ${g.week}`, score: round2(g.score), oppName: nameOf(g.oppId), oppScore: round2(g.oppScore), oppId: String(g.oppId) } : null;
	const best = [...regular].sort((a, b) => b.score - a.score)[0];
	const worst = [...regular].sort((a, b) => a.score - b.score)[0];
	if (best) opponents.push(best.oppId);
	if (worst) opponents.push(worst.oppId);

	const overall = me.record?.overall;
	return {
		facts: {
			leagueName: raw.settings?.name?.trim() || 'ESPN league',
			season: num(raw.seasonId) || new Date().getFullYear() - 1,
			teamName: espnTeamName(me),
			teamLogo: null,
			wins: num(overall?.wins),
			losses: num(overall?.losses),
			ties: num(overall?.ties),
			pointsFor: round2(pf(me)),
			pointsRank: pointsRankOf(pf(me), ranked.map(pf)),
			finish: finish || null,
			teams: ranked.length || null,
			seed: seed !== null && playoffTeams > 0 && seed <= playoffTeams ? seed : null,
			outcome,
			playoffs,
			bestGame: toGame(best),
			worstGame: toGame(worst),
		},
		logoIds: { team: teamId, opponents: [...new Set(opponents)] },
		complete,
	};
}

/** A team's logo URL as ESPN stores it, when it is one we can fetch. */
export function espnLogoUrl(t: EspnTeam | undefined): string | null {
	const logo = t?.logo?.trim();
	return logo && /^https:\/\//i.test(logo) ? logo : null;
}

export type EspnReadError = { ok: false; error: 'not-json' | 'private' | 'not-a-league' | 'wrong-league' | 'too-old'; message: string };

/**
 * What the owner pasted (or what ESPN answered), checked: JSON, not ESPN's
 * "not authorized" body, a league season, and — when we know it — this league.
 */
export function readEspnSeason(text: string, leagueId: string | null): { ok: true; raw: EspnSeasonRaw } | EspnReadError {
	const trimmed = text.trim();
	if (!trimmed || trimmed.length > MAX_ESPN_PASTE_CHARS) {
		return { ok: false, error: 'not-json', message: 'That isn’t what the ESPN link shows. Open the link, select all of the text, copy it and paste it here.' };
	}
	let data: unknown;
	try {
		data = JSON.parse(trimmed);
	} catch {
		return { ok: false, error: 'not-json', message: 'That isn’t what the ESPN link shows. Open the link, select all of the text, copy it and paste it here.' };
	}
	if (Array.isArray(data)) data = data[0];
	if (!data || typeof data !== 'object') return { ok: false, error: 'not-a-league', message: 'That doesn’t look like an ESPN league.' };
	if (Array.isArray((data as { messages?: unknown }).messages)) {
		return {
			ok: false,
			error: 'private',
			message: 'ESPN said "not authorized". Sign in at espn.com in this same browser, then open the link again.',
		};
	}
	const raw = data as EspnSeasonRaw;
	if (!Array.isArray(raw.teams) || !raw.teams.length) {
		return { ok: false, error: 'not-a-league', message: 'That doesn’t look like an ESPN league. Copy everything the link shows.' };
	}
	if (leagueId && raw.id !== undefined && String(raw.id) !== leagueId) {
		return { ok: false, error: 'wrong-league', message: `That’s ESPN league ${raw.id}, not ${leagueId}.` };
	}
	return { ok: true, raw };
}

// ── loading ───────────────────────────────────────────────────────────────

export interface EspnVideoResponse {
	ok: true;
	leagueId: string;
	season: number;
	teams: { id: number; name: string }[];
	/** Null until the owner has picked their team. */
	teamId: number | null;
	facts: SeasonFacts | null;
	kind: SeasonVideoKind | null;
	complete: boolean;
}

/** One team's video facts (logos fetched as data: URLs) from a checked ESPN season. */
export async function buildEspnVideo(raw: EspnSeasonRaw, teamId: number | null, fetchLogo: FetchLogo): Promise<EspnVideoResponse> {
	const teams = rankEspnTeams(raw.teams ?? []);
	const list = teams.map((t) => ({ id: t.id as number, name: espnTeamName(t) }));
	const base = { ok: true as const, leagueId: String(raw.id ?? ''), season: num(raw.seasonId), teams: list };
	const result = teamId !== null ? fromEspn(raw, teamId) : null;
	if (!result) return { ...base, teamId: null, facts: null, kind: null, complete: false };

	const byId = new Map(teams.map((t) => [t.id as number, t]));
	const logos = new Map<string, string | null>();
	await Promise.all(
		[result.logoIds.team, ...result.logoIds.opponents].map(async (id) => {
			const url = espnLogoUrl(byId.get(id));
			logos.set(String(id), url ? await fetchLogo(url).catch(() => null) : null);
		}),
	);
	const withLogo = <T extends { oppId?: string }>(g: T): T => ({ ...g, oppLogo: g.oppId ? logos.get(g.oppId) ?? null : null });
	const facts: SeasonFacts = {
		...result.facts,
		teamLogo: logos.get(String(teamId)) ?? null,
		playoffs: result.facts.playoffs.map(withLogo),
		bestGame: result.facts.bestGame ? withLogo(result.facts.bestGame) : null,
		worstGame: result.facts.worstGame ? withLogo(result.facts.worstGame) : null,
	};
	return { ...base, teamId, facts, kind: pickVideoKind(facts, result.complete), complete: result.complete };
}

export type EspnGet = (url: string) => Promise<{ status: number; text: string } | null>;

export type EspnLoadError =
	| EspnReadError
	| { ok: false; error: 'no-league' | 'espn-unavailable'; message: string }
	| { ok: false; error: 'private'; message: string; pasteUrl: string };

/** A PUBLIC league read server-side. A private one answers with the link the owner opens instead. */
export async function loadEspnSeason(input: {
	leagueId: string;
	season: number;
	teamId: number | null;
	get: EspnGet;
	fetchLogo: FetchLogo;
}): Promise<EspnVideoResponse | EspnLoadError> {
	const { leagueId, season } = input;
	if (!ESPN_LEAGUE_ID.test(leagueId)) return { ok: false, error: 'no-league', message: 'That isn’t an ESPN league id.' };
	if (!Number.isInteger(season) || season < ESPN_FIRST_SEASON || season > 2100) {
		return { ok: false, error: 'too-old', message: `We can read ESPN seasons from ${ESPN_FIRST_SEASON} on.` };
	}
	const pasteUrl = espnVideoUrl(leagueId, season);
	const res = await input.get(pasteUrl);
	if (!res) return { ok: false, error: 'espn-unavailable', message: 'ESPN isn’t answering right now. Try again in a minute.' };
	if (res.status === 401 || res.status === 403) {
		return { ok: false, error: 'private', message: 'This league is private, so ESPN only shows it to its members.', pasteUrl };
	}
	if (res.status === 404) return { ok: false, error: 'no-league', message: `ESPN has no ${season} season for league ${leagueId}.` };
	if (res.status !== 200) return { ok: false, error: 'espn-unavailable', message: 'ESPN isn’t answering right now. Try again in a minute.' };
	const read = readEspnSeason(res.text, leagueId);
	if (!read.ok) return read.error === 'private' ? { ...read, pasteUrl } : read;
	return buildEspnVideo(read.raw, input.teamId, input.fetchLogo);
}
