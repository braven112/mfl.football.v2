/**
 * Season video — a league's trades and waiver/free agent moves, from each
 * platform's own transaction data (Brandon, 2026-11-06): the weekly recap
 * shows every trade made that week, the season recap counts the season's
 * trades and waiver/free agent moves.
 *
 *  - MFL: the year's transactions export. A trade lists what each side gave
 *    up; players are named through the players export, draft picks and
 *    blind-bid dollars are spelled out. The week is the NFL week the trade
 *    was made in (`nflWeekFor`), so a trade made after Monday night counts
 *    toward the next week's recap. Waiver/free agent moves are FREE_AGENT,
 *    WAIVER and BBID_WAIVER transactions; auctions are not counted, since a
 *    salary-cap league's auction is mostly its draft.
 *  - Sleeper: each week's transactions (`leg` is the week); only completed
 *    ones count.
 *  - ESPN: only the per-team counters ESPN keeps on each team, so the season
 *    totals and no trade cards.
 *
 * Server only (the week boundaries carry the NFL schedule).
 */
import { asArray } from '../league-history/mfl-champions';
import { nflWeekFor } from '../nfl-week-starts.mjs';
import type { LeagueMoves, LeagueTrade } from './league-recap';

const ordinal = (n: number) => {
	const s = ['th', 'st', 'nd', 'rd'];
	const v = n % 100;
	return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

function tally(byTeam: LeagueMoves['byTeam'], id: string, kind: 'trades' | 'moves') {
	const row = byTeam[id] ?? (byTeam[id] = { trades: 0, moves: 0 });
	row[kind]++;
}

// ── MFL ───────────────────────────────────────────────────────────────────

interface MflTransaction {
	type?: string;
	timestamp?: string;
	franchise?: string;
	franchise2?: string;
	franchise1_gave_up?: string;
	franchise2_gave_up?: string;
}

function mflRows(body: unknown): MflTransaction[] {
	return asArray((body as { transactions?: { transaction?: unknown } } | null)?.transactions?.transaction as MflTransaction[]).filter(Boolean);
}

const tokens = (list: string | undefined) => (list ?? '').split(',').map((t) => t.trim()).filter(Boolean);

/** Every player id named in the year's trades, for the players export. */
export function mflTradePlayerIds(body: unknown): string[] {
	const ids = new Set<string>();
	for (const t of mflRows(body)) {
		if (t.type !== 'TRADE') continue;
		for (const tok of [...tokens(t.franchise1_gave_up), ...tokens(t.franchise2_gave_up)]) if (/^\d{1,6}$/.test(tok)) ids.add(tok);
	}
	return [...ids];
}

/** One traded asset in words: a player's name, a draft pick, blind-bid dollars. Null when it can't be named. */
export function mflAssetLabel(token: string, season: number, playerName: (id: string) => string | null): string | null {
	if (/^\d{1,6}$/.test(token)) return playerName(token);
	const future = /^FP_\d{4}_(\d{4})_(\d{1,2})$/.exec(token);
	if (future) return `${future[1]} ${ordinal(Number(future[2]))}-round pick`;
	const current = /^DP_(\d{1,2})_(\d{1,3})$/.exec(token);
	if (current) return `${season} pick ${Number(current[1]) + 1}.${String(Number(current[2]) + 1).padStart(2, '0')}`;
	const bid = /^BB_(\d+(?:\.\d+)?)$/.exec(token);
	if (bid) return `${money(Number(bid[1]))} in blind-bid dollars`;
	return null;
}

const MFL_WAIVER_TYPES = new Set(['FREE_AGENT', 'WAIVER', 'BBID_WAIVER']);

export function mflMoves(body: unknown, season: number, playerName: (id: string) => string | null): LeagueMoves | null {
	const rows = mflRows(body);
	if (!rows.length) return null;
	const trades: LeagueTrade[] = [];
	const byTeam: LeagueMoves['byTeam'] = {};
	let waiverMoves = 0;
	for (const t of rows) {
		const team = /^\d{4}$/.test(t.franchise ?? '') ? t.franchise! : null;
		if (!team) continue;
		if (t.type === 'TRADE') {
			const other = /^\d{4}$/.test(t.franchise2 ?? '') ? t.franchise2! : null;
			if (!other || other === team) continue;
			const name = (list: string | undefined) => tokens(list).map((x) => mflAssetLabel(x, season, playerName)).filter((x): x is string => !!x);
			const ts = Number(t.timestamp);
			trades.push({
				week: Number.isFinite(ts) && ts > 0 ? nflWeekFor(season, new Date(ts * 1000)) : 0,
				// Each side gets what the other gave up.
				sides: [
					{ teamId: team, gets: name(t.franchise2_gave_up) },
					{ teamId: other, gets: name(t.franchise1_gave_up) },
				],
			});
			tally(byTeam, team, 'trades');
			tally(byTeam, other, 'trades');
		} else if (MFL_WAIVER_TYPES.has(t.type ?? '')) {
			waiverMoves++;
			tally(byTeam, team, 'moves');
		}
	}
	return { trades, tradeCount: trades.length, waiverMoves, byTeam };
}

// ── Sleeper ───────────────────────────────────────────────────────────────

export interface SleeperTransaction {
	type?: string;
	status?: string;
	leg?: number;
	roster_ids?: number[];
	adds?: Record<string, number> | null;
	draft_picks?: { season?: string; round?: number; owner_id?: number; previous_owner_id?: number }[] | null;
	waiver_budget?: { sender?: number; receiver?: number; amount?: number }[] | null;
}

export function sleeperMoves(rows: readonly SleeperTransaction[], playerName: (id: string) => string | null): LeagueMoves {
	const trades: LeagueTrade[] = [];
	const byTeam: LeagueMoves['byTeam'] = {};
	let waiverMoves = 0;
	for (const t of rows) {
		if (t.status !== 'complete') continue;
		if (t.type === 'trade') {
			const ids = [...new Set(t.roster_ids ?? [])];
			if (ids.length < 2) continue;
			const gets = new Map<number, string[]>(ids.map((id) => [id, []]));
			for (const [pid, rid] of Object.entries(t.adds ?? {})) gets.get(rid)?.push(playerName(pid) ?? 'A player');
			for (const p of t.draft_picks ?? []) if (p.owner_id !== undefined && p.round) gets.get(p.owner_id)?.push(`${p.season ?? ''} ${ordinal(p.round)}-round pick`.trim());
			for (const b of t.waiver_budget ?? []) if (b.receiver !== undefined && b.amount) gets.get(b.receiver)?.push(`${money(b.amount)} in FAAB`);
			trades.push({ week: Number(t.leg) || 0, sides: ids.map((id) => ({ teamId: String(id), gets: gets.get(id) ?? [] })) });
			for (const id of ids) tally(byTeam, String(id), 'trades');
		} else if (t.type === 'waiver' || t.type === 'free_agent') {
			const id = t.roster_ids?.[0];
			if (id === undefined) continue;
			waiverMoves++;
			tally(byTeam, String(id), 'moves');
		}
	}
	return { trades, tradeCount: trades.length, waiverMoves, byTeam };
}

// ── ESPN ──────────────────────────────────────────────────────────────────

/** ESPN keeps counters on each team (`transactionCounter`): totals only, no trade cards. */
export function espnMoves(teams: readonly { id?: number; transactionCounter?: { trades?: number; acquisitions?: number } }[]): LeagueMoves | null {
	const byTeam: LeagueMoves['byTeam'] = {};
	let trades = 0;
	let moves = 0;
	let seen = false;
	for (const t of teams) {
		const c = t.transactionCounter;
		if (t.id === undefined || !c) continue;
		seen = true;
		const tr = Number(c.trades) || 0;
		const mv = Number(c.acquisitions) || 0;
		byTeam[String(t.id)] = { trades: tr, moves: mv };
		trades += tr;
		moves += mv;
	}
	if (!seen) return null;
	// Each trade sits on both teams' counters.
	return { trades: null, tradeCount: Math.round(trades / 2), waiverMoves: moves, byTeam };
}
