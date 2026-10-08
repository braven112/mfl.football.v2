/**
 * Site Insights — the Redis half. See `site-insights-model.ts` for what is
 * tracked and why every field is bounded.
 *
 * KEYS (all under `insights:`; daily keys expire after INSIGHTS_TTL_DAYS):
 *
 * - `insights:d:<date>:pages`        `<section>|<page>` → views (everyone)
 * - `insights:d:<date>:visitors`     `anon|<section>` → signed-out views
 * - `insights:d:<date>:usersections` `<visitor>|<section>` → views
 * - `insights:d:<date>:userpages`    `<visitor>|<section>|<page>` → views
 * - `insights:d:<date>:hours`        `<section>|<hour>` → views
 * - `insights:d:<date>:devices`      `<section>|<device>` → views
 * - `insights:d:<date>:sources`      `<section>|<source>` → tab landings
 * - `insights:d:<date>:actions`      `<section>|<action>` → count
 * - `insights:d:<date>:useractions`  `<visitor>|<action>` → count
 * - `insights:d:<date>:logins`       `<visitor>` → sign-ins
 * - `insights:d:<date>:links`        `<section>|<area>|<page>` → arrivals by an
 *                                    in-site link (`-` = page not nameable)
 * - `insights:d:<date>:userlinks`    `<visitor>|<section>|<area>` → arrivals
 * - `insights:lastseen` / `insights:lastlogin`  `<visitor>` → epoch ms
 * - `insights:names`                 `<visitor>` → MFL username
 *
 * The three un-dated hashes do not expire: they hold one field per owner who
 * has ever signed in, which is bounded by the leagues' size.
 *
 * `<visitor>` is `<leagueId>:<franchiseId>` (see `visitorKey`). The date and
 * hour are on the league's OFFICIAL clock, so "Sunday 10am" means what an
 * owner means by it rather than UTC.
 *
 * Every write is ONE EVAL (Upstash bills a script as a single command) and
 * never throws: analytics must never break a page view, a login or a lineup.
 * Writes are awaited by callers because a serverless function can be frozen
 * the moment its response returns.
 */

import { getRedis } from './redis-client';
import { getLeagueTeamConfigs } from './league-team-brands';
import { isCommissionerOrAdmin, type AuthUser } from './auth';
import {
	ALL_LEAGUES,
	getLeagueById,
	getLeagueBySlug,
	leagueClock,
	DEFAULT_LEAGUE_SLUG,
} from '../config/leagues';
import {
	ANONYMOUS_INSIGHT_ACTIONS,
	INSIGHTS_OWNER,
	INSIGHTS_TTL_SECONDS,
	insightClock,
	insightDates,
	visitorKey,
	type InsightAction,
	type InsightDayRaw,
	type InsightDevice,
	type InsightLinkArea,
	type InsightPerson,
	type InsightSource,
} from './site-insights-model';

const PREFIX = 'insights';
const dayKey = (date: string, name: string) => `${PREFIX}:d:${date}:${name}`;
const LAST_SEEN = `${PREFIX}:lastseen`;
const LAST_LOGIN = `${PREFIX}:lastlogin`;
const NAMES = `${PREFIX}:names`;

const DAY_HASHES = [
	'pages',
	'visitors',
	'usersections',
	'userpages',
	'hours',
	'devices',
	'sources',
	'actions',
	'useractions',
	'logins',
	'links',
	'userlinks',
] as const;

function clockNow(now = new Date()) {
	return insightClock(now, leagueClock(DEFAULT_LEAGUE_SLUG).zone);
}

/**
 * Who may read the report: TheLeague's franchise 0001, signed in to
 * TheLeague, with the commissioner/admin role. All three, so neither the
 * AFL's franchise 0001 nor another league's commissioner qualifies.
 */
