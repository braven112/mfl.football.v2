import { describe, it, expect } from 'vitest';
import {
	ANON_PAGEVIEW_FIELD,
	buildEngagementRows,
	buildPageInsights,
	canonicalPath,
	isDirectoryPath,
	sortEngagement,
	summarizeTraffic,
	type DailyPageViews,
} from '../src/utils/site-analytics';

/**
 * The Owner Activity page's analytics half.
 *
 * Every number on that page beyond the raw counters is computed here, and two
 * of the derivations exist because the raw counters LIE if read naively:
 *
 *   - the daily pageview hash carries signed-out traffic in a reserved field
 *     alongside the franchises, so anything that sums or counts its fields
 *     without excluding that field reports a phantom 25th owner; and
 *   - the same page is recorded under two or three different paths depending
 *     on which host the visitor was on, so a raw group-by splits one page
 *     into rows that each look unpopular.
 */

function daily(rows: Record<string, Record<string, number>>): DailyPageViews {
	return { dates: Object.keys(rows), data: rows };
}

describe('summarizeTraffic', () => {
	it('separates signed-out traffic from the owners, and never counts it as one', () => {
		const pv = daily({
			'2026-09-01': { '0001': 4, '0002': 2, [ANON_PAGEVIEW_FIELD]: 10 },
			'2026-09-02': { '0001': 1 },
		});
		const out = summarizeTraffic(pv);

		expect(out.days[0]).toEqual({
			date: '2026-09-01',
			signedIn: 6,
			anonymous: 10,
			total: 16,
			activeOwners: 2,
		});
		expect(out.signedInViews).toBe(7);
		expect(out.anonymousViews).toBe(10);
		expect(out.totalViews).toBe(17);
		expect(out.anonymousShare).toBe(59);
		expect(out.ownersSeen).toBe(2);
	});

	it('keeps empty days in the series rather than compressing the window', () => {
		const out = summarizeTraffic(
			daily({ '2026-09-01': { '0001': 3 }, '2026-09-02': {}, '2026-09-03': { '0001': 3 } }),
		);
		expect(out.days.map((d) => d.total)).toEqual([3, 0, 3]);
		expect(out.avgPerDay).toBe(2);
		expect(out.avgActiveOwners).toBe(0.7);
	});

	it('reports no busiest day when nothing was ever recorded', () => {
		expect(summarizeTraffic(daily({ '2026-09-01': {} })).busiest).toBeNull();
	});
});

describe('buildEngagementRows', () => {
	const teams = [
		{ franchiseId: '0001', name: 'Pigskins', icon: '' },
		{ franchiseId: '0002', name: 'Ninjas', icon: '' },
	];

	it('counts active days, streaks and share of the owners-only total', () => {
		const pv = daily({
			'2026-09-01': { '0001': 2, '0002': 1, [ANON_PAGEVIEW_FIELD]: 99 },
			'2026-09-02': { '0001': 3 },
			'2026-09-03': { '0001': 5 },
		});
		const [pigskins, ninjas] = buildEngagementRows(teams, pv);

		expect(pigskins.views).toBe(10);
		expect(pigskins.activeDays).toBe(3);
		expect(pigskins.windowDays).toBe(3);
		expect(pigskins.currentStreak).toBe(3);
		expect(pigskins.longestStreak).toBe(3);
		expect(pigskins.bestDay).toBe(5);
		// Signed-out views are not part of the denominator — 10 of 11, not 10 of 110.
		expect(pigskins.share).toBe(91);
		expect(ninjas.share).toBe(9);
	});

	it('lets a streak end yesterday, because today is always partial', () => {
		const pv = daily({
			'2026-09-01': { '0001': 1 },
			'2026-09-02': { '0001': 1 },
			'2026-09-03': {},
		});
		expect(buildEngagementRows(teams, pv)[0].currentStreak).toBe(2);
	});

	it('does not resurrect a streak that ended before yesterday', () => {
		const pv = daily({
			'2026-09-01': { '0001': 1 },
			'2026-09-02': {},
			'2026-09-03': {},
		});
		expect(buildEngagementRows(teams, pv)[0].currentStreak).toBe(0);
	});

	it('sorts busiest owner first', () => {
		const pv = daily({ '2026-09-01': { '0001': 1, '0002': 9 } });
		expect(sortEngagement(buildEngagementRows(teams, pv)).map((r) => r.franchiseId)).toEqual([
			'0002',
			'0001',
		]);
	});
});

