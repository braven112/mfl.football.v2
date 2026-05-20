/**
 * Schefter Tipster Counter Helpers
 *
 * Mutates the Phase 6 scorecard state in Redis after a rumor post is committed.
 * Kept alongside the scanner (rather than importing the .ts helpers) so this
 * module can run in a plain Node runtime without a build step.
 *
 * Counters:
 *   schefter:tipster:codename:{hash}                    STRING   assigned codename
 *   schefter:tipster:codenames_used                     SET      claimed base names (uniqueness)
 *   schefter:tipster:rumors_total:{hash}                STRING   lifetime count
 *   schefter:tipster:rumors_season:{YYYY}:{hash}        STRING   per-league-year count
 *   schefter:tipster:leaderboard:{YYYY}                 ZSET     member=hash, score=count
 *
 * Identity-sensitive: the member in the leaderboard ZSET is a hashedOwnerId.
 * The API layer (tipster-stats.ts) looks up each member's codename before
 * returning the leaderboard so the hash never leaves the server.
 */

const CODENAME_KEY_PREFIX = 'schefter:tipster:codename:';
const CODENAMES_USED_KEY = 'schefter:tipster:codenames_used';
const RUMORS_TOTAL_PREFIX = 'schefter:tipster:rumors_total:';
const RUMORS_SEASON_PREFIX = 'schefter:tipster:rumors_season:';
const LEADERBOARD_PREFIX = 'schefter:tipster:leaderboard:';
// Per-tipster topic histogram, populated alongside the rumor counters above.
// HASH: topic → lifetime count. Read by buildTipsterContext (lib/schefter-
// tipster-context.mjs) to derive a "standing beat" — the topic share that
// HARD RULE 24 surfaces in the prompt without ever attaching a codename.
const TOPIC_COUNTS_PREFIX = 'schefter:tipster:topic_counts:';

/** Must stay in sync with src/utils/schefter-codenames.ts. */
const SCHEFTER_CODENAMES = [
  'Burner Phone',
  'Back-Channel',
  'The Leak',
  'Smoke Signal',
  'Off the Record',
  'Unnamed Source',
  'The Whisper',
  'Sources Say',
  'League Source',
  'Close to the Situation',
  'Someone Familiar',
  'The Insider',
  'Rolodex',
  'The Wire',
  'The Dossier',
  'A Longtime Observer',
  'The Tipline',
  'Anonymous Veteran',
  'Blind Item',
  'Hot Mic',
  'Green Room',
  'The Ledger',
  'Earpiece',
  'Cold Case',
  'The Courier',
  'The Ghost',
  'Static',
  'Hearsay',
  'Room Service',
];

function seedSlot(hashedOwnerId) {
  if (!hashedOwnerId) return 0;
  const prefix = String(hashedOwnerId).slice(0, 8);
  const n = parseInt(prefix, 16);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) % SCHEFTER_CODENAMES.length;
}

/**
 * Claim an unused codename for a tipster. Idempotent. If the user already has
 * one, returns it. Returns `null` only if `redis` is missing.
 */
export async function assignCodename(redis, hashedOwnerId) {
  if (!redis || !hashedOwnerId) return null;

  const userKey = CODENAME_KEY_PREFIX + hashedOwnerId;
  const existing = await redis.get(userKey);
  if (typeof existing === 'string' && existing.length > 0) return existing;

  const start = seedSlot(hashedOwnerId);
  const total = SCHEFTER_CODENAMES.length;

  for (let i = 0; i < total; i++) {
    const candidate = SCHEFTER_CODENAMES[(start + i) % total];
    const added = await redis.sadd(CODENAMES_USED_KEY, candidate);
    if (added === 1) {
      const writeRes = await redis.set(userKey, candidate, { nx: true });
      if (writeRes === 'OK' || writeRes === true) return candidate;
      // Lost the race — release the hold and pick up the winner's name.
      await redis.srem(CODENAMES_USED_KEY, candidate);
      const actual = await redis.get(userKey);
      if (typeof actual === 'string' && actual.length > 0) return actual;
    }
  }

  const fallback = `${SCHEFTER_CODENAMES[start]} ${String(hashedOwnerId).slice(0, 4)}`;
  const writeRes = await redis.set(userKey, fallback, { nx: true });
  if (writeRes === 'OK' || writeRes === true) return fallback;
  const actual = await redis.get(userKey);
  return typeof actual === 'string' && actual.length > 0 ? actual : fallback;
}

/**
 * Increment scorecard counters for each distinct web tipster in the batch
 * that produced this rumor. Safely no-ops in --dry-run or when the batch
 * contains no web tips.
 *
 * @param {object} opts
 * @param {import('@upstash/redis').Redis} opts.redis
 * @param {Array<{source: string, hashedOwnerId?: string}>} opts.batch
 * @param {number} opts.seasonYear - 4-digit league year (see getCurrentLeagueYear)
 * @param {boolean} [opts.dryRun]
 * @param {(msg: string) => void} [opts.log]
 * @param {(msg: string) => void} [opts.warn]
 */
