import { describe, it, expect } from 'vitest';
import {
	lastMflMoveByFranchise,
	describeMoveType,
	OWNER_ACTION_TX_TYPES,
} from '../src/utils/mfl-activity';
import { blendActivity, buildOwnerActivityRow } from '../src/utils/owner-activity';

const SEC = 1000;

/** Build a raw MFL transaction row. Timestamps are epoch SECONDS, as strings. */
function tx(overrides: Record<string, unknown>) {
	return { timestamp: '1700000000', ...overrides };
}

describe('lastMflMoveByFranchise', () => {
	it('accepts the full MFL envelope, the inner object, or a bare array', () => {
		const rows = [tx({ type: 'FREE_AGENT', franchise: '0001' })];
		const expected = { '0001': { at: 1700000000 * SEC, type: 'FREE_AGENT' } };

		expect(lastMflMoveByFranchise({ transactions: { transaction: rows } })).toEqual(expected);
		expect(lastMflMoveByFranchise({ transaction: rows })).toEqual(expected);
		expect(lastMflMoveByFranchise(rows)).toEqual(expected);
	});

	it('normalizes a single transaction returned as an object, not an array', () => {
		// MFL collapses a one-element list into a bare object.
		const feed = { transactions: { transaction: tx({ type: 'TRADE', franchise: '0002', franchise2: '0003' }) } };
		const result = lastMflMoveByFranchise(feed);
		expect(Object.keys(result).sort()).toEqual(['0002', '0003']);
	});

	it('converts MFL epoch seconds to milliseconds', () => {
		const result = lastMflMoveByFranchise([tx({ type: 'IR', franchise: '0001', timestamp: '1787915211' })]);
		expect(result['0001'].at).toBe(1787915211000);
	});

	it('keeps only the most recent qualifying move per franchise', () => {
		const result = lastMflMoveByFranchise([
			tx({ type: 'FREE_AGENT', franchise: '0001', timestamp: '1000' }),
			tx({ type: 'TAXI', franchise: '0001', timestamp: '3000' }),
			tx({ type: 'IR', franchise: '0001', timestamp: '2000' }),
		]);
		expect(result['0001']).toEqual({ at: 3000 * SEC, type: 'TAXI' });
	});

	it('credits BOTH sides of a trade', () => {
		const result = lastMflMoveByFranchise([
			tx({ type: 'TRADE', franchise: '0004', franchise2: '0009', timestamp: '5000' }),
		]);
		expect(result['0004'].at).toBe(5000 * SEC);
		expect(result['0009'].at).toBe(5000 * SEC);
	});

	// THE BUG THIS PREVENTS: counting commissioner-executed moves would show an
	// absent owner as "active 2h ago" the moment the commish fixed their roster.
	it('ignores rows the commissioner executed on a franchise behalf', () => {
		const result = lastMflMoveByFranchise([
			tx({ type: 'FREE_AGENT', franchise: '0012', timestamp: '9000', by_commish: '1' }),
		]);
		expect(result['0012']).toBeUndefined();
	});

	it('still counts a row whose by_commish is absent, empty, or "0"', () => {
		const result = lastMflMoveByFranchise([
			tx({ type: 'FREE_AGENT', franchise: '0001', timestamp: '1000' }),
			tx({ type: 'FREE_AGENT', franchise: '0002', timestamp: '1000', by_commish: '' }),
			tx({ type: 'FREE_AGENT', franchise: '0003', timestamp: '1000', by_commish: '0' }),
		]);
		expect(Object.keys(result).sort()).toEqual(['0001', '0002', '0003']);
	});

	// THE BUG THIS PREVENTS: the scheduled waiver run and the kickoff lock fire
	// for every league every week. Counting them would make every owner look
	// active forever, which is exactly the signal this feature exists to give.
	it.each([
		'LOCK_ALL_PLAYERS',
		'AUTO_PROCESS_WAIVERS',
		'BBID_AUTO_PROCESS_WAIVERS',
		'LOAD_ROSTERS',
	])('ignores the system/commissioner transaction type %s', (type) => {
		const result = lastMflMoveByFranchise([tx({ type, franchise: '0001', timestamp: '9999' })]);
		expect(result).toEqual({});
	});

	it('ignores league-wide rows that carry an empty franchise id', () => {
		const result = lastMflMoveByFranchise([tx({ type: 'FREE_AGENT', franchise: '' })]);
		expect(result).toEqual({});
	});

	it('ignores rows with a missing or unusable timestamp', () => {
		const result = lastMflMoveByFranchise([
			tx({ type: 'IR', franchise: '0001', timestamp: undefined }),
			tx({ type: 'IR', franchise: '0002', timestamp: '' }),
			tx({ type: 'IR', franchise: '0003', timestamp: 'not-a-number' }),
			tx({ type: 'IR', franchise: '0004', timestamp: '0' }),
		]);
		expect(result).toEqual({});
	});

	it('survives empty, null, and malformed feeds', () => {
		expect(lastMflMoveByFranchise(null)).toEqual({});
		expect(lastMflMoveByFranchise(undefined)).toEqual({});
		expect(lastMflMoveByFranchise({})).toEqual({});
		expect(lastMflMoveByFranchise({ transactions: {} })).toEqual({});
		expect(lastMflMoveByFranchise([])).toEqual({});
	});

	it('covers every owner-action type observed in both leagues feeds', () => {
		// Types seen across TheLeague + AFL 2025/2026 transaction feeds that a
		// human owner has to perform. If MFL adds one, add it deliberately.
		for (const type of ['TRADE', 'FREE_AGENT', 'WAIVER', 'BBID_WAIVER', 'AUCTION_BID', 'AUCTION_WON', 'AUCTION_INIT', 'IR', 'TAXI']) {
			expect(OWNER_ACTION_TX_TYPES.has(type)).toBe(true);
		}
		expect(OWNER_ACTION_TX_TYPES.has('LOCK_ALL_PLAYERS')).toBe(false);
	});
});

