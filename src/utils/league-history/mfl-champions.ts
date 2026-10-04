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
 *  2. 'standings' — ONLY for a season with no playoff brackets at all: MFL's
 *                   standings order is the league's own result (its
 *                   tiebreakers applied — never re-sorted; see
 *                   docs/claude/rules/standings-brackets-draft-order.md).
 *  3. 'unknown'   — anything else. A season whose bracket exists but cannot
 *                   name a winner (unplayed, tied, missing ids) is NOT
 *                   guessed from standings: the regular-season leader is not
 *                   the champion of a league that holds playoffs.
 * An admin override ('override') beats all three; see store.ts.
 */

export type ChampionMethod = 'bracket' | 'standings' | 'override' | 'unknown';

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

/** The league's name, from a `TYPE=league` export. */
export function parseLeagueName(leagueExport: unknown): string {
	const name = (leagueExport as { league?: { name?: unknown } })?.league?.name;
	return typeof name === 'string' && name.trim() ? name.trim() : 'MFL league';
}

/** Franchise id → name for one season, from that season's `TYPE=league` export. */
export function parseFranchises(leagueExport: unknown): Map<string, string> {
	const out = new Map<string, string>();
	const rows = (leagueExport as { league?: { franchises?: { franchise?: unknown } } })?.league?.franchises
		?.franchise;
	for (const f of asArray(rows as { id?: string; name?: string }[])) {
		const id = String(f?.id ?? '').trim();
		if (!id) continue;
		out.set(id, String(f?.name ?? '').trim() || `Franchise ${id}`);
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

const NOT_CHAMPIONSHIP = /consol|toilet|loser|sacko|3rd|third|5th|7th|\bplace\b|\bpick\b|draft/i;
const CHAMPIONSHIP = /champ|title|super ?bowl|final/i;

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
 * excluded first.
 */
export function pickChampionshipBracketId(bracketsExport: unknown): string | null {
	const rows = (bracketsExport as { playoffBrackets?: { playoffBracket?: unknown } })?.playoffBrackets
		?.playoffBracket;
	const metas: BracketMeta[] = asArray(rows as Record<string, string>[])
		.map((b) => ({
			id: String(b?.id ?? ''),
			name: String(b?.name ?? ''),
			winnerTitle: String(b?.bracketWinnerTitle ?? ''),
			startWeek: Number(b?.startWeek) || 99,
			teams: Number(b?.teamsInvolved) || 0,
		}))
		.filter((b) => b.id);
	if (metas.length === 0) return null;

	const label = (b: BracketMeta) => `${b.winnerTitle} ${b.name}`;
	const named = metas.filter((b) => CHAMPIONSHIP.test(label(b)) && !NOT_CHAMPIONSHIP.test(label(b)));
	// Several brackets can call themselves a championship (the AFL's NIT is a
	// 16-team "NIT Championship" that finishes AFTER the real title game).
	// MFL's first bracket is the league's own in every league we have read, so
	// it wins when it is one of them.
	const namedFirst = named.find((b) => b.id === '1');
	if (namedFirst) return namedFirst.id;
	if (named.length > 0) return [...named].sort(byWidthThenStart)[0].id;

	const first = metas.find((b) => b.id === '1' && !NOT_CHAMPIONSHIP.test(label(b)));
	if (first) return first.id;

	const candidates = metas.filter((b) => !NOT_CHAMPIONSHIP.test(label(b)));
	return candidates.length > 0 ? [...candidates].sort(byWidthThenStart)[0].id : null;
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
): { winnerId: string; loserId: string } | { reason: string } {
	const rounds = asArray(
		(bracketExport as { playoffBracket?: { playoffRound?: unknown } })?.playoffBracket?.playoffRound as {
			week?: string;
			playoffGame?: unknown;
		}[],
	);
	if (rounds.length === 0) return { reason: 'the championship bracket has no games' };
	const last = [...rounds].sort((a, b) => (Number(b.week) || 0) - (Number(a.week) || 0))[0];
	const games = asArray(last.playoffGame as { home?: GameSide; away?: GameSide }[]);
	if (games.length !== 1) return { reason: `the final round has ${games.length} games, not one` };
	const { home, away } = games[0];
	const homeId = home?.franchise_id;
	const awayId = away?.franchise_id;
	if (!homeId || !awayId) return { reason: 'the final has not been set yet' };
	const hp = Number(home?.points);
	const ap = Number(away?.points);
	if (home?.points === undefined || away?.points === undefined || !Number.isFinite(hp) || !Number.isFinite(ap)) {
		return { reason: 'the final has not been played yet' };
	}
	if (hp === ap) return { reason: 'the final is recorded as a tie' };
	return hp > ap ? { winnerId: homeId, loserId: awayId } : { winnerId: awayId, loserId: homeId };
}

/** First and second place from `TYPE=leagueStandings`, in MFL's own order. */
export function topTwoFromStandings(standingsExport: unknown): [string, string | null] | null {
	const rows = asArray(
		(standingsExport as { leagueStandings?: { franchise?: unknown } })?.leagueStandings?.franchise as {
			id?: string;
		}[],
	);
	const ids = rows.map((r) => String(r?.id ?? '')).filter(Boolean);
	if (ids.length === 0) return null;
	return [ids[0], ids[1] ?? null];
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

/** A season with no brackets, decided by MFL's standings order. */
export function championFromStandings(
	year: number,
	standingsExport: unknown,
	franchises: Map<string, string>,
): SeasonChampion {
	const top = topTwoFromStandings(standingsExport);
	if (!top) {
		return { year, method: 'unknown', champion: null, runnerUp: null, note: 'no brackets and no standings' };
	}
	return { year, method: 'standings', champion: side(franchises, top[0]), runnerUp: side(franchises, top[1]) };
}

export interface ChampionTally {
	franchiseId: string;
	/** The name the franchise wore in its MOST RECENT season on record. */
	name: string;
	titles: number[];
	runnerUps: number[];
}

/**
 * The trophy case: titles per franchise, keyed by MFL franchise id (a slot
 * that keeps its id when it changes name or owner). Most titles first, then
 * most recent title. A franchise with only runner-up finishes is listed after
 * every champion.
 */
export function tallyChampions(seasons: SeasonChampion[], latestNames: Map<string, string>): ChampionTally[] {
	const byId = new Map<string, ChampionTally>();
	const get = (f: SeasonFranchise) => {
		let row = byId.get(f.id);
		if (!row) {
			row = { franchiseId: f.id, name: latestNames.get(f.id) ?? f.name, titles: [], runnerUps: [] };
			byId.set(f.id, row);
		}
		return row;
	};
	for (const s of seasons) {
		if (s.champion) get(s.champion).titles.push(s.year);
		if (s.runnerUp) get(s.runnerUp).runnerUps.push(s.year);
	}
	const latest = (years: number[]) => (years.length ? Math.max(...years) : 0);
	return [...byId.values()].sort(
		(a, b) =>
			b.titles.length - a.titles.length ||
			latest(b.titles) - latest(a.titles) ||
			b.runnerUps.length - a.runnerUps.length ||
			a.name.localeCompare(b.name),
	);
}