export function canViewSiteInsights(user: AuthUser | null | undefined): boolean {
	if (!user) return false;
	const league = getLeagueBySlug(INSIGHTS_OWNER.leagueSlug);
	if (!league || user.leagueId !== league.id) return false;
	if (user.franchiseId !== INSIGHTS_OWNER.franchiseId) return false;
	return isCommissionerOrAdmin(user);
}

/** Who did something: an `AuthUser` fits, as does a resolved caller. */
export interface InsightActor {
	leagueId: string;
	franchiseId: string;
	name?: string;
}

/** The section an owner's own actions belong to: their session's league. */
function sectionForUser(user: InsightActor): string {
	return getLeagueById(user.leagueId)?.slug ?? 'live';
}

// ── Visits ──────────────────────────────────────────────────────────────────

/**
 * KEYS[1..9] pages, visitors, usersections, userpages, hours, devices,
 *            sources, lastseen, names      KEYS[10] rate-limit counter
 * ARGV[1] ttl      ARGV[2] section   ARGV[3] page ('' = don't name it)
 * ARGV[4] visitor ('' = anonymous)    ARGV[5] now ms   ARGV[6] username
 * ARGV[7] hour     ARGV[8] device ('' = skip)   ARGV[9] source ('' = skip)
 * ARGV[10] rate max ('0' = no limit)  ARGV[11] rate window seconds
 * KEYS[11] links  KEYS[12] userlinks   ARGV[12] link area ('' = skip)
 *
 * Returns 0 when rate-limited (nothing written), else 1.
 */
const VISIT_SCRIPT = `
if tonumber(ARGV[10]) > 0 then
  local n = redis.call('INCR', KEYS[10])
  if n == 1 then redis.call('EXPIRE', KEYS[10], ARGV[11]) end
  if n > tonumber(ARGV[10]) then return 0 end
end
local function bump(key, field)
  redis.call('HINCRBY', key, field, 1)
  if redis.call('TTL', key) < 0 then redis.call('EXPIRE', key, ARGV[1]) end
end
local s = ARGV[2]
if ARGV[3] ~= '' then bump(KEYS[1], s .. '|' .. ARGV[3]) end
if ARGV[4] == '' then
  bump(KEYS[2], 'anon|' .. s)
else
  bump(KEYS[3], ARGV[4] .. '|' .. s)
  if ARGV[3] ~= '' then bump(KEYS[4], ARGV[4] .. '|' .. s .. '|' .. ARGV[3]) end
  redis.call('HSET', KEYS[8], ARGV[4], ARGV[5])
  if ARGV[6] ~= '' then redis.call('HSET', KEYS[9], ARGV[4], ARGV[6]) end
end
bump(KEYS[5], s .. '|' .. ARGV[7])
if ARGV[8] ~= '' then bump(KEYS[6], s .. '|' .. ARGV[8]) end
if ARGV[9] ~= '' then bump(KEYS[7], s .. '|' .. ARGV[9]) end
if ARGV[12] ~= '' then
  local p = ARGV[3]
  if p == '' then p = '-' end
  bump(KEYS[11], s .. '|' .. ARGV[12] .. '|' .. p)
  if ARGV[4] ~= '' then bump(KEYS[12], ARGV[4] .. '|' .. s .. '|' .. ARGV[12]) end
end
return 1
`;

export interface InsightVisit {
	section: string;
	/** Normalized path, or null when it may not be named (unknown anon path). */
	page: string | null;
	/** Signed-in owner, or null for a signed-out visitor. */
	user: { leagueId: string; franchiseId: string; username: string } | null;
	device: InsightDevice | null;
	/** Only on a tab's landing beacon. */
	source: InsightSource | null;
	/** The tagged area of the in-site link that brought the visitor here. */
	via?: InsightLinkArea | null;
	/** Anonymous callers only: an opaque per-caller key and its cap. */
	rateLimit?: { callerKey: string; max: number; windowSeconds: number };
}

