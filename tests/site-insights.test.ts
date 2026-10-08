/**
 * Site Insights (`/live/analytics`) — the pure model and the access gate.
 *
 * The gate is the one rule a regression would make public: the report names
 * every owner and what they open, and it is for ONE seat only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	buildInsightsReport,
	classifyLandingSource,
	insightClock,
	insightDates,
	normalizeInsightPath,
	parseInsightDevice,
	parseInsightsRange,
	resolveSection,
	isKnownAppPath,
	parseInsightLinkArea,
	type InsightDayRaw,
} from '../src/utils/site-insights-model';
import { getLeagueBySlug } from '../src/config/leagues';

const THELEAGUE = getLeagueBySlug('theleague')!;
const AFL = getLeagueBySlug('afl-fantasy')!;

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

describe('normalizeInsightPath', () => {
	it('strips query, hash and trailing slash', () => {
		expect(normalizeInsightPath('/rosters/?view=cards#top')).toBe('/rosters');
		expect(normalizeInsightPath('/')).toBe('/');
	});
	it('folds id-like segments so one page is one row', () => {
		expect(normalizeInsightPath('/live/league/12345')).toBe('/live/league/:id');
		expect(normalizeInsightPath('/players/0a1b2c3d4e5f6a7b8c9d')).toBe('/players/:id');
		expect(normalizeInsightPath('/draft/2026')).toBe('/draft/:id');
	});
	it('refuses anything that could corrupt a hash field', () => {
		expect(normalizeInsightPath('/a|b')).toBeNull();
		expect(normalizeInsightPath('rosters')).toBeNull();
		expect(normalizeInsightPath('/' + 'x'.repeat(200))).toBeNull();
		expect(normalizeInsightPath('/<script>')).toBeNull();
		expect(normalizeInsightPath(null)).toBeNull();
	});
});

describe('bounded vocabularies', () => {
	it('devices and ranges are allowlisted', () => {
		expect(parseInsightDevice('phone')).toBe('phone');
		expect(parseInsightDevice('toaster')).toBeNull();
		expect(parseInsightsRange('90')).toBe(90);
		expect(parseInsightsRange('3650')).toBe(30);
	});
	it('only a short fixed list of app paths may be named anonymously', () => {
		expect(isKnownAppPath('/live')).toBe(true);
		expect(isKnownAppPath('/live/league/:id')).toBe(true);
		expect(isKnownAppPath('/live/anything-else')).toBe(false);
	});
	it('a league slug wins; otherwise the path picks live vs site', () => {
		expect(resolveSection('afl-fantasy', '/live')).toBe('afl-fantasy');
		expect(resolveSection(null, '/live/settings')).toBe('live');
		expect(resolveSection(null, '/livestream')).toBe('site');
		expect(resolveSection(null, '/login')).toBe('site');
	});
});

describe('classifyLandingSource', () => {
	const base = { requestHost: 'www.theleague.us', srcTag: null, surface: 'browser' };
	it('the service worker tag beats any referrer', () => {
		expect(classifyLandingSource({ ...base, refHost: 'google.com', srcTag: 'push' })).toBe('push');
	});
	it('no referrer is direct, or the home-screen app when installed', () => {
		expect(classifyLandingSource({ ...base, refHost: '' })).toBe('direct');
		expect(classifyLandingSource({ ...base, refHost: '', surface: 'pwa' })).toBe('app');
	});
	it('our own hosts are internal, including the other league and the shared host', () => {
		expect(classifyLandingSource({ ...base, refHost: 'www.theleague.us' })).toBe('internal');
		expect(classifyLandingSource({ ...base, refHost: AFL.domains[0] })).toBe('internal');
		expect(classifyLandingSource({ ...base, refHost: 'mfl.football' })).toBe('internal');
	});
	it('names the outside sources it can', () => {
		expect(classifyLandingSource({ ...base, refHost: 'web.groupme.com' })).toBe('groupme');
		expect(classifyLandingSource({ ...base, refHost: 'www.google.com' })).toBe('search');
		expect(classifyLandingSource({ ...base, refHost: 'www.reddit.com' })).toBe('social');
		expect(classifyLandingSource({ ...base, refHost: 'example.org' })).toBe('other');
	});
});

describe('clock', () => {
	it('dates and hours are on the given zone, not UTC', () => {
		// 2026-09-28 03:30 UTC is 20:30 on the 27th in Pacific time.
		expect(insightClock(new Date('2026-09-28T03:30:00Z'), 'America/Los_Angeles')).toEqual({
			date: '2026-09-27',
			hour: 20,
		});
	});
	it('insightDates runs oldest first and ends today', () => {
		expect(insightDates('2026-03-01', 3)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
	});
});

describe('buildInsightsReport', () => {
	const a = `${THELEAGUE.id}:0001`;
	const b = `${AFL.id}:0001`;
	const days = [
		day('2026-09-20', {
			userSections: { [`${a}|theleague`]: 3, [`${b}|live`]: 2 },
			visitors: { 'anon|theleague': 4 },
			pages: { 'theleague|/rosters': 5, 'live|/live': 4 },
			userPages: { [`${a}|theleague|/rosters`]: 3, [`${b}|live|/live`]: 2 },
			hours: { 'theleague|10': 7, 'live|22': 2 },
			devices: { 'theleague|phone': 6, 'live|desktop': 3 },
			sources: { 'theleague|push': 1 },
			logins: { [a]: 1 },
			actions: { 'theleague|lineup_submit': 2, 'theleague|schefter_tip': 1 },
			userActions: { [`${a}|lineup_submit`]: 2 },
		}),
		day('2026-09-21', { userSections: { [`${a}|theleague`]: 1 } }),
	];

	it('keeps owners in different leagues with the same franchise id apart', () => {
		const r = buildInsightsReport({ days, people: [], section: null });
		expect(r.totals.owners).toBe(2);
		expect(r.totals.views).toBe(3 + 2 + 4 + 1);
		expect(r.totals.anonymousViews).toBe(4);
		expect(r.totals.logins).toBe(1);
		expect(r.days.map((d) => d.activeOwners)).toEqual([2, 1]);
	});

	it('ranks pages with distinct-owner reach', () => {
		const r = buildInsightsReport({ days, people: [], section: null });
		expect(r.pages[0]).toEqual({ section: 'theleague', page: '/rosters', views: 5, visitors: 1 });
	});

	it('a section filter narrows every figure', () => {
		const r = buildInsightsReport({ days, people: [], section: 'live' });
		expect(r.totals.views).toBe(2);
		expect(r.pages.map((p) => p.page)).toEqual(['/live']);
		expect(r.people.map((p) => p.key)).toEqual([b]);
		expect(r.devices).toEqual([{ key: 'desktop', label: 'Desktop', count: 3 }]);
	});

	it('heatmap files the hour under the date\'s weekday', () => {
		const r = buildInsightsReport({ days, people: [], section: null });
		// 2026-09-20 is a Sunday.
		expect(r.heatmap[0][10]).toBe(7);
		expect(r.heatmap[0][22]).toBe(2);
	});

	it('an anonymous action has a count but never an owner count', () => {
		const r = buildInsightsReport({ days, people: [], section: null });
		const tip = r.actions.find((x) => x.action === 'schefter_tip')!;
		expect(tip.count).toBe(1);
		expect(tip.owners).toBeNull();
		expect(r.actions.find((x) => x.action === 'lineup_submit')).toMatchObject({ count: 2, owners: 1 });
	});

	it('lists never-seen owners from the people list alongside active ones', () => {
		const ghost = { key: `${THELEAGUE.id}:0009`, leagueId: THELEAGUE.id, franchiseId: '0009', username: null, lastSeen: null, lastLogin: null };
		const r = buildInsightsReport({ days, people: [ghost], section: null });
		expect(r.people.map((p) => p.key)).toContain(ghost.key);
		expect(r.people.find((p) => p.key === a)!.topPages[0]).toEqual({ section: 'theleague', page: '/rosters', views: 3 });
	});
});

describe('link areas — how people get around', () => {
	it('accepts only the fixed areas', () => {
		expect(parseInsightLinkArea('mtw')).toBe('mtw');
		expect(parseInsightLinkArea('nav')).toBe('nav');
		expect(parseInsightLinkArea('header')).toBe('header');
		expect(parseInsightLinkArea('quick')).toBe('quick');
		expect(parseInsightLinkArea('evil|field')).toBeNull();
		expect(parseInsightLinkArea('constructor')).toBeNull();
		expect(parseInsightLinkArea(null)).toBeNull();
	});

	it('counts clicks, distinct owners and destinations per area, and honours the section filter', () => {
		const days = [
			day('2026-10-07', {
				links: {
					'theleague|mtw|/lineup': 3,
					'theleague|mtw|/players': 1,
					'afl-fantasy|mtw|/lineup': 2,
					'theleague|nav|-': 4,
				},
				userLinks: {
					'13522:0001|theleague|mtw': 3,
					'13522:0002|theleague|mtw': 1,
					'19621:0001|afl-fantasy|mtw': 2,
				},
			}),
		];
		const all = buildInsightsReport({ days, people: [], section: null });
		const mtw = all.links.find((l) => l.area === 'mtw')!;
		expect(mtw.clicks).toBe(6);
		expect(mtw.owners).toBe(3);
		expect(mtw.destinations[0]).toEqual({ section: 'theleague', page: '/lineup', clicks: 3 });
		// An unnameable page still counts as a click but never as a destination.
		const nav = all.links.find((l) => l.area === 'nav')!;
		expect(nav.clicks).toBe(4);
		expect(nav.destinations).toEqual([]);
		// Every area is listed, even at zero.
		expect(all.links.find((l) => l.area === 'quick')?.clicks).toBe(0);

		const tl = buildInsightsReport({ days, people: [], section: 'theleague' });
		expect(tl.links.find((l) => l.area === 'mtw')).toMatchObject({ clicks: 4, owners: 2 });
	});
});

describe('canViewSiteInsights — one seat only', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	async function gate() {
		return (await import('../src/utils/site-insights')).canViewSiteInsights;
	}

	it('TheLeague 0001 with the admin role gets in', async () => {
		const can = await gate();
		expect(can({ id: 'x', name: 'b', franchiseId: '0001', leagueId: THELEAGUE.id, role: 'admin' })).toBe(true);
	});

	it('the AFL franchise 0001 does not, even as admin', async () => {
		const can = await gate();
		expect(can({ id: 'x', name: 'b', franchiseId: '0001', leagueId: AFL.id, role: 'admin' })).toBe(false);
	});

	it('another TheLeague commissioner seat does not', async () => {
		const can = await gate();
		expect(can({ id: 'x', name: 'b', franchiseId: '0002', leagueId: THELEAGUE.id, role: 'commissioner' })).toBe(false);
	});

	it('signed out does not', async () => {
		const can = await gate();
		expect(can(null)).toBe(false);
	});
});
