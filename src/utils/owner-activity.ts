/**
 * Owner Activity Tracking
 *
 * Tracks when franchise owners last visited theleague.us.
 * Uses Upstash Redis hash per league: activity:{leagueId} → { franchiseId: timestampMs }
 *
 * Reusable across: activity page, roster headers, trade builder, league summary.
 */

import { getRedis } from './redis-client';
import { describeMoveType, type MflMove } from './mfl-activity';
import {
	summarizeSurfaces,
	surfaceField,
	parseSurfaceField,
	subtractSurfaces,
	EMPTY_SURFACE_BREAKDOWN,
	type SurfaceBreakdown,
	type VisitContext,
	type VisitPlatform,
} from './visit-surface';

export type ActivityLevel = 'active' | 'idle' | 'dormant' | 'unknown';

function redisKey(leagueId: string): string {
	return `activity:${leagueId}`;
}

const PAGEVIEW_TTL_SECONDS = 45 * 86_400; // 45 days

function pageviewKey(leagueId: string, date: string): string {
	return `pageviews:${leagueId}:${date}`;
}

function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}

function globalPageKey(leagueId: string): string {
	return `pages:${leagueId}`;
}

function ownerPageKey(leagueId: string, franchiseId: string): string {
	return `pages:${leagueId}:${franchiseId}`;
}

/**
 * Surface counters (installed PWA vs browser tab, by platform).
 *
 * Three keys, all plain hashes of `<surface>:<platform>` → count, all
 * unexpiring: they are lifetime totals, and the report reads them as shares
 * rather than as a time series.
 *
 * - `surface:{leagueId}`        every visit, signed in or not
 * - `surface:{leagueId}:anon`   the logged-out subset of the same visits
 * - `surface:{leagueId}:f:{id}` one owner's visits
 *
 * The anon hash is a SUBSET of the league-wide one rather than its complement,
 * so an anonymous visit costs one extra HINCRBY instead of a second endpoint;
 * signed-in traffic is the difference (`subtractSurfaces`). The `:f:` infix
 * keeps an owner key from ever colliding with the literal `anon` suffix.
 */
function leagueSurfaceKey(leagueId: string): string {
	return `surface:${leagueId}`;
}

function anonSurfaceKey(leagueId: string): string {
	return `surface:${leagueId}:anon`;
}

function ownerSurfaceKey(leagueId: string, franchiseId: string): string {
	return `surface:${leagueId}:f:${franchiseId}`;
}

/** Hash of franchiseId → the surface field their most recent visit came from. */
function lastSurfaceKey(leagueId: string): string {
	return `surface-last:${leagueId}`;
}

/**
 * Lua script bundling the writes recordVisit needs into a single EVAL call.
 * Upstash bills EVAL as one command regardless of how many `redis.call(...)`
 * lines the script contains, so this takes a ~8-command operation (HSET +
 * 3× HINCRBY + EXPIRE-on-every-call + 3 surface writes) down to 1 command per
 * visit. The EXPIRE guard uses TTL < 0 so it only fires the first time we
 * touch the pageview key each day.
 *
 * The surface writes are skipped when ARGV[5] is empty — a beacon from a
 * client that reported no usable surface still records the visit itself, it
 * just adds nothing to the PWA-vs-browser split. Guarding INSIDE the script
 * keeps the KEYS list a fixed length in both cases.
 *
 * KEYS[1] activity hash          ARGV[1] franchiseId
 * KEYS[2] daily pageview hash    ARGV[2] now-ms timestamp string
 * KEYS[3] global pages hash      ARGV[3] pageview TTL seconds
 * KEYS[4] owner pages hash       ARGV[4] normalized page path
 * KEYS[5] league surface hash    ARGV[5] surface field, or '' to skip
 * KEYS[6] owner surface hash
 * KEYS[7] last-surface hash
 */
const RECORD_VISIT_LUA = `
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
if redis.call('TTL', KEYS[2]) < 0 then
  redis.call('EXPIRE', KEYS[2], ARGV[3])
end
redis.call('HINCRBY', KEYS[3], ARGV[4], 1)
redis.call('HINCRBY', KEYS[4], ARGV[4], 1)
if ARGV[5] ~= '' then
  redis.call('HINCRBY', KEYS[5], ARGV[5], 1)
  redis.call('HINCRBY', KEYS[6], ARGV[5], 1)
  redis.call('HSET', KEYS[7], ARGV[1], ARGV[5])
end
return 1
`;

