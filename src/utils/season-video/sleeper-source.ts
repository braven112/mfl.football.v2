/**
 * Season video — reading a season from Sleeper.
 *
 * Sleeper's API is public and read-only, so a Sleeper owner needs no sign-in
 * here: they type their Sleeper username, pick one of their leagues, and the
 * season fills in. That keeps the free tier's "minimum effort" promise for
 * the owners least likely to have an MFL account.
 *
 * What Sleeper gives, and how it maps onto `SeasonFacts`:
 *  - Record and points: each roster's `settings` (wins, losses, ties, fpts +
 *    fpts_decimal / 100).
 *  - Finish: Sleeper publishes records, not an order. Ranked by wins, then
 *    points for — Sleeper's own default view (see sleeper/standings.ts).
 *  - Playoffs: `winners_bracket` names who played whom in each round and who
 *    won (`w`); the scores come from that round's matchups. A round can span
 *    two weeks (`playoff_round_type` 1: the final only, 2: every round), and
 *    then its score is the sum of both weeks.
 *  - Placement games (`p` 3, 5 …) are played by bracket losers; they are not
 *    the road to the title, so they are left out.
 *  - Logos: the team's own avatar (`metadata.avatar`, a full URL), else the
 *    owner's user avatar on Sleeper's CDN.
 *
 * Team-level data only; the matchups carry player points, which are never read.
 * SERVER ONLY (network); the parsing is pure and tested in
 * tests/season-video-sleeper.test.ts.
 */
import { pickVideoKind, roundLabel, type SeasonFacts, type SeasonGame, type SeasonVideoKind } from './season';
import type { FetchLogo } from './mfl-source';

export type SleeperGet = (path: string) => Promise<unknown>;

export interface SleeperLeagueRow {
	id: string;
	name: string;
	season: number;
	status: string;
}

interface Roster {
	roster_id: number;
	owner_id?: string | null;
	co_owners?: string[] | null;
	settings?: { wins?: number; losses?: number; ties?: number; fpts?: number; fpts_decimal?: number } | null;
}
interface LeagueUser {
	user_id: string;
	display_name?: string;
	avatar?: string | null;
	metadata?: { team_name?: string | null; avatar?: string | null } | null;
}
interface BracketMatch {
	r: number;
	m: number;
	t1?: number | null;
	t2?: number | null;
	w?: number | null;
	l?: number | null;
	p?: number | null;
}
interface Matchup {
	roster_id: number;
	points?: number | null;
	custom_points?: number | null;
}

export interface SleeperSeasonInput {
	league: {
		name?: string;
		season?: string | number;
		status?: string;
		settings?: { playoff_week_start?: number; playoff_round_type?: number; start_week?: number } | null;
	};
	rosters: Roster[];
	users: LeagueUser[];
	bracket: BracketMatch[];
	/** Week number → that week's matchups. Regular season and playoff weeks. */
	matchups: Map<number, Matchup[]>;
	rosterId: number;
}

