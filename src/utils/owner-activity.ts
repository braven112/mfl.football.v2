/**
 * Owner Activity Tracking
 *
 * Tracks when franchise owners last visited theleague.us.
 * Uses Upstash Redis hash per league: activity:{leagueId} → { franchiseId: timestampMs }
 *
 * Reusable across: activity page, roster headers, trade builder, league summary.
 */

export type ActivityLevel = 'active' | 'idle' | 'dormant' | 'unknown';

type RedisClient = {
	hgetall: <T = Record<string, string>>(key: string) => Promise<T | null>;
	hset: (key: string, data: Record<string, unknown>) => Promise<unknown>;
	hincrby: (key: string, field: string, increment: number) => Promise<number>;
	expire: (key: string, seconds: number) => Promise<unknown>;
	eval: <T = unknown>(script: string, keys: string[], args: (string | number)[]) => Promise<T>;
};

let _redis: RedisClient | null | undefined;

export async function getRedis(): Promise<RedisClient | null> {
	if (_redis !== undefined) return _redis;

	const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL;
	const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN;
	if (!url || !token) {
		_redis = null;
		return null;
	}

	try {
		const { Redis } = await import('@upstash/redis');
		_redis = new Redis({ url, token }) as unknown as RedisClient;
		return _redis;
	} catch (err) {
		console.warn('[owner-activity] Redis unavailable:', err);
		_redis = null;
		return null;
	}
}

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
 * Lua script bundling the four writes recordVisit needs into a single
 * EVAL call. Upstash bills EVAL as one command regardless of how many
 * `redis.call(...)` lines the script contains, so this takes a ~5-command
 * operation (HSET + 3× HINCRBY + EXPIRE-on-every-call) down to 1 command
 * per visit. The EXPIRE guard uses TTL < 0 so it only fires the first
 * time we touch the pageview key each day.
 *
 * KEYS[1] activity hash        ARGV[1] franchiseId
 * KEYS[2] daily pageview hash  ARGV[2] now-ms timestamp string
 * KEYS[3] global pages hash    ARGV[3] pageview TTL seconds
 * KEYS[4] owner pages hash     ARGV[4] normalized page path
 */
const RECORD_VISIT_LUA = `
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
if redis.call('TTL', KEYS[2]) < 0 then
  redis.call('EXPIRE', KEYS[2], ARGV[3])
end
redis.call('HINCRBY', KEYS[3], ARGV[4], 1)
redis.call('HINCRBY', KEYS[4], ARGV[4], 1)
return 1
`;

/** Record a visit for a franchise (updates last-seen, daily page view count, and page popularity) */
export async function recordVisit(leagueId: string, franchiseId: string, page = '/'): Promise<void> {
	const redis = await getRedis();
	if (!redis) return;
	const today = todayISO();
	const pvKey = pageviewKey(leagueId, today);
	// Normalize page path: strip query params, trailing slashes
	const normalizedPage = page.split('?')[0].replace(/\/+$/, '') || '/';

	try {
		await redis.eval(
			RECORD_VISIT_LUA,
			[redisKey(leagueId), pvKey, globalPageKey(leagueId), ownerPageKey(leagueId, franchiseId)],
			[franchiseId, Date.now().toString(), PAGEVIEW_TTL_SECONDS, normalizedPage],
		);
	} catch (err) {
		// Older Redis/Upstash instances without EVAL fall back to the 5-command
		// path so tracking keeps working even if the script layer is unavailable.
		console.warn('[owner-activity] EVAL failed, falling back to pipelined writes:', err);
		await Promise.all([
			redis.hset(redisKey(leagueId), { [franchiseId]: Date.now().toString() }),
			redis.hincrby(pvKey, franchiseId, 1).then(() => redis.expire(pvKey, PAGEVIEW_TTL_SECONDS)),
			redis.hincrby(globalPageKey(leagueId), normalizedPage, 1),
			redis.hincrby(ownerPageKey(leagueId, franchiseId), normalizedPage, 1),
		]);
	}
}

/** Get all franchise activity timestamps for a league */
export async function getAllActivity(leagueId: string): Promise<Record<string, number>> {
	const redis = await getRedis();
	if (!redis) return {};

	const raw = await redis.hgetall<Record<string, string>>(redisKey(leagueId));
	if (!raw) return {};

	const result: Record<string, number> = {};
	for (const [key, value] of Object.entries(raw)) {
		const num = Number(value);
		if (!isNaN(num)) result[key] = num;
	}
	return result;
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
		dates.map((d) => redis.hgetall<Record<string, string>>(pageviewKey(leagueId, d))),
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
	const raw = await redis.hgetall<Record<string, string>>(globalPageKey(leagueId));
	return parsePageCounts(raw);
}

/** Get a single owner's page popularity (sorted by most visited) */
export async function getOwnerPagePopularity(
	leagueId: string,
	franchiseId: string,
): Promise<{ page: string; count: number }[]> {
	const redis = await getRedis();
	if (!redis) return [];
	const raw = await redis.hgetall<Record<string, string>>(ownerPageKey(leagueId, franchiseId));
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
		franchiseIds.map((id) => redis.hgetall<Record<string, string>>(ownerPageKey(leagueId, id))),
	);
	const out: Record<string, { page: string; count: number }[]> = {};
	for (let i = 0; i < franchiseIds.length; i++) {
		out[franchiseIds[i]] = parsePageCounts(results[i]);
	}
	return out;
}