export async function recordInsightVisit(
	visit: InsightVisit,
	now = new Date(),
): Promise<{ limited: boolean }> {
	try {
		const redis = await getRedis();
		if (!redis) return { limited: false };
		const { date, hour } = clockNow(now);
		const keys = [
			dayKey(date, 'pages'),
			dayKey(date, 'visitors'),
			dayKey(date, 'usersections'),
			dayKey(date, 'userpages'),
			dayKey(date, 'hours'),
			dayKey(date, 'devices'),
			dayKey(date, 'sources'),
			LAST_SEEN,
			NAMES,
			`rate:insights-anon:${visit.rateLimit?.callerKey ?? 'none'}`,
			dayKey(date, 'links'),
			dayKey(date, 'userlinks'),
		];
		const result = await redis.eval<number>(VISIT_SCRIPT, keys, [
			INSIGHTS_TTL_SECONDS,
			visit.section,
			visit.page ?? '',
			visit.user ? visitorKey(visit.user.leagueId, visit.user.franchiseId) : '',
			String(now.getTime()),
			visit.user?.username ?? '',
			String(hour),
			visit.device ?? '',
			visit.source ?? '',
			String(visit.rateLimit?.max ?? 0),
			String(visit.rateLimit?.windowSeconds ?? 60),
			visit.via ?? '',
		]);
		return { limited: Number(result) === 0 };
	} catch (err) {
		console.warn('[site-insights] visit write failed:', err);
		return { limited: false };
	}
}

// ── Actions & logins ────────────────────────────────────────────────────────

/**
 * KEYS[1] actions  KEYS[2] useractions  KEYS[3] names
 * ARGV[1] ttl  ARGV[2] section  ARGV[3] action
 * ARGV[4] visitor ('' = count only, see ANONYMOUS_ACTIONS)  ARGV[5] username
 */
const ACTION_SCRIPT = `
local function bump(key, field)
  redis.call('HINCRBY', key, field, 1)
  if redis.call('TTL', key) < 0 then redis.call('EXPIRE', key, ARGV[1]) end
end
bump(KEYS[1], ARGV[2] .. '|' .. ARGV[3])
if ARGV[4] == '' then return 1 end
bump(KEYS[2], ARGV[4] .. '|' .. ARGV[3])
if ARGV[5] ~= '' then redis.call('HSET', KEYS[3], ARGV[4], ARGV[5]) end
return 1
`;

/**
 * Count one successful in-app action. Call it only once the endpoint has
 * definitely succeeded, and await it (see the header). Never throws.
 */
export async function recordInsightAction(
	user: InsightActor | null | undefined,
	action: InsightAction,
	now = new Date(),
): Promise<void> {
	if (!user?.leagueId || !user.franchiseId) return;
	try {
		const redis = await getRedis();
		if (!redis) return;
		const { date } = clockNow(now);
		const anonymous = ANONYMOUS_INSIGHT_ACTIONS.has(action);
		await redis.eval(
			ACTION_SCRIPT,
			[dayKey(date, 'actions'), dayKey(date, 'useractions'), NAMES],
			[
				INSIGHTS_TTL_SECONDS,
				sectionForUser(user),
				action,
				anonymous ? '' : visitorKey(user.leagueId, user.franchiseId),
				anonymous ? '' : user.name ?? '',
			],
		);
	} catch (err) {
		console.warn('[site-insights] action write failed:', err);
	}
}

/**
 * KEYS[1] logins  KEYS[2] lastlogin  KEYS[3] names
 * ARGV[1] ttl  ARGV[2] visitor  ARGV[3] now ms  ARGV[4] username
 */
const LOGIN_SCRIPT = `
redis.call('HINCRBY', KEYS[1], ARGV[2], 1)
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
if ARGV[4] ~= '' then redis.call('HSET', KEYS[3], ARGV[2], ARGV[4]) end
return 1
`;

