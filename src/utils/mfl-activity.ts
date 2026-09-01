/**
 * MFL Owner Activity
 *
 * Derives a per-franchise "last did something on MFL" timestamp from the
 * `TYPE=transactions` feed.
 *
 * WHY THIS EXISTS. MFL does publish a last-online number — `lastVisit` on the
 * franchise record — but ONLY to a commissioner session, and undocumented:
 * none of the 59 export types is activity-shaped, and the franchise record
 * returned to an ANONYMOUS caller carries only id/name/abbrev/division/
 * waiverSortOrder/icon/logo/bbidAvailableBalance/salaryCapAmount/stadium/sound
 * (verified across 60 public leagues, Aug 2026). The real value is fetched in
 * CI by `scripts/sync-owner-last-visit.mjs` and committed, because the
 * commissioner cookie cannot exist in the page runtime.
 *
 * Transaction recency is the FALLBACK for where that value is unavailable: a
 * league we are only an owner in, or before the sync has first run. It is a
 * floor on the same quantity — an owner has to log in to transact, so their
 * last move is never more recent than their last login — and it is strictly
 * worse as a signal, because an owner who reads MFL daily and never touches
 * their roster looks dormant here.
 *
 * Pure module — no I/O, no Redis. Callers hand it a parsed feed.
 */

/**
 * Transaction types that prove the OWNER themselves did something.
 *
 * Deliberately excluded, because they are the system or the commissioner
 * acting and would manufacture activity for an absent owner:
 *   LOCK_ALL_PLAYERS             — kickoff lock, league-wide (franchise is "")
 *   AUTO_PROCESS_WAIVERS         — scheduled waiver run (franchise is "")
 *   BBID_AUTO_PROCESS_WAIVERS    — same, blind-bid leagues (franchise is "")
 *   LOAD_ROSTERS                 — commissioner bulk import
 * Any row flagged `by_commish` is excluded for the same reason regardless of
 * type — the commissioner made that move on the franchise's behalf.
 *
 * NOTE on WAIVER / BBID_WAIVER: the timestamp is when the batch PROCESSED, not
 * when the owner submitted the claim, so these can overstate recency by up to
 * the waiver period. They are still owner-initiated, so they count.
 */
export const OWNER_ACTION_TX_TYPES: ReadonlySet<string> = new Set([
	'TRADE',
	'FREE_AGENT',
	'WAIVER',
	'BBID_WAIVER',
	'AUCTION_BID',
	'AUCTION_WON',
	'AUCTION_INIT', // a nomination — the owner put the player up
	'IR',
	'TAXI',
]);

export interface MflMove {
	/** Epoch milliseconds of the most recent owner-driven move. */
	at: number;
	/** MFL transaction type that produced it, e.g. "TRADE". */
	type: string;
}

interface RawTx {
	type?: string;
	franchise?: string;
	franchise2?: string;
	timestamp?: string | number;
	by_commish?: string;
	[key: string]: unknown;
}

/** MFL returns a single transaction as an object, many as an array, none as undefined. */
function toArray(raw: unknown): RawTx[] {
	if (Array.isArray(raw)) return raw as RawTx[];
	if (raw && typeof raw === 'object') return [raw as RawTx];
	return [];
}

/** MFL timestamps are epoch SECONDS in a string. Returns ms, or null if unusable. */
function toMillis(value: string | number | undefined): number | null {
	if (value === undefined || value === null || value === '') return null;
	const seconds = Number(value);
	if (!Number.isFinite(seconds) || seconds <= 0) return null;
	return seconds * 1000;
}

/** A franchise id is present and real (league-wide rows carry an empty string). */
function isFranchiseId(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

/**
 * MFL sets `by_commish` to "1" on a commissioner-executed row and omits it
 * otherwise. Anything truthy-but-not-"0" counts, so a future "Y" still trips it.
 */
function isCommissionerExecuted(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	const flag = String(value).trim();
	return flag !== '' && flag !== '0';
}

/**
 * Most recent owner-driven MFL move per franchise.
 *
 * @param transactionsFeed the parsed `TYPE=transactions` JSON, or the inner
 *   `transactions` object, or the raw transaction array — all three are
 *   accepted so callers don't have to unwrap MFL's envelope.
 * @returns `{ [franchiseId]: { at, type } }`, epoch ms. Franchises with no
 *   qualifying move are absent from the map.
 */
export function lastMflMoveByFranchise(transactionsFeed: unknown): Record<string, MflMove> {
	const feed = transactionsFeed as
		| { transactions?: { transaction?: unknown } ; transaction?: unknown }
		| unknown[]
		| null
		| undefined;

	const rawList = Array.isArray(feed)
		? feed
		: ((feed as { transactions?: { transaction?: unknown } })?.transactions?.transaction ??
			(feed as { transaction?: unknown })?.transaction);

	const result: Record<string, MflMove> = {};

	for (const tx of toArray(rawList)) {
		const type = typeof tx.type === 'string' ? tx.type : '';
		if (!OWNER_ACTION_TX_TYPES.has(type)) continue;

		// A commissioner-executed move says nothing about whether the owner was around.
		if (isCommissionerExecuted(tx.by_commish)) continue;

		const at = toMillis(tx.timestamp);
		if (at === null) continue;

		// A trade credits BOTH sides — each owner had to act for it to complete.
		const parties = [tx.franchise, tx.franchise2].filter(isFranchiseId);
		for (const franchiseId of parties) {
			const existing = result[franchiseId];
			if (!existing || at > existing.at) result[franchiseId] = { at, type };
		}
	}

	return result;
}

/** Human-readable label for a transaction type, for the UI. */
export function describeMoveType(type: string): string {
	const labels: Record<string, string> = {
		TRADE: 'trade',
		FREE_AGENT: 'free agent move',
		WAIVER: 'waiver claim',
		BBID_WAIVER: 'waiver claim',
		AUCTION_BID: 'auction bid',
		AUCTION_WON: 'auction win',
		AUCTION_INIT: 'auction nomination',
		IR: 'IR move',
		TAXI: 'taxi squad move',
	};
	return labels[type] || 'roster move';
}
