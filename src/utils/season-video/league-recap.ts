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
	/** True once a playoff game has points on the board: the video then opens on the end of the regular season. */
	playoffsStarted?: boolean;
	/** Week → team id → that team's best starter, judged against the league at his position. */
	bestStarts?: Record<number, Record<string, StarterLine>>;
	/** Trades and waiver/free agent moves, when the platform shares them. */
	moves?: LeagueMoves | null;
}

/** One trade: each side and what it got. */
export interface LeagueTrade {
	/** The NFL week it was made in; 0 before the season's first game. */
	week: number;
	sides: { teamId: string; gets: string[] }[];
}

export interface LeagueMoves {
	/** Every trade with what changed hands, or null when the platform only shares counts (ESPN). */
	trades: LeagueTrade[] | null;
	/** The season's trades, offseason included. */
	tradeCount: number;
	/** The season's waiver and free agent moves. */
	waiverMoves: number;
	/** Team → its own trades and waiver/free agent moves. */
	byTeam: Record<string, { trades: number; moves: number }>;
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
	/** The next teams in line for this award, best first, each with its own line: honorable mentions. */
	alternates?: { teamId: string; value: string }[];
}

/**
 * One card of the league recap. A team that wins several awards gets ONE
 * bigger card naming them all, and each award it doubled up on hands its slot
 * to the next team in line, as an honorable mention (Brandon, 2026-11-10: the
 * AFL's week had one team on three cards in a row).
 */
export type RecapCard =
	| { kind: 'award'; award: Award; mention?: boolean }
	| { kind: 'combo'; teamId: string; awards: Award[] };

/** The award's honorable-mention title: dishonorable for the bad ones. */
export function mentionTitle(a: Pick<Award, 'title' | 'tone'>): string {
	return `${a.title} · ${a.tone === 'good' ? 'honorable' : 'dishonorable'} mention`;
}

/**
 * The awards as cards, in their order. A team's second and later awards fold
 * into its first card; in each folded award's place, the next team in line
 * that wins nothing in this video (not the champion either, who has its own
 * card) gets an honorable mention, so a mention never joins a combined card
 * and no team shows twice. A division winner has no runner-up mention: second
 * in a division wins nothing. The champion always keeps its own card.
 */
