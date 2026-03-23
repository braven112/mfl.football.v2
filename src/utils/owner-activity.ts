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

/** Record a visit for a franchise */
export async function recordVisit(leagueId: string, franchiseId: string): Promise<void> {
	const redis = await getRedis();
	if (!redis) return;
	await redis.hset(redisKey(leagueId), { [franchiseId]: Date.now().toString() });
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