/** Count one successful sign-in. Never throws. */
export async function recordInsightLogin(
	login: { leagueId: string; franchiseId: string; username: string },
	now = new Date(),
): Promise<void> {
	if (!login.leagueId || !login.franchiseId) return;
	try {
		const redis = await getRedis();
		if (!redis) return;
		const { date } = clockNow(now);
		await redis.eval(
			LOGIN_SCRIPT,
			[dayKey(date, 'logins'), LAST_LOGIN, NAMES],
			[
				INSIGHTS_TTL_SECONDS,
				visitorKey(login.leagueId, login.franchiseId),
				String(now.getTime()),
				login.username ?? '',
			],
		);
	} catch (err) {
		console.warn('[site-insights] login write failed:', err);
	}
}

// ── Reads ───────────────────────────────────────────────────────────────────

function toCounts(raw: Record<string, unknown> | null | undefined): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(raw ?? {})) {
		const n = Number(v);
		if (Number.isFinite(n)) out[k] = n;
	}
	return out;
}

/**
 * Every daily hash for the last `count` days, oldest first, in ONE pipeline.
 * Returns null when Redis is unavailable, so the page can say so rather than
 * render a report of zeros.
 */
export async function readInsightDays(count: number, now = new Date()): Promise<InsightDayRaw[] | null> {
	const redis = await getRedis();
	if (!redis) return null;
	const dates = insightDates(clockNow(now).date, count);
	const pipe = redis.pipeline();
	for (const date of dates) for (const name of DAY_HASHES) pipe.hgetall(dayKey(date, name));
	const results = await pipe.exec<(Record<string, unknown> | null)[]>();
	return dates.map((date, i) => {
		const at = (j: number) => toCounts(results[i * DAY_HASHES.length + j]);
		return {
			date,
			pages: at(0),
			visitors: at(1),
			userSections: at(2),
			userPages: at(3),
			hours: at(4),
			devices: at(5),
			sources: at(6),
			actions: at(7),
			userActions: at(8),
			logins: at(9),
			links: at(10),
			userLinks: at(11),
		};
	});
}

/**
 * Every owner the counters know, merged with the registry leagues' rosters so
 * an owner who has never visited still appears (as never seen) — and with
 * `/activity`'s older `activity:<leagueId>` last-seen hash, which predates
 * these counters and so knows about visits they missed.
 */
export async function readInsightPeople(): Promise<InsightPerson[]> {
	const redis = await getRedis();
	if (!redis) return [];
	const pipe = redis.pipeline();
	pipe.hgetall(LAST_SEEN);
	pipe.hgetall(LAST_LOGIN);
	pipe.hgetall(NAMES);
	const managed = ALL_LEAGUES;
	for (const league of managed) pipe.hgetall(`activity:${league.id}`);
	const [seen, login, names, ...legacy] = await pipe.exec<(Record<string, unknown> | null)[]>();

	const lastSeen = toCounts(seen);
	const lastLogin = toCounts(login);
	const usernames = (names ?? {}) as Record<string, unknown>;
	managed.forEach((league, i) => {
		for (const [fid, ts] of Object.entries(toCounts(legacy[i]))) {
			const key = visitorKey(league.id, fid);
			if ((lastSeen[key] ?? 0) < ts) lastSeen[key] = ts;
		}
	});

	const keys = new Set([...Object.keys(lastSeen), ...Object.keys(lastLogin), ...Object.keys(usernames)]);
	for (const league of managed) {
		for (const team of getLeagueTeamConfigs(league.slug)) {
			if (team?.franchiseId) keys.add(visitorKey(league.id, team.franchiseId));
		}
	}

	return [...keys].map((key) => {
		const i = key.indexOf(':');
		const name = usernames[key];
		return {
			key,
			leagueId: key.slice(0, i),
			franchiseId: key.slice(i + 1),
			username: typeof name === 'string' && name ? name : null,
			lastSeen: lastSeen[key] ?? null,
			lastLogin: lastLogin[key] ?? null,
		};
	});
}
