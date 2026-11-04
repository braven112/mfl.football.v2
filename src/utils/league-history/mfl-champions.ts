/**
 * League History — reading an ARBITRARY MFL league's champions out of MFL's
 * own exports. Pure: every function here takes a parsed export and returns
 * data, so the rules are tested against recorded responses
 * (tests/league-history-mfl.test.ts) and the network lives in mfl-crawl.ts.
 *
 * docs/plans/league-history-free-page.md is the plan of record.
 *
 * ── WHY A LEAGUE IS A CHAIN OF IDS ────────────────────────────────────────
 * An MFL league gets a NEW id in some seasons (TheLeague was 76273 in 2007,
 * 28463 in 2008, … 13522 from 2016). The league export's `history.league[]`
 * lists every season as `{ year, url: https://wwwNN.myfantasyleague.com/<yr>/home/<id> }`,
 * and that url is the only reliable map from a year to the id and host to
 * query it on. Querying an old year with today's id silently returns a
 * DIFFERENT league, so never do that.
 *
 * ── HOW A CHAMPION IS DECIDED, IN ORDER ───────────────────────────────────
 *  1. 'bracket'   — the championship bracket's final game, winner by points.
 *                   The championship bracket is the one whose title or name
 *                   says champion; our own convention (bracket id '1') is
 *                   only the tiebreak, because other leagues number freely.
 *  2. 'unknown'   — anything else, and never guessed. A season whose bracket
 *                   cannot name a winner (unplayed, tied, missing ids) is
 *                   unknown, and so is a season with NO brackets: a league
 *                   can crown its champion in ways MFL does not record
 *                   (Archie's runs its own playoff structure), so first in
 *                   the standings is not assumed to be the champion. The
 *                   admin sets those seasons with an override.
 * An admin override ('override') beats all three; see store.ts.
 */

export type ChampionMethod = 'bracket' | 'override' | 'unknown';

/** One season of the league, as `history.league[]` names it. */
export interface MflSeasonRef {
	year: number;
	/** The league's id IN THAT YEAR — it changes between seasons. */
	leagueId: string;
	/** `wwwNN.myfantasyleague.com` for that year. */
	host: string;
}

export interface SeasonFranchise {
	id: string;
	/** The name AS IT WAS that season. */
	name: string;
}

export interface SeasonChampion {
	year: number;
	method: ChampionMethod;
	champion: SeasonFranchise | null;
	runnerUp: SeasonFranchise | null;
	/** Why a season is 'unknown', in one line, for the admin. */
	note?: string;
}

const HOST_RE = /^www\d{1,3}\.myfantasyleague\.com$/;
const HISTORY_URL_RE = /^https?:\/\/(www\d{1,3}\.myfantasyleague\.com)\/(\d{4})\/home\/(\d{3,7})\/?$/;

/** A host we will ever send a request to: MFL's numbered web hosts, or its api host. */
export function isMflHost(host: string): boolean {
	return HOST_RE.test(host) || host === 'api.myfantasyleague.com';
}

