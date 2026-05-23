/**
 * Shared GroupMe daily-budget + Pacific-Time posting gates.
 *
 * Schefter caps GroupMe pings at MAX_POSTS_PER_DAY per Pacific day and spaces
 * them out. The rumor-mill scanner (scripts/schefter-rumor-scan.mjs) owns the
 * canonical implementation of these gates; this module exists so the
 * transaction scanner (scripts/schefter-scan.mjs) can draw from the SAME daily
 * budget when it pings GroupMe for big-name player drops.
 *
 * Both scanners share two Redis keys:
 *   schefter:rumor:posts_today  (INTEGER, INCR per ping, expires at PT midnight)
 *   schefter:rumor:last_post_ts (INTEGER ms epoch of the last ping)
 *
 * The constants below MUST stay in sync with schefter-rumor-scan.mjs — a
 * source-level guard test (tests/schefter-groupme-budget.test.ts) fails if the
 * rumor scanner's values drift from these.
 */

export const RUMOR_POSTS_TODAY_KEY = 'schefter:rumor:posts_today';
export const RUMOR_LAST_POST_TS_KEY = 'schefter:rumor:last_post_ts';

export const MAX_POSTS_PER_DAY = 3;
export const MIN_SPACING_MS = 4 * 60 * 60 * 1000; // 4h between any two pings
export const QUIET_HOUR_START = 23; // 11pm PT (inclusive)
export const QUIET_HOUR_END = 7; //  7am PT (exclusive)

/** Hour-of-day (0-23) in America/Los_Angeles, regardless of server tz. */
export function getPtHour(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  });
  // "24" can appear at midnight in some environments; normalize to 0.
  return parseInt(fmt.format(now), 10) % 24;
}

/** True during the overnight quiet window (23:00 PT through 06:59 PT). */
export function isQuietHours(now = new Date()) {
  const h = getPtHour(now);
  return h >= QUIET_HOUR_START || h < QUIET_HOUR_END;
}

/** Seconds remaining until the next Pacific-Time midnight (for key TTLs). */
export function secondsUntilPtMidnight(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]),
  );
  const h = parseInt(parts.hour, 10) % 24;
  const m = parseInt(parts.minute, 10);
  const s = parseInt(parts.second, 10);
  return 24 * 3600 - (h * 3600 + m * 60 + s);
}

function toInt(raw) {
  if (typeof raw === 'number') return raw;
  return parseInt(raw ?? '0', 10) || 0;
}

/** Read today's GroupMe post count from Redis. */
export async function readPostsToday(redis) {
  if (!redis) return 0;
  return toInt(await redis.get(RUMOR_POSTS_TODAY_KEY));
}

/**
 * Spacing gate: once at least one ping has gone out today, the next must be at
 * least MIN_SPACING_MS after the last. Returns true when a ping must be HELD.
 */
export function isSpacingHeld(now, lastPostTsMs, postsToday) {
  if (postsToday < 1 || !lastPostTsMs) return false;
  return now.getTime() - lastPostTsMs < MIN_SPACING_MS;
}

/**
 * Decide whether a GroupMe ping may go out right now. The daily CAP is
 * intentionally NOT enforced here — big drops always ping (the caller passes
 * the cap decision) — but quiet hours and spacing always hold a ping back.
 */
export async function evaluatePingWindow(redis, now = new Date()) {
  const postsToday = await readPostsToday(redis);
  const quietHours = isQuietHours(now);
  const lastTs = redis ? toInt(await redis.get(RUMOR_LAST_POST_TS_KEY)) : 0;
  const spacingHeld = isSpacingHeld(now, lastTs, postsToday);
  return {
    ok: !quietHours && !spacingHeld,
    quietHours,
    spacingHeld,
    postsToday,
    atCap: postsToday >= MAX_POSTS_PER_DAY,
  };
}

/** Consume one daily GroupMe slot: bump the counter and stamp last-post time. */
export async function consumeDailyPost(redis, now = new Date()) {
  if (!redis) return;
  const newCount = await redis.incr(RUMOR_POSTS_TODAY_KEY);
  if (newCount === 1) {
    await redis.expire(RUMOR_POSTS_TODAY_KEY, secondsUntilPtMidnight(now));
  }
  await redis.set(RUMOR_LAST_POST_TS_KEY, now.getTime());
}