/**
 * Record a visit for a franchise: last-seen, daily page view count, page
 * popularity, and — when the client reported one — which surface (installed
 * PWA vs browser tab, and on what platform) the visit came from.
 */
export async function recordVisit(
	leagueId: string,
	franchiseId: string,
	page = '/',
	visit: VisitContext | null = null,
): Promise<void> {
	const redis = await getRedis();
	if (!redis) return;
	const today = todayISO();
	const pvKey = pageviewKey(leagueId, today);
	// Normalize page path: strip query params, trailing slashes
	const normalizedPage = page.split('?')[0].replace(/\/+$/, '') || '/';
	const field = visit ? surfaceField(visit) : '';

	try {
		await redis.eval(
			RECORD_VISIT_LUA,
			[
				redisKey(leagueId),
				pvKey,
				globalPageKey(leagueId),
				ownerPageKey(leagueId, franchiseId),
				leagueSurfaceKey(leagueId),
				ownerSurfaceKey(leagueId, franchiseId),
				lastSurfaceKey(leagueId),
			],
			[franchiseId, Date.now().toString(), PAGEVIEW_TTL_SECONDS, normalizedPage, field],
		);
	} catch (err) {
		// Older Redis/Upstash instances without EVAL fall back to the multi-command
		// path so tracking keeps working even if the script layer is unavailable.
		console.warn('[owner-activity] EVAL failed, falling back to pipelined writes:', err);
		await Promise.all([
			redis.hset(redisKey(leagueId), { [franchiseId]: Date.now().toString() }),
			redis.hincrby(pvKey, franchiseId, 1).then(() => redis.expire(pvKey, PAGEVIEW_TTL_SECONDS)),
			redis.hincrby(globalPageKey(leagueId), normalizedPage, 1),
			redis.hincrby(ownerPageKey(leagueId, franchiseId), normalizedPage, 1),
			...(field
				? [
						redis.hincrby(leagueSurfaceKey(leagueId), field, 1),
						redis.hincrby(ownerSurfaceKey(leagueId, franchiseId), field, 1),
						redis.hset(lastSurfaceKey(leagueId), { [franchiseId]: field }),
					]
				: []),
		]);
	}
}

/**
 * A logged-out visit, rate limit included, in ONE command.
 *
 * The counters are the only thing kept — no franchise, no page, no timestamp,
 * because a visitor we cannot name is only ever counted.
 *
 * The limit lives INSIDE the script rather than in a preceding
 * `checkRateLimit` call for two reasons: an anonymous beacon would otherwise
 * cost 2-3 Upstash commands against unbounded unauthenticated traffic where a
 * signed-in one costs 1, and a rejected request would still spend its INCR.
 * Here a rejection costs the same single EVAL as an accepted visit, and the
 * counters are never touched. Like `checkRateLimit` it fails open on a Redis
 * error — analytics must not start rejecting because Redis blinked.
 *
 * KEYS[1] rate-limit counter   ARGV[1] surface field
 * KEYS[2] league surface hash  ARGV[2] max requests per window
 * KEYS[3] anon surface hash    ARGV[3] window seconds
 */
const RECORD_ANON_SURFACE_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[3])
end
if n > tonumber(ARGV[2]) then
  return 0