export async function incrementTipsterCounters({
  redis,
  batch,
  seasonYear,
  dryRun = false,
  log = () => {},
  warn = () => {},
}) {
  if (!redis || !Array.isArray(batch) || batch.length === 0) return;

  // Only web tips carry an owner hash — groupme/trade_offer tips do not count
  // toward the tipster scorecard per the engagement plan.
  const distinctHashes = new Set();
  for (const tip of batch) {
    if (tip && tip.source === 'web' && typeof tip.hashedOwnerId === 'string' && tip.hashedOwnerId.length > 0) {
      distinctHashes.add(tip.hashedOwnerId);
    }
  }
  if (distinctHashes.size === 0) {
    log('  [tipster-counters] no web tippers in batch — skipping');
    return;
  }

  if (dryRun) {
    log(`  [dry-run] Would increment tipster counters for ${distinctHashes.size} contributor(s): season=${seasonYear}`);
    return;
  }

  const leaderboardKey = `${LEADERBOARD_PREFIX}${seasonYear}`;

  for (const hash of distinctHashes) {
    try {
      await assignCodename(redis, hash);

      const totalKey = `${RUMORS_TOTAL_PREFIX}${hash}`;
      const seasonKey = `${RUMORS_SEASON_PREFIX}${seasonYear}:${hash}`;

      await Promise.all([
        redis.incr(totalKey),
        redis.incr(seasonKey),
        redis.zincrby(leaderboardKey, 1, hash),
      ]);
    } catch (err) {
      warn(`  [tipster-counters] increment failed for one contributor: ${err.message}`);
    }
  }

  log(`  [tipster-counters] updated ${distinctHashes.size} contributor(s)`);
}

/**
 * Increment the per-tipster topic histogram. Called after a rumor ships, in
 * parallel with incrementTipsterCounters. One increment per (tipster, topic)
 * pair in the batch — a tipster who contributed two trade tips to the same
 * post counts +1 for "trade", not +2, so the histogram tracks distinct
 * authoritative beats per post rather than tip volume.
 *
 * The histogram drives HARD RULE 24 (standing beat) via buildTipsterContext.
 * Only web tips count — groupme tips are already attributable and don't
 * benefit from a standing-beat hint; trade_offer tips have no tipster at all.
 *
 * @param {object} opts
 * @param {import('@upstash/redis').Redis} opts.redis
 * @param {Array<{source: string, hashedOwnerId?: string, topic?: string}>} opts.batch
 * @param {boolean} [opts.dryRun]
 * @param {(msg: string) => void} [opts.log]
 * @param {(msg: string) => void} [opts.warn]
 */
export async function incrementTipsterTopicCounters({
  redis,
  batch,
  dryRun = false,
  log = () => {},
  warn = () => {},
}) {
  if (!redis || !Array.isArray(batch) || batch.length === 0) return;

  // Dedup to (hash, topic) pairs so a tipster who tipped two roster items in
  // the same batch counts +1 for "roster", not +2. This keeps the histogram
  // a fair measure of WHAT a tipster reliably reports on, not how many
  // overlapping tips they happened to send.
  const pairs = new Map(); // hash → Set<topic>
  for (const tip of batch) {
    if (!tip || tip.source !== 'web') continue;
    const hash = typeof tip.hashedOwnerId === 'string' ? tip.hashedOwnerId : '';
    const topic = typeof tip.topic === 'string' && tip.topic.length > 0 ? tip.topic : 'other';
    if (!hash) continue;
    if (!pairs.has(hash)) pairs.set(hash, new Set());
    pairs.get(hash).add(topic);
  }
  if (pairs.size === 0) {
    log('  [tipster-topic-counters] no web tippers in batch — skipping');
    return;
  }

  if (dryRun) {
    const summary = [...pairs.entries()]
      .map(([h, topics]) => `${h.slice(0, 6)}:[${[...topics].join(',')}]`)
      .join(', ');
    log(`  [dry-run] Would increment topic counters: ${summary}`);
    return;
  }

  for (const [hash, topics] of pairs) {
    for (const topic of topics) {
      try {
        await redis.hincrby(`${TOPIC_COUNTS_PREFIX}${hash}`, topic, 1);
      } catch (err) {
        warn(`  [tipster-topic-counters] increment failed for ${hash.slice(0, 6)} topic=${topic}: ${err.message}`);
      }
    }
  }
  log(`  [tipster-topic-counters] updated ${pairs.size} contributor(s)`);
}