/** MFL wraps a single element as an object rather than a one-item array. */
export function asArray<T>(value: T | T[] | null | undefined): T[] {
	if (value === null || value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

/** MFL reports errors as HTTP 200 with `{ error: ... }`. */
export function mflErrorText(body: unknown): string | null {
	if (!body || typeof body !== 'object') return 'empty response';
	const err = (body as { error?: unknown }).error;
	if (!err) return null;
	if (typeof err === 'string') return err;
	const text = (err as { $t?: unknown }).$t;
	return typeof text === 'string' ? text : 'MFL returned an error';
}

/**
 * Every season the league has played, oldest first, from a `TYPE=league`
 * export. Rows whose url is not an MFL league home are dropped rather than
 * trusted. The export's own league is included even when its history list
 * omits it (a brand-new league has no history yet).
 */
export function parseSeasonChain(leagueExport: unknown, exportYear: number): MflSeasonRef[] {
	const league = (leagueExport as { league?: Record<string, unknown> })?.league;
	if (!league) return [];
	const byYear = new Map<number, MflSeasonRef>();
	const history = (league.history as { league?: unknown })?.league;
	for (const row of asArray(history as { year?: string; url?: string }[])) {
		const m = HISTORY_URL_RE.exec(String(row?.url ?? '').trim());
		if (!m) continue;
		const year = Number(m[2]);
		if (String(row?.year) !== m[2]) continue;
		byYear.set(year, { year, host: m[1], leagueId: m[3] });
	}
	const ownId = String(league.id ?? '');
	const base = /^https?:\/\/(www\d{1,3}\.myfantasyleague\.com)/.exec(String(league.baseURL ?? ''));
	if (/^\d{3,7}$/.test(ownId) && base && !byYear.has(exportYear)) {
		byYear.set(exportYear, { year: exportYear, host: base[1], leagueId: ownId });
	}
	return [...byYear.values()].sort((a, b) => a.year - b.year);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * A name as MFL stores it, made plain text. MFL lets an owner put HTML in a
 * team name (`<font color=0101DF>Fleece</font> City`, seen live on a 32-team
 * league), and the page escapes it, so without this the tags print as text on
 * the page and on the champion card.
 */
export function cleanMflName(raw: unknown): string {
	return String(raw ?? '')
		.replace(/<[^>]*>/g, '')
		.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
			if (code[0] === '#') {
				const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
				return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
			}
			return ENTITIES[code.toLowerCase()] ?? m;
		})
		.replace(/\s+/g, ' ')
		.trim();
}

/** The league's name, from a `TYPE=league` export. */
export function parseLeagueName(leagueExport: unknown): string {
	const name = cleanMflName((leagueExport as { league?: { name?: unknown } })?.league?.name);
	return name || 'MFL league';
}

/** Franchise id → name for one season, from that season's `TYPE=league` export. */
export function parseFranchises(leagueExport: unknown): Map<string, string> {
	const out = new Map<string, string>();
	const rows = (leagueExport as { league?: { franchises?: { franchise?: unknown } } })?.league?.franchises
		?.franchise;
	for (const f of asArray(rows as { id?: string; name?: string }[])) {
		const id = String(f?.id ?? '').trim();
		if (!id) continue;
		out.set(id, cleanMflName(f?.name) || `Franchise ${id}`);
	}
	return out;
}

interface BracketMeta {
	id: string;
	name: string;
	winnerTitle: string;
	startWeek: number;
	teams: number;
}

const NOT_CHAMPIONSHIP = /consol|toilet|loser|sacko|3rd|third|5th|7th|\bplace\b|\bpick\b|draft|pride/i;
const CHAMPIONSHIP = /champ|title|super ?bowl|final/i;
/**
 * A bracket for PART of the league: a conference, a division, or a parallel
 * tournament (the AFL's NIT). Its winner is a "champion" of something, so its
 * title says champion, but it is never the league's title while a bracket for
 * the whole league exists. Live, without this, a 32-team league's
 * "Conf 1" bracket (bracket 1) was read as the title every season, and a
 * bracket 1 titled "Mountain div. champ" beat the league's own
 * "TWD League Championship".
 */
const PART_OF_LEAGUE = /\b(afc|nfc|al|nl|conf|conference|div|division|nit)\b/i;

/**
 * Which bracket decides the title, from `TYPE=playoffBrackets`. Returns null
 * when the league defines no brackets that season.
 *
 * A title naming a championship and nothing consolation-like wins, and
 * among several such, bracket '1' (MFL's first bracket, the league's own in
 * every league read so far) wins outright. Otherwise a non-consolation
 * bracket '1', then any non-consolation bracket. Among several, the one that
 * FINISHES LAST wins: a league with conference brackets feeding a title game (the AFL: AL
 * and NL championships in weeks 15-16, the AFL Championship in week 17) names
 * all three "Championship", and only the last one is the league's title.
 * `Super Bowl` matches the championship pattern on purpose; `Toilet Bowl` is
 * excluded first. A bracket for part of the league (PART_OF_LEAGUE) is
 * considered only when no whole-league bracket exists.
 */
export function pickChampionshipBracketId(bracketsExport: unknown): string | null {
	return rankChampionshipBrackets(bracketsExport)[0] ?? null;
}

/**
 * Every bracket that could be the title, best first (the order
 * `pickChampionshipBracketId` describes). The crawler reads the first, and
 * for a finished season moves down the list only while a candidate cannot
 * name a winner: a league can leave a bracket it set up and never played
 * (seen live: an 8-team "War Games League Championship" opening in week 16 of
 * a 17-week season, next to the real two-team final).
 *
 * Brackets for part of the league (PART_OF_LEAGUE) rank only when nothing
 * else is left: when every bracket names a conference, one of them is the
 * best answer there is.
 */
export function rankChampionshipBrackets(bracketsExport: unknown): string[] {
	const metas = bracketMetas(bracketsExport);
	const eligible = metas.filter((b) => !NOT_CHAMPIONSHIP.test(label(b)));
	const whole = eligible.filter((b) => !PART_OF_LEAGUE.test(label(b)));
	const pool = whole.length > 0 ? whole : eligible;

	const named = pool.filter((b) => CHAMPIONSHIP.test(label(b))).sort(byWidthThenStart);
	// Several brackets can call themselves a championship (the AFL's NIT is a
	// 16-team "NIT Championship" that finishes AFTER the real title game).
	// MFL's first bracket is the league's own in every league we have read, so
	// it wins when it is one of them.
	const namedFirst = named.filter((b) => b.id === '1');
	const first = pool.filter((b) => b.id === '1');
	const rest = [...pool].sort(byWidthThenStart);
	return [...new Set([...namedFirst, ...named, ...first, ...rest].map((b) => b.id))];
}

function bracketMetas(bracketsExport: unknown): BracketMeta[] {
	const rows = (bracketsExport as { playoffBrackets?: { playoffBracket?: unknown } })?.playoffBrackets
		?.playoffBracket;
	return asArray(rows as Record<string, string>[])
		.map((b) => ({
			id: String(b?.id ?? ''),
			name: String(b?.name ?? ''),
			winnerTitle: String(b?.bracketWinnerTitle ?? ''),
			startWeek: Number(b?.startWeek) || 99,
			teams: Number(b?.teamsInvolved) || 0,
		}))
		.filter((b) => b.id);
}

const label = (b: BracketMeta) => `${b.winnerTitle} ${b.name}`;

/**
 * The non-consolation brackets that finish AFTER `bracketId`'s final, soonest
 * first. A bracket's winner who plays on in one of these did not win the
 * league there: names do not always say which bracket is a division's (a
 * 24-team league names its two divisions' brackets "NOLL" and "COWHER", and
 * bracket 1 is one of them; the title is a later two-team "FANTASY BOWL").
 */
export function laterBrackets(bracketsExport: unknown, bracketId: string): string[] {
	const metas = bracketMetas(bracketsExport);
	const from = metas.find((b) => b.id === bracketId);
	if (!from) return [];
	return metas
		.filter((b) => b.id !== bracketId && !NOT_CHAMPIONSHIP.test(label(b)) && finalWeek(b) > finalWeek(from))
		.sort((a, b) => finalWeek(a) - finalWeek(b) || Number(a.id) - Number(b.id))
		.map((b) => b.id);
}

/** Every franchise a bracket's export names in any game. */
export function bracketTeams(bracketExport: unknown): Set<string> {
	const out = new Set<string>();
	for (const r of bracketRounds(bracketExport)) {
		for (const g of r.games) {
			for (const side of [g.home, g.away]) if (isFranchiseId(side?.franchise_id)) out.add(side!.franchise_id!);
		}
	}
	return out;
}

/** The week a bracket's final is played: one round per halving of the field. */
function finalWeek(b: BracketMeta): number {
	return b.startWeek + Math.max(0, Math.ceil(Math.log2(Math.max(b.teams, 2))) - 1);
}

/** Finishes last first; then widest; then lowest id. */
function byWidthThenStart(a: BracketMeta, b: BracketMeta): number {
	return finalWeek(b) - finalWeek(a) || b.teams - a.teams || Number(a.id) - Number(b.id);
}

interface GameSide {
	franchise_id?: string;
	points?: string;
}

/**
 * Winner and loser of a bracket's final game, from `TYPE=playoffBracket`.
 * The final round is the one with the highest week; it must hold exactly one
 * game with both franchises and both scores, and the scores must differ.
 */
export function finalFromBracket(
	bracketExport: unknown,
): { winnerId: string; loserId: string } | { reason: string; unresolved?: true } {
	const rounds = bracketRounds(bracketExport);
	if (rounds.length === 0) return { reason: 'the championship bracket has no games' };
	const last = rounds[rounds.length - 1];
	const games = last.games;
	if (games.length !== 1) return { reason: `the final round has ${games.length} games, not one` };
	const { home, away } = games[0];
	// Only a real franchise id names a team: MFL fills an unseeded bracket
	// with `SEED1`/`SEED2` placeholders, and a past season's bracket often
	// carries seeds alone (see `finalFromGames`).
	const homeId = isFranchiseId(home?.franchise_id) ? home!.franchise_id! : null;
	const awayId = isFranchiseId(away?.franchise_id) ? away!.franchise_id! : null;
	if (!homeId || !awayId) return { reason: 'the final has not been set yet', unresolved: true };
	// An empty string is "no score yet", not zero: `Number('')` is 0, which
	// once read an unplayed placeholder final as "recorded as a tie".
	const hp = score(home?.points);
	const ap = score(away?.points);
	if (hp === null || ap === null) return { reason: 'the final has not been played yet', unresolved: true };
	if (hp === ap) return { reason: 'the final is recorded as a tie' };
	return hp > ap ? { winnerId: homeId, loserId: awayId } : { winnerId: awayId, loserId: homeId };
}

const isFranchiseId = (v: unknown): v is string => typeof v === 'string' && /^\d{1,6}$/.test(v);

/** A recorded score, or null for a missing or blank one. */
function score(v: unknown): number | null {
	if (typeof v !== 'string' && typeof v !== 'number') return null;
	if (String(v).trim() === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

interface BracketSide extends GameSide {
	seed?: string;
	winner_of_game?: string;
	loser_of_game?: string;
	/** Set when the side comes from ANOTHER bracket's game. */
	bracket?: string;
}

interface BracketGame {
	id: string;
	week: number;
	home?: BracketSide;
	away?: BracketSide;
}

/** The bracket's rounds, oldest week first. */
function bracketRounds(bracketExport: unknown): { week: number; games: BracketGame[] }[] {
	const rounds = asArray(
		(bracketExport as { playoffBracket?: { playoffRound?: unknown } })?.playoffBracket?.playoffRound as {
			week?: string;
			playoffGame?: unknown;
		}[],
	);
	return rounds
		.map((r) => {
			const week = Number(r?.week) || 0;
			const games = asArray(r?.playoffGame as { game_id?: string; home?: BracketSide; away?: BracketSide }[]).map(
				(g) => ({ id: String(g?.game_id ?? ''), week, home: g?.home, away: g?.away }),
			);
			return { week, games };
		})
		.sort((a, b) => a.week - b.week);
}

interface PlayedGame {
	a: string;
	b: string;
	sa: number;
	sb: number;
}

/** Week → every game with both scores recorded, from `TYPE=weeklyResults&W=YTD`. */
export function parseWeeklyGames(weeklyExport: unknown): Map<number, PlayedGame[]> {
	const root = weeklyExport as { allWeeklyResults?: { weeklyResults?: unknown }; weeklyResults?: unknown };
	const weeks = asArray((root?.allWeeklyResults?.weeklyResults ?? root?.weeklyResults) as {
		week?: string;
		matchup?: unknown;
	}[]);
	const out = new Map<number, PlayedGame[]>();
	for (const w of weeks) {
		const week = Number(w?.week);
		if (!Number.isInteger(week)) continue;
		const games: PlayedGame[] = [];
		for (const m of asArray(w?.matchup as { franchise?: unknown }[])) {
			const sides = asArray(m?.franchise as { id?: string; score?: string }[]);
			if (sides.length !== 2) continue;
			const [x, y] = sides;
			const sa = score(x?.score);
			const sb = score(y?.score);
			if (!isFranchiseId(x?.id) || !isFranchiseId(y?.id) || sa === null || sb === null || x.id === y.id) continue;
			games.push({ a: x.id, b: y.id, sa, sb });
		}
		out.set(week, games);
	}
	return out;
}

/**
 * The final of a bracket MFL exported as SEEDS ONLY (no franchise ids, no
 * points: a whole 25-season league read live came back this way, and so did
 * TheLeague's and the AFL's own feeds before 2024), read from the games MFL
 * recorded in those weeks.
 *
 * Walks DOWN from the final: pick a game played in the final's week, then
 * each side must be the winner (or loser) of the bracket game it names, which
 * fixes that team's game in the earlier week, and so on to the seeds, which
 * must be distinct teams. Every played game in the final week is tried; the
 * season is decided only when exactly one champion and runner-up survive.
 * The real final always survives (it is MFL's own record), so a unique
 * survivor is the answer; two survivors (a consolation bracket of the same
 * shape) leave the season unknown. Nothing here reads standings.
 */
export function finalFromGames(
	bracketExport: unknown,
	weeklyExport: unknown,
): { winnerId: string; loserId: string } | { reason: string } {
	const rounds = bracketRounds(bracketExport);
	if (rounds.length === 0) return { reason: 'the championship bracket has no games' };
	const finalRound = rounds[rounds.length - 1];
	if (finalRound.games.length !== 1) return { reason: `the final round has ${finalRound.games.length} games, not one` };
	const byId = new Map(rounds.flatMap((r) => r.games).map((g) => [g.id, g]));
	const played = parseWeeklyGames(weeklyExport);
	const finalGame = finalRound.games[0];

	interface State {
		seeds: Map<string, string>;
		seedOf: Map<string, string>;
		games: Map<string, { winner: string; loser: string }>;
	}
	type Task = { side: BracketSide | undefined; team: string };
	let budget = 20000;

	const gamesOf = (week: number, team: string) =>
		(played.get(week) ?? []).filter((g) => g.a === team || g.b === team);

	const solve = (tasks: Task[], state: State): boolean => {
		if (--budget < 0) return false;
		if (tasks.length === 0) return true;
		const [{ side, team }, ...rest] = tasks;
		if (!side) return false;
		if (side.franchise_id !== undefined && isFranchiseId(side.franchise_id)) {
			return side.franchise_id === team && solve(rest, state);
		}
		const ref = side.winner_of_game ?? side.loser_of_game;
		if (ref !== undefined) {
			const wantWin = side.winner_of_game !== undefined;
			const game = byId.get(String(ref));
			// A side fed from ANOTHER bracket cannot be walked from this one.
			if (!game || (side.bracket !== undefined && side.bracket !== '')) return false;
			const known = state.games.get(game.id);
			if (known) return (wantWin ? known.winner : known.loser) === team && solve(rest, state);
			for (const g of gamesOf(game.week, team)) {
				// A tied game was settled by the league's tiebreaker, which the
				// scores do not show: either team may have gone through, and the
				// rest of the bracket says which (two seeds-only leagues read live
				// had a tied semifinal).
				const winners = g.sa === g.sb ? [g.a, g.b] : [g.sa > g.sb ? g.a : g.b];
				const winner = wantWin ? team : winners.find((w) => w !== team);
				if (!winner || !winners.includes(winner)) continue;
				const loser = winner === g.a ? g.b : g.a;
				if ((wantWin ? winner : loser) !== team) continue;
				const games = new Map(state.games).set(game.id, { winner, loser });
				const other = team === winner ? loser : winner;
				for (const [h, a] of [
					[team, other],
					[other, team],
				]) {
					if (solve([{ side: game.home, team: h }, { side: game.away, team: a }, ...rest], { ...state, games })) {
						return true;
					}
				}
			}
			return false;
		}
		if (side.seed !== undefined && String(side.seed).trim() !== '') {
			const seed = String(side.seed);
			const bound = state.seeds.get(seed);
			if (bound) return bound === team && solve(rest, state);
			if (state.seedOf.has(team)) return false;
			return solve(rest, {
				...state,
				seeds: new Map(state.seeds).set(seed, team),
				seedOf: new Map(state.seedOf).set(team, seed),
			});
		}
		return false;
	};

	const outcomes = new Set<string>();
	for (const g of played.get(finalGame.week) ?? []) {
		if (g.sa === g.sb) continue;
		const winner = g.sa > g.sb ? g.a : g.b;
		const loser = winner === g.a ? g.b : g.a;
		for (const [h, a] of [
			[g.a, g.b],
			[g.b, g.a],
		]) {
			const state: State = { seeds: new Map(), seedOf: new Map(), games: new Map([[finalGame.id, { winner, loser }]]) };
			if (solve([{ side: finalGame.home, team: h }, { side: finalGame.away, team: a }], state)) {
				outcomes.add(`${winner}|${loser}`);
				break;
			}
		}
	}
	if (budget < 0) return { reason: 'the bracket is too large to read from the games' };
	if (outcomes.size === 0) return { reason: 'the games MFL recorded do not complete the bracket' };
	if (outcomes.size > 1) return { reason: 'more than one game fits the final' };
	const [winnerId, loserId] = [...outcomes][0].split('|');
	return { winnerId, loserId };
}

const side = (franchises: Map<string, string>, id: string | null): SeasonFranchise | null =>
	id ? { id, name: franchises.get(id) ?? `Franchise ${id}` } : null;

/** A season decided by its bracket. */
export function championFromBracket(
	year: number,
	bracketExport: unknown,
	franchises: Map<string, string>,
): SeasonChampion {
	const final = finalFromBracket(bracketExport);
	if ('reason' in final) {
		return { year, method: 'unknown', champion: null, runnerUp: null, note: final.reason };
	}
	return {
		year,
		method: 'bracket',
		champion: side(franchises, final.winnerId),
		runnerUp: side(franchises, final.loserId),
	};
}

/** True when the bracket's final names no teams or scores, so `championFromGames` may be able to read it. */
export function bracketNeedsGames(bracketExport: unknown): boolean {
	const final = finalFromBracket(bracketExport);
	return 'reason' in final && final.unresolved === true;
}

/** A season decided by the games MFL recorded for a seeds-only bracket (`finalFromGames`). */
export function championFromGames(
	year: number,
	bracketExport: unknown,
	weeklyExport: unknown,
	franchises: Map<string, string>,
): SeasonChampion {
	const final = finalFromGames(bracketExport, weeklyExport);
	if ('reason' in final) {
		return { year, method: 'unknown', champion: null, runnerUp: null, note: final.reason };
	}
	return {
		year,
		method: 'bracket',
		champion: side(franchises, final.winnerId),
		runnerUp: side(franchises, final.loserId),
	};
}

export interface ChampionTally {
	/** The team name the titles were won under, exactly as MFL recorded it that season. */
	name: string;
	titles: number[];
	runnerUps: number[];
}

/**
 * The trophy case: titles grouped by the NAME each was won under. Nothing is
 * merged across names or MFL team slots: a slot can change hands, and a
 * renamed team may or may not be the same owner, so the free page does not
 * guess. Linking names to people is Full History's owners-and-eras work.
 *
 * Names match exactly after trimming, so case is kept as recorded. Most titles
 * first, then most recent title; a name with only runner-up finishes comes
 * after every champion.
 */
export function tallyChampions(seasons: SeasonChampion[]): ChampionTally[] {
	const byName = new Map<string, ChampionTally>();
	const get = (f: SeasonFranchise) => {
		const name = f.name.trim();
		let row = byName.get(name);
		if (!row) {
			row = { name, titles: [], runnerUps: [] };
			byName.set(name, row);
		}
		return row;
	};
	for (const s of seasons) {
		if (s.champion) get(s.champion).titles.push(s.year);
		if (s.runnerUp) get(s.runnerUp).runnerUps.push(s.year);
	}
	const latest = (years: number[]) => (years.length ? Math.max(...years) : 0);
	return [...byName.values()].sort(
		(a, b) =>
			b.titles.length - a.titles.length ||
			latest(b.titles) - latest(a.titles) ||
			b.runnerUps.length - a.runnerUps.length ||
			a.name.localeCompare(b.name),
	);
}
