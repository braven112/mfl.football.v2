/**
 * The video → League History funnel (Brandon, 2026-11-05): how many people
 * make a season video, click through to their league's history, land on it,
 * start importing the full history, and finish. The leagues that finish are
 * the potential client list.
 *
 *   history-funnel:total            hash `<step>|<platform>` → every event
 *   history-funnel:day:<YYYY-MM-DD> hash `<step>|<platform>` → that day's events (TTL)
 *   history-funnel:people:<step>    set of browser ids (or `<platform>:<league>`
 *                                   for the import steps) — the unique count
 *   history-funnel:leads            hash `<platform>:<league>` → ImportLead JSON
 *
 * BROWSER steps arrive through POST /api/history-funnel, which needs no
 * session, so every field is a closed list or a validated pattern. SERVER
 * steps (an import starting or finishing, an email opt-in) are written only by
 * our own endpoints, never by the browser, so the client list cannot be
 * padded from outside. A browser id is a random value the page keeps in
 * localStorage, never anything about the person.
 */
import { getRedis } from './redis-client';

export const FUNNEL_STEPS = {
	video_made: { label: 'Videos made', from: 'browser' },
	history_link_click: { label: 'Clicked “see your history”', from: 'browser' },
	history_view: { label: 'History page visits', from: 'browser' },
	import_started: { label: 'Full-history imports started', from: 'server' },
	import_finished: { label: 'Full histories imported', from: 'server' },
} as const;
export type FunnelStep = keyof typeof FUNNEL_STEPS;

/** Counted alongside the funnel, but not a stage of it. */
export const FUNNEL_EXTRAS = {
	video_downloaded: { label: 'Videos downloaded', from: 'browser' },
	video_shared: { label: 'Videos shared', from: 'browser' },
	email_optin: { label: 'Email opt-ins', from: 'server' },
} as const;
export type FunnelExtra = keyof typeof FUNNEL_EXTRAS;
export type FunnelEvent = FunnelStep | FunnelExtra;

const ALL_EVENTS: Record<FunnelEvent, { label: string; from: 'browser' | 'server' }> = {
	...FUNNEL_STEPS,
	...FUNNEL_EXTRAS,
};

export const FUNNEL_PLATFORMS = ['mfl', 'espn', 'sleeper', 'manual'] as const;
export type FunnelPlatform = (typeof FUNNEL_PLATFORMS)[number];

export function isFunnelEvent(raw: unknown): raw is FunnelEvent {
	return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(ALL_EVENTS, raw);
}
/** Only these may be sent by a browser; the rest are server-written. */
export function isBrowserFunnelEvent(raw: unknown): raw is FunnelEvent {
	return isFunnelEvent(raw) && ALL_EVENTS[raw].from === 'browser';
}
export function isFunnelPlatform(raw: unknown): raw is FunnelPlatform {
	return typeof raw === 'string' && (FUNNEL_PLATFORMS as readonly string[]).includes(raw);
}
export function isFunnelVisitor(raw: unknown): raw is string {
	return typeof raw === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(raw);
}

const TOTAL_KEY = 'history-funnel:total';
const dayKey = (day: string) => `history-funnel:day:${day}`;
const peopleKey = (event: FunnelEvent) => `history-funnel:people:${event}`;
const LEADS_KEY = 'history-funnel:leads';
/** Daily rows are kept a little over a year, for "last N days" and year-over-year. */
const DAY_TTL_SECONDS = 400 * 24 * 3600;
/** A ceiling on the lead list (one row per league), far above any real launch. */
export const MAX_LEADS = 20000;

const field = (event: FunnelEvent, platform: FunnelPlatform) => `${event}|${platform}`;
export const funnelDay = (at: Date) => at.toISOString().slice(0, 10);

/** Count one event. `who` is a browser id, or `<platform>:<league>` for imports. */
export async function recordFunnel(
	event: FunnelEvent,
	platform: FunnelPlatform,
	who?: string,
	now = new Date(),
): Promise<boolean> {
	const redis = await getRedis();
	if (!redis) return false;
	const day = dayKey(funnelDay(now));
	await Promise.all([
		redis.hincrby(TOTAL_KEY, field(event, platform), 1),
		redis.hincrby(day, field(event, platform), 1),
		redis.expire(day, DAY_TTL_SECONDS),
		who ? redis.sadd(peopleKey(event), who) : Promise.resolve(0),
	]);
	return true;
}

/** One league that started (and maybe finished) importing its full history. */
export interface ImportLead {
	platform: FunnelPlatform;
	leagueId: string;
	name: string;
	seasons: number;
	startedAt: string;
	finishedAt?: string;
}

/**
 * Note an import's progress. The first call for a league counts
 * `import_started`; the first call with `finished` counts `import_finished`.
 * Repeats only refresh the name and season count, so revisiting a built
 * league never inflates either number.
 */
