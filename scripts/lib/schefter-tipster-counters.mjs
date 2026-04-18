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
