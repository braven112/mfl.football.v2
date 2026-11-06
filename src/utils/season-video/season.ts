/**
 * Season video — the facts one video is made from, and which video they make.
 *
 * Free tier (Brandon, 2026-11-05): team-level data only, never player data.
 * The facts come from MFL after sign-in (`fromMflExports`, fed by
 * `/api/season-video/mfl`) or from the visitor typing them in, and the
 * visitor can change any of them before rendering. So everything a scene
 * prints is on `SeasonFacts`, and nothing here reads anything but MFL's own
 * team-level exports: league, leagueStandings, playoffBrackets,
 * playoffBracket and schedule.
 *
 * Which story a season suggests (`pickVideoKind`): the champion gets the
 * champion video, the last-place team the last-place one, a season still
 * being played the mid-season report, and everyone else the season recap.
 * The visitor can pick any story and any look instead.
 *
 * Pure: tests/season-video.test.ts drives it with TheLeague's recorded 2025
 * feeds, the season the original Computer Jocks video was cut from.
 */
import { asArray, pickChampionshipBracketId } from '../league-history/mfl-champions';

/**
 * Two separate choices (Brandon, 2026-11-05: "I want to have all of the
 * options available"): the STORY is what the video says, the LOOK is how it
 * looks. Any story wears any look, and any team in the league can be the
 * subject, because the video is a trash-talk tool as much as a keepsake: a
 * 9–2 team can be called mid, a champion can get the poop look.
 */
export type SeasonVideoKind = 'champion' | 'recap' | 'midseason' | 'weekly' | 'beatdown' | 'tiger' | 'mid' | 'last';
export type VideoLook = 'trophy' | 'bling' | 'retro' | 'princess' | 'poop' | 'clown' | 'jackass' | 'dumpster' | 'crybaby' | 'snail' | 'potato' | 'bombs' | 'flex' | 'riot' | 'goat';
/** Saved before looks were split from stories (a LastVideo in localStorage). */
export type LastPlaceTheme = 'princess' | 'poop';
export type ChampionStyle = 'trophy' | 'bling' | 'retro';

/** A story the owner can pick, in picker order. */
export const VIDEO_STORIES: readonly { id: SeasonVideoKind; name: string }[] = [
	{ id: 'champion', name: '🏆 Champion' },
	{ id: 'recap', name: 'Season recap' },
	{ id: 'midseason', name: '📝 Mid-season report' },
	{ id: 'weekly', name: '🤡 Weekly roast' },
	{ id: 'beatdown', name: '💪 Beatdown' },
	{ id: 'tiger', name: '🐯 Paper tiger' },
	{ id: 'mid', name: '😐 Master of mediocrity' },
	{ id: 'last', name: 'Last place' },
];

/** A look the owner can pick on the style step. */
export interface VideoStyleOption {
	id: VideoLook;
	name: string;
	icon: string;
	/** CSS background for the picker tile. */
	swatch: string;
}

