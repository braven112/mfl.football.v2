/**
 * Site analytics — everything the Owner Activity page derives from the visit
 * counters, with no I/O of its own.
 *
 * The counters themselves live in `owner-activity.ts` (Redis) and are
 * deliberately dumb: a daily hash of franchise → views, one all-time hash of
 * page → views for the league, one per owner, and one for signed-out traffic.
 * Every number this page shows beyond those four raw shapes is computed HERE,
 * as a pure function of what was read, so it can be tested without Redis and
 * so both league routes get the identical derivation rather than two copies.
 *
 * PAGE PATHS ARE CANONICALIZED, NOT COMPARED RAW. The same page is recorded
 * under different paths depending on the host: the tracker strips
 * `/theleague` client-side, an AFL owner on the shared preview domain records
 * `/afl-fantasy/rosters`, and the same owner on the league's apex domain
 * records a bare `/rosters`. `resolveDirectoryHref` is the one function that
 * already knows how to move a path between those forms, so every recorded
 * path and every directory path is pushed through it before anything is
 * summed — otherwise one page reads as two or three unrelated rows.
 *
 * page-directory.json is ONE list shared by every league, so it is scoped with
 * `pathBelongsToLeague` before it is used for titles, categories or the quiet
 * list (see tests/stats-hub-links.test.ts's CONSUMERS registry).
 */

import pageDirectory from '../data/page-directory.json';
import { pathBelongsToLeague } from '../config/footer-config';
import { resolveDirectoryHref } from './nav-utils';
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../config/leagues';
import type { LeagueSlug } from '../types/nav';

/**
 * Field name the signed-out visit count uses inside the DAILY pageview hash.
 *
 * The hash is otherwise franchiseId → count, and franchise ids are always
 * digits, so a word can never collide with one. Every reader here excludes it
 * explicitly rather than trusting the chart to ignore an unknown series.
 */
export const ANON_PAGEVIEW_FIELD = 'anon';

export interface DailyPageViews {
	dates: string[];
	data: Record<string, Record<string, number>>;
}

export interface PageCount {
	page: string;
	count: number;
}

// ── Traffic ────────────────────────────────────────────────────────────────

export interface TrafficDay {
	date: string;
	/** Views from owners we could name. */
	signedIn: number;
	/** Views from visitors who were not signed in. */
	anonymous: number;
	total: number;
	/** How many distinct owners loaded a page that day. */
	activeOwners: number;
}

export interface TrafficSummary {
	days: TrafficDay[];
	totalViews: number;
	signedInViews: number;
	anonymousViews: number;
	/** Share of all views that came from signed-out visitors, 0-100. */
	anonymousShare: number;
	/** Mean views per day across the whole window, including empty days. */
	avgPerDay: number;
	/** The single busiest day, or null when nothing was recorded at all. */
	busiest: TrafficDay | null;
	/** Mean distinct owners per day, across the whole window. */
	avgActiveOwners: number;
	/** Distinct owners with at least one view anywhere in the window. */
	ownersSeen: number;
}

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