const pts = (r: Roster) => (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;
const score = (m: Matchup | undefined) => (m ? Number(m.custom_points ?? m.points ?? 0) : 0);

/** Teams ranked as Sleeper's own standings view does: wins, then points for. */
export function rankRosters(rosters: readonly Roster[]): Roster[] {
	return [...rosters].sort(
		(a, b) => (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0) || pts(b) - pts(a) || a.roster_id - b.roster_id,
	);
}

/** The weeks a playoff round is played in. */
export function roundWeeks(round: number, maxRound: number, start: number, roundType: number): number[] {
	if (roundType === 2) return [start + 2 * (round - 1), start + 2 * (round - 1) + 1];
	const week = start + round - 1;
	return roundType === 1 && round === maxRound ? [week, week + 1] : [week];
}

function teamName(users: readonly LeagueUser[], roster: Roster | undefined): string {
	const u = users.find((x) => x.user_id === roster?.owner_id);
	return (u?.metadata?.team_name || u?.display_name || `Team ${roster?.roster_id ?? ''}`).trim();
}

/** The avatar to show for a roster: the team's own, else its owner's. */
export function rosterAvatarUrl(users: readonly LeagueUser[], roster: Roster | undefined): string | null {
	const u = users.find((x) => x.user_id === roster?.owner_id);
	const team = u?.metadata?.avatar;
	if (team && /^https:\/\//.test(team)) return team;
	return u?.avatar && /^[A-Za-z0-9_.-]+$/.test(u.avatar) ? `https://sleepercdn.com/avatars/${u.avatar}` : null;
}

export interface SleeperSeasonResult {
	facts: SeasonFacts;
	/** Roster ids whose avatars the facts reference (team first). */
	logoIds: { team: number; opponents: number[] };
	complete: boolean;
}

/** One roster's season from Sleeper's league, rosters, users, bracket and matchups. Null if the roster is not in the league. */
export function fromSleeper(x: SleeperSeasonInput): SleeperSeasonResult | null {
	const me = x.rosters.find((r) => r.roster_id === x.rosterId);
	if (!me) return null;
	const ranked = rankRosters(x.rosters);
	const byId = new Map(x.rosters.map((r) => [r.roster_id, r]));
	const nameOf = (id: number) => teamName(x.users, byId.get(id));
	const start = Number(x.league.settings?.playoff_week_start) || 15;
	const roundType = Number(x.league.settings?.playoff_round_type) || 0;

	// The road to the title: the winners bracket without its placement games.
	const road = x.bracket.filter((m) => m && (m.p === undefined || m.p === null || m.p === 1));
	const maxRound = road.reduce((n, m) => Math.max(n, m.r), 0);
	const final = road.find((m) => m.p === 1) ?? road.filter((m) => m.r === maxRound).find(() => true);
	const complete = !!final?.w;

	const playoffs: SeasonGame[] = [];
	const opponents: number[] = [];
	for (const m of [...road].sort((a, b) => a.r - b.r)) {
		if (m.t1 !== x.rosterId && m.t2 !== x.rosterId) continue;
		const oppId = m.t1 === x.rosterId ? m.t2 : m.t1;
		if (!oppId) continue;
		const weeks = roundWeeks(m.r, maxRound, start, roundType);
		const sum = (id: number) =>
			weeks.reduce((s, w) => s + score(x.matchups.get(w)?.find((e) => e.roster_id === id)), 0);
		const mine = sum(x.rosterId);
		const theirs = sum(oppId);
		if (!m.w && mine === 0 && theirs === 0) continue; // not played yet
		playoffs.push({
			label: m === final ? 'The Final' : roundLabel(m.r - 1, maxRound),
			score: Math.round(mine * 100) / 100,
			oppName: nameOf(oppId),
			oppScore: Math.round(theirs * 100) / 100,
			oppId: String(oppId),
		});
		opponents.push(oppId);
	}

	let outcome: SeasonFacts['outcome'] = playoffs.length ? 'playoffs' : 'missed';
	if (complete && final && (final.t1 === x.rosterId || final.t2 === x.rosterId)) {
		outcome = final.w === x.rosterId ? 'champion' : 'runner-up';
	}

	// Best and worst regular-season games, from the weekly matchups.
	const regular: { week: number; score: number; oppId: number; oppScore: number }[] = [];
	for (const [week, entries] of x.matchups) {
		if (week >= start) continue;
		const mine = entries.find((e) => e.roster_id === x.rosterId) as (Matchup & { matchup_id?: number | null }) | undefined;
		if (!mine || mine.matchup_id === null || mine.matchup_id === undefined) continue;
		const opp = entries.find(
			(e) => e.roster_id !== x.rosterId && (e as Matchup & { matchup_id?: number | null }).matchup_id === mine.matchup_id,
		);
		if (!opp || (score(mine) === 0 && score(opp) === 0)) continue;
		regular.push({ week, score: score(mine), oppId: opp.roster_id, oppScore: score(opp) });
	}
	const toGame = (g: (typeof regular)[number] | undefined): SeasonGame | null =>
		g ? { label: `Week ${g.week}`, score: g.score, oppName: nameOf(g.oppId), oppScore: g.oppScore, oppId: String(g.oppId) } : null;
	const best = [...regular].sort((a, b) => b.score - a.score)[0];
	const worst = [...regular].sort((a, b) => a.score - b.score)[0];
	if (best) opponents.push(best.oppId);
	if (worst) opponents.push(worst.oppId);

	return {
		facts: {
			leagueName: String(x.league.name ?? '').trim() || 'Sleeper league',
			season: Number(x.league.season) || new Date().getFullYear() - 1,
			teamName: nameOf(x.rosterId),
			teamLogo: null,
			wins: me.settings?.wins ?? 0,
			losses: me.settings?.losses ?? 0,
			ties: me.settings?.ties ?? 0,
			pointsFor: Math.round(pts(me) * 100) / 100,
			finish: ranked.indexOf(me) + 1,
			teams: ranked.length,
			seed: null,
			outcome,
			playoffs,
			bestGame: toGame(best),
			worstGame: toGame(worst),
		},
		logoIds: { team: x.rosterId, opponents: [...new Set(opponents)] },
		complete,
	};
}

// ── network ───────────────────────────────────────────────────────────────

const LEAGUE_ID = /^\d{6,25}$/;

/** A Sleeper user's NFL leagues for the last two seasons, finished seasons first. */
export async function listSleeperLeagues(userId: string, now: Date, get: SleeperGet): Promise<SleeperLeagueRow[]> {
	const year = now.getFullYear();
	const lists = await Promise.all([year, year - 1].map((y) => get(`/user/${encodeURIComponent(userId)}/leagues/nfl/${y}`)));
	const rows: SleeperLeagueRow[] = [];
	for (const list of lists) {
		if (!Array.isArray(list)) continue;
		for (const l of list as { league_id?: string; name?: string; season?: string; status?: string }[]) {
			if (!l?.league_id || !LEAGUE_ID.test(l.league_id)) continue;
			rows.push({ id: l.league_id, name: String(l.name ?? 'Sleeper league').trim(), season: Number(l.season) || year, status: String(l.status ?? '') });
		}
	}
	const done = (r: SleeperLeagueRow) => (r.status === 'complete' ? 0 : 1);
	return rows.sort((a, b) => done(a) - done(b) || b.season - a.season || a.name.localeCompare(b.name));
}

export interface SleeperVideoResponse {
	ok: true;
	facts: SeasonFacts;
	kind: SeasonVideoKind;
	rosterId: number;
	teams: { id: number; name: string }[];
	complete: boolean;
}

export type SleeperVideoError = { ok: false; error: 'no-league' | 'not-in-league' | 'sleeper-unavailable'; message: string };

export async function loadSleeperSeason(input: {
	leagueId: string;
	/** The Sleeper user whose team to show by default. */
	userId: string | null;
	rosterId?: number | null;
	get: SleeperGet;
	fetchLogo: FetchLogo;
}): Promise<SleeperVideoResponse | SleeperVideoError> {
	const { leagueId, get } = input;
	if (!LEAGUE_ID.test(leagueId)) return { ok: false, error: 'no-league', message: 'That isn’t a Sleeper league id.' };
	const [league, rosters, users, bracket] = await Promise.all([
		get(`/league/${leagueId}`),
		get(`/league/${leagueId}/rosters`),
		get(`/league/${leagueId}/users`),
		get(`/league/${leagueId}/winners_bracket`),
	]);
	if (!league || typeof league !== 'object' || !Array.isArray(rosters) || !Array.isArray(users)) {
		return { ok: false, error: 'sleeper-unavailable', message: 'Sleeper didn’t return this league. Try again in a minute.' };
	}
	const rs = rosters as Roster[];
	const owned = input.userId ? rs.find((r) => r.owner_id === input.userId || r.co_owners?.includes(input.userId!)) : undefined;
	const rosterId = input.rosterId && rs.some((r) => r.roster_id === input.rosterId) ? input.rosterId : owned?.roster_id ?? null;
	if (!rosterId) return { ok: false, error: 'not-in-league', message: 'Pick your team from the list.' };

	const settings = (league as SleeperSeasonInput['league']).settings ?? {};
	const start = Number(settings.playoff_week_start) || 15;
	const firstWeek = Number(settings.start_week) || 1;
	const lastWeek = start + 5; // up to three two-week rounds
	const weeks = Array.from({ length: lastWeek - firstWeek + 1 }, (_, i) => firstWeek + i);
	const weekly = await Promise.all(weeks.map((w) => get(`/league/${leagueId}/matchups/${w}`)));
	const matchups = new Map<number, Matchup[]>();
	weeks.forEach((w, i) => {
		if (Array.isArray(weekly[i]) && (weekly[i] as unknown[]).length) matchups.set(w, weekly[i] as Matchup[]);
	});

	const result = fromSleeper({
		league: league as SleeperSeasonInput['league'],
		rosters: rs,
		users: users as LeagueUser[],
		bracket: Array.isArray(bracket) ? (bracket as BracketMatch[]) : [],
		matchups,
		rosterId,
	});
	if (!result) return { ok: false, error: 'not-in-league', message: 'That team isn’t in this league.' };

	const byId = new Map(rs.map((r) => [r.roster_id, r]));
	const logos = new Map<string, string | null>();
	await Promise.all(
		[result.logoIds.team, ...result.logoIds.opponents].map(async (id) => {
			const url = rosterAvatarUrl(users as LeagueUser[], byId.get(id));
			logos.set(String(id), url ? await input.fetchLogo(url).catch(() => null) : null);
		}),
	);
	const withLogo = <T extends { oppId?: string }>(g: T): T => ({ ...g, oppLogo: g.oppId ? logos.get(g.oppId) ?? null : null });
	const facts: SeasonFacts = {
		...result.facts,
		teamLogo: logos.get(String(rosterId)) ?? null,
		playoffs: result.facts.playoffs.map(withLogo),
		bestGame: result.facts.bestGame ? withLogo(result.facts.bestGame) : null,
		worstGame: result.facts.worstGame ? withLogo(result.facts.worstGame) : null,
	};
	return {
		ok: true,
		facts,
		kind: pickVideoKind(facts, result.complete),
		rosterId,
		teams: rankRosters(rs).map((r) => ({ id: r.roster_id, name: teamName(users as LeagueUser[], r) })),
		complete: result.complete,
	};
}