/** Every look, in picker order. Every story can wear every one. */
export const VIDEO_LOOKS: readonly VideoStyleOption[] = [
	{ id: 'trophy', name: 'Trophy Room', icon: '🏆', swatch: 'linear-gradient(135deg, #0b1a33 40%, #c9a24a)' },
	{ id: 'bling', name: 'Bling', icon: '💎', swatch: 'linear-gradient(135deg, #0a0a0a 45%, #f5c542)' },
	{ id: 'retro', name: 'Retro', icon: '📼', swatch: 'linear-gradient(135deg, #f3e6c8 35%, #e2711d 65%, #5a3a22)' },
	{ id: 'princess', name: 'Princess', icon: '👑', swatch: 'linear-gradient(135deg, #ff8fc8, #b26bd6)' },
	{ id: 'poop', name: 'Poop', icon: '💩', swatch: 'linear-gradient(135deg, #3b2a1a, #c9a227)' },
	{ id: 'clown', name: 'Clown', icon: '🤡', swatch: 'linear-gradient(135deg, #e63946 33%, #ffd23f 33% 66%, #1d6fd8 66%)' },
	{ id: 'jackass', name: 'Jackass', icon: '🫏', swatch: 'linear-gradient(135deg, #6b5a48, #c8b08a)' },
	{ id: 'dumpster', name: 'Dumpster Fire', icon: '🔥', swatch: 'linear-gradient(135deg, #1f1f1f 40%, #d9480f)' },
	{ id: 'crybaby', name: 'Crybaby', icon: '🍼', swatch: 'linear-gradient(135deg, #a8d8f0, #fff4e0)' },
	{ id: 'snail', name: 'Snail', icon: '🐌', swatch: 'linear-gradient(135deg, #3d5a2a, #9bc53d)' },
	{ id: 'potato', name: 'Couch Potato', icon: '🥔', swatch: 'linear-gradient(135deg, #5a4632, #c9a26b)' },
	{ id: 'bombs', name: 'Bombs Away', icon: '💣', swatch: 'linear-gradient(135deg, #111111 40%, #ff7a00)' },
	{ id: 'flex', name: 'Flex', icon: '💪', swatch: 'linear-gradient(135deg, #1c2530 40%, #c1121f)' },
	{ id: 'riot', name: 'Running Riot', icon: '🚨', swatch: 'linear-gradient(135deg, #b80c0c 50%, #0b3fb8 50%)' },
	{ id: 'goat', name: 'GOAT', icon: '🐐', swatch: 'linear-gradient(135deg, #2d1457 40%, #d4af37)' },
];

/** The look a story starts in, until the owner picks one. */
export function defaultLook(kind: SeasonVideoKind): VideoLook {
	return kind === 'last' ? 'princess' : 'trophy';
}

/** The look a saved video was made in, including one saved before looks were split out. */
export function lookOf(v: { kind: SeasonVideoKind; look?: VideoLook; theme?: LastPlaceTheme; style?: ChampionStyle }): VideoLook {
	if (v.look) return v.look;
	if (v.kind === 'last') return v.theme ?? 'princess';
	return v.style ?? 'trophy';
}

/** How the season ended for this team. */
export type SeasonOutcome = 'in-progress' | 'champion' | 'runner-up' | 'playoffs' | 'missed';

export const SEASON_OUTCOMES: readonly { id: SeasonOutcome; label: string }[] = [
	{ id: 'in-progress', label: 'Still being played' },
	{ id: 'champion', label: 'Won the championship' },
	{ id: 'runner-up', label: 'Lost in the championship' },
	{ id: 'playoffs', label: 'Made the playoffs, lost before the final' },
	{ id: 'missed', label: 'Missed the playoffs' },
];

export interface SeasonGame {
	/** "Quarterfinal", "Semifinal", "The Final", "Week 11" … */
	label: string;
	score: number;
	oppName: string;
	oppScore: number;
	/** The opponent's MFL franchise id, when the game came from MFL (for its logo). */
	oppId?: string;
	/** A data: URL (same-origin safe for the canvas), or null for initials. */
	oppLogo?: string | null;
}

export interface SeasonFacts {
	leagueName: string;
	season: number;
	teamName: string;
	/** A data: or blob: URL. Required before rendering; null until uploaded. */
	teamLogo?: string | null;
	/** 'none' draws the team logo as it is, for a logo already cut out; the circle is the default. */
	teamLogoFrame?: 'circle' | 'none';
	wins: number;
	losses: number;
	ties: number;
	pointsFor: number;
	/** Where those points rank in the league, 1 = most. Feeds the paper-tiger story. */
	pointsRank?: number | null;
	/** Regular-season finish, 1-based, in MFL's own standings order. */
	finish: number | null;
	teams: number | null;
	/** Playoff seed, when the bracket names one. */
	seed?: number | null;
	outcome: SeasonOutcome;
	/** Every playoff game, in order; the final is last when they played in it. */
	playoffs: SeasonGame[];
	/** Highest regular-season score, for the "statement game" card. */
	bestGame?: SeasonGame | null;
	/** Lowest regular-season score, for the last-place video. */
	worstGame?: SeasonGame | null;
	/** Every played regular-season week, with where it ranked in the league that week. Feeds the weekly roast. */
	weeks?: WeekLine[];
}

