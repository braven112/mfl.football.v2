/**
 * Tipster context — per-tipster signals used to weight bucket priority and
 * to surface human-reflex framing in the LLM prompt.
 *
 * The scanner builds a Map<hashedOwnerId, TipsterContext> once per cycle from
 * the queued tips + Redis counters, then threads it through:
 *   - bucketPriorityScore (lifts first-time voices, discounts the regulars)
 *   - anonymizeTips (sets per-tip `firstTimeTipster` / `prolificTipster`
 *     / `tipsterBeat` flags that drive HARD RULES in the system prompt)
 *
 * Pure shape contract — no I/O in the scoring path. The Redis fetch is the
 * one and only side-effectful step (buildTipsterContext); everything
 * downstream reads the assembled map.
 *
 * Counter sources:
 *   - lifetime posts:        schefter:tipster:rumors_total:{hash}
 *   - lifetime topic mix:    schefter:tipster:topic_counts:{hash}  (HASH topic→count)
 *
 * Per-cycle queue counts come from the freshTips array directly — they don't
 * need a Redis read.
 */

const RUMORS_TOTAL_PREFIX = 'schefter:tipster:rumors_total:';
const TOPIC_COUNTS_PREFIX = 'schefter:tipster:topic_counts:';

// Thresholds — pulled out as named constants so they're easy to tune without
// hunting through scoring logic. Numbers chosen so a first-timer always
// jumps a same-sized cluster from a chatty regular, but a 2-tip cluster
// from the regular still beats a fresh-but-empty bucket.
export const FIRST_TIME_BOOST = 5;
export const PROLIFIC_THRESHOLD = 10;     // lifetime posts to count as "the regular"
export const PROLIFIC_PENALTY = -1;
export const BURST_HEAVY_PENALTY = -3;    // 3+ tips in current queue from same hash
export const BURST_LIGHT_PENALTY = -1;    // exactly 2 in current queue
export const BEAT_TIP_FLOOR = 3;          // need at least this many lifetime posts to assign a beat
export const BEAT_CONCENTRATION = 0.6;    // top topic must be this share of total

/**
 * @typedef {Object} TipsterContext
 * @property {string} hashedOwnerId
 * @property {number} tipsInQueue      Distinct queued web tips by this tipster this cycle.
 * @property {number} rumorsTotal      Lifetime rumor-mill posts they've contributed to.
 * @property {boolean} isFirstTime     True iff rumorsTotal === 0 (no shipped post ever).
 * @property {boolean} isProlific      True iff rumorsTotal >= PROLIFIC_THRESHOLD.
 * @property {?{topic: string, count: number, total: number, share: number}} beat
 *   Top-topic affinity. Null when the tipster hasn't earned a beat yet
 *   (lifetime < BEAT_TIP_FLOOR or top-topic share < BEAT_CONCENTRATION).
 */

/**
 * Read a HASH from Redis and coerce numeric values. Tolerates the upstash
 * client returning either strings or numbers depending on serialization.
 * Returns an empty object on any error.
 */
async function readHash(redis, key) {
  try {
    const raw = await redis.hgetall(key);
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function deriveBeat(topicCounts) {
  let total = 0;
  let topTopic = null;
  let topCount = 0;
  for (const [topic, count] of Object.entries(topicCounts)) {
    total += count;
    if (count > topCount) {
      topCount = count;
      topTopic = topic;
    }
  }
  if (!topTopic || total < BEAT_TIP_FLOOR) return null;
  const share = topCount / total;
  if (share < BEAT_CONCENTRATION) return null;
  return { topic: topTopic, count: topCount, total, share };
}

/**
 * Build a per-tipster context map for this scanner cycle.
 *
 * @param {Array<{source?: string, hashedOwnerId?: string}>} freshTips
 * @param {import('@upstash/redis').Redis | null} redis
 * @returns {Promise<Map<string, TipsterContext>>}
 */
export async function buildTipsterContext(freshTips, redis) {
  const queueCounts = new Map();
  for (const tip of Array.isArray(freshTips) ? freshTips : []) {
    if (tip?.source !== 'web') continue;
    const hash = tip?.hashedOwnerId;
    if (typeof hash !== 'string' || hash.length === 0) continue;
    queueCounts.set(hash, (queueCounts.get(hash) ?? 0) + 1);
  }

  const ctx = new Map();
  if (queueCounts.size === 0) return ctx;

  // Without Redis (offline / dry-run with no env), every tipster looks like
  // a first-timer because we can't read their lifetime history. That's
  // intentional — boost-on-failure is safer than a silent regression to the
  // old size+age-only ordering.
  if (!redis) {
    for (const [hash, count] of queueCounts) {
      ctx.set(hash, {
        hashedOwnerId: hash,
        tipsInQueue: count,
        rumorsTotal: 0,
        isFirstTime: true,
        isProlific: false,
        beat: null,
      });
    }
    return ctx;
  }

  await Promise.all([...queueCounts.entries()].map(async ([hash, count]) => {
    let rumorsTotal = 0;
    try {
      const v = await redis.get(`${RUMORS_TOTAL_PREFIX}${hash}`);
      rumorsTotal = Number(v);
      if (!Number.isFinite(rumorsTotal) || rumorsTotal < 0) rumorsTotal = 0;
    } catch {
      rumorsTotal = 0;
    }
    const topicCounts = await readHash(redis, `${TOPIC_COUNTS_PREFIX}${hash}`);
    const beat = deriveBeat(topicCounts);
    ctx.set(hash, {
      hashedOwnerId: hash,
      tipsInQueue: count,
      rumorsTotal,
      isFirstTime: rumorsTotal === 0,
      isProlific: rumorsTotal >= PROLIFIC_THRESHOLD,
      beat,
    });
  }));

  return ctx;
}

/**
 * Tipster-aware delta for a bucket's priority score. Designed so a single
 * first-time voice anywhere in the bucket lifts it over a same-sized cluster
 * from the league's chattiest tipster, while preserving the existing age +
 * cluster-size signal. Pure function — no I/O.
 *
 * The math: the strongest first-time boost across the bucket's tippers wins,
 * stacked with the harshest active penalty (burst > prolific). A bucket that
 * mixes a first-timer with a regular still gets the first-timer boost — what
 * the new voice is willing to tip about is the story.
 */
export function tipsterScoreDelta(bucket, tipsterContext) {
  if (!tipsterContext || !bucket || !Array.isArray(bucket.tips)) return 0;

  const hashes = new Set();
  for (const tip of bucket.tips) {
    if (tip?.source === 'web' && typeof tip.hashedOwnerId === 'string' && tip.hashedOwnerId) {
      hashes.add(tip.hashedOwnerId);
    }
  }
  if (hashes.size === 0) return 0;

  let bestBoost = 0;
  let worstPenalty = 0;
  for (const hash of hashes) {
    const c = tipsterContext.get(hash);
    if (!c) continue;
    if (c.isFirstTime) {
      if (FIRST_TIME_BOOST > bestBoost) bestBoost = FIRST_TIME_BOOST;
    }
    if (c.tipsInQueue >= 3) {
      if (BURST_HEAVY_PENALTY < worstPenalty) worstPenalty = BURST_HEAVY_PENALTY;
    } else if (c.tipsInQueue === 2) {
      if (BURST_LIGHT_PENALTY < worstPenalty) worstPenalty = BURST_LIGHT_PENALTY;
    }
    if (c.isProlific) {
      if (PROLIFIC_PENALTY < worstPenalty) worstPenalty = PROLIFIC_PENALTY;
    }
  }
  return bestBoost + worstPenalty;
}