end
redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
redis.call('HINCRBY', KEYS[3], ARGV[1], 1)
return 1
`;

/** Fixed-window limit applied to the anonymous path, per caller. */
export interface AnonymousVisitLimit {
	/** Opaque per-caller identity — never a raw IP; see track-visit.ts. */
	callerKey: string;
	max: number;
	windowSeconds: number;
}

/** `recorded: false` means the caller is over its limit (or Redis is absent). */
export interface AnonymousVisitResult {
	recorded: boolean;
	limited: boolean;
}

/** Count one logged-out visit toward the league's PWA-vs-browser split. */
export async function recordAnonymousSurface(
	leagueId: string,
	visit: VisitContext,
	limit: AnonymousVisitLimit,
): Promise<AnonymousVisitResult> {
	const redis = await getRedis();
	if (!redis) return { recorded: false, limited: false };
	const field = surfaceField(visit);
	const rateKey = `rate:track-visit-anon:${limit.callerKey}`;

	try {
		const allowed = await redis.eval(
			RECORD_ANON_SURFACE_LUA,
			[rateKey, leagueSurfaceKey(leagueId), anonSurfaceKey(leagueId)],
			[field, limit.max.toString(), limit.windowSeconds.toString()],
		);
		const recorded = Number(allowed) === 1;
		return { recorded, limited: !recorded };
	} catch (err) {
		// Older Redis/Upstash instances without EVAL: the limit degrades to a
		// separate INCR rather than being dropped.
		console.warn('[owner-activity] anon surface EVAL failed, falling back:', err);
		const count = await redis.incr(rateKey);
		if (count === 1) await redis.expire(rateKey, limit.windowSeconds);
		if (count > limit.max) return { recorded: false, limited: true };
		await Promise.all([
			redis.hincrby(leagueSurfaceKey(leagueId), field, 1),
			redis.hincrby(anonSurfaceKey(leagueId), field, 1),
		]);
		return { recorded: true, limited: false };
	}
}

/** Get all franchise activity timestamps for a league */
export async function getAllActivity(leagueId: string): Promise<Record<string, number>> {
	const redis = await getRedis();
	if (!redis) return {};

	const raw = await redis.hgetall<string>(redisKey(leagueId));
	if (!raw) return {};

	const result: Record<string, number> = {};
	for (const [key, value] of Object.entries(raw)) {
		const num = Number(value);
		if (!isNaN(num)) result[key] = num;
	}
	return result;
}

/**
 * Which signal produced a franchise's blended last-seen time.
 * `site` = a page view on our site, `mfl` = an owner-driven MFL roster move.
 */
export type ActivitySource = 'site' | 'mfl' | 'none';

export interface BlendedActivity {
	/** Last page view on our site, epoch ms, or null if never seen. */
	siteVisit: number | null;
	/** Last MFL-side sign of life, epoch ms, or null if we have none. */
	mflSignal: number | null;
	/** The more recent of the two — what the report ranks and grades on. */
	lastSeen: number | null;
	/** Which signal `lastSeen` came from. */
	source: ActivitySource;
}

/**
 * Blend our site-visit tracking with MFL-side activity.
 *
 * Neither signal alone is complete: site visits miss an owner who only ever
 * logs into MFL, and MFL misses an owner who reads here and never touches
 * their roster. The max of the two is the honest floor on "when was this owner
 * last around", and both raw values are kept so the UI can show its work.
 *
 * Ties go to `site` — a page view is direct evidence of a human present, while
 * a fallback waiver row is timestamped when the batch ran, not when the owner
 * clicked.
 */
export function blendActivity(
	siteVisit: number | null,
	mflSignal: number | null,
): BlendedActivity {
	if (siteVisit === null && mflSignal === null) {
		return { siteVisit: null, mflSignal: null, lastSeen: null, source: 'none' };
	}
	if (mflSignal !== null && (siteVisit === null || mflSignal > siteVisit)) {
		return { siteVisit, mflSignal, lastSeen: mflSignal, source: 'mfl' };
	}
	return { siteVisit, mflSignal, lastSeen: siteVisit, source: 'site' };
}

/** Classify activity level based on time since last visit */
export function getActivityLevel(lastVisitMs: number | null): ActivityLevel {
	if (!lastVisitMs) return 'unknown';
	const hoursAgo = (Date.now() - lastVisitMs) / (1000 * 60 * 60);
	if (hoursAgo < 24) return 'active';
	if (hoursAgo < 24 * 7) return 'idle';
	return 'dormant';
}

/** Human-readable label for activity level */
export function getActivityLabel(level: ActivityLevel): string {
	const labels: Record<ActivityLevel, string> = {
		active: 'Active',
		idle: 'Idle',
		dormant: 'Dormant',
		unknown: 'Never seen',
	};
	return labels[level];
}

/** Format a timestamp as a human-readable relative time string */
export function formatLastSeen(timestampMs: number | null): string {
	if (!timestampMs) return 'Never seen';

	const diffMs = Date.now() - timestampMs;
	const minutes = Math.floor(diffMs / 60_000);
	const hours = Math.floor(diffMs / 3_600_000);
	const days = Math.floor(diffMs / 86_400_000);

	if (minutes < 1) return 'Just now';
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 30) return `${days}d ago`;
	return `${Math.floor(days / 30)}mo ago`;
}

/** Format as a longer, more descriptive relative time */
export function formatLastSeenLong(timestampMs: number | null): string {
	if (!timestampMs) return 'Never seen';

	const diffMs = Date.now() - timestampMs;
	const minutes = Math.floor(diffMs / 60_000);
	const hours = Math.floor(diffMs / 3_600_000);
	const days = Math.floor(diffMs / 86_400_000);

	if (minutes < 1) return 'Just now';
	if (minutes === 1) return '1 minute ago';
	if (minutes < 60) return `${minutes} minutes ago`;
	if (hours === 1) return '1 hour ago';
	if (hours < 24) {
		const remainingMin = minutes - hours * 60;
		return remainingMin > 0 ? `${hours}h ${remainingMin}m ago` : `${hours} hour${hours > 1 ? 's' : ''} ago`;
	}
	if (days === 1) return '1 day ago';
	if (days < 30) return `${days} days ago`;
	return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''} ago`;
}

