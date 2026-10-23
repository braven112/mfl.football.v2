/**
 * Site Insights — how usage CHANGES: lifecycle stages, the depth curve,
 * first-seen cohorts, personas, page-to-page paths, month-by-month history
 * and window-over-window deltas. Pure, like `site-insights-model.ts`, and
 * narrowed by the same filters (`insightFilters`), so every card on
 * `/live/analytics` agrees with the report around it.
 *
 * Two clocks of data feed it. The daily hashes (90 days) carry enough detail
 * for weeks; the monthly hashes (`insights:m:<YYYY-MM>:*`, never expire)
 * carry the long-term history the daily ones drop.
 */

import { ALL_LEAGUES } from '../config/leagues';
import {
	insightClock,
	insightFilters,
	type InsightPerson,
	type InsightsInput,
} from './site-insights-model';

const DAY_MS = 86_400_000;

/** Days since the epoch for a YYYY-MM-DD date. */
function dayNumber(date: string): number {
	const [y, m, d] = date.split('-').map(Number);
	return Date.UTC(y, m - 1, d) / DAY_MS;
}

function dateOfDayNumber(n: number): string {
	return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** The league-clock date an epoch-ms instant fell on. */
function clockDay(ms: number, zone: string): number {
	return dayNumber(insightClock(new Date(ms), zone).date);
}

function splitField(field: string, parts: number): string[] | null {
	const out = field.split('|');
	return out.length === parts ? out : null;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export const LIFECYCLE_STAGES = {
	hooked: { label: 'Hooked', note: 'on 3 or more of the last 7 days' },
	active: { label: 'Active', note: 'seen in the last 7 days' },
	new: { label: 'New', note: 'first seen in the last 14 days' },
	cooling: { label: 'Cooling', note: 'last seen 8 to 30 days ago' },
	lapsed: { label: 'Lapsed', note: 'last seen over 30 days ago' },
	never: { label: 'Never seen', note: 'no visit on record' },
} as const;
export type LifecycleStage = keyof typeof LIFECYCLE_STAGES;

export function parseLifecycleStage(raw: string | null | undefined): LifecycleStage | null {
	return raw && Object.prototype.hasOwnProperty.call(LIFECYCLE_STAGES, raw) ? (raw as LifecycleStage) : null;
}

/**
 * Where an owner is in their life on the site. First match wins, so a
 * brand-new owner reads as New even on a busy first week; after 14 days they
 * graduate to whatever their habits say.
 */
export function lifecycleStage(
	person: Pick<InsightPerson, 'lastSeen' | 'firstSeen'> & { recentDays?: number },
	now: number,
): LifecycleStage {
	if (!person.lastSeen) return 'never';
	if (person.firstSeen && now - person.firstSeen < 14 * DAY_MS) return 'new';
	if ((person.recentDays ?? 0) >= 3) return 'hooked';
	const idle = now - person.lastSeen;
	if (idle < 7 * DAY_MS) return 'active';
	if (idle <= 30 * DAY_MS) return 'cooling';
	return 'lapsed';
}

// ── Personas ────────────────────────────────────────────────────────────────

/**
 * Usage styles, read off the mix of pages an owner opens. The first rule a
 * path matches decides its group, so the specific ones (trades, the draft)
 * come before the broad roster rule that would otherwise swallow them.
 */
export const PERSONAS = {
	trader: { label: 'Deal maker', note: 'trade builder and offers' },
	draft: { label: 'Draft prepper', note: 'draft, mocks and rankings' },
	gameday: { label: 'Game-day watcher', note: 'live scoring and the broadcast' },
	roster: { label: 'Roster tinkerer', note: 'rosters, lineups, players, contracts' },
	news: { label: 'News reader', note: 'news, Schefter, rules and guides' },
	history: { label: 'Stats & history buff', note: 'standings, history, records' },
	home: { label: 'Homepage checker', note: 'mostly the homepage' },
	mixed: { label: 'All-rounder', note: 'no single kind of page dominates' },
	dropin: { label: 'Drop-in', note: 'fewer than 5 views in the window' },
} as const;
export type Persona = keyof typeof PERSONAS;

export function parsePersona(raw: string | null | undefined): Persona | null {
	return raw && Object.prototype.hasOwnProperty.call(PERSONAS, raw) ? (raw as Persona) : null;
}

const PERSONA_RULES: [Exclude<Persona, 'mixed' | 'dropin' | 'home'>, RegExp][] = [
	['trader', /trade/],
	['draft', /draft|mock|rankings|^\/cr$|rookies|adp/],
	['gameday', /live-scoring|broadcast|^\/live(\/|$)|sunday-ticket|scoreboard|red-zone/],
	['roster', /roster|lineup|players|free-agents|waiver|keeper|contract|salary|dead-money|transactions|stats|watch/],
	['news', /news|schefter|whats-new|rumor|guides|faq|rules|about|suggestions/],
	['history', /standings|playoff|history|franchises|owners|rivalries|records|division|pecking|schedule|mvp|summary|activity/],
];

const LEAGUE_ROOTS = new Set(['/', ...ALL_LEAGUES.map((l) => `/${l.slug}`)]);

export function pageGroup(page: string): Exclude<Persona, 'mixed' | 'dropin'> | null {
	if (LEAGUE_ROOTS.has(page)) return 'home';
	for (const [group, re] of PERSONA_RULES) if (re.test(page)) return group;
	return null;
}

/** An owner's persona from their pages; null with no views at all. */
export function personaOf(pages: readonly { page: string; views: number }[]): Persona | null {
	const total = pages.reduce((s, p) => s + p.views, 0);
	if (total === 0) return null;
	if (total < 5) return 'dropin';
	const byGroup = new Map<string, number>();
	for (const p of pages) {
		const g = pageGroup(p.page);
		if (g) byGroup.set(g, (byGroup.get(g) ?? 0) + p.views);
	}
	const [top] = [...byGroup.entries()].sort((a, b) => b[1] - a[1]);
	return top && top[1] / total >= 0.45 ? (top[0] as Persona) : 'mixed';
}

// ── Depth curve and cohorts ─────────────────────────────────────────────────

/** Weeks since first seen that the curve and the cohort grid follow. */
export const TREND_WEEKS = 12;

export interface DepthWeekRow {
	/** 0 = the week of an owner's first visit. */
	week: number;
	/** Owners whose week `week` lies wholly inside the loaded window. */
	eligible: number;
	/** Of those, owners with at least one view that week. */
	active: number;
	/** Average distinct pages opened that week, over the active owners. */
	avgPages: number;
	/** Average days with a view that week (1-7), over the active owners. */
	avgDays: number;
}

export interface CohortRow {
	/** Monday of the week these owners were first seen (YYYY-MM-DD). */
	start: string;
	size: number;
	/** Index k-1 = share (0-1) of the cohort active in week k; null = not yet. */
	retention: (number | null)[];
}

export interface TrendsInput extends Pick<InsightsInput, 'days' | 'people' | 'section' | 'owner' | 'excludeOwners'> {
	/** The league clock first-seen instants are dated on. */
	zone: string;
}

/**
 * The depth curve (do owners use MORE of the site the longer they've been
 * here?) and the cohort grid (do they stay?), from the loaded window only:
 * a week counts only when all seven of its days are inside it, so a short
 * window shows fewer weeks rather than understated ones.
 */
export function buildDepthAndCohorts(input: TrendsInput): { depth: DepthWeekRow[]; cohorts: CohortRow[] } {
	const { inSection, ownerOk } = insightFilters({ ...input, page: null });
	if (input.days.length === 0) return { depth: [], cohorts: [] };
	const firstDay = dayNumber(input.days[0].date);
	const lastDay = dayNumber(input.days[input.days.length - 1].date);

	const activeDays = new Map<string, Set<number>>();
	const dayPages = new Map<string, Map<number, Set<string>>>();
	for (const day of input.days) {
		const n = dayNumber(day.date);
		for (const [field, views] of Object.entries(day.userSections)) {
			const parts = splitField(field, 2);
			if (!parts || views <= 0 || !inSection(parts[1]) || !ownerOk(parts[0])) continue;
			let set = activeDays.get(parts[0]);
			if (!set) activeDays.set(parts[0], (set = new Set()));
			set.add(n);
		}
		for (const [field, views] of Object.entries(day.userPages)) {
			const parts = splitField(field, 3);
			if (!parts || views <= 0 || !inSection(parts[1]) || !ownerOk(parts[0])) continue;
			let byDay = dayPages.get(parts[0]);
			if (!byDay) dayPages.set(parts[0], (byDay = new Map()));
			let set = byDay.get(n);
			if (!set) byDay.set(n, (set = new Set()));
			set.add(`${parts[1]}|${parts[2]}`);
		}
	}

	const weeks = Array.from({ length: TREND_WEEKS + 1 }, (_, week) => ({ week, eligible: 0, active: 0, pages: 0, days: 0 }));
	const cohorts = new Map<number, { size: number; num: number[]; den: number[] }>();

	for (const person of input.people) {
		if (!person.firstSeen || !ownerOk(person.key)) continue;
		const seen = activeDays.get(person.key);
		// Under a section filter, an owner who never used that section is
		// not part of its curve.
		if (input.section !== null && !seen) continue;
		const first = clockDay(person.firstSeen, input.zone);
		const status: boolean[] = [];
		for (let k = 0; k <= TREND_WEEKS; k++) {
			const start = first + 7 * k;
			const end = start + 6;
			if (end > lastDay) break;
			if (start < firstDay) {
				status.push(false);
				continue;
			}
			const row = weeks[k];
			row.eligible += 1;
			let days = 0;
			const pages = new Set<string>();
			for (let d = start; d <= end; d++) {
				if (seen?.has(d)) days += 1;
				for (const p of dayPages.get(person.key)?.get(d) ?? []) pages.add(p);
			}
			if (days > 0) {
				row.active += 1;
				row.days += days;
				row.pages += pages.size;
			}
			status[k] = days > 0;
		}
		if (first < firstDay) continue;
		const monday = first - ((new Date(first * DAY_MS).getUTCDay() + 6) % 7);
		let cohort = cohorts.get(monday);
		if (!cohort) {
			cohorts.set(monday, (cohort = { size: 0, num: Array(TREND_WEEKS).fill(0), den: Array(TREND_WEEKS).fill(0) }));
		}
		cohort.size += 1;
		for (let k = 1; k <= TREND_WEEKS && k < status.length; k++) {
			cohort.den[k - 1] += 1;
			if (status[k]) cohort.num[k - 1] += 1;
		}
	}

	const round1 = (v: number) => Math.round(v * 10) / 10;
	return {
		depth: weeks
			.filter((w) => w.eligible > 0)
			.map((w) => ({
				week: w.week,
				eligible: w.eligible,
				active: w.active,
				avgPages: w.active ? round1(w.pages / w.active) : 0,
				avgDays: w.active ? round1(w.days / w.active) : 0,
			})),
		cohorts: [...cohorts.entries()]
			.sort((a, b) => b[0] - a[0])
			.map(([start, c]) => ({
				start: dateOfDayNumber(start),
				size: c.size,
				retention: c.den.map((den, i) => (den ? c.num[i] / den : null)),
			})),
	};
}

// ── Paths ───────────────────────────────────────────────────────────────────

export interface PathRow {
	section: string;
	from: string;
	to: string;
	steps: number;
	/** Distinct owners who took this step. */
	owners: number;
}

/**
 * Page-to-page steps (signed-in only: the beacon names the page before this
 * one in the same tab). Under a page filter, every step into or out of it.
 */
export function buildPaths(input: Pick<InsightsInput, 'days' | 'section' | 'owner' | 'page' | 'excludeOwners'>): PathRow[] {
	const { inSection, ownerOk, pageRef } = insightFilters(input);
	const steps = new Map<string, number>();
	const owners = new Map<string, Set<string>>();
	for (const day of input.days) {
		for (const [field, n] of Object.entries(day.paths ?? {})) {
			const parts = splitField(field, 4);
			if (!parts || !inSection(parts[1]) || !ownerOk(parts[0])) continue;
			if (pageRef && parts[2] !== pageRef.page && parts[3] !== pageRef.page) continue;
			const key = `${parts[1]}|${parts[2]}|${parts[3]}`;
			steps.set(key, (steps.get(key) ?? 0) + n);
			let set = owners.get(key);
			if (!set) owners.set(key, (set = new Set()));
			set.add(parts[0]);
		}
	}
	return [...steps.entries()]
		.filter(([, n]) => n > 0)
		.map(([key, n]) => {
			const [section, from, to] = key.split('|');
			return { section, from, to, steps: n, owners: owners.get(key)?.size ?? 0 };
		})
		.sort((a, b) => b.steps - a.steps || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

// ── Months ──────────────────────────────────────────────────────────────────

/** One month of the never-expiring rollup, as `readInsightMonths` returns it. */
export interface InsightMonthRaw {
	/** YYYY-MM on the league clock. */
	month: string;
	/** `<section>|<page>` → views (everyone) */
	pages: Record<string, number>;
	/** `<visitorKey>|<section>` → views */
	userSections: Record<string, number>;
	/** `<visitorKey>|<section>|<page>` → views */
	userPages: Record<string, number>;
	/** `<visitorKey>` → days with a view, site-wide */
	userDays: Record<string, number>;
}

/** The `count` months ending with `today`'s, oldest first. */
export function insightMonths(today: string, count: number): string[] {
	const [y, m] = today.split('-').map(Number);
	const out: string[] = [];
	for (let i = count - 1; i >= 0; i--) {
		const d = new Date(Date.UTC(y, m - 1 - i, 1));
		out.push(d.toISOString().slice(0, 7));
	}
	return out;
}

export interface MonthRow {
	month: string;
	/** Signed-in views (the rollup keeps no signed-out split per owner). */
	views: number;
	owners: number;
	/** Owners whose first visit fell in this month. */
	newOwners: number;
	/** Average days on the site per active owner; null under a page filter. */
	avgDays: number | null;
	/** Distinct pages opened. */
	pages: number;
}

export function buildMonthRows(
	input: Pick<InsightsInput, 'people' | 'section' | 'owner' | 'page' | 'excludeOwners'> & {
		months: InsightMonthRaw[];
		zone: string;
	},
): MonthRow[] {
	const { inSection, pageOk, ownerOk, pageRef } = insightFilters(input);
	const firstMonth = new Map<string, number>();
	for (const p of input.people) {
		if (!p.firstSeen || !ownerOk(p.key)) continue;
		const month = insightClock(new Date(p.firstSeen), input.zone).date.slice(0, 7);
		firstMonth.set(month, (firstMonth.get(month) ?? 0) + 1);
	}
	return input.months.map((m) => {
		const owners = new Set<string>();
		const pages = new Set<string>();
		let views = 0;
		if (!pageRef) {
			for (const [field, n] of Object.entries(m.userSections)) {
				const parts = splitField(field, 2);
				if (!parts || !inSection(parts[1]) || !ownerOk(parts[0])) continue;
				views += n;
				owners.add(parts[0]);
			}
		}
		for (const [field, n] of Object.entries(m.userPages)) {
			const parts = splitField(field, 3);
			if (!parts || !pageOk(parts[1], parts[2]) || !ownerOk(parts[0])) continue;
			pages.add(`${parts[1]}|${parts[2]}`);
			if (pageRef) {
				views += n;
				owners.add(parts[0]);
			}
		}
		let days = 0;
		for (const key of owners) days += m.userDays[key] ?? 0;
		return {
			month: m.month,
			views,
			owners: owners.size,
			newOwners: input.section === null && !pageRef ? (firstMonth.get(m.month) ?? 0) : 0,
			avgDays: pageRef || owners.size === 0 ? null : Math.round((days / owners.size) * 10) / 10,
			pages: pages.size,
		};
	});
}

// ── Deltas ──────────────────────────────────────────────────────────────────

/**
 * Percent change from the previous window, rounded; null when there is no
 * honest comparison (nothing before, so any growth would read as infinite).
 */
export function percentChange(current: number, previous: number): number | null {
	if (!Number.isFinite(previous) || previous <= 0) return null;
	return Math.round(((current - previous) / previous) * 100);
}

/**
 * How many days to read so the window can be compared with the one before
 * it: double, when the daily hashes still hold that much.
 */
export function daysToRead(range: number, keptDays: number): number {
	return range * 2 <= keptDays ? range * 2 : range;
}

/** Split a doubled read into [previous window, current window]. */
export function splitWindows<T>(days: T[], range: number): { previous: T[] | null; current: T[] } {
	if (days.length <= range) return { previous: null, current: days };
	return { previous: days.slice(0, days.length - range), current: days.slice(-range) };
}

/** Deterministic monthly rollup for `?mock`, matching `mockInsights`' owners. */
export function mockInsightMonths(months: string[], owners: { key: string; section: string }[]): InsightMonthRaw[] {
	let seed = 23;
	const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
	const pages = ['/', '/rosters', '/standings', '/lineup', '/players', '/trade-builder', '/schefter'];
	return months.map((month, mi) => {
		const m: InsightMonthRaw = { month, pages: {}, userSections: {}, userPages: {}, userDays: {} };
		// The site grows: fewer owners in the oldest months.
		const share = 0.25 + (0.6 * (mi + 1)) / months.length;
		owners.forEach((o) => {
			if (rand() > share) return;
			const days = 1 + Math.floor(rand() * 20);
			m.userDays[o.key] = days;
			let total = 0;
			for (const page of pages) {
				if (rand() < 0.4) continue;
				const views = 1 + Math.floor(rand() * days * 2);
				total += views;
				m.userPages[`${o.key}|${o.section}|${page}`] = views;
				m.pages[`${o.section}|${page}`] = (m.pages[`${o.section}|${page}`] ?? 0) + views;
			}
			if (total) m.userSections[`${o.key}|${o.section}`] = total;
		});
		return m;
	});
}
