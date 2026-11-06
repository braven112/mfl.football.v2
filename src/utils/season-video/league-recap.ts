/**
 * Season video — the LEAGUE recap: no team picked, the data hands out the
 * awards (Brandon, 2026-11-06). A commissioner's weekly or season recap.
 *
 *  - Weekly: top score, low score, biggest blowout, closest game, best start
 *    at any position, unluckiest loss (the highest score that still lost).
 *  - Season: best and worst record, most and fewest points, best and worst
 *    all-play, every division winner (conference winners when the league has
 *    conferences and no divisions), and the champion once there is one.
 *  - Anyone can override who won an award; the award's stat line then
 *    describes the team they picked, so it stays true.
 *
 * Built from league data only (MFL, Sleeper, ESPN), never typed in: every
 * card needs a real team's name and logo. Pure; the sources build
 * `LeagueFacts` and the page renders the story.
 */
import { asArray, pickChampionshipBracketId } from '../league-history/mfl-champions';
import type { MflSeasonExports, StarterLine, WeekStarter } from './season';
import { formatPoints, formatRecord, formatScore, parseBracketGames, parseMflFranchises, parseMflStandings, parseScheduleAll, pickStandouts, positionLabel } from './season';

export interface LeagueTeam {
	id: string;
	name: string;
	/** A data: URL (same-origin safe for the canvas), or null for initials. */
	logo?: string | null;
	wins: number;
	losses: number;
	ties: number;
	pointsFor: number;
	/** The division (or conference) name, when the league has them. */
	group?: string | null;
}

/** One regular-season game with both scores. */
export interface LeagueGame {
	week: number;
	a: string;
	aScore: number;
	b: string;
	bScore: number;
}

export interface LeagueFacts {
	leagueName: string;
	season: number;
	/** In standings order, best first: the platform's own order where it has one. */
	teams: LeagueTeam[];
	games: LeagueGame[];
	/** What `group` names: divisions, or conferences when the league only has those. */
	groupKind?: 'division' | 'conference' | null;
	/** Null until the final is played. */
	championId?: string | null;
	/** Week → team id → that team's best starter, judged against the league at his position. */
	bestStarts?: Record<number, Record<string, StarterLine>>;
}

export type AwardId =
	| 'champion'
	| 'best-record'
	| 'most-points'
	| 'best-allplay'
	| 'worst-record'
	| 'fewest-points'
	| 'worst-allplay'
	| `group:${string}`
	| 'top-score'
	| 'low-score'
	| 'blowout'
	| 'closest'
	| 'best-start'
	| 'unlucky';

