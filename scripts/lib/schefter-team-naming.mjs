/**
 * Schefter Team-Naming Counter
 *
 * Tracks how many Schefter rumor-mill posts have named each franchise in a
 * rolling 30-day window. Drives two consumers:
 *   1. Drama escalation in the prompt — the scanner reads each tip's target
 *      franchise's 30d name count and stamps it on the safe tip as
 *      `nameCount30d` so the LLM can escalate framing
 *      ("the Geeks keep coming up", "most-named team in the rumor mill").
 *   2. The "Hottest desks this week" sidebar widget on /theleague/news,
 *      which queries getTopNamedTeams() at SSR time.
 *
 * Schema:
 *   schefter:team_name_count:{franchiseId}
 *     ZSET — score = postTimestamp_ms, member = postId
 *     EXPIRE 30d on every ZADD so the key auto-cleans after 30d of silence
 *
 * Reads use ZCOUNT (now - windowMs, +inf) so old entries don't poison the
 * count even before they're trimmed. The trimming is opportunistic — if you
 * want a tighter bound on storage, ZREMRANGEBYSCORE could run on every
 * write, but ZSETs of postIds in a 30d window stay small (sub-100 entries
 * per franchise even on busy weeks) so the cost isn't worth the round-trip.
 */

const TEAM_NAMING_PREFIX = 'schefter:team_name_count:';
const TEAM_NAMING_TTL_SEC = 30 * 24 * 60 * 60; // 30d
const DAY_MS = 24 * 60 * 60 * 1000;

function buildKey(franchiseId) {
  return `${TEAM_NAMING_PREFIX}${franchiseId}`;
}

/**
 * Record that a rumor-mill post named a specific franchise. Called by the
 * scanner's post-commit hook for any post whose scope names a team
 * (franchise-explicit-pick / franchise-multi-source / trade-bait).
 *
 * Idempotent on (franchiseId, postId) — re-recording the same post does not
 * inflate the count because ZADD with the same member updates the score
 * rather than adding a duplicate.
 *
 * @param {string} franchiseId
 * @param {string} postId
 * @param {number} postTimestampMs - epoch ms; used as the ZSET score
 * @param {import('@upstash/redis').Redis} redis
 */
export async function recordTeamNaming(franchiseId, postId, postTimestampMs, redis) {
  if (!redis || !franchiseId || !postId) return;
  const ts = Number.isFinite(postTimestampMs) ? postTimestampMs : Date.now();
  const key = buildKey(franchiseId);
  await redis.zadd(key, { score: ts, member: postId });
  // Refresh TTL on every write so an actively-named team's window stays open.
  // Unlike the rate-limit key, here we WANT activity to extend retention —
  // a team that just got named again clearly belongs in the data set.
  await redis.expire(key, TEAM_NAMING_TTL_SEC);
}

/**
 * Returns the number of times this franchise has been named in the last
 * `windowDays` days (default 30). Drives the prompt's drama-escalation
 * ladder (1 → light, 2-3 → "keeps coming up", 4+ → "most-named").
 *
 * @param {string} franchiseId
 * @param {import('@upstash/redis').Redis} redis
 * @param {number} [windowDays=30]
 * @returns {Promise<number>}
 */
export async function getTeamNameCount30d(franchiseId, redis, windowDays = 30) {
  if (!redis || !franchiseId) return 0;
  const key = buildKey(franchiseId);
  const min = Date.now() - windowDays * DAY_MS;
  const raw = await redis.zcount(key, min, '+inf');
  const count = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? '0'), 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/**
 * Returns the top N franchises by name-count over the last `days` days.
 * Powers the "Hottest desks this week" sidebar widget on /theleague/news.
 *
 * Implementation note: there's no single ZSET that aggregates across teams,
 * so we enumerate the per-team keys via SCAN and read each team's window
 * count. With 16 franchises this is a small fan-out; if the league grows
 * (or this gets called more often than once-per-page-render), we could
 * materialize a top-N ZSET on each recordTeamNaming call instead.
 *
 * @param {import('@upstash/redis').Redis} redis
 * @param {number} [days=7] - rolling window
 * @param {number} [limit=5] - max rows returned
 * @returns {Promise<Array<{franchiseId: string, count: number, lastNamedAt: number}>>}
 *   sorted desc by count, ties broken by most-recent lastNamedAt
 */
export async function getTopNamedTeams(redis, days = 7, limit = 5) {
  if (!redis) return [];
  const min = Date.now() - days * DAY_MS;

  // Enumerate every team-naming key via SCAN. Match pattern is the prefix
  // plus a wildcard. Use a generous COUNT to keep iterations short.
  const matchPattern = `${TEAM_NAMING_PREFIX}*`;
  const found = [];
  let cursor = 0;
  do {
    const result = await redis.scan(cursor, { match: matchPattern, count: 100 });
    // Upstash returns [nextCursor, keys] tuple OR { cursor, keys } shape
    // depending on client version. Normalize.
    const nextCursor = Array.isArray(result) ? result[0] : result.cursor;
    const keys = Array.isArray(result) ? result[1] : result.keys;
    if (Array.isArray(keys)) {
      for (const k of keys) found.push(k);
    }
    cursor = typeof nextCursor === 'string' ? Number.parseInt(nextCursor, 10) : nextCursor;
    if (!Number.isFinite(cursor)) cursor = 0;
  } while (cursor !== 0);

  if (found.length === 0) return [];

  // For each key, get the count and the most-recent timestamp for tie-break.
  // Run in parallel — 16 teams max, no rate-limit risk.
  const rows = await Promise.all(
    found.map(async (key) => {
      const franchiseId = key.slice(TEAM_NAMING_PREFIX.length);
      const [countRaw, recent] = await Promise.all([
        redis.zcount(key, min, '+inf'),
        // Most-recent member in the window — ZRANGEBYSCORE with WITHSCORES
        // and reverse + limit 1. We just need the score (timestamp) for
        // tie-break, not the member id.
        redis.zrange(key, '+inf', min, {
          byScore: true,
          rev: true,
          offset: 0,
          count: 1,
          withScores: true,
        }),
      ]);
      const count = typeof countRaw === 'number'
        ? countRaw
        : Number.parseInt(String(countRaw ?? '0'), 10);
      let lastNamedAt = 0;
      if (Array.isArray(recent) && recent.length >= 2) {
        // [member, score] pairs — score at index 1
        const score = recent[1];
        lastNamedAt = typeof score === 'number' ? score : Number.parseInt(String(score), 10);
        if (!Number.isFinite(lastNamedAt)) lastNamedAt = 0;
      }
      return {
        franchiseId,
        count: Number.isFinite(count) && count > 0 ? count : 0,
        lastNamedAt,
      };
    }),
  );

  return rows
    .filter((r) => r.count > 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.lastNamedAt - a.lastNamedAt; // tie → most-recent first
    })
    .slice(0, limit);
}