/** One regular-season week for one team, set against every score in the league that week. */
export interface WeekLine {
	week: number;
	score: number;
	oppName: string;
	oppScore: number;
	oppId?: string;
	/** That week's score among the league's, 1 = most; ties share the better rank. */
	rank: number;
	teams: number;
	/** All-play: how the score would have done against every other team that week. */
	allPlay: { wins: number; losses: number; ties: number };
	/** This team's best and worst starter that week, from the league's own lineups. */
	best?: StarterLine | null;
	worst?: StarterLine | null;
}

/**
 * One starter's week. Player data from the league platform itself (MFL,
 * Sleeper), which every league has: Brandon, 2026-11-06, "If it's provided
 * by MFL or Sleeper or on the ESPN, then we can provide it."
 */
export interface StarterLine {
	name: string;
	/** MFL's position words: QB RB WR TE PK Def (or an IDP position). */
	pos: string;
	pts: number;
	/** The league's average at that position that week, when enough teams started one. */
	avg: number | null;
}

/** One starter in one lineup that week. */
export interface WeekStarter {
	team: string;
	id: string;
	pts: number;
}

/** A position average needs this many starters behind it to mean anything. */
const MIN_POSITION_SAMPLE = 3;

/**
 * The team's best and worst starter, judged against the league's average at
 * the same position that week: a tight end's 1.2 is worse than a kicker's 3,
 * and a 30-point running back beats a 32-point quarterback when quarterbacks
 * averaged 25. A starter the league data cannot name is left out. With no
 * usable averages it falls back to raw points.
 */
