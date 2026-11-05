/**
 * Season video — limits on its public, unauthenticated endpoints
 * (/api/season-video-sleeper, -espn, -logo).
 *
 * The video is drawn in the visitor's browser, so a real person costs us a
 * page load and a lookup or two. The things worth limiting are a BOT driving
 * our server to fetch from Sleeper, ESPN or an arbitrary logo URL, and a bot
 * filling Redis through the ESPN save (Brandon, 2026-11-05: "make this safe,
 * including the Redis cap").
 *
 * WHICH ADDRESS. `getClientIdentity().client` reads `cf-connecting-ip` first,
 * but no Cloudflare sits in front of this site (Brandon, 2026-11-05), so any
 * caller can send that header with any value and get a fresh limit per
 * request. So every limit here ALSO counts against `nearestHop` — the last
 * X-Forwarded-For entry, which our own platform appends and a caller cannot
 * forge. Served straight from Vercel, that IS the caller's real address. If a
 * proxy is ever put in front, it becomes the proxy's address, which is why
 * its ceiling is set higher than the per-caller one rather than equal.
 *
 * All of it fails open when Redis is down (checkRateLimit), so the edge layer
 * — the Vercel Firewall rate-limit rule on /api/season-video* — is the one
 * that holds without Redis.
 */
import { getClientIdentity } from '../client-ip';
import { checkRateLimit } from '../rate-limit';

const HOUR = 3600;
const DAY = 86_400;

/** Requests per hour, per scope. The hop ceiling covers a forged `client`. */
export const SEASON_VIDEO_LIMITS = {
	'season-video-sleeper': { perClient: 60, perHop: 120 },
	'season-video-espn': { perClient: 60, perHop: 120 },
	'season-video-logo': { perClient: 30, perHop: 60 },
} as const;

export type SeasonVideoScope = keyof typeof SEASON_VIDEO_LIMITS;

/** True when this caller is still inside both of the scope's limits. Consumes one request from each. */
export async function allowSeasonVideoCall(request: Request, scope: SeasonVideoScope): Promise<boolean> {
	const { client, nearestHop } = getClientIdentity(request);
	const limits = SEASON_VIDEO_LIMITS[scope];
	if (nearestHop && !(await checkRateLimit(`${scope}-hop`, nearestHop, limits.perHop, HOUR)).allowed) return false;
	if (client && !(await checkRateLimit(scope, client, limits.perClient, HOUR)).allowed) return false;
	return true;
}

// ── the ESPN save into League History's store ─────────────────────────────

/**
 * A real season with the video's three views is ~100–300 KB of JSON; anything
 * far past that is not one, and is not kept (the owner still gets a video).
 */
export const MAX_ESPN_SAVE_CHARS = 600_000;
/** Snapshots kept per ESPN league per day. A season changes weekly at most. */
export const ESPN_SAVES_PER_LEAGUE_PER_DAY = 5;
/** Snapshots kept per caller per day, across every league id they name. */
export const ESPN_SAVES_PER_CALLER_PER_DAY = 20;
/** Snapshots kept per day site-wide: the hard ceiling on what a bot can add to Redis. */
export const ESPN_SAVES_PER_DAY = 300;

/**
 * Whether an ESPN season read may be SAVED for League History. Reading and
 * the video never depend on it. Order matters: the cheap size check first,
 * then the narrow counters, so a refused caller never spends the site-wide one.
 */
export async function allowEspnSave(request: Request, leagueId: string, chars: number): Promise<boolean> {
	if (chars > MAX_ESPN_SAVE_CHARS) return false;
	const { nearestHop } = getClientIdentity(request);
	if (!(await checkRateLimit('espn-save-league', leagueId, ESPN_SAVES_PER_LEAGUE_PER_DAY, DAY)).allowed) return false;
	if (nearestHop && !(await checkRateLimit('espn-save-hop', nearestHop, ESPN_SAVES_PER_CALLER_PER_DAY, DAY)).allowed) return false;
	return (await checkRateLimit('espn-save-all', 'all', ESPN_SAVES_PER_DAY, DAY)).allowed;
}
