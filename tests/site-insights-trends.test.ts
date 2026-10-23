/**
 * Site Insights trends (`/live/analytics`): lifecycle, personas, the depth
 * curve and cohorts, paths, the monthly rollup and window deltas. All pure.
 */
import { describe, it, expect } from 'vitest';
import {
	buildDepthAndCohorts,
	buildMonthRows,
	buildPaths,
	daysToRead,
	insightMonths,
	lifecycleStage,
	pageGroup,
	parseLifecycleStage,
	parsePersona,
	percentChange,
	personaOf,
	splitWindows,
	type InsightMonthRaw,
} from '../src/utils/site-insights-trends';
import { insightDates, type InsightDayRaw, type InsightPerson } from '../src/utils/site-insights-model';
import { getLeagueBySlug } from '../src/config/leagues';

const TL = getLeagueBySlug('theleague')!;
const DAY = 86_400_000;
const ZONE = 'America/Los_Angeles';

function day(date: string, partial: Partial<InsightDayRaw> = {}): InsightDayRaw {
	return {
		date,
		pages: {},
		visitors: {},
		hours: {},
		devices: {},
		sources: {},
		userPages: {},
		actions: {},
		userActions: {},
		logins: {},
		userSections: {},
		links: {},
		userLinks: {},
		...partial,
	};
}

function person(key: string, extra: Partial<InsightPerson> = {}): InsightPerson {
	const [leagueId, franchiseId] = key.split(':');
	return { key, leagueId, franchiseId, username: null, lastSeen: null, lastLogin: null, ...extra };
}

describe('lifecycleStage', () => {
	const now = Date.parse('2026-10-20T20:00:00Z');
	it('reads never, new, hooked, active, cooling and lapsed in that order', () => {
		expect(lifecycleStage({ lastSeen: null }, now)).toBe('never');
		expect(lifecycleStage({ lastSeen: now - DAY, firstSeen: now - 5 * DAY, recentDays: 6 }, now)).toBe('new');
		expect(lifecycleStage({ lastSeen: now - DAY, firstSeen: now - 60 * DAY, recentDays: 3 }, now)).toBe('hooked');
		expect(lifecycleStage({ lastSeen: now - DAY, firstSeen: now - 60 * DAY, recentDays: 1 }, now)).toBe('active');
		expect(lifecycleStage({ lastSeen: now - 12 * DAY, firstSeen: null }, now)).toBe('cooling');
		expect(lifecycleStage({ lastSeen: now - 45 * DAY, firstSeen: null }, now)).toBe('lapsed');
	});
	it('parses only known stages', () => {
		expect(parseLifecycleStage('hooked')).toBe('hooked');
		expect(parseLifecycleStage('toString')).toBeNull();
		expect(parseLifecycleStage(null)).toBeNull();
	});
});

describe('personas', () => {
	it('files a path under the first group it matches', () => {
		expect(pageGroup('/front-office/trade-builder')).toBe('trader');
		expect(pageGroup('/draft/order')).toBe('draft');
		expect(pageGroup('/rosters')).toBe('roster');
		expect(pageGroup('/live-scoring')).toBe('gameday');
		expect(pageGroup('/standings')).toBe('history');
		expect(pageGroup('/')).toBe('home');
		expect(pageGroup('/archies')).toBe('home');
	});
	it('a dominant group names the style; a spread is an all-rounder; light use a drop-in', () => {
		expect(personaOf([])).toBeNull();
		expect(personaOf([{ page: '/rosters', views: 3 }])).toBe('dropin');
		expect(personaOf([{ page: '/rosters', views: 8 }, { page: '/standings', views: 2 }])).toBe('roster');
		expect(
			personaOf([
				{ page: '/rosters', views: 3 },
				{ page: '/standings', views: 3 },
				{ page: '/news', views: 3 },
				{ page: '/draft', views: 3 },
			]),
		).toBe('mixed');
		expect(parsePersona('trader')).toBe('trader');
		expect(parsePersona('hasOwnProperty')).toBeNull();
	});
});

