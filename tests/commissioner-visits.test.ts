import { describe, it, expect } from 'vitest';
import { trackedAccountName, parseCommissionerAccounts } from '../src/utils/commissioner-visits';

/**
 * Owner Activity's Commissioners section counts visits by MFL ACCOUNT, so a
 * head commissioner and a co-commissioner show separately (owner's ask, Oct
 * 2026). It must never become a per-owner name log.
 */
describe('trackedAccountName', () => {
	const league = '10105';

	it('records a commissioner session in its own league, lowercased', () => {
		expect(trackedAccountName({ name: 'HeadCommish', role: 'commissioner', leagueId: league }, league)).toBe('headcommish');
	});

	it('records a platform admin even when MFL calls them an owner', () => {
		expect(trackedAccountName({ name: 'braven112', role: 'owner', leagueId: league }, league)).toBe('braven112');
	});

	it('never records a plain owner', () => {
		expect(trackedAccountName({ name: 'someowner', role: 'owner', leagueId: league }, league)).toBeNull();
	});

	it('never records a session from another league', () => {
		expect(trackedAccountName({ name: 'braven112', role: 'commissioner', leagueId: '13522' }, league)).toBeNull();
	});

	it('refuses an empty name or one carrying the field separator', () => {
		expect(trackedAccountName({ name: '  ', role: 'commissioner', leagueId: league }, league)).toBeNull();
		expect(trackedAccountName({ name: 'a|seen', role: 'commissioner', leagueId: league }, league)).toBeNull();
		expect(trackedAccountName(null, league)).toBeNull();
	});
});

describe('parseCommissionerAccounts', () => {
	it('groups fields per account and sorts the most recent first', () => {
		const rows = parseCommissionerAccounts({
			'braven112|seen': '2000',
			'braven112|views': '7',
			'headcommish|login': '5000',
			'headcommish|seen': '4000',
			'headcommish|views': 3,
			'junk': '1',
			'x|unknown': '9',
		});
		expect(rows).toEqual([
			{ account: 'headcommish', lastSeen: 4000, lastLogin: 5000, views: 3 },
			{ account: 'braven112', lastSeen: 2000, lastLogin: null, views: 7 },
		]);
	});

	it('returns nothing for an empty or missing hash', () => {
		expect(parseCommissionerAccounts(null)).toEqual([]);
		expect(parseCommissionerAccounts({})).toEqual([]);
	});
});