export interface Award {
	id: AwardId;
	title: string;
	badge: string;
	/** The team the data picked. */
	pickedId: string;
	/** The team shown: the override when there is one, else the pick. */
	teamId: string;
	/** A line about the shown team's own numbers. */
	value: string;
	/** Good news or bad: sets the card's palette. */
	tone: 'good' | 'bad';
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Every regular-season week with a played game, in order. */
export function leagueWeeks(lf: LeagueFacts): number[] {
	return [...new Set(lf.games.map((g) => g.week))].sort((a, b) => a - b);
}

/** Each team's all-play record: every week's score against every other team's that week. */
export function allPlayRecords(lf: LeagueFacts): Map<string, { wins: number; losses: number; ties: number }> {
	const out = new Map(lf.teams.map((t) => [t.id, { wins: 0, losses: 0, ties: 0 }]));
	for (const week of leagueWeeks(lf)) {
		const scores = weekScores(lf, week);
		for (const [id, s] of scores) {
			const rec = out.get(id) ?? out.set(id, { wins: 0, losses: 0, ties: 0 }).get(id)!;
			for (const [other, o] of scores) {
				if (other === id) continue;
				if (s > o) rec.wins++;
				else if (s < o) rec.losses++;
				else rec.ties++;
			}
		}
	}
	return out;
}

/** One score per team that week (a doubleheader counts once). */
function weekScores(lf: LeagueFacts, week: number): Map<string, number> {
	const scores = new Map<string, number>();
	for (const g of lf.games) {
		if (g.week !== week) continue;
		if (!scores.has(g.a)) scores.set(g.a, g.aScore);
		if (!scores.has(g.b)) scores.set(g.b, g.bScore);
	}
	return scores;
}

/** The team's game that week (its first, in a doubleheader week). */
function gameOf(lf: LeagueFacts, week: number, id: string) {
	const g = lf.games.find((x) => x.week === week && (x.a === id || x.b === id));
	if (!g) return null;
	const mine = g.a === id;
	return { score: mine ? g.aScore : g.bScore, oppId: mine ? g.b : g.a, oppScore: mine ? g.bScore : g.aScore };
}

const pct = (t: LeagueTeam) => {
	const n = t.wins + t.losses + t.ties;
	return n ? (t.wins + t.ties / 2) / n : 0;
};
const apPct = (r: { wins: number; losses: number; ties: number }) => {
	const n = r.wins + r.losses + r.ties;
	return n ? (r.wins + r.ties / 2) / n : 0;
};

/** The groups the league plays in, in the order their first team appears in the standings. */
export function leagueGroups(lf: LeagueFacts): string[] {
	const out: string[] = [];
	for (const t of lf.teams) if (t.group && !out.includes(t.group)) out.push(t.group);
	return out.length > 1 ? out : [];
}

/**
 * The awards, in the order the video shows them. `overrides` maps an award
 * to the team the viewer picked instead; an override naming a team not in
 * the league is ignored.
 */
export function leagueAwards(
	lf: LeagueFacts,
	span: 'week' | 'season',
	week: number | undefined,
	overrides: Partial<Record<AwardId, string>> = {},
): Award[] {
	const byId = new Map(lf.teams.map((t) => [t.id, t]));
	const name = (id: string) => byId.get(id)?.name ?? 'Unknown';
	const make = (id: AwardId, title: string, badge: string, tone: Award['tone'], pickedId: string | undefined, value: (teamId: string) => string): Award | null => {
		if (!pickedId) return null;
		const o = overrides[id];
		const teamId = o && byId.has(o) ? o : pickedId;
		return { id, title, badge, pickedId, teamId, value: value(teamId), tone };
	};
	const out: (Award | null)[] = [];

	if (span === 'week') {
		const weeks = leagueWeeks(lf);
		const w = week !== undefined && weeks.includes(week) ? week : weeks[weeks.length - 1];
		if (w === undefined) return [];
		const scores = weekScores(lf, w);
		const ranked = [...scores].sort((a, b) => b[1] - a[1]);
		const scoreLine = (id: string) => {
			const s = scores.get(id);
			return s === undefined ? 'Didn’t play this week.' : `${formatScore(s)} points.`;
		};
		const resultLine = (id: string) => {
			const g = gameOf(lf, w, id);
			if (!g) return 'Didn’t play this week.';
			const m = formatScore(r2(Math.abs(g.score - g.oppScore)));
			if (g.score > g.oppScore) return `Beat ${name(g.oppId)} by ${m}.`;
			if (g.score < g.oppScore) return `Lost to ${name(g.oppId)} by ${m}.`;
			return `Tied ${name(g.oppId)}.`;
		};
		const games = lf.games.filter((g) => g.week === w);
		const margin = (g: LeagueGame) => Math.abs(g.aScore - g.bScore);
		const winner = (g: LeagueGame) => (g.aScore >= g.bScore ? g.a : g.b);
		const blowout = [...games].sort((x, y) => margin(y) - margin(x))[0];
		const closest = [...games].filter((g) => margin(g) > 0).sort((x, y) => margin(x) - margin(y))[0];
		const losers = games
			.filter((g) => g.aScore !== g.bScore)
			.map((g) => (g.aScore < g.bScore ? { id: g.a, s: g.aScore } : { id: g.b, s: g.bScore }))
			.sort((x, y) => y.s - x.s);
		const starts = lf.bestStarts?.[w] ?? {};
		const gap = (p: StarterLine) => p.pts - (p.avg ?? 0);
		const bestStart = Object.entries(starts).sort((x, y) => gap(y[1]) - gap(x[1]))[0]?.[0];
		const startLine = (id: string) => {
			const p = starts[id];
			if (!p) return scoreLine(id);
			const avg = p.avg !== null ? ` ${positionLabel(p.pos)}s averaged ${p.avg.toFixed(1)}.` : '';
			return `${p.name}, ${positionLabel(p.pos)}: ${formatScore(p.pts)} points.${avg}`;
		};
		out.push(
			make('top-score', 'Top score', '🔥', 'good', ranked[0]?.[0], scoreLine),
			make('blowout', 'Biggest blowout', '💥', 'good', blowout && winner(blowout), resultLine),
			make('best-start', 'Best start', '⭐', 'good', bestStart, startLine),
			make('closest', 'Closest game', '😬', 'good', closest && winner(closest), resultLine),
			make('unlucky', 'Unluckiest loss', '🍀', 'bad', losers[0]?.id, (id) => `${scoreLine(id)} ${resultLine(id)}`),
			make('low-score', 'Low score', '🤡', 'bad', ranked[ranked.length - 1]?.[0], scoreLine),
		);
		return out.filter((a): a is Award => !!a);
	}

	const ap = allPlayRecords(lf);
	const teams = lf.teams;
	const byRecord = [...teams].sort((a, b) => pct(b) - pct(a) || b.pointsFor - a.pointsFor);
	const byPoints = [...teams].sort((a, b) => b.pointsFor - a.pointsFor);
	const hasAp = leagueWeeks(lf).length > 0;
	const byAp = [...teams].sort((a, b) => apPct(ap.get(b.id)!) - apPct(ap.get(a.id)!) || b.pointsFor - a.pointsFor);
	const record = (id: string) => (byId.get(id) ? `${formatRecord(byId.get(id)!)} record` : '');
	const points = (id: string) => `${formatPoints(byId.get(id)?.pointsFor ?? 0)} points`;
	const allPlay = (id: string) => `${formatRecord(ap.get(id) ?? { wins: 0, losses: 0, ties: 0 })} against everyone`;
	const groupWord = lf.groupKind === 'conference' ? 'Conference' : 'Division';

	out.push(
		make('best-record', 'Best record', '📈', 'good', byRecord[0]?.id, record),
		make('most-points', 'Most points', '🔥', 'good', byPoints[0]?.id, points),
		hasAp ? make('best-allplay', 'Best all-play', '💪', 'good', byAp[0]?.id, allPlay) : null,
	);
	// Each group's winner: the first of its teams in the standings order.
	for (const g of leagueGroups(lf)) {
		out.push(make(`group:${g}`, `${g} ${groupWord.toLowerCase()} winner`, '🥇', 'good', teams.find((t) => t.group === g)?.id, record));
	}
	out.push(
		make('worst-record', 'Worst record', '📉', 'bad', byRecord[byRecord.length - 1]?.id, record),
		make('fewest-points', 'Fewest points', '🥶', 'bad', byPoints[byPoints.length - 1]?.id, points),
		hasAp ? make('worst-allplay', 'Worst all-play', '🤡', 'bad', byAp[byAp.length - 1]?.id, allPlay) : null,
		make('champion', 'Champion', '🏆', 'good', lf.championId ?? undefined, (id) => `${lf.season} champions · ${record(id)}`),
	);
	return out.filter((a): a is Award => !!a);
}

// ── MFL ───────────────────────────────────────────────────────────────────

/**
 * Each franchise's division, or conference when the league has only those,
 * by name. Null when the league has neither (or just one).
 */
export function mflGroups(leagueExport: unknown): { kind: 'division' | 'conference'; of: Map<string, string> } | null {
	const lg = (leagueExport as { league?: Record<string, unknown> })?.league ?? {};
	const divisions = asArray((lg.divisions as { division?: unknown } | undefined)?.division as { id?: string; name?: string; conference?: string }[]);
	const conferences = asArray((lg.conferences as { conference?: unknown } | undefined)?.conference as { id?: string; name?: string }[]);
	const franchises = asArray((lg.franchises as { franchise?: unknown } | undefined)?.franchise as { id?: string; division?: string; conference?: string }[]);
	const named = (rows: { id?: string; name?: string }[]) => new Map(rows.map((r) => [String(r.id ?? ''), String(r.name ?? '').trim()]));
	const pad = (v: unknown) => `${v ?? ''}`.trim().padStart(4, '0');
	if (divisions.length > 1) {
		const names = named(divisions);
		const of = new Map<string, string>();
		for (const f of franchises) if (f.division !== undefined && names.get(String(f.division))) of.set(pad(f.id), names.get(String(f.division))!);
		if (of.size) return { kind: 'division', of };
	}
	if (conferences.length > 1) {
		const names = named(conferences);
		const divConf = new Map(divisions.map((d) => [String(d.id ?? ''), String(d.conference ?? '')]));
		const of = new Map<string, string>();
		for (const f of franchises) {
			const conf = f.conference ?? divConf.get(String(f.division ?? ''));
			if (conf !== undefined && names.get(String(conf))) of.set(pad(f.id), names.get(String(conf))!);
		}
		if (of.size) return { kind: 'conference', of };
	}
	return null;
}

/** The whole league's season from MFL's exports: standings order, regular-season games, groups, champion. */
export function mflLeagueFacts(x: MflSeasonExports): LeagueFacts {
	const franchises = parseMflFranchises(x.league);
	const standings = parseMflStandings(x.standings);
	const champId = pickChampionshipBracketId(x.brackets);
	const bracket = champId && x.championshipBracket ? parseBracketGames(x.championshipBracket) : { games: [], weeks: [] };
	const firstPlayoffWeek = bracket.weeks[0] ?? Infinity;
	const finalWeek = bracket.weeks[bracket.weeks.length - 1];
	const finals = bracket.games.filter((g) => g.week === finalWeek);
	const f = finals.length === 1 ? finals[0] : null;
	const championId = f && f.homePts !== null && f.awayPts !== null && f.homePts !== f.awayPts && f.homeId && f.awayId ? (f.homePts > f.awayPts ? f.homeId : f.awayId) : null;
	const groups = mflGroups(x.league);
	return {
		leagueName: x.leagueName,
		season: x.season,
		teams: standings.map((r) => ({
			id: r.id,
			name: franchises.find((fr) => fr.id === r.id)?.name ?? `Franchise ${r.id}`,
			wins: r.wins,
			losses: r.losses,
			ties: r.ties,
			pointsFor: r.pointsFor,
			group: groups?.of.get(r.id) ?? null,
		})),
		games: parseScheduleAll(x.schedule).filter((g) => g.week < firstPlayoffWeek),
		groupKind: groups?.kind ?? null,
		championId,
	};
}

/** Week → team → that team's best starter, from every week's lineups. */
export function bestStartsByWeek(
	starters: ReadonlyMap<number, readonly WeekStarter[]>,
	who: (id: string) => { name: string; pos: string } | null,
): Record<number, Record<string, StarterLine>> {
	const out: Record<number, Record<string, StarterLine>> = {};
	for (const [week, list] of starters) {
		const teams = new Set(list.map((s) => s.team));
		const row: Record<string, StarterLine> = {};
		for (const t of teams) {
			const best = pickStandouts(list, t, who).best;
			if (best) row[t] = best;
		}
		if (Object.keys(row).length) out[week] = row;
	}
	return out;
}