describe('buildDepthAndCohorts', () => {
	const a = `${TL.id}:0002`;
	const b = `${TL.id}:0003`;
	const dates = insightDates('2026-10-21', 21); // 2026-10-01 … 2026-10-21
	// Both first seen on Oct 1 (noon league time). A comes back in week 2 and
	// opens more pages; B never returns after week 1.
	const first = Date.parse('2026-10-01T19:00:00Z');
	const days = dates.map((date) => {
		const d = day(date);
		if (date === '2026-10-01') {
			d.userSections = { [`${a}|theleague`]: 2, [`${b}|theleague`]: 1 };
			d.userPages = { [`${a}|theleague|/rosters`]: 2, [`${b}|theleague|/`]: 1 };
		}
		if (date === '2026-10-09' || date === '2026-10-10') {
			d.userSections = { [`${a}|theleague`]: 3 };
			d.userPages = { [`${a}|theleague|/rosters`]: 1, [`${a}|theleague|/lineup`]: 1, [`${a}|theleague|/standings`]: 1 };
		}
		return d;
	});
	const people = [person(a, { firstSeen: first, lastSeen: first }), person(b, { firstSeen: first, lastSeen: first })];

	it('averages distinct pages per returning owner, week by week since first seen', () => {
		const { depth } = buildDepthAndCohorts({ days, people, section: null, zone: ZONE });
		expect(depth[0]).toEqual({ week: 0, eligible: 2, active: 2, avgPages: 1, avgDays: 1 });
		expect(depth[1]).toEqual({ week: 1, eligible: 2, active: 1, avgPages: 3, avgDays: 2 });
		expect(depth[2]).toMatchObject({ week: 2, eligible: 2, active: 0 });
		// Week 3 (Oct 22-28) is not over, so it is not shown at all.
		expect(depth).toHaveLength(3);
	});

	it('groups owners by the Monday of their first week and tracks who came back', () => {
		const { cohorts } = buildDepthAndCohorts({ days, people, section: null, zone: ZONE });
		expect(cohorts).toHaveLength(1);
		expect(cohorts[0].start).toBe('2026-09-28');
		expect(cohorts[0].size).toBe(2);
		expect(cohorts[0].retention.slice(0, 3)).toEqual([0.5, 0, null]);
	});

	it('an owner filter makes it that owner\'s own curve, and admins can be left out', () => {
		const own = buildDepthAndCohorts({ days, people, section: null, owner: b, zone: ZONE });
		expect(own.depth.map((w) => w.active)).toEqual([1, 0, 0]);
		const noA = buildDepthAndCohorts({ days, people, section: null, excludeOwners: new Set([a]), zone: ZONE });
		expect(noA.cohorts[0].size).toBe(1);
	});
});

describe('buildPaths', () => {
	const a = `${TL.id}:0002`;
	const admin = `${TL.id}:0001`;
	const days = [
		day('2026-10-20', {
			paths: {
				[`${a}|theleague|/|/rosters`]: 3,
				[`${admin}|theleague|/|/rosters`]: 5,
				[`${a}|theleague|/rosters|/lineup`]: 2,
				[`${a}|afl-fantasy|/|/standings`]: 1,
			},
		}),
	];
	it('sums steps and distinct owners, honoring every filter', () => {
		const all = buildPaths({ days, section: null });
		expect(all[0]).toEqual({ section: 'theleague', from: '/', to: '/rosters', steps: 8, owners: 2 });
		const noAdmin = buildPaths({ days, section: 'theleague', excludeOwners: new Set([admin]) });
		expect(noAdmin.map((p) => [p.to, p.steps])).toEqual([['/rosters', 3], ['/lineup', 2]]);
		const page = buildPaths({ days, section: null, page: { section: 'theleague', page: '/rosters' } });
		expect(page.map((p) => `${p.from}>${p.to}`)).toEqual(['/>/rosters', '/rosters>/lineup']);
	});
});

describe('monthly rollup', () => {
	const a = `${TL.id}:0002`;
	const c = `${TL.id}:0004`;
	const months: InsightMonthRaw[] = [
		{
			month: '2026-09',
			pages: {},
			userSections: { [`${a}|theleague`]: 10 },
			userPages: { [`${a}|theleague|/rosters`]: 10 },
			userDays: { [a]: 4 },
		},
		{
			month: '2026-10',
			pages: {},
			userSections: { [`${a}|theleague`]: 6, [`${c}|theleague`]: 2 },
			userPages: { [`${a}|theleague|/rosters`]: 4, [`${a}|theleague|/lineup`]: 2, [`${c}|theleague|/rosters`]: 2 },
			userDays: { [a]: 3, [c]: 1 },
		},
	];
	const people = [
		person(a, { firstSeen: Date.parse('2026-09-03T18:00:00Z') }),
		person(c, { firstSeen: Date.parse('2026-10-05T18:00:00Z') }),
	];

	it('lists the months ending with today\'s, oldest first, across a year boundary', () => {
		expect(insightMonths('2027-02-14', 4)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
	});

	it('counts views, owners, new owners, average days and pages per month', () => {
		const rows = buildMonthRows({ months, people, section: null, zone: ZONE });
		expect(rows).toEqual([
			{ month: '2026-09', views: 10, owners: 1, newOwners: 1, avgDays: 4, pages: 1 },
			{ month: '2026-10', views: 8, owners: 2, newOwners: 1, avgDays: 2, pages: 2 },
		]);
	});

	it('a page filter counts that page alone', () => {
		const rows = buildMonthRows({ months, people, section: null, page: { section: 'theleague', page: '/rosters' }, zone: ZONE });
		expect(rows.map((r) => [r.views, r.owners, r.avgDays])).toEqual([[10, 1, null], [6, 2, null]]);
	});
});

describe('window deltas', () => {
	it('reads twice the window when the daily hashes hold it', () => {
		expect(daysToRead(7, 90)).toBe(14);
		expect(daysToRead(30, 90)).toBe(60);
		expect(daysToRead(90, 90)).toBe(90);
	});
	it('splits a doubled read into previous and current', () => {
		expect(splitWindows([1, 2, 3, 4], 2)).toEqual({ previous: [1, 2], current: [3, 4] });
		expect(splitWindows([1, 2], 2)).toEqual({ previous: null, current: [1, 2] });
	});
	it('percent change has no answer against nothing', () => {
		expect(percentChange(12, 10)).toBe(20);
		expect(percentChange(5, 10)).toBe(-50);
		expect(percentChange(5, 0)).toBeNull();
	});
});
