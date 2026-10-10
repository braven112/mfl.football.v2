import { describe, it, expect } from 'vitest';
import { sumPageUsage } from '../src/utils/page-usage';
import { canonicalPath } from '../src/utils/site-analytics';

/**
 * Site search ranks by real use. The commissioner opens every page (on
 * TheLeague about half of all signed-in views), so the admin franchises are
 * left out or search ranks by one person's habits.
 */
describe('sumPageUsage', () => {
	const key = (p: string) => canonicalPath(p, 'theleague');

	it('sums owners and signed-out views per page, leaving the admins out', () => {
		const usage = sumPageUsage(
			'theleague',
			{
				'0001': [{ page: '/sunday-ticket', count: 40 }],
				'0002': [{ page: '/schefter/tip', count: 12 }],
				'0003': [{ page: '/schefter/tip', count: 5 }, { page: '/sunday-ticket', count: 1 }],
			},
			[{ page: '/theleague/schefter/tip', count: 3 }],
			['0001'],
		);
		expect(usage.get(key('/schefter/tip'))).toBe(20);
		expect(usage.get(key('/sunday-ticket'))).toBe(1);
	});

	it('folds a retired address into the page it moved to', () => {
		const usage = sumPageUsage('theleague', { '0002': [{ page: '/draft-room', count: 9 }] }, [
			{ page: '/draft/room', count: 1 },
		], []);
		expect(usage.get(key('/draft/room'))).toBe(10);
	});
});