/**
 * One row of the Owner Activity "Last Seen" table, as
 * `OwnerActivityReport.astro` consumes it.
 */
export interface OwnerActivityRow {
	franchiseId: string;
	name: string;
	icon: string;
	/** The later of the site visit and the MFL signal — what the table ranks on. */
	lastSeen: number | null;
	/** Last page view on our site, epoch ms. */
	siteVisit: number | null;
	/** Last MFL LOGIN, epoch ms, from MFL's commissioner-only `lastVisit`. */
	mflVisit: number | null;
	/** Last owner-driven MFL roster move, epoch ms. */
	mflMove: number | null;
	source: ActivitySource;
	level: ActivityLevel;
	label: string;
	timeAgo: string;
	siteTimeAgo: string;
	mflVisitTimeAgo: string;
	mflMoveTimeAgo: string;
	/** e.g. "trade" — what the most recent MFL move actually was. */
	mflMoveLabel: string;
}

/**
 * Build one Last Seen row: pick the MFL signal, blend it against the site
 * visit, grade the result, and format every string the table needs.
 *
 * WHICH MFL SIGNAL. `mflVisit` is MFL's own `lastVisit` — a real login
 * timestamp, and the better signal: an owner must log in to transact, so
 * within a single MFL response a login is never older than a move.
 *
 * But the two reach us from DIFFERENT FILES on different cadences —
 * `owner-last-visit.json` every 6 hours, the transactions feed every 5
 * minutes — so that guarantee does not survive the trip. A trade made twenty
 * minutes ago sits beside a login timestamp synced this morning. Taking the
 * login on its own would then rank the owner by the older number while the
 * row's own breakdown line said "Last move: 20m ago", which is both wrong and
 * visibly self-contradictory. So the MFL signal is the LATER of the two, and
 * the transaction also covers the case where there is no login at all (the
 * sync has not run yet, or this is a league we are not commissioner of, where
 * MFL withholds the field).
 *
 * Lives here rather than in the two `activity.astro` pages because they are
 * forked siblings (`tests/page-fork-ratchet.test.ts`) — the league-specific
 * part is only where the name, icon and feeds come from, and that stays in
 * the routes.
 */
export function buildOwnerActivityRow(team: {
	franchiseId: string;
	name: string;
	icon: string;
	siteVisit: number | null;
	mflVisit?: number | null;
	move: MflMove | null;
}): OwnerActivityRow {
	const mflVisit = team.mflVisit ?? null;
	const mflMove = team.move?.at ?? null;
	const mflSignal =
		mflVisit === null || mflMove === null ? (mflVisit ?? mflMove) : Math.max(mflVisit, mflMove);
	const blended = blendActivity(team.siteVisit, mflSignal);
	const level = getActivityLevel(blended.lastSeen);
	return {
		franchiseId: team.franchiseId,
		name: team.name,
		icon: team.icon,
		lastSeen: blended.lastSeen,
		siteVisit: blended.siteVisit,
		mflVisit,
		mflMove,
		source: blended.source,
		level,
		label: getActivityLabel(level),
		timeAgo: formatLastSeenLong(blended.lastSeen),
		siteTimeAgo: blended.siteVisit === null ? '' : formatLastSeen(blended.siteVisit),
		mflVisitTimeAgo: mflVisit === null ? '' : formatLastSeen(mflVisit),
		mflMoveTimeAgo: mflMove === null ? '' : formatLastSeen(mflMove),
		mflMoveLabel: team.move ? describeMoveType(team.move.type) : '',
	};
}

/** Sort Last Seen rows by most recent sign of life, never-seen last. */
export function sortByLastSeen(rows: OwnerActivityRow[]): OwnerActivityRow[] {
	return rows.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
}