function share(part: number, whole: number): number {
	return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/**
 * Collapse the daily hashes into a per-day series plus the headline numbers.
 *
 * Days with nothing recorded stay in the series as zeroes — a gap in a traffic
 * chart is information ("nobody came"), and dropping it would compress the
 * x-axis into a lie.
 */
export function summarizeTraffic(pv: DailyPageViews): TrafficSummary {
	const days: TrafficDay[] = pv.dates.map((date) => {
		const row = pv.data[date] ?? {};
		let signedIn = 0;
		let activeOwners = 0;
		let anonymous = 0;
		for (const [field, count] of Object.entries(row)) {
			const n = Number(count) || 0;
			if (n <= 0) continue;
			if (field === ANON_PAGEVIEW_FIELD) {
				anonymous += n;
				continue;
			}
			signedIn += n;
			activeOwners += 1;
		}
		return { date, signedIn, anonymous, total: signedIn + anonymous, activeOwners };
	});

	const owners = new Set<string>();
	for (const date of pv.dates) {
		for (const [field, count] of Object.entries(pv.data[date] ?? {})) {
			if (field !== ANON_PAGEVIEW_FIELD && (Number(count) || 0) > 0) owners.add(field);
		}
	}

	const signedInViews = days.reduce((s, d) => s + d.signedIn, 0);
	const anonymousViews = days.reduce((s, d) => s + d.anonymous, 0);
	const totalViews = signedInViews + anonymousViews;
	const busiest = days.reduce<TrafficDay | null>(
		(best, d) => (d.total > 0 && (!best || d.total > best.total) ? d : best),
		null,
	);

	return {
		days,
		totalViews,
		signedInViews,
		anonymousViews,
		anonymousShare: share(anonymousViews, totalViews),
		avgPerDay: days.length ? round1(totalViews / days.length) : 0,
		busiest,
		avgActiveOwners: days.length
			? round1(days.reduce((s, d) => s + d.activeOwners, 0) / days.length)
			: 0,
		ownersSeen: owners.size,
	};
}

// ── Per-owner engagement ───────────────────────────────────────────────────

export interface EngagementTeam {
	franchiseId: string;
	name: string;
	icon: string;
}

export interface EngagementRow extends EngagementTeam {
	/** Views inside the window. */
	views: number;
	/** Days inside the window with at least one view. */
	activeDays: number;
	/** Days in the window, so a row can render "12 of 30" without a second prop. */
	windowDays: number;
	/** Consecutive active days ending at today (or yesterday — see below). */
	currentStreak: number;
	longestStreak: number;
	/** Share of the league's SIGNED-IN views, 0-100. */
	share: number;
	/** Most views this owner racked up in a single day. */
	bestDay: number;
}

/**
 * Per-owner engagement over the same window the chart draws.
 *
 * THE TRAILING DAY IS A GRACE DAY. Today is always partial — an owner who
 * reads the site every evening has a zero next to their name all morning — so
 * a streak is allowed to end yesterday and still count as current. Without
 * that, the column reads 0 for most of the league for most of the day, which
 * is both wrong and the kind of number people stop trusting.
 */
export function buildEngagementRows(
	teams: readonly EngagementTeam[],
	pv: DailyPageViews,
): EngagementRow[] {
	const leagueTotal = pv.dates.reduce((sum, date) => {
		const row = pv.data[date] ?? {};
		for (const [field, count] of Object.entries(row)) {
			if (field !== ANON_PAGEVIEW_FIELD) sum += Number(count) || 0;
		}
		return sum;
	}, 0);

	return teams.map((team) => {
		const daily = pv.dates.map((date) => Number(pv.data[date]?.[team.franchiseId]) || 0);
		const views = daily.reduce((s, n) => s + n, 0);
		const activeDays = daily.filter((n) => n > 0).length;

		let longestStreak = 0;
		let run = 0;
		for (const n of daily) {
			run = n > 0 ? run + 1 : 0;
			if (run > longestStreak) longestStreak = run;
		}

		// Walk back from the end, skipping a still-empty today.
		let i = daily.length - 1;
		if (i >= 0 && daily[i] === 0) i -= 1;
		let currentStreak = 0;
		for (; i >= 0 && daily[i] > 0; i--) currentStreak += 1;

		return {
			...team,
			views,
			activeDays,
			windowDays: pv.dates.length,
			currentStreak,
			longestStreak,
			share: share(views, leagueTotal),
			bestDay: daily.reduce((max, n) => (n > max ? n : max), 0),
		};
	});
}

/** Engagement rows sorted the way the table reads: busiest owner first. */
export function sortEngagement(rows: EngagementRow[]): EngagementRow[] {
	return [...rows].sort((a, b) => b.views - a.views || a.name.localeCompare(b.name));
}

// ── Pages ──────────────────────────────────────────────────────────────────

export type PageCategory = 'popular' | 'my-team' | 'reports' | 'tools' | 'info';

/** Same labels the site-search filter chips use. */
export const PAGE_CATEGORY_LABELS: Record<string, string> = {
	popular: 'Popular',
	'my-team': 'My Team',
	reports: 'Reports',
	tools: 'Tools',
	info: 'Info',
};

interface DirectoryEntry {
	id: string;
	title: string;
	path: string;
	category: string;
	visibility: string;
}

export interface PageRow {
	/** Canonical (league-prefixed) path — the key everything is summed under. */
	path: string;
	/**
	 * League-prefixed href. A component on an apex host runs it through
	 * `resolveLeaguePath` the way every other shared directory consumer does.
	 */
	href: string;
	title: string;
	category: string;
	views: number;
	signedIn: number;
	anonymous: number;
	/** How many owners have ever opened it — volume's missing half. */
	reach: number;
}

export interface QuietPage {
	href: string;
	title: string;
	category: string;
}

export interface CategoryRow {
	category: string;
	label: string;
	views: number;
	share: number;
}

export interface OwnerPageRow {
	href: string;
	title: string;
	count: number;
}

export interface PageInsights {
	pages: PageRow[];
	/** Directory pages for this league with no recorded view at all. */
	quiet: QuietPage[];
	/** How many of the league's directory pages HAVE been visited. */
	visitedPages: number;
	directoryPages: number;
	categories: CategoryRow[];
	ownerPages: Record<string, OwnerPageRow[]>;
}

const directory = pageDirectory as DirectoryEntry[];

/**
 * A league's nav slug, which is what the path helpers key on. Derived from the
 * registry rather than passed in, so a caller only ever names the league once
 * and the two slug flavors cannot disagree.
 */
function navSlugFor(league: CanonicalLeagueSlug): LeagueSlug {
	return getLeagueBySlug(league)?.navSlug ?? 'theleague';
}

/** The directory entries that belong to one league, minus view-variant paths. */
function directoryFor(league: CanonicalLeagueSlug): DirectoryEntry[] {
	return directory.filter((entry) => pathBelongsToLeague(entry.path, league));
}

/**
 * Every form of a path reduced to the league's own prefixed form.
 *
 * Handles the three shapes a recorded path arrives in (bare from an apex host,
 * `/theleague`-stripped by the tracker, or fully prefixed on a preview domain)
 * and the two the directory stores.
 */
export function canonicalPath(path: string, league: CanonicalLeagueSlug): string {
	const bare = path.split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
	return resolveDirectoryHref(bare, navSlugFor(league));
}

/**
 * Is this a page the directory knows about for this league?
 *
 * The gate on counting a SIGNED-OUT page view: an unauthenticated caller can
 * put any string in the `page` param, and a hash keyed on that would grow
 * forever. Membership is computed once per league and cached, because the
 * beacon endpoint calls this on every logged-out request.
 */
export function isDirectoryPath(path: string, league: CanonicalLeagueSlug): boolean {
	let known = KNOWN_PATHS.get(league);
	if (!known) {
		known = new Set(directoryFor(league).map((entry) => canonicalPath(entry.path, league)));
		KNOWN_PATHS.set(league, known);
	}
	return known.has(canonicalPath(path, league));
}

const KNOWN_PATHS = new Map<CanonicalLeagueSlug, Set<string>>();

function titleFromPath(path: string): string {
	const last = path.split('/').filter(Boolean).pop();
	if (!last) return 'Homepage';
	return last.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Merge the three page counters into one table, then say what is missing from
 * it.
 *
 * `reach` is the number the volume column cannot give you: a page with 500
 * views from two owners is a private tool, and a page with 90 views from
 * twelve owners is the league's front door. Both look the same ranked by
 * count alone.
 */
export function buildPageInsights(input: {
	league: CanonicalLeagueSlug;
	globalPages: readonly PageCount[];
	anonPages?: readonly PageCount[];
	ownerPages: Record<string, readonly PageCount[]>;
}): PageInsights {
	const { league } = input;
	const navSlug = navSlugFor(league);
	const entries = directoryFor(league);

	const titles = new Map<string, DirectoryEntry>();
	for (const entry of entries) {
		// A `?view=` variant names the same route; the first plain entry wins so
		// the title is the page's own, not the variant's.
		const key = canonicalPath(entry.path, league);
		if (!titles.has(key) || entry.path.includes('?')) continue;
		titles.set(key, entry);
	}
	for (const entry of entries) {
		const key = canonicalPath(entry.path, league);
		if (!titles.has(key)) titles.set(key, entry);
	}

	const rows = new Map<string, PageRow>();
	const rowFor = (rawPath: string): PageRow => {
		const path = canonicalPath(rawPath, league);
		let row = rows.get(path);
		if (!row) {
			const entry = titles.get(path);
			row = {
				path,
				href: path,
				title: entry?.title ?? titleFromPath(path),
				category: entry?.category ?? 'other',
				views: 0,
				signedIn: 0,
				anonymous: 0,
				reach: 0,
			};
			rows.set(path, row);
		}
		return row;
	};

	for (const { page, count } of input.globalPages) {
		const row = rowFor(page);
		row.signedIn += count;
		row.views += count;
	}
	for (const { page, count } of input.anonPages ?? []) {
		const row = rowFor(page);
		row.anonymous += count;
		row.views += count;
	}

	const ownerPages: Record<string, OwnerPageRow[]> = {};
	for (const [franchiseId, pages] of Object.entries(input.ownerPages)) {
		const merged = new Map<string, OwnerPageRow>();
		for (const { page, count } of pages) {
			// rowFor also CREATES the row, so a page only this owner has opened
			// still exists to carry their reach below.
			const row = rowFor(page);
			const existing = merged.get(row.path);
			if (existing) existing.count += count;
			else merged.set(row.path, { href: row.href, title: row.title, count });
		}
		for (const path of merged.keys()) {
			const row = rows.get(path);
			if (row) row.reach += 1;
		}
		ownerPages[franchiseId] = [...merged.values()].sort((a, b) => b.count - a.count);
	}

	const pages = [...rows.values()]
		.filter((row) => row.views > 0)
		.sort((a, b) => b.views - a.views || a.title.localeCompare(b.title));

	const categoryTotals = new Map<string, number>();
	for (const row of pages) {
		if (!PAGE_CATEGORY_LABELS[row.category]) continue;
		categoryTotals.set(row.category, (categoryTotals.get(row.category) ?? 0) + row.views);
	}
	const categorized = [...categoryTotals.values()].reduce((s, n) => s + n, 0);
	const categories: CategoryRow[] = [...categoryTotals.entries()]
		.map(([category, views]) => ({
			category,
			label: PAGE_CATEGORY_LABELS[category] ?? category,
			views,
			share: share(views, categorized),
		}))
		.sort((a, b) => b.views - a.views);

	// The quiet list is the league's own directory minus everything with a
	// view. `?view=` variants are dropped: they share a route with their parent
	// and can never be recorded separately, so they would sit there forever.
	const quiet: QuietPage[] = entries
		.filter((entry) => !entry.path.includes('?'))
		.filter((entry) => !rows.get(canonicalPath(entry.path, league))?.views)
		.map((entry) => ({
			href: resolveDirectoryHref(entry.path, navSlug),
			title: entry.title,
			category: entry.category,
		}))
		.sort((a, b) => a.title.localeCompare(b.title));

	const trackable = entries.filter((entry) => !entry.path.includes('?'));
	return {
		pages,
		quiet,
		visitedPages: trackable.length - quiet.length,
		directoryPages: trackable.length,
		categories,
		ownerPages,
	};
}