describe('describeMoveType', () => {
	it('labels every owner-action type', () => {
		for (const type of OWNER_ACTION_TX_TYPES) {
			expect(describeMoveType(type)).not.toBe('roster move');
		}
	});

	it('falls back for an unrecognized type', () => {
		expect(describeMoveType('SOMETHING_NEW')).toBe('roster move');
	});
});

describe('blendActivity', () => {
	it('takes the more recent of the two signals', () => {
		expect(blendActivity(100, 500)).toEqual({ siteVisit: 100, mflSignal: 500, lastSeen: 500, source: 'mfl' });
		expect(blendActivity(900, 500)).toEqual({ siteVisit: 900, mflSignal: 500, lastSeen: 900, source: 'site' });
	});

	it('uses whichever signal exists when the other is missing', () => {
		expect(blendActivity(null, 500)).toMatchObject({ lastSeen: 500, source: 'mfl' });
		expect(blendActivity(300, null)).toMatchObject({ lastSeen: 300, source: 'site' });
	});

	it('reports no signal when the owner has neither', () => {
		expect(blendActivity(null, null)).toEqual({ siteVisit: null, mflSignal: null, lastSeen: null, source: 'none' });
	});

	// A waiver row is stamped when the batch ran, not when the owner clicked, so
	// a tie is more trustworthy as a real page view.
	it('breaks a tie in favor of the site visit', () => {
		expect(blendActivity(500, 500).source).toBe('site');
	});

	it('always preserves both raw halves for the UI to show its work', () => {
		expect(blendActivity(100, 500)).toMatchObject({ siteVisit: 100, mflSignal: 500 });
		expect(blendActivity(900, 500)).toMatchObject({ siteVisit: 900, mflSignal: 500 });
	});
});

