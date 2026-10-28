/**
 * The free all-play report for ANY MFL league (/mfl-all-play-standings), from
 * a `TYPE=weeklyResults&W=YTD` export. Pure, so the tests drive it with
 * recorded responses (tests/mfl-all-play-report.test.ts).
 *
 * Built on game-results.mjs, the repo's one definition of a game and of an
 * all-play week: this file only decides WHICH weeks count and adds luck.
 *
 * All-play asks "what if every team played every other team every week?".
 * Luck is a team's real wins minus the wins its all-play rate predicts over
 * the same number of games: a team that keeps meeting opponents on their
 * best weeks shows up negative.
 *
 * ── WHICH WEEKS COUNT ─────────────────────────────────────────────────────
 * Only regular-season games MFL has marked FINAL. Every side of a decided
 * game carries `result` (W/L/T); the week being played right now has scores
 * but no results, and counting it would rank teams on half a week. Playoff
 * matchups (`regularSeason: "0"`) are left out, so a playoff team is not
 * credited extra all-play games.
 */
import {
	addResult,
	allPlayWeek,
	emptyRecord,
	formatRecord,
	weekEntries,
	weekGames,
	winPct,
} from './game-results.mjs';

export interface AllPlayRow {
	id: string;
	name: string;
	record: string;
	allPlayRecord: string;
	/** All-play winning percentage, ties as half a win. 0–1. */
	allPlayPct: number;
	pointsFor: number;
	/** Real wins minus the wins the all-play rate predicts over the same games. */
	luck: number;
}

export interface AllPlayReport {
	weeks: number[];
	rows: AllPlayRow[];
}

const FINAL = new Set(['W', 'L', 'T']);

type RawSide = { result?: string };
type RawWeek = { week?: string; matchup?: unknown };

/** The weeks of an export, whichever wrapper MFL used (`allWeeklyResults` for W=YTD). */
function entriesOf(body: unknown): RawWeek[] {
	const ytd = (body as { allWeeklyResults?: unknown })?.allWeeklyResults;
	return weekEntries(ytd ?? body) as RawWeek[];
}

/** Every side of every matchup that week has a recorded result. */
function weekIsFinal(week: RawWeek): boolean {
	const matchups = Array.isArray(week.matchup) ? week.matchup : week.matchup ? [week.matchup] : [];
	if (matchups.length === 0) return false;
	return matchups.every((m) => {
		const sides = (m as { franchise?: RawSide | RawSide[] }).franchise;
		const list = Array.isArray(sides) ? sides : sides ? [sides] : [];
		return list.length > 0 && list.every((s) => FINAL.has(String(s?.result)));
	});
}

export function computeAllPlayReport(
	body: unknown,
	names: Map<string, string> | Record<string, string>,
): AllPlayReport {
	const nameOf = (id: string) => (names instanceof Map ? names.get(id) : names[id]) ?? `Franchise ${id}`;
	const actual = new Map<string, ReturnType<typeof emptyRecord>>();
	const allPlay = new Map<string, ReturnType<typeof emptyRecord>>();
	const rec = (m: typeof actual, id: string) => {
		let r = m.get(id);
		if (!r) m.set(id, (r = emptyRecord()));
		return r;
	};
	const weeks: number[] = [];

	for (const week of entriesOf(body)) {
		if (!weekIsFinal(week)) continue;
		const games = weekGames(week).filter((g: { regularSeason: boolean | null }) => g.regularSeason !== false);
		if (games.length === 0) continue;
		const scores = new Map<string, number>();
		for (const g of games) {
			addResult(rec(actual, g.a), g.ra);
			addResult(rec(actual, g.b), g.rb);
			scores.set(g.a, g.sa);
			scores.set(g.b, g.sb);
		}
		// Points once per team per WEEK: a doubleheader is two games on one
		// score, and summing per game would count that score twice.
		for (const [id, score] of scores) rec(actual, id).pointsFor += score;
		const week_ = allPlayWeek(scores);
		if (week_.size === 0) continue;
		weeks.push(Number(week.week));
		for (const [id, r] of week_) {
			const ap = rec(allPlay, id);
			ap.wins += r.wins;
			ap.losses += r.losses;
			ap.ties += r.ties;
		}
	}

	const rows: AllPlayRow[] = [...actual.entries()].map(([id, r]) => {
		const ap = allPlay.get(id) ?? emptyRecord();
		const pct = winPct(ap) ?? 0;
		const games = r.wins + r.losses + r.ties;
		return {
			id,
			name: nameOf(id),
			record: formatRecord(r),
			allPlayRecord: formatRecord(ap),
			allPlayPct: pct,
			pointsFor: Math.round(r.pointsFor * 100) / 100,
			luck: r.wins + r.ties / 2 - pct * games,
		};
	});
	rows.sort((a, b) => b.allPlayPct - a.allPlayPct || b.pointsFor - a.pointsFor || a.name.localeCompare(b.name));
	return { weeks: weeks.sort((a, b) => a - b), rows };
}

/** ".659", as MFL and every standings page print it. */
export function formatPct(p: number): string {
	return p.toFixed(3).replace(/^0/, '');
}

/** "+1.4" / "−0.8" / "0.0". */
export function formatLuck(n: number): string {
	const v = Math.round(n * 10) / 10;
	if (v === 0) return '0.0';
	return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
}