/** Date string for N days ago in YYYY-MM-DD format */
function daysAgoISO(n: number): string {
	const d = new Date();
	d.setDate(d.getDate() - n);
	return d.toISOString().slice(0, 10);
}

/**
 * Get daily page view counts for all franchises over the last N days.
 * Returns { "YYYY-MM-DD": { franchiseId: count, ... }, ... }
 * Days with no data are included as empty objects.
 */
export async function getDailyPageViews(
	leagueId: string,
	days = 30,
): Promise<{ dates: string[]; data: Record<string, Record<string, number>> }> {
	const redis = await getRedis();
	const dates: string[] = [];
	for (let i = days - 1; i >= 0; i--) {
		dates.push(daysAgoISO(i));
	}

	if (!redis) {
		const empty: Record<string, Record<string, number>> = {};
		for (const d of dates) empty[d] = {};
		return { dates, data: empty };
	}

	const results = await Promise.all(
		dates.map((d) => redis.hgetall<string>(pageviewKey(leagueId, d))),
	);

	const data: Record<string, Record<string, number>> = {};
	for (let i = 0; i < dates.length; i++) {
		const raw = results[i];
		const dayData: Record<string, number> = {};
		if (raw) {
			for (const [key, value] of Object.entries(raw)) {
				const num = Number(value);
				if (!isNaN(num)) dayData[key] = num;
			}
		}
		data[dates[i]] = dayData;
	}

	return { dates, data };
}

/** Parse a Redis hash of string counts into a sorted array of { page, count } */
function parsePageCounts(raw: Record<string, string> | null): { page: string; count: number }[] {
	if (!raw) return [];
	return Object.entries(raw)
		.map(([page, val]) => ({ page, count: Number(val) || 0 }))
		.filter((e) => e.count > 0)
		.sort((a, b) => b.count - a.count);
}

/** Get global page popularity across all owners (sorted by most visited) */
export async function getGlobalPagePopularity(
	leagueId: string,
): Promise<{ page: string; count: number }[]> {
	const redis = await getRedis();
	if (!redis) return [];
	const raw = await redis.hgetall<string>(globalPageKey(leagueId));
	return parsePageCounts(raw);
}

/** Get a single owner's page popularity (sorted by most visited) */
export async function getOwnerPagePopularity(
	leagueId: string,
	franchiseId: string,
): Promise<{ page: string; count: number }[]> {
	const redis = await getRedis();
	if (!redis) return [];
	const raw = await redis.hgetall<string>(ownerPageKey(leagueId, franchiseId));
	return parsePageCounts(raw);
}

/** Get page popularity for ALL owners at once */
export async function getAllOwnerPagePopularity(
	leagueId: string,
	franchiseIds: string[],
): Promise<Record<string, { page: string; count: number }[]>> {
	const redis = await getRedis();
	if (!redis) return {};
	const results = await Promise.all(
		franchiseIds.map((id) => redis.hgetall<string>(ownerPageKey(leagueId, id))),
	);
	const out: Record<string, { page: string; count: number }[]> = {};
	for (let i = 0; i < franchiseIds.length; i++) {
		out[franchiseIds[i]] = parsePageCounts(results[i]);
	}
	return out;
}

/**
 * Every surface counter a league has, in one round trip.
 *
 * `signedIn` is derived rather than stored (see the key comment above), so it
 * is a plain total-and-share rather than a full breakdown — the per-platform
 * split of signed-in traffic is already visible per owner below it.
 */
export interface LeagueSurfaceReport {
	/** Every visit, signed in or not. */
	all: SurfaceBreakdown;
	/** The logged-out subset. */
	anonymous: SurfaceBreakdown;
	/** `all` minus `anonymous`. */
	signedIn: { total: number; pwa: number; browser: number; pwaShare: number };
}

export async function getLeagueSurfaceReport(leagueId: string): Promise<LeagueSurfaceReport> {
	const redis = await getRedis();
	if (!redis) {
		return {
			all: EMPTY_SURFACE_BREAKDOWN,
			anonymous: EMPTY_SURFACE_BREAKDOWN,
			signedIn: { total: 0, pwa: 0, browser: 0, pwaShare: 0 },
		};
	}

	const [allRaw, anonRaw] = await Promise.all([
		redis.hgetall<string>(leagueSurfaceKey(leagueId)),
		redis.hgetall<string>(anonSurfaceKey(leagueId)),
	]);

	const all = summarizeSurfaces(allRaw);
	const anonymous = summarizeSurfaces(anonRaw);
	return { all, anonymous, signedIn: subtractSurfaces(all, anonymous) };
}

