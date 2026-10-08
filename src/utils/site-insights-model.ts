/**
 * Site Insights — the admin-only, site-wide analytics behind `/live/analytics`.
 *
 * This module is the PURE half: the vocabularies, the validators that bound
 * every client-supplied value, and the report derivation. It does no I/O, so
 * it is tested without Redis. The counters live in `site-insights.ts`.
 *
 * WHY A SECOND SET OF COUNTERS, NOT MORE FIELDS ON `owner-activity`'s. Those
 * are per-league and back the public `/activity` page, which keeps its own
 * numbers. Insights are cross-league (TheLeague, the AFL, Best Ball, MFL Live
 * and the shared host's own pages in ONE report), daily rather than lifetime,
 * and carry dimensions `/activity` does not: device, hour of day, landing
 * source, logins and in-app actions. Everything here expires after
 * `INSIGHTS_TTL_DAYS`.
 *
 * EVERY HASH FIELD IS BOUNDED. The beacon endpoint accepts anonymous callers,
 * so a field name built from a raw client string would let anyone grow a hash
 * one invented value at a time. Device, source, section and action are fixed
 * vocabularies; an anonymous page is recorded only when it is a known route;
 * a signed-in page is sanitized (`normalizeInsightPath`) and belongs to an
 * authenticated owner.
 */

import { ALL_LEAGUES, isSharedAppHost } from '../config/leagues';

/** Days every daily insights hash is kept. */
export const INSIGHTS_TTL_DAYS = 90;
export const INSIGHTS_TTL_SECONDS = INSIGHTS_TTL_DAYS * 86_400;

/** The report's selectable windows. */
export const INSIGHTS_RANGES = [7, 30, 90] as const;
export type InsightsRange = (typeof INSIGHTS_RANGES)[number];

export function parseInsightsRange(raw: string | null | undefined): InsightsRange {
	const n = Number(raw);
	return (INSIGHTS_RANGES as readonly number[]).includes(n) ? (n as InsightsRange) : 30;
}

// ── Sections ────────────────────────────────────────────────────────────────

/**
 * Where on the site a view happened: a registry league's own pages (its
 * slug), MFL Live (`live`), or the shared host's pages outside both
 * (`site` — the splash and the app's sign-in).
 */
export const APP_SECTIONS = ['live', 'site'] as const;

export function insightSections(): string[] {
	return [...ALL_LEAGUES.map((l) => l.slug), ...APP_SECTIONS];
}

export function sectionLabel(section: string): string {
	if (section === 'live') return 'MFL Live';
	if (section === 'site') return 'Sign-in & splash';
	return ALL_LEAGUES.find((l) => l.slug === section)?.name ?? section;
}

/**
 * The section a beacon belongs to. `leagueSlug` is the registry league the
 * page itself resolved (already validated by the caller); without one, the
 * path decides between MFL Live and the shared host's own pages.
 */
export function resolveSection(leagueSlug: string | null, page: string): string {
	if (leagueSlug) return leagueSlug;
	return page === '/live' || page.startsWith('/live/') ? 'live' : 'site';
}

// ── Devices ─────────────────────────────────────────────────────────────────

export const INSIGHT_DEVICES = ['phone', 'tablet', 'desktop'] as const;
export type InsightDevice = (typeof INSIGHT_DEVICES)[number];

export const DEVICE_LABELS: Record<InsightDevice, string> = {
	phone: 'Phone',
	tablet: 'Tablet',
	desktop: 'Desktop',
};

export function parseInsightDevice(raw: string | null | undefined): InsightDevice | null {
	return (INSIGHT_DEVICES as readonly string[]).includes(raw ?? '') ? (raw as InsightDevice) : null;
}

// ── Landing sources ─────────────────────────────────────────────────────────

export const INSIGHT_SOURCES = [
	'direct',
	'app',
	'push',
	'groupme',
	'search',
	'social',
	'internal',
	'other',
] as const;
export type InsightSource = (typeof INSIGHT_SOURCES)[number];