describe('canonicalPath', () => {
	it('folds every host-dependent spelling of a page onto one key', () => {
		// Apex host (tracker records a bare path), shared preview domain, and the
		// directory's own prefixed entry all name the same page.
		const forms = ['/rosters', '/theleague/rosters', '/rosters/', '/rosters?view=planner'];
		const canonical = forms.map((p) => canonicalPath(p, 'theleague'));
		expect(new Set(canonical).size).toBe(1);
	});

	it('keeps the two leagues apart', () => {
		expect(canonicalPath('/rosters', 'afl-fantasy')).not.toBe(
			canonicalPath('/rosters', 'theleague'),
		);
	});
});

describe('isDirectoryPath', () => {
	it('accepts a page the league has', () => {
		expect(isDirectoryPath('/rosters', 'theleague')).toBe(true);
		expect(isDirectoryPath('/afl-fantasy/rosters', 'afl-fantasy')).toBe(true);
	});

	it('rejects anything the directory does not name — the bound on a public counter', () => {
		expect(isDirectoryPath('/not-a-page', 'theleague')).toBe(false);
		expect(isDirectoryPath('/../etc/passwd', 'theleague')).toBe(false);
		expect(isDirectoryPath(`/${'x'.repeat(500)}`, 'theleague')).toBe(false);
	});

	it("rejects the other league's page", () => {
		expect(isDirectoryPath('/afl-fantasy/keepers', 'theleague')).toBe(false);
	});
});

describe('buildPageInsights', () => {
	const insights = () =>
		buildPageInsights({
			league: 'theleague',
			globalPages: [
				{ page: '/rosters', count: 100 },
				// The same page as recorded from the other host shape.
				{ page: '/theleague/rosters', count: 20 },
				{ page: '/standings', count: 30 },
			],
			anonPages: [{ page: '/standings', count: 45 }],
			ownerPages: {
				'0001': [{ page: '/rosters', count: 60 }],
				'0002': [{ page: '/rosters', count: 60 }],
				'0003': [{ page: '/standings', count: 30 }],
			},
		});

	it('merges the host-dependent spellings into one row', () => {
		const rosters = insights().pages.find((p) => p.title.toLowerCase().includes('roster'));
		expect(rosters?.views).toBe(120);
	});

	it('counts reach as owners, not views — the half the ranking hides', () => {
		const { pages } = insights();
		const rosters = pages.find((p) => p.path.endsWith('/rosters'));
		const standings = pages.find((p) => p.path.endsWith('/standings'));
		expect(rosters?.reach).toBe(2);
		expect(standings?.reach).toBe(1);
	});

	it('keeps signed-out views separate from the owners', () => {
		const standings = insights().pages.find((p) => p.path.endsWith('/standings'));
		expect(standings).toMatchObject({ signedIn: 30, anonymous: 45, views: 75 });
	});

	it('names pages from the directory rather than the raw path', () => {
		expect(insights().pages.every((p) => !p.title.startsWith('/'))).toBe(true);
	});

	it('lists the league\'s unvisited pages, and never another league\'s', () => {
		const { quiet, visitedPages, directoryPages } = insights();
		expect(quiet.length).toBeGreaterThan(0);
		expect(quiet.some((q) => q.href.includes('/afl-fantasy/'))).toBe(false);
		expect(visitedPages).toBe(directoryPages - quiet.length);
	});

	it('never calls a page quiet just because a ?view= variant exists', () => {
		// /rosters?view=planner is a directory entry that can never be recorded
		// separately — the tracker strips the query — so it must not sit in the
		// quiet list forever.
		expect(insights().quiet.some((q) => q.href.includes('?'))).toBe(false);
	});

	it('rolls views up by category', () => {
		const { categories } = insights();
		expect(categories.length).toBeGreaterThan(0);
		expect(categories.reduce((s, c) => s + c.share, 0)).toBeGreaterThanOrEqual(99);
	});
});