/** Per-owner surface breakdowns for a whole league. */
export async function getAllOwnerSurfaces(
	leagueId: string,
	franchiseIds: string[],
): Promise<Record<string, SurfaceBreakdown>> {
	const redis = await getRedis();
	if (!redis) return {};
	const results = await Promise.all(
		franchiseIds.map((id) => redis.hgetall<string>(ownerSurfaceKey(leagueId, id))),
	);
	const out: Record<string, SurfaceBreakdown> = {};
	for (let i = 0; i < franchiseIds.length; i++) {
		out[franchiseIds[i]] = summarizeSurfaces(results[i]);
	}
	return out;
}

/** franchiseId → the surface their most recent visit came from. */
export async function getLastSurfaces(
	leagueId: string,
): Promise<Record<string, VisitContext>> {
	const redis = await getRedis();
	if (!redis) return {};
	const raw = await redis.hgetall<string>(lastSurfaceKey(leagueId));
	if (!raw) return {};
	const out: Record<string, VisitContext> = {};
	for (const [franchiseId, field] of Object.entries(raw)) {
		const ctx = parseSurfaceField(String(field));
		if (ctx) out[franchiseId] = ctx;
	}
	return out;
}

/** Everything the Owner Activity report needs about visit surfaces. */
export interface SurfaceSection {
	surfaces: LeagueSurfaceReport;
	ownerSurfaces: Record<string, SurfaceBreakdown>;
	lastSurfaces: Record<string, VisitContext>;
}

/**
 * One call for the whole App-vs-Browser section. Both league pages are forked
 * siblings (`tests/page-fork-ratchet.test.ts`) — bundling the three reads here
 * keeps the addition to two lines on each side instead of a block that can
 * drift.
 */
export async function getSurfaceSection(
	leagueId: string,
	franchiseIds: string[],
): Promise<SurfaceSection> {
	const [surfaces, ownerSurfaces, lastSurfaces] = await Promise.all([
		getLeagueSurfaceReport(leagueId),
		getAllOwnerSurfaces(leagueId, franchiseIds),
		getLastSurfaces(leagueId),
	]);
	return { surfaces, ownerSurfaces, lastSurfaces };
}

/**
 * Deterministic stand-in for the `?mock=true` preview path, so the section can
 * be designed and reviewed before any real visit has been recorded. The shape
 * is the interesting part: a league where the app is the majority surface on
 * phones and a rounding minority overall, plus owners on both sides of it.
 */
export function mockSurfaceSection(franchiseIds: string[]): SurfaceSection {
	const perOwner: Record<string, SurfaceBreakdown> = {};
	const lastSurfaces: Record<string, VisitContext> = {};
	const platforms: VisitPlatform[] = ['ios', 'android', 'desktop'];
	const raw: Record<string, number> = {};

	franchiseIds.forEach((franchiseId, i) => {
		const platform = platforms[i % platforms.length];
		// Every third owner is a browser holdout; the rest lean on the app.
		const pwa = i % 3 === 2 ? 4 + i : 40 + i * 6;
		const browser = i % 3 === 2 ? 60 + i * 3 : 12 + i;
		perOwner[franchiseId] = summarizeSurfaces({
			[`pwa:${platform}`]: pwa,
			[`browser:${platform}`]: browser,
		});
		lastSurfaces[franchiseId] = { surface: pwa >= browser ? 'pwa' : 'browser', platform };
		raw[`pwa:${platform}`] = (raw[`pwa:${platform}`] ?? 0) + pwa;
		raw[`browser:${platform}`] = (raw[`browser:${platform}`] ?? 0) + browser;
	});

	// Logged-out traffic is browser-heavy by nature — nobody installs a site
	// they have not signed into — so the anon subset skews the other way.
	const anonRaw = { 'browser:desktop': 180, 'browser:ios': 90, 'pwa:ios': 8 };
	for (const [field, count] of Object.entries(anonRaw)) {
		raw[field] = (raw[field] ?? 0) + count;
	}

	const all = summarizeSurfaces(raw);
	const anonymous = summarizeSurfaces(anonRaw);
	return {
		surfaces: { all, anonymous, signedIn: subtractSurfaces(all, anonymous) },
		ownerSurfaces: perOwner,
		lastSurfaces,
	};
}