export const SOURCE_LABELS: Record<InsightSource, string> = {
	direct: 'Direct / bookmark',
	app: 'Home-screen app',
	push: 'Push notification',
	groupme: 'GroupMe',
	search: 'Search engine',
	social: 'Social',
	internal: 'Another league site',
	other: 'Other website',
};

const SEARCH_HOSTS = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|startpage|baidu|yandex)\./i;
const SOCIAL_HOSTS = /(^|\.)(facebook|fb|twitter|x|t|instagram|reddit|threads|linkedin|discord)\.(com|co|net|gg)$/i;

/**
 * Classify a tab's LANDING (its first beacon), from the referrer's host only —
 * the client never sends a full referrer URL — plus the `src` tag the service
 * worker puts on a notification click.
 *
 * The GroupMe mobile app sends no referrer, so its links land as `direct`;
 * only GroupMe's web client is attributable. That is a limit of the platform,
 * not a bug to fix here.
 */
export function classifyLandingSource(input: {
	refHost: string | null | undefined;
	requestHost: string;
	srcTag: string | null | undefined;
	surface: string | null | undefined;
}): InsightSource {
	if (input.srcTag === 'push') return 'push';
	const ref = (input.refHost ?? '').trim().toLowerCase();
	if (!ref) return input.surface === 'pwa' ? 'app' : 'direct';
	const host = input.requestHost.toLowerCase();
	if (ref === host || isSharedAppHost(ref)) return 'internal';
	const ours = ALL_LEAGUES.some((l) =>
		[...l.domains, ...(l.stagingDomains ?? [])].some((d) => d.toLowerCase() === ref),
	);
	if (ours || ref.endsWith('.vercel.app')) return 'internal';
	if (ref.includes('groupme')) return 'groupme';
	if (SEARCH_HOSTS.test(ref)) return 'search';
	if (SOCIAL_HOSTS.test(ref)) return 'social';
	return 'other';
}

// ── Actions ─────────────────────────────────────────────────────────────────

/**
 * In-app actions, recorded server-side at each endpoint's success point (so a
 * click that failed is never counted). Adding one: add it here, then call
 * `recordInsightAction` where the endpoint has definitely succeeded.
 */
export const INSIGHT_ACTIONS = {
	lineup_submit: 'Lineup submitted',
	trade_offer: 'Trade offer sent',
	trade_response: 'Trade offer answered',
	waiver_claim: 'Waiver / free-agent claim',
	contract_declare: 'Contract declared',
	poll_vote: "Owners' Poll ballot cast",
	schefter_tip: 'Schefter tip sent',
	suggestion_post: 'Idea posted to the Board',
	watch_list: 'Watch list changed',
} as const;
export type InsightAction = keyof typeof INSIGHT_ACTIONS;

/**
 * Actions counted WITHOUT the owner. A Schefter tip is promised anonymous —
 * `schefter/tip.ts` never persists who sent one — so the report may say how
 * many tips arrived, never whose.
 */
export const ANONYMOUS_INSIGHT_ACTIONS: ReadonlySet<InsightAction> = new Set(['schefter_tip']);

export function isInsightAction(raw: string): raw is InsightAction {
	return Object.prototype.hasOwnProperty.call(INSIGHT_ACTIONS, raw);
}

// ── Link areas ──────────────────────────────────────────────────────────────

/**
 * Which part of the site an in-site click came from. A page view says where
 * an owner WENT; this says how they got there, so a navigation change can be
 * measured (Oct 2026: the homepage My Team card shortcuts vs the nav menu,
 * the header icons and the quick links). The client tags a click by the nearest `data-track-via`
 * ancestor and the NEXT page's beacon carries it, so only clicks that
 * actually arrived are counted. Adding an area: add it here and put
 * `data-track-via="<key>"` on its root element.
 */
export const INSIGHT_LINK_AREAS = {
	mtw: 'My Team card',
	nav: 'Nav menu',
	header: 'Header icons & search',
	quick: 'Quick links',
} as const;
export type InsightLinkArea = keyof typeof INSIGHT_LINK_AREAS;