export async function recordImport(
	platform: FunnelPlatform,
	leagueId: string,
	info: { name: string; seasons: number; finished: boolean },
	now = new Date(),
): Promise<void> {
	const redis = await getRedis();
	if (!redis) return;
	const key = `${platform}:${leagueId}`;
	const raw = await redis.hget<ImportLead | string>(LEADS_KEY, key);
	const existing: ImportLead | null = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
	if (!existing && (await redis.hlen(LEADS_KEY)) >= MAX_LEADS) return;
	const stamp = now.toISOString();
	const lead: ImportLead = {
		platform,
		leagueId,
		name: info.name,
		seasons: info.seasons,
		startedAt: existing?.startedAt ?? stamp,
		finishedAt: existing?.finishedAt ?? (info.finished ? stamp : undefined),
	};
	await redis.hset(LEADS_KEY, { [key]: JSON.stringify(lead) });
	if (!existing) await recordFunnel('import_started', platform, key, now);
	if (info.finished && !existing?.finishedAt) await recordFunnel('import_finished', platform, key, now);
}

export interface FunnelRow {
	event: FunnelEvent;
	label: string;
	total: number;
	/** Events in the chosen window. */
	recent: number;
	/** Distinct browsers (or leagues, for imports), all time. */
	people: number;
	byPlatform: Partial<Record<FunnelPlatform, number>>;
	/** Of the previous step's people, the share that reached this one. Null for the first step. */
	fromPrevious: number | null;
}

export interface FunnelReport {
	days: number;
	steps: FunnelRow[];
	extras: FunnelRow[];
	leads: ImportLead[];
}

/** Pure: turn the raw hashes into the report the admin page shows. */
export function buildFunnelReport(input: {
	days: number;
	totals: Record<string, number | string>;
	recent: Array<Record<string, number | string> | null>;
	people: Partial<Record<FunnelEvent, number>>;
	leads: ImportLead[];
}): FunnelReport {
	const sum = (hash: Record<string, number | string> | null, event: FunnelEvent) =>
		Object.entries(hash ?? {}).reduce((n, [f, v]) => (f.split('|')[0] === event ? n + (Number(v) || 0) : n), 0);
	const row = (event: FunnelEvent): FunnelRow => {
		const byPlatform: Partial<Record<FunnelPlatform, number>> = {};
		for (const [f, v] of Object.entries(input.totals)) {
			const [e, p] = f.split('|');
			if (e === event && isFunnelPlatform(p)) byPlatform[p] = (byPlatform[p] ?? 0) + (Number(v) || 0);
		}
		return {
			event,
			label: ALL_EVENTS[event].label,
			total: sum(input.totals, event),
			recent: input.recent.reduce((n, h) => n + sum(h, event), 0),
			people: input.people[event] ?? 0,
			byPlatform,
			fromPrevious: null,
		};
	};
	const steps = (Object.keys(FUNNEL_STEPS) as FunnelStep[]).map(row);
	steps.forEach((r, i) => {
		if (i === 0) return;
		const prev = steps[i - 1].people;
		r.fromPrevious = prev > 0 ? r.people / prev : null;
	});
	const leads = [...input.leads].sort((a, b) =>
		(b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt),
	);
	return { days: input.days, steps, extras: (Object.keys(FUNNEL_EXTRAS) as FunnelExtra[]).map(row), leads };
}

/** The report for the last `days` days. Null when storage is unavailable. */
export async function readFunnelReport(days = 30, now = new Date()): Promise<FunnelReport | null> {
	const redis = await getRedis();
	if (!redis) return null;
	const dayNames = Array.from({ length: days }, (_, i) => funnelDay(new Date(now.getTime() - i * 86400000)));
	const events = Object.keys(ALL_EVENTS) as FunnelEvent[];
	const [totals, recent, people, leads] = await Promise.all([
		redis.hgetall<number | string>(TOTAL_KEY),
		Promise.all(dayNames.map((d) => redis.hgetall<number | string>(dayKey(d)))),
		Promise.all(events.map((e) => redis.scard(peopleKey(e)))),
		redis.hgetall<ImportLead | string>(LEADS_KEY),
	]);
	return buildFunnelReport({
		days,
		totals: totals ?? {},
		recent,
		people: Object.fromEntries(events.map((e, i) => [e, Number(people[i]) || 0])),
		leads: Object.values(leads ?? {}).map((v) => (typeof v === 'string' ? JSON.parse(v) : v) as ImportLead),
	});
}

/** The client list as CSV (Excel/Sheets). Cells are quoted and formula-safe. */
export function leadsCsv(leads: ImportLead[]): string {
	const cell = (v: string | number | undefined) => {
		let s = String(v ?? '');
		if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
		return `"${s.replace(/"/g, '""')}"`;
	};
	const header = ['Platform', 'League ID', 'League', 'Seasons', 'Started', 'Finished'];
	const rows = leads.map((l) => [l.platform, l.leagueId, l.name, l.seasons, l.startedAt, l.finishedAt ?? ''].map(cell).join(','));
	return [header.map(cell).join(','), ...rows].join('\r\n') + '\r\n';
}