export function pickStandouts(
	league: readonly WeekStarter[],
	team: string,
	who: (id: string) => { name: string; pos: string } | null,
): { best: StarterLine | null; worst: StarterLine | null } {
	const byPos = new Map<string, number[]>();
	const seen = new Set<string>();
	const mine: StarterLine[] = [];
	for (const s of league) {
		// A doubleheader week lists the same lineup twice.
		const key = `${s.team}:${s.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const p = who(s.id);
		if (!p?.pos) continue;
		(byPos.get(p.pos) ?? byPos.set(p.pos, []).get(p.pos)!).push(s.pts);
		if (s.team === team && p.name) mine.push({ name: p.name, pos: p.pos, pts: Math.round(s.pts * 100) / 100, avg: null });
	}
	for (const m of mine) {
		const all = byPos.get(m.pos) ?? [];
		if (all.length >= MIN_POSITION_SAMPLE) m.avg = Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10) / 10;
	}
	if (mine.length === 0) return { best: null, worst: null };
	const rated = mine.some((m) => m.avg !== null) ? mine.filter((m) => m.avg !== null) : mine;
	const gap = (m: StarterLine) => m.pts - (m.avg ?? 0);
	const sorted = [...rated].sort((a, b) => gap(a) - gap(b) || a.pts - b.pts);
	return { worst: sorted[0], best: sorted[sorted.length - 1] };
}

/** Week lines with each week's best and worst starter filled in, where the league data has that week's lineups. */
export function attachStandouts(
	weeks: readonly WeekLine[],
	starters: ReadonlyMap<number, readonly WeekStarter[]>,
	team: string,
	who: (id: string) => { name: string; pos: string } | null,
): WeekLine[] {
	return weeks.map((w) => {
		const list = starters.get(w.week);
		if (!list?.length) return w;
		const { best, worst } = pickStandouts(list, team, who);
		return best || worst ? { ...w, best, worst } : w;
	});
}

/** The position as the video prints it: K for MFL's PK, DEF for its Def. */
export function positionLabel(pos: string): string {
	return pos === 'PK' ? 'K' : pos === 'Def' ? 'DEF' : pos.toUpperCase();
}

/**
 * Every week's starters from an MFL `weeklyResults` export (one week, or
 * `W=YTD`'s `allWeeklyResults`). Only players MFL marks `starter`.
 */
export function parseMflWeekStarters(body: unknown): Map<number, WeekStarter[]> {
	const root = (body as { allWeeklyResults?: { weeklyResults?: unknown } })?.allWeeklyResults ?? body;
	const raw = (root as { weeklyResults?: unknown })?.weeklyResults;
	const weeks = asArray(raw as { week?: string; matchup?: unknown; franchise?: unknown }[]);
	const out = new Map<number, WeekStarter[]>();
	for (const w of weeks) {
		const week = num(w?.week);
		if (!week) continue;
		const list: WeekStarter[] = [];
		const sides = [
			...asArray(w?.matchup as { franchise?: unknown }[]).flatMap((m) => asArray(m?.franchise as unknown[])),
			...asArray(w?.franchise as unknown[]),
		] as { id?: string; player?: unknown }[];
		for (const side of sides) {
			if (!side?.id) continue;
			for (const p of asArray(side.player as { id?: string; status?: string; score?: string }[])) {
				if (p?.status === 'starter' && p.id && p.score !== undefined && p.score !== '') list.push({ team: pad(side.id), id: String(p.id), pts: num(p.score) });
			}
		}
		if (list.length) out.set(week, list);
	}
	return out;
}

/**
 * Week lines from this team's games and every team's score each week. A week
 * whose league scores are missing still gets a line, ranked against itself.
 */
export function buildWeekLines(
	games: readonly { week: number; score: number; oppId: string; oppScore: number }[],
	leagueScores: ReadonlyMap<number, readonly number[]>,
	nameOf: (id: string) => string,
): WeekLine[] {
	// One line per week: a doubleheader week is one score, shown against its first opponent.
	const byWeek = new Map<number, (typeof games)[number]>();
	for (const g of games) if (!byWeek.has(g.week)) byWeek.set(g.week, g);
	return [...byWeek.values()]
		.sort((a, b) => a.week - b.week)
		.map((g) => {
			const all = leagueScores.get(g.week)?.length ? [...leagueScores.get(g.week)!] : [g.score, g.oppScore];
			// Everyone else that week: drop one copy of our own score.
			const mine = all.indexOf(g.score);
			const others = mine >= 0 ? [...all.slice(0, mine), ...all.slice(mine + 1)] : all;
			const r2 = (n: number) => Math.round(n * 100) / 100;
			return {
				week: g.week,
				score: r2(g.score),
				oppName: nameOf(g.oppId),
				oppScore: r2(g.oppScore),
				oppId: g.oppId,
				rank: 1 + others.filter((s) => s > g.score).length,
				teams: others.length + 1,
				allPlay: {
					wins: others.filter((s) => s < g.score).length,
					losses: others.filter((s) => s > g.score).length,
					ties: others.filter((s) => s === g.score).length,
				},
			};
		});
}

/** The whole season's all-play record, summed from its weeks. */
export function seasonAllPlay(weeks: readonly WeekLine[]): { wins: number; losses: number; ties: number } {
	return weeks.reduce((t, w) => ({ wins: t.wins + w.allPlay.wins, losses: t.losses + w.allPlay.losses, ties: t.ties + w.allPlay.ties }), { wins: 0, losses: 0, ties: 0 });
}

/**
 * The story a season suggests before the visitor overrides it. A season still
 * in its regular season (`complete` false, no playoff games yet) suggests the
 * mid-season report.
 */
export function pickVideoKind(
	facts: Pick<SeasonFacts, 'outcome' | 'finish' | 'teams'> & { playoffs?: readonly unknown[] },
	complete = true,
): SeasonVideoKind {
	if (facts.outcome === 'in-progress' || (!complete && (facts.playoffs?.length ?? 0) === 0)) return 'midseason';
	if (facts.outcome === 'champion') return 'champion';
	if (facts.finish && facts.teams && facts.finish >= facts.teams) return 'last';
	return 'recap';
}

/** What the video is about: one week, or the whole season. */
export type VideoSpan = 'week' | 'season';
/** The vibe the owner picks on the style step; the story inside it is the data's call. */
export type VideoVibe = 'facts' | 'brag' | 'mid' | 'roast';

/**
 * The style step's groups (Brandon, 2026-11-06): pick a vibe, then only its
 * looks show. Champion and the mid-season report are both "Facts". A week
 * can only be bragged about or roasted.
 */
export const VIDEO_VIBES: readonly { id: VideoVibe; name: string; icon: string; looks: readonly VideoLook[]; spans: readonly VideoSpan[] }[] = [
	{ id: 'facts', name: 'Facts', icon: '🏆', looks: ['trophy', 'bling', 'retro'], spans: ['season'] },
	{ id: 'brag', name: 'Brag', icon: '💪', looks: ['bombs', 'flex', 'riot', 'goat'], spans: ['week', 'season'] },
	{ id: 'mid', name: 'Mid', icon: '😐', looks: ['snail', 'potato'], spans: ['season'] },
	{ id: 'roast', name: 'Roast', icon: '🔥', looks: ['poop', 'princess', 'clown', 'jackass', 'dumpster', 'crybaby'], spans: ['week', 'season'] },
];

/**
 * The story for a span and vibe, picked from the data so the video stays
 * true. Season roast: last place if they finished last, else paper tiger
 * (Brandon, 2026-11-06: "let the data pick").
 */
export function storyFor(
	span: VideoSpan,
	vibe: VideoVibe,
	facts: Pick<SeasonFacts, 'outcome' | 'finish' | 'teams'> & { playoffs?: readonly unknown[] },
	complete = true,
): SeasonVideoKind {
	if (span === 'week') return vibe === 'brag' ? 'beatdown' : 'weekly';
	if (vibe === 'mid') return 'mid';
	if (vibe === 'roast') return facts.finish && facts.teams && facts.finish >= facts.teams ? 'last' : 'tiger';
	const told = pickVideoKind(facts, complete);
	// Facts and brag never call a team last; that's the roast's job.
	return told === 'last' ? 'recap' : told;
}

/** Where a points total ranks among the league's, 1 = most; ties share the better rank. */
export function pointsRankOf(points: number, league: readonly number[]): number | null {
	if (!league.length) return null;
	return 1 + league.filter((p) => p > points).length;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
	const mod100 = n % 100;
	if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
	return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "13–5" or "8–9–1". */
export function formatRecord(f: Pick<SeasonFacts, 'wins' | 'losses' | 'ties'>): string {
	return f.ties > 0 ? `${f.wins}–${f.losses}–${f.ties}` : `${f.wins}–${f.losses}`;
}

/** Fantasy points as MFL shows them: two decimals, no thousands separator. */
export function formatScore(n: number): string {
	return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

/** A season total: "1,998" — whole points read better at that size. */
export function formatPoints(n: number): string {
	return Math.round(n).toLocaleString('en-US');
}

// ── MFL exports → facts ───────────────────────────────────────────────────

const num = (v: unknown): number => {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
};
const pad = (v: unknown): string => `${v ?? ''}`.trim().padStart(4, '0');

export interface MflFranchiseInfo {
	id: string;
	name: string;
	/** The franchise's square icon url as MFL stores it (an owner-set url). */
	icon: string | null;
}

/** Franchises of one season, from `TYPE=league`. The square `icon`, never the banner `logo`. */
export function parseMflFranchises(leagueExport: unknown): MflFranchiseInfo[] {
	const rows = (leagueExport as { league?: { franchises?: { franchise?: unknown } } })?.league?.franchises?.franchise;
	return asArray(rows as Record<string, unknown>[])
		.map((f) => {
			const icon = `${f?.icon ?? ''}`.trim();
			return {
				id: pad(f?.id),
				name: `${f?.name ?? ''}`.trim() || `Franchise ${pad(f?.id)}`,
				icon: /^https?:\/\//i.test(icon) ? icon : null,
			};
		})
		.filter((f) => f.id !== '0000');
}

interface StandingRow {
	id: string;
	wins: number;
	losses: number;
	ties: number;
	pointsFor: number;
}

/** MFL's standings rows IN MFL'S ORDER — never re-sorted (its order applies the tiebreakers). */
export function parseMflStandings(standingsExport: unknown): StandingRow[] {
	const raw = (standingsExport as { leagueStandings?: { franchise?: unknown } })?.leagueStandings?.franchise;
	return asArray(raw as Record<string, unknown>[])
		.map((r) => {
			const wlt = /^(\d+)-(\d+)-(\d+)$/.exec(`${r?.h2hwlt ?? ''}`.trim());
			return {
				id: pad(r?.id),
				wins: wlt ? Number(wlt[1]) : num(r?.h2hw),
				losses: wlt ? Number(wlt[2]) : num(r?.h2hl),
				ties: wlt ? Number(wlt[3]) : num(r?.h2ht),
				pointsFor: num(r?.pf),
			};
		})
		.filter((r) => r.id !== '0000');
}

interface BracketGame {
	week: number;
	homeId: string;
	awayId: string;
	homePts: number | null;
	awayPts: number | null;
	homeSeed: number | null;
	awaySeed: number | null;
}

function parseBracketGames(bracketExport: unknown): { games: BracketGame[]; weeks: number[] } {
	const rounds = asArray(
		(bracketExport as { playoffBracket?: { playoffRound?: unknown } })?.playoffBracket?.playoffRound as {
			week?: string;
			playoffGame?: unknown;
		}[],
	);
	const games: BracketGame[] = [];
	const weeks = new Set<number>();
	for (const round of rounds) {
		const week = num(round?.week);
		if (!week) continue;
		weeks.add(week);
		for (const g of asArray(round.playoffGame as Record<string, Record<string, string>>[])) {
			const pts = (v: unknown) => (v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
			const seed = (v: unknown) => (v === undefined || v === '' ? null : num(v) || null);
			games.push({
				week,
				homeId: g?.home?.franchise_id ? pad(g.home.franchise_id) : '',
				awayId: g?.away?.franchise_id ? pad(g.away.franchise_id) : '',
				homePts: pts(g?.home?.points),
				awayPts: pts(g?.away?.points),
				homeSeed: seed(g?.home?.seed),
				awaySeed: seed(g?.away?.seed),
			});
		}
	}
	return { games, weeks: [...weeks].sort((a, b) => a - b) };
}

/** "The Final", "Semifinal", "Quarterfinal", then "Wild Card" for anything earlier. */
export function roundLabel(roundIndex: number, roundCount: number): string {
	const fromEnd = roundCount - 1 - roundIndex;
	if (fromEnd === 0) return 'The Final';
	if (fromEnd === 1) return 'Semifinal';
	if (fromEnd === 2) return 'Quarterfinal';
	return 'Wild Card';
}

interface ScheduleGame {
	week: number;
	score: number;
	oppId: string;
	oppScore: number;
}

/** This franchise's played games from `TYPE=schedule`, scores only. */
function parseScheduleGames(scheduleExport: unknown, franchiseId: string): ScheduleGame[] {
	const weeks = asArray(
		(scheduleExport as { schedule?: { weeklySchedule?: unknown } })?.schedule?.weeklySchedule as {
			week?: string;
			matchup?: unknown;
		}[],
	);
	const out: ScheduleGame[] = [];
	for (const w of weeks) {
		const week = num(w?.week);
		for (const m of asArray(w?.matchup as { franchise?: unknown }[])) {
			const sides = asArray(m?.franchise as Record<string, string>[]);
			if (sides.length !== 2) continue;
			const mine = sides.find((s) => pad(s?.id) === franchiseId);
			const theirs = sides.find((s) => pad(s?.id) !== franchiseId);
			if (!mine || !theirs) continue;
			if (mine.score === undefined || mine.score === '' || theirs.score === undefined || theirs.score === '') continue;
			out.push({ week, score: num(mine.score), oppId: pad(theirs.id), oppScore: num(theirs.score) });
		}
	}
	return out;
}

/** Every franchise's score each week from `TYPE=schedule`, played games only. */
function parseScheduleScores(scheduleExport: unknown): Map<number, number[]> {
	const weeks = asArray(
		(scheduleExport as { schedule?: { weeklySchedule?: unknown } })?.schedule?.weeklySchedule as { week?: string; matchup?: unknown }[],
	);
	const out = new Map<number, number[]>();
	for (const w of weeks) {
		const week = num(w?.week);
		// One score per franchise: a doubleheader week lists each franchise twice.
		const scores = new Map<string, number>();
		for (const m of asArray(w?.matchup as { franchise?: unknown }[])) {
			for (const side of asArray(m?.franchise as Record<string, string>[])) {
				if (side?.score !== undefined && side.score !== '') scores.set(pad(side.id), num(side.score));
			}
		}
		if (scores.size) out.set(week, [...scores.values()]);
	}
	return out;
}

export interface MflSeasonExports {
	leagueName: string;
	season: number;
	franchiseId: string;
	league: unknown;
	standings: unknown;
	brackets: unknown;
	/** The championship bracket (`TYPE=playoffBracket`), or null when the league has none. */
	championshipBracket: unknown;
	schedule: unknown;
}

export interface MflSeasonResult {
	facts: SeasonFacts;
	/** Franchise ids whose icons the facts reference: the team first, then opponents. */
	logoIds: { team: string; opponents: string[] };
	franchises: MflFranchiseInfo[];
	/** False while the championship final has not been played. */
	complete: boolean;
}

/**
 * One franchise's season, from MFL's exports. Returns null when the
 * franchise is not in that season's standings.
 */
export function fromMflExports(x: MflSeasonExports): MflSeasonResult | null {
	const franchises = parseMflFranchises(x.league);
	const nameOf = (id: string) => franchises.find((f) => f.id === id)?.name ?? `Franchise ${id}`;
	const standings = parseMflStandings(x.standings);
	const idx = standings.findIndex((r) => r.id === x.franchiseId);
	if (idx < 0) return null;
	const row = standings[idx];

	// The championship bracket's games involving this team.
	const champId = pickChampionshipBracketId(x.brackets);
	const bracket = champId && x.championshipBracket ? parseBracketGames(x.championshipBracket) : { games: [], weeks: [] };
	const finalWeek = bracket.weeks.length ? bracket.weeks[bracket.weeks.length - 1] : null;
	const finalGame = finalWeek !== null ? bracket.games.filter((g) => g.week === finalWeek) : [];
	const complete =
		finalGame.length === 1 && finalGame[0].homePts !== null && finalGame[0].awayPts !== null && !!finalGame[0].homeId;

	let seed: number | null = null;
	const playoffs: SeasonGame[] = [];
	const opponents: string[] = [];
	for (const g of bracket.games) {
		const home = g.homeId === x.franchiseId;
		const away = g.awayId === x.franchiseId;
		if (!home && !away) continue;
		seed ??= home ? g.homeSeed : g.awaySeed;
		const score = home ? g.homePts : g.awayPts;
		const oppScore = home ? g.awayPts : g.homePts;
		const oppId = home ? g.awayId : g.homeId;
		if (score === null || oppScore === null || !oppId) continue;
		playoffs.push({
			label: roundLabel(bracket.weeks.indexOf(g.week), bracket.weeks.length),
			score,
			oppName: nameOf(oppId),
			oppScore,
			oppId,
		});
		opponents.push(oppId);
	}

	let outcome: SeasonOutcome = playoffs.length ? 'playoffs' : complete ? 'missed' : 'in-progress';
	const last = playoffs[playoffs.length - 1];
	if (complete && last?.label === 'The Final') outcome = last.score > last.oppScore ? 'champion' : 'runner-up';

	// Best and worst regular-season games: weeks before the bracket starts.
	const firstPlayoffWeek = bracket.weeks[0] ?? Infinity;
	const regular = parseScheduleGames(x.schedule, x.franchiseId).filter((g) => g.week < firstPlayoffWeek);
	const toGame = (g: ScheduleGame | undefined): SeasonGame | null =>
		g ? { label: `Week ${g.week}`, score: g.score, oppName: nameOf(g.oppId), oppScore: g.oppScore, oppId: g.oppId } : null;
	const best = [...regular].sort((a, b) => b.score - a.score)[0];
	const worst = [...regular].sort((a, b) => a.score - b.score)[0];
	if (best) opponents.push(best.oppId);
	if (worst) opponents.push(worst.oppId);

	return {
		facts: {
			leagueName: x.leagueName,
			season: x.season,
			teamName: nameOf(x.franchiseId),
			teamLogo: null,
			wins: row.wins,
			losses: row.losses,
			ties: row.ties,
			pointsFor: row.pointsFor,
			pointsRank: pointsRankOf(row.pointsFor, standings.map((r) => r.pointsFor)),
			finish: idx + 1,
			teams: standings.length,
			seed,
			outcome,
			playoffs,
			bestGame: toGame(best),
			worstGame: toGame(worst),
			weeks: buildWeekLines(regular, parseScheduleScores(x.schedule), nameOf),
		},
		logoIds: { team: x.franchiseId, opponents: [...new Set(opponents)] },
		franchises,
		complete,
	};
}