export function parseInsightLinkArea(raw: string | null | undefined): InsightLinkArea | null {
	return raw && Object.prototype.hasOwnProperty.call(INSIGHT_LINK_AREAS, raw) ? (raw as InsightLinkArea) : null;
}

// ── Paths ───────────────────────────────────────────────────────────────────

const MAX_PATH_LENGTH = 100;

/**
 * Canonical page path for a hash field: no query or hash, no trailing slash,
 * and id-like segments (digits, long hex) folded to `:id` so
 * `/live/league/12345` and `/live/league/67890` are one page. Returns null for
 * anything that is not a plain path — a field separator (`|`) or other
 * punctuation in a field name would corrupt every reader.
 */
export function normalizeInsightPath(raw: string | null | undefined): string | null {
	if (!raw) return null;
	// Reject an oversized value before doing any work on it: this runs on an
	// unauthenticated endpoint ahead of its rate limit.
	if (String(raw).length > MAX_PATH_LENGTH * 4) return null;
	let path = String(raw).split(/[?#]/)[0].trim();
	if (!path.startsWith('/')) return null;
	if (path.length > 1) path = path.replace(/\/+$/, '');
	path = path
		.split('/')
		.map((seg) => (/^\d{3,}$/.test(seg) || /^[0-9a-f]{16,}$/i.test(seg) ? ':id' : seg))
		.join('/');
	if (path.length > MAX_PATH_LENGTH) return null;
	if (!/^[A-Za-z0-9/_\-.:]*$/.test(path)) return null;
	return path || '/';
}

/**
 * Routes an ANONYMOUS beacon may name on the app sections. League sections use
 * the page directory instead (see `track-visit`). A short, fixed list is the
 * whole bound on this hash for signed-out traffic.
 */
const KNOWN_APP_PATHS = new Set(['/', '/live', '/live/league/:id', '/live/settings', '/login']);

export function isKnownAppPath(path: string): boolean {
	return KNOWN_APP_PATHS.has(path);
}

// ── Clock ───────────────────────────────────────────────────────────────────

export interface InsightClockStamp {
	/** YYYY-MM-DD in the given zone. */
	date: string;
	/** 0-23 in the given zone. */
	hour: number;
}

export function insightClock(now: Date, zone: string): InsightClockStamp {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(now);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
	return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

/** The `count` calendar dates ending at `today`, oldest first. */
export function insightDates(today: string, count: number): string[] {
	const [y, m, d] = today.split('-').map(Number);
	const base = Date.UTC(y, m - 1, d);
	const out: string[] = [];
	for (let i = count - 1; i >= 0; i--) {
		out.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
	}
	return out;
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// ── Visitors ────────────────────────────────────────────────────────────────

/**
 * An owner's identity in these counters: league id + franchise id. Both are
 * needed — every league has a franchise 0001.
 */
export function visitorKey(leagueId: string, franchiseId: string): string {
	return `${leagueId}:${franchiseId}`;
}

export function parseVisitorKey(key: string): { leagueId: string; franchiseId: string } | null {
	const i = key.indexOf(':');
	if (i <= 0 || i === key.length - 1) return null;
	return { leagueId: key.slice(0, i), franchiseId: key.slice(i + 1) };
}

// ── Report ──────────────────────────────────────────────────────────────────

/** One day of raw hashes, as `readInsightDays` returns them. */
export interface InsightDayRaw {
	date: string;
	/** `<section>|<page>` → views */
	pages: Record<string, number>;
	/** `<visitorKey>` or `anon|<section>` → views */
	visitors: Record<string, number>;
	/** `<section>|<hour>` → views */
	hours: Record<string, number>;
	/** `<section>|<device>` → views */
	devices: Record<string, number>;
	/** `<section>|<source>` → landings */
	sources: Record<string, number>;
	/** `<visitorKey>|<section>|<page>` → views */
	userPages: Record<string, number>;
	/** `<section>|<action>` → count */
	actions: Record<string, number>;
	/** `<visitorKey>|<action>` → count */
	userActions: Record<string, number>;
	/** `<visitorKey>` → logins */
	logins: Record<string, number>;
	/** `<visitorKey>|<section>` → views (which sections each owner used) */
	userSections: Record<string, number>;
	/** `<section>|<area>|<page>` → arrivals by an in-site link (page `-` = unnamed) */
	links: Record<string, number>;
	/** `<visitorKey>|<section>|<area>` → arrivals */
	userLinks: Record<string, number>;
}

export interface InsightPerson {
	key: string;
	leagueId: string;
	franchiseId: string;
	username: string | null;
	lastSeen: number | null;
	lastLogin: number | null;
}

export interface InsightsInput {
	days: InsightDayRaw[];
	people: InsightPerson[];
	/** Restrict every figure to one section, or null for the whole site. */
	section: string | null;
}

export interface CountRow {
	key: string;
	label: string;
	count: number;
}

export interface PageInsightRow {
	section: string;
	page: string;
	views: number;
	visitors: number;
}

export interface DayInsightRow {
	date: string;
	views: number;
	anonymousViews: number;
	activeOwners: number;
	logins: number;
}

export interface PersonInsightRow extends InsightPerson {
	views: number;
	logins: number;
	activeDays: number;
	actions: number;
	topPages: { section: string; page: string; views: number }[];
	sections: string[];
}

export interface ActionInsightRow {
	action: InsightAction;
	label: string;
	count: number;
	/** Distinct owners; null for an action counted anonymously. */
	owners: number | null;
}

export interface LinkAreaInsightRow {
	area: InsightLinkArea;
	label: string;
	clicks: number;
	/** Distinct signed-in owners who used it. */
	owners: number;
	/** Where those clicks went, most first. */
	destinations: { section: string; page: string; clicks: number }[];
}

export interface InsightsReport {
	totals: {
		views: number;
		signedInViews: number;
		anonymousViews: number;
		owners: number;
		logins: number;
		actions: number;
		avgDailyOwners: number;
		/** Distinct owners active in the last 7 days of the window. */
		weeklyOwners: number;
	};
	days: DayInsightRow[];
	pages: PageInsightRow[];
	sections: CountRow[];
	devices: CountRow[];
	sources: CountRow[];
	/** [weekday 0-6][hour 0-23] → views */
	heatmap: number[][];
	actions: ActionInsightRow[];
	links: LinkAreaInsightRow[];
	people: PersonInsightRow[];
}

function splitField(field: string, parts: number): string[] | null {
	const out = field.split('|');
	return out.length === parts ? out : null;
}

const add = (map: Map<string, number>, key: string, n: number) =>
	map.set(key, (map.get(key) ?? 0) + n);

/**
 * Derive the whole dashboard from the raw daily hashes. Pure — every number
 * the page prints comes from here.
 */
export function buildInsightsReport(input: InsightsInput): InsightsReport {
	const { section } = input;
	const inSection = (s: string) => section === null || s === section;

	const pageViews = new Map<string, number>();
	const pageVisitors = new Map<string, Set<string>>();
	const sectionViews = new Map<string, number>();
	const deviceViews = new Map<string, number>();
	const sourceViews = new Map<string, number>();
	const actionCounts = new Map<string, number>();
	const actionOwners = new Map<string, Set<string>>();
	const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
	const linkClicks = new Map<string, number>();
	const linkPages = new Map<string, Map<string, number>>();
	const linkOwners = new Map<string, Set<string>>();

	const personViews = new Map<string, number>();
	const personLogins = new Map<string, number>();
	const personDays = new Map<string, number>();
	const personActions = new Map<string, number>();
	const personPages = new Map<string, Map<string, number>>();
	const personSections = new Map<string, Set<string>>();

	const days: DayInsightRow[] = [];
	const allOwners = new Set<string>();
	const weekOwners = new Set<string>();
	const weekStart = Math.max(0, input.days.length - 7);

	input.days.forEach((day, dayIndex) => {
		const dayOwners = new Set<string>();
		let views = 0;
		let anonymousViews = 0;
		let logins = 0;

		// Per-owner views come from userSections so a section filter applies;
		// anonymous views from the visitors hash's `anon|<section>` fields.
		for (const [field, n] of Object.entries(day.userSections)) {
			const parts = splitField(field, 2);
			if (!parts || !inSection(parts[1])) continue;
			const [key] = parts;
			views += n;
			dayOwners.add(key);
			add(personViews, key, n);
			let set = personSections.get(key);
			if (!set) personSections.set(key, (set = new Set()));
			set.add(parts[1]);
		}
		for (const [field, n] of Object.entries(day.visitors)) {
			const parts = splitField(field, 2);
			if (!parts || parts[0] !== 'anon' || !inSection(parts[1])) continue;
			views += n;
			anonymousViews += n;
		}

		for (const key of dayOwners) {
			allOwners.add(key);
			add(personDays, key, 1);
			if (dayIndex >= weekStart) weekOwners.add(key);
		}

		// Logins are site-wide events with no section of their own.
		if (section === null) {
			for (const [key, n] of Object.entries(day.logins)) {
				logins += n;
				add(personLogins, key, n);
			}
		}

		for (const [field, n] of Object.entries(day.pages)) {
			const parts = splitField(field, 2);
			if (!parts || !inSection(parts[0])) continue;
			add(pageViews, field, n);
			add(sectionViews, parts[0], n);
		}
		for (const [field, n] of Object.entries(day.userPages)) {
			const parts = splitField(field, 3);
			if (!parts || !inSection(parts[1])) continue;
			const pageKey = `${parts[1]}|${parts[2]}`;
			let set = pageVisitors.get(pageKey);
			if (!set) pageVisitors.set(pageKey, (set = new Set()));
			set.add(parts[0]);
			let mine = personPages.get(parts[0]);
			if (!mine) personPages.set(parts[0], (mine = new Map()));
			add(mine, pageKey, n);
		}

		const weekday = weekdayOf(day.date);
		for (const [field, n] of Object.entries(day.hours)) {
			const parts = splitField(field, 2);
			if (!parts || !inSection(parts[0])) continue;
			const hour = Number(parts[1]);
			if (Number.isInteger(hour) && hour >= 0 && hour < 24) heatmap[weekday][hour] += n;
		}
		for (const [field, n] of Object.entries(day.devices)) {
			const parts = splitField(field, 2);
			if (parts && inSection(parts[0])) add(deviceViews, parts[1], n);
		}
		for (const [field, n] of Object.entries(day.sources)) {
			const parts = splitField(field, 2);
			if (parts && inSection(parts[0])) add(sourceViews, parts[1], n);
		}
		for (const [field, n] of Object.entries(day.actions)) {
			const parts = splitField(field, 2);
			if (parts && inSection(parts[0])) add(actionCounts, parts[1], n);
		}
		for (const [field, n] of Object.entries(day.userActions)) {
			const parts = splitField(field, 2);
			if (!parts) continue;
			// userActions carries no section; under a section filter only the
			// owner set is shown, which is still the right "who" for that action.
			let set = actionOwners.get(parts[1]);
			if (!set) actionOwners.set(parts[1], (set = new Set()));
			set.add(parts[0]);
			if (section === null) add(personActions, parts[0], n);
		}

		for (const [field, n] of Object.entries(day.links ?? {})) {
			const parts = splitField(field, 3);
			if (!parts || !inSection(parts[0])) continue;
			add(linkClicks, parts[1], n);
			if (parts[2] === '-') continue;
			let pagesFor = linkPages.get(parts[1]);
			if (!pagesFor) linkPages.set(parts[1], (pagesFor = new Map()));
			add(pagesFor, `${parts[0]}|${parts[2]}`, n);
		}
		for (const field of Object.keys(day.userLinks ?? {})) {
			const parts = splitField(field, 3);
			if (!parts || !inSection(parts[1])) continue;
			let set = linkOwners.get(parts[2]);
			if (!set) linkOwners.set(parts[2], (set = new Set()));
			set.add(parts[0]);
		}

		days.push({ date: day.date, views, anonymousViews, activeOwners: dayOwners.size, logins });
	});

	const totalViews = days.reduce((s, d) => s + d.views, 0);
	const anonymousViews = days.reduce((s, d) => s + d.anonymousViews, 0);

	const pages: PageInsightRow[] = [...pageViews.entries()]
		.map(([field, views]) => {
			const [s, page] = field.split('|');
			return { section: s, page, views, visitors: pageVisitors.get(field)?.size ?? 0 };
		})
		.sort((a, b) => b.views - a.views || a.page.localeCompare(b.page));

	const toRows = (map: Map<string, number>, label: (k: string) => string): CountRow[] =>
		[...map.entries()]
			.filter(([, n]) => n > 0)
			.map(([key, count]) => ({ key, label: label(key), count }))
			.sort((a, b) => b.count - a.count);

	const actions: ActionInsightRow[] = (Object.keys(INSIGHT_ACTIONS) as InsightAction[])
		.map((action) => ({
			action,
			label: INSIGHT_ACTIONS[action],
			count: actionCounts.get(action) ?? 0,
			owners: ANONYMOUS_INSIGHT_ACTIONS.has(action) ? null : (actionOwners.get(action)?.size ?? 0),
		}))
		.sort((a, b) => b.count - a.count);

	// Every area is listed, even at zero: "nobody used the card" is the answer
	// the section exists to give.
	const links: LinkAreaInsightRow[] = (Object.keys(INSIGHT_LINK_AREAS) as InsightLinkArea[])
		.map((area) => ({
			area,
			label: INSIGHT_LINK_AREAS[area],
			clicks: linkClicks.get(area) ?? 0,
			owners: linkOwners.get(area)?.size ?? 0,
			destinations: [...(linkPages.get(area) ?? new Map<string, number>()).entries()]
				.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
				.slice(0, 8)
				.map(([field, clicks]) => {
					const [s, page] = field.split('|');
					return { section: s, page, clicks };
				}),
		}))
		.sort((a, b) => b.clicks - a.clicks);

	// Every person the counters know, plus anyone active in the window.
	const byKey = new Map(input.people.map((p) => [p.key, p]));
	for (const key of allOwners) {
		if (byKey.has(key)) continue;
		const parsed = parseVisitorKey(key);
		if (!parsed) continue;
		byKey.set(key, { key, ...parsed, username: null, lastSeen: null, lastLogin: null });
	}

	const people: PersonInsightRow[] = [...byKey.values()]
		.filter((p) => section === null || personSections.get(p.key)?.has(section))
		.map((p) => {
			const pagesFor = personPages.get(p.key);
			const topPages = pagesFor
				? [...pagesFor.entries()]
						.sort((a, b) => b[1] - a[1])
						.slice(0, 5)
						.map(([field, views]) => {
							const [s, page] = field.split('|');
							return { section: s, page, views };
						})
				: [];
			return {
				...p,
				views: personViews.get(p.key) ?? 0,
				logins: personLogins.get(p.key) ?? 0,
				activeDays: personDays.get(p.key) ?? 0,
				actions: personActions.get(p.key) ?? 0,
				topPages,
				sections: [...(personSections.get(p.key) ?? [])].sort(),
			};
		})
		.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0) || b.views - a.views);

	const activeDayCount = days.length || 1;
	return {
		totals: {
			views: totalViews,
			signedInViews: totalViews - anonymousViews,
			anonymousViews,
			owners: allOwners.size,
			logins: days.reduce((s, d) => s + d.logins, 0),
			actions: [...actionCounts.values()].reduce((s, n) => s + n, 0),
			avgDailyOwners:
				Math.round((days.reduce((s, d) => s + d.activeOwners, 0) / activeDayCount) * 10) / 10,
			weeklyOwners: weekOwners.size,
		},
		days,
		pages,
		sections: toRows(sectionViews, sectionLabel),
		devices: toRows(deviceViews, (k) => DEVICE_LABELS[k as InsightDevice] ?? k),
		sources: toRows(sourceViews, (k) => SOURCE_LABELS[k as InsightSource] ?? k),
		heatmap,
		actions,
		links,
		people,
	};
}

// ── Access ──────────────────────────────────────────────────────────────────

/**
 * The one franchise allowed to read the report: TheLeague's commissioner
 * seat. Named here, once, so the page and any future API share one answer.
 */
export const INSIGHTS_OWNER = { leagueSlug: 'theleague', franchiseId: '0001' } as const;

// ── Preview data ────────────────────────────────────────────────────────────

/**
 * Deterministic sample data for `?mock` — lets the dashboard be designed and
 * screenshotted before (or without) real traffic. Never written anywhere.
 */
export function mockInsights(
	dates: string[],
	owners: { key: string; section: string }[],
): { days: InsightDayRaw[]; people: InsightPerson[] } {
	let seed = 42;
	const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
	let linkSeed = 7;
	const linkRand = () => ((linkSeed = (linkSeed * 16807) % 2147483647) - 1) / 2147483646;
	const pages = ['/', '/rosters', '/standings', '/lineup', '/players', '/trade-builder', '/schefter'];
	const now = Date.now();
	const days: InsightDayRaw[] = dates.map((date) => {
		const day: InsightDayRaw = {
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
		};
		const bump = (map: Record<string, number>, k: string, n = 1) => (map[k] = (map[k] ?? 0) + n);
		const sunday = weekdayOf(date) === 0;
		owners.forEach((o, i) => {
			if (rand() > (i % 4 === 0 ? 0.9 : 0.45)) return;
			const views = 1 + Math.floor(rand() * (sunday ? 14 : 6));
			for (let v = 0; v < views; v++) {
				const page = pages[Math.floor(rand() ** 1.6 * pages.length)];
				const section = rand() < 0.2 ? 'live' : o.section;
				const p = section === 'live' ? '/live' : page;
				bump(day.pages, `${section}|${p}`);
				bump(day.userPages, `${o.key}|${section}|${p}`);
				bump(day.userSections, `${o.key}|${section}`);
				const hour = sunday ? 9 + Math.floor(rand() * 11) : 6 + Math.floor(rand() * 17);
				bump(day.hours, `${section}|${hour}`);
				bump(day.devices, `${section}|${rand() < 0.62 ? 'phone' : rand() < 0.2 ? 'tablet' : 'desktop'}`);
			}
			const src = INSIGHT_SOURCES[Math.floor(rand() ** 2 * INSIGHT_SOURCES.length)];
			bump(day.sources, `${o.section}|${src}`);
			if (rand() < 0.08) bump(day.logins, o.key);
			if (rand() < 0.3) {
				const action = (Object.keys(INSIGHT_ACTIONS) as InsightAction[])[Math.floor(rand() * 9)];
				bump(day.actions, `${o.section}|${action}`);
				if (!ANONYMOUS_INSIGHT_ACTIONS.has(action)) bump(day.userActions, `${o.key}|${action}`);
			}
		});
		bump(day.visitors, `anon|${owners[0]?.section ?? 'site'}`, Math.floor(rand() * 12));
		// Link areas draw from their OWN generator so adding them left every
		// other mock number exactly where it was.
		owners.forEach((o) => {
			if (linkRand() > 0.5) return;
			const area = (Object.keys(INSIGHT_LINK_AREAS) as InsightLinkArea[])[Math.floor(linkRand() ** 1.5 * 4)];
			const page = pages[1 + Math.floor(linkRand() * (pages.length - 1))];
			bump(day.links, `${o.section}|${area}|${page}`);
			bump(day.userLinks, `${o.key}|${o.section}|${area}`);
		});
		return day;
	});
	const people: InsightPerson[] = owners.map((o, i) => {
		const parsed = parseVisitorKey(o.key)!;
		return {
			key: o.key,
			...parsed,
			username: `owner${i + 1}`,
			lastSeen: i % 7 === 6 ? null : now - Math.floor(rand() * (i % 3 === 0 ? 20 : 2) * 86_400_000),
			lastLogin: now - Math.floor(rand() * 40 * 86_400_000),
		};
	});
	return { days, people };
}