export function recapCards(awards: readonly Award[]): RecapCard[] {
	const cards: RecapCard[] = [];
	const at = new Map<string, number>();
	const winners = new Set(awards.map((a) => a.teamId));
	const mentioned = new Set<string>();
	for (const a of awards) {
		if (a.id === 'champion') {
			cards.push({ kind: 'award', award: a });
			continue;
		}
		const i = at.get(a.teamId);
		if (i === undefined) {
			at.set(a.teamId, cards.length);
			cards.push({ kind: 'award', award: a });
			continue;
		}
		const c = cards[i];
		cards[i] = c.kind === 'combo' ? { ...c, awards: [...c.awards, a] } : { kind: 'combo', teamId: a.teamId, awards: [c.award, a] };
		const alt = a.id.startsWith('group:') ? undefined : a.alternates?.find((x) => !winners.has(x.teamId) && !mentioned.has(x.teamId));
		if (alt) {
			mentioned.add(alt.teamId);
			cards.push({ kind: 'award', mention: true, award: { ...a, title: mentionTitle(a), teamId: alt.teamId, value: alt.value, alternates: [] } });
		}
	}
	return cards;
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
	/** `ranked` is the award's whole order, best first: its first team wins, the rest are next in line. */
	const make = (id: AwardId, title: string, badge: string, tone: Award['tone'], ranked: readonly (string | undefined)[], value: (teamId: string) => string): Award | null => {
		const order = [...new Set(ranked.filter((x): x is string => !!x))];
		const pickedId = order[0];
		if (!pickedId) return null;
		const o = overrides[id];
		const teamId = o && byId.has(o) ? o : pickedId;
		const alternates = order.filter((t) => t !== teamId).slice(0, 6).map((t) => ({ teamId: t, value: value(t) }));
		return { id, title, badge, pickedId, teamId, value: value(teamId), tone, alternates };
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
		const blowouts = [...games].sort((x, y) => margin(y) - margin(x));
		const closests = [...games].filter((g) => margin(g) > 0).sort((x, y) => margin(x) - margin(y));
		const losers = games
			.filter((g) => g.aScore !== g.bScore)
			.map((g) => (g.aScore < g.bScore ? { id: g.a, s: g.aScore } : { id: g.b, s: g.bScore }))
			.sort((x, y) => y.s - x.s);
		const starts = lf.bestStarts?.[w] ?? {};
		const gap = (p: StarterLine) => p.pts - (p.avg ?? 0);
		const bestStarts = Object.entries(starts).sort((x, y) => gap(y[1]) - gap(x[1])).map(([id]) => id);
		const startLine = (id: string) => {
			const p = starts[id];
			if (!p) return scoreLine(id);
			const avg = p.avg !== null ? ` ${positionLabel(p.pos)}s averaged ${p.avg.toFixed(1)}.` : '';
			return `${p.name}, ${positionLabel(p.pos)}: ${formatScore(p.pts)} points.${avg}`;
		};
		out.push(
			make('top-score', 'Top score', '🔥', 'good', ranked.map(([id]) => id), scoreLine),
			make('blowout', 'Biggest blowout', '💥', 'good', blowouts.map(winner), resultLine),
			make('best-start', 'Best start', '⭐', 'good', bestStarts, startLine),
			make('closest', 'Closest game', '😬', 'good', closests.map(winner), resultLine),
			make('unlucky', 'Unluckiest loss', '🍀', 'bad', losers.map((l) => l.id), (id) => `${scoreLine(id)} ${resultLine(id)}`),
			make('low-score', 'Low score', '🤡', 'bad', [...ranked].reverse().map(([id]) => id), scoreLine),
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
	const ids = (ts: readonly LeagueTeam[]) => ts.map((t) => t.id);
	const groupWord = lf.groupKind === 'conference' ? 'Conference' : 'Division';

	out.push(
		make('best-record', 'Best record', '📈', 'good', ids(byRecord), record),
		make('most-points', 'Most points', '🔥', 'good', ids(byPoints), points),
		hasAp ? make('best-allplay', 'Best all-play', '💪', 'good', ids(byAp), allPlay) : null,
	);
	// Each group's winner: the first of its teams in the standings order.
	for (const g of leagueGroups(lf)) {
		out.push(make(`group:${g}`, `${g} ${groupWord.toLowerCase()} winner`, '🥇', 'good', ids(teams.filter((t) => t.group === g)), record));
	}
	out.push(
		make('worst-record', 'Worst record', '📉', 'bad', ids(byRecord).reverse(), record),
		make('fewest-points', 'Fewest points', '🥶', 'bad', ids(byPoints).reverse(), points),
		hasAp ? make('worst-allplay', 'Worst all-play', '🤡', 'bad', ids(byAp).reverse(), allPlay) : null,
		make('champion', 'Champion', '🏆', 'good', [lf.championId ?? undefined], (id) => `${lf.season} champions · ${record(id)}`),
	);
	return out.filter((a): a is Award => !!a);
}

/** The trades made in the recap's week (the latest played week by default). */
export function weekTrades(lf: Pick<LeagueFacts, 'games' | 'moves'>, week: number | undefined): LeagueTrade[] {
	const weeks = leagueWeeks(lf as LeagueFacts);
	const w = week !== undefined && weeks.includes(week) ? week : weeks[weeks.length - 1];
	if (w === undefined) return [];
	return (lf.moves?.trades ?? []).filter((t) => t.week === w && t.sides.length >= 2);
}

/** The season's busiest team at one kind of move, or null when nobody made one. */
export function busiest(moves: LeagueMoves, kind: 'trades' | 'moves'): { teamId: string; count: number } | null {
	let best: { teamId: string; count: number } | null = null;
	for (const [teamId, c] of Object.entries(moves.byTeam)) {
		if (c[kind] > (best?.count ?? 0)) best = { teamId, count: c[kind] };
	}
	return best;
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
		playoffsStarted: bracket.games.some((g) => (g.homePts ?? 0) > 0 || (g.awayPts ?? 0) > 0),
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