describe('buildOwnerActivityRow — which MFL signal wins', () => {
	const base = { franchiseId: '0001', name: 'Pigskins', icon: '/i.png' };
	// Pinned once: a helper that re-read Date.now() per call returns a slightly
	// different value each time, so `toBe` comparisons against it flake.
	const NOW = Date.now();
	const hoursAgo = (h: number) => NOW - h * 3_600_000;

	// MFL's own lastVisit is a real login. An owner must log in to transact, so
	// a login is never older than their last move — using the move when both
	// exist would understate how recently they were around.
	it('prefers the real MFL login over transaction recency', () => {
		const row = buildOwnerActivityRow({
			...base,
			siteVisit: hoursAgo(200),
			mflVisit: hoursAgo(2),
			move: { at: hoursAgo(72), type: 'TRADE' },
		});
		expect(row.source).toBe('mfl');
		expect(row.lastSeen).toBe(row.mflVisit);
		expect(row.level).toBe('active');
		// Both raw halves survive for the UI.
		expect(row.mflMove).toBe(hoursAgo(72));
		expect(row.mflMoveLabel).toBe('trade');
	});

	// THE CASE THE WHOLE FEATURE EXISTS FOR: an owner who reads MFL daily and
	// never touches their roster. Transaction recency alone calls them dormant.
	it('rescues an owner who logs into MFL but never transacts', () => {
		const withMove = buildOwnerActivityRow({
			...base,
			siteVisit: hoursAgo(400),
			mflVisit: null,
			move: { at: hoursAgo(400), type: 'IR' },
		});
		expect(withMove.level).toBe('dormant');

		const withLogin = buildOwnerActivityRow({
			...base,
			siteVisit: hoursAgo(400),
			mflVisit: hoursAgo(3),
			move: { at: hoursAgo(400), type: 'IR' },
		});
		expect(withLogin.level).toBe('active');
		expect(withLogin.source).toBe('mfl');
	});

	// THE BUG THIS PREVENTS: lastVisit is synced every 6h and transactions every
	// 5 min, so a move can be NEWER than the login on file. Taking the login
	// alone ranked the owner by the older number while the row's own breakdown
	// line read "Last move: 20m ago" — wrong, and visibly self-contradictory.
	it('takes the later of login and move when the move is fresher', () => {
		const row = buildOwnerActivityRow({
			...base,
			siteVisit: hoursAgo(200),
			mflVisit: hoursAgo(6),
			move: { at: hoursAgo(1), type: 'TRADE' },
		});
		expect(row.lastSeen).toBe(hoursAgo(1));
		expect(row.source).toBe('mfl');
		// Both raw halves still render, so the breakdown agrees with the headline.
		expect(row.mflVisit).toBe(hoursAgo(6));
		expect(row.mflMove).toBe(hoursAgo(1));
	});

	it('falls back to transaction recency when no login is available', () => {
		const row = buildOwnerActivityRow({
			...base,
			siteVisit: hoursAgo(200),
			mflVisit: null,
			move: { at: hoursAgo(5), type: 'FREE_AGENT' },
		});
		expect(row.source).toBe('mfl');
		expect(row.lastSeen).toBe(hoursAgo(5));
		expect(row.mflVisitTimeAgo).toBe('');
	});

	it('reports no signal when the owner has none of the three', () => {
		const row = buildOwnerActivityRow({ ...base, siteVisit: null, mflVisit: null, move: null });
		expect(row.source).toBe('none');
		expect(row.lastSeen).toBeNull();
		expect(row.label).toBe('Never seen');
		expect(row.siteTimeAgo).toBe('');
		expect(row.mflVisitTimeAgo).toBe('');
		expect(row.mflMoveTimeAgo).toBe('');
	});

	it('still lets a fresher site visit win over an older MFL login', () => {
		const row = buildOwnerActivityRow({
			...base,
			siteVisit: hoursAgo(1),
			mflVisit: hoursAgo(50),
			move: null,
		});
		expect(row.source).toBe('site');
		expect(row.lastSeen).toBe(hoursAgo(1));
	});
});
