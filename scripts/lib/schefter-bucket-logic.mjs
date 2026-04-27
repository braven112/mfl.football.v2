/**
 * Schefter rumor-mill bucket logic — shared between the scanner
 * (scripts/schefter-rumor-scan.mjs) and the admin operations dashboard
 * (src/pages/api/admin/schefter-stats.ts).
 *
 * Pure functions. No I/O, no Redis, no fetch — safe to import from a
 * Vercel API route or a Node CLI. Both consumers must agree on bucketing
 * and priority scoring; extracting here is the canonical "single source of
 * truth" so the admin page can show an honest preview of what the next
 * scanner cycle will pick.
 */

export function classifyTipKind(tip) {
  if (!tip) return 'gossip';
  if (tip.source === 'trade_offer') return 'trade';
  return 'gossip';
}

/**
 * Group tips into single-topic buckets. Bucket keys:
 *   - trade_offer tips           → 'trade:offer'
 *   - trade_bait tips            → 'topic:trade_bait:<franchiseId>'
 *   - whisper-back followups     → 'thread:<parentPostId>'
 *   - web/groupme tips           → 'topic:<topic>:<scope>'
 *
 * Web/groupme keys include the franchiseHint (or 'league-wide') as a
 * scope discriminator so two `topic: 'trade'` tips from different sources
 * (one about a specific franchise, one league-wide) don't collapse into
 * a single combined post. Multi-source clustering still works: two
 * tippers naming the SAME franchise on the SAME topic share a key and
 * cluster correctly. Trade-bait tips key per-franchise so an owner's
 * dump only ever produces one post per cycle.
 */
export function buildTopicBuckets(tips) {
  const map = new Map();
  for (const tip of tips) {
    let key;
    if (tip.source === 'trade_offer') {
      key = 'trade:offer';
    } else if (tip.source === 'trade_bait') {
      const scope = tip.franchiseHint ?? 'league-wide';
      key = `topic:trade_bait:${scope}`;
    } else if (typeof tip.repliesToPostId === 'string' && tip.repliesToPostId.length > 0) {
      key = `thread:${tip.repliesToPostId}`;
    } else {
      const topic = tip.topic ?? 'other';
      const scope = tip.franchiseHint && tip.franchiseHint !== 'league-wide'
        ? tip.franchiseHint
        : 'league-wide';
      key = `topic:${topic}:${scope}`;
    }
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        key,
        kind: classifyTipKind(tip),
        tips: [],
        oldestSubmittedAt: tip.submittedAt ?? Date.now(),
      };
      map.set(key, bucket);
    }
    bucket.tips.push(tip);
    if ((tip.submittedAt ?? Date.now()) < bucket.oldestSubmittedAt) {
      bucket.oldestSubmittedAt = tip.submittedAt ?? Date.now();
    }
    // Promote bucket kind to 'trade' if ANY tip in it is trade-classified —
    // shouldn't happen given the bucketing above, but safety-first.
    if (classifyTipKind(tip) === 'trade') bucket.kind = 'trade';
  }
  return [...map.values()];
}

/**
 * Score a bucket for priority selection. Higher = better.
 *
 * Scoring weights (chosen so clusters normally beat singletons, but
 * aging-out singletons eventually overtake fresh clusters before they
 * expire):
 *   - Each additional tip in the bucket: +2 (a 2-tip cluster = +2, 3-tip = +4)
 *   - Each day the oldest tip has been queued: +1
 */
export function bucketPriorityScore(bucket, now = new Date()) {
  const refMs = now instanceof Date ? now.getTime() : Date.now();
  const oldestAgeMs = Math.max(0, refMs - (bucket.oldestSubmittedAt ?? refMs));
  const oldestAgeDays = Math.floor(oldestAgeMs / (24 * 60 * 60 * 1000));
  const sizeScore = Math.max(0, bucket.tips.length - 1) * 2;
  return sizeScore + oldestAgeDays;
}

/**
 * Sort buckets in the order the scanner would pick them — trade buckets
 * first (always win), then gossip buckets by descending priority score.
 * Used by the admin page to preview the next few posts.
 */
export function rankBuckets(buckets, now = new Date()) {
  const trade = buckets.filter((b) => b.kind === 'trade');
  const gossip = buckets.filter((b) => b.kind !== 'trade');
  trade.sort((a, b) => bucketPriorityScore(b, now) - bucketPriorityScore(a, now));
  gossip.sort((a, b) => bucketPriorityScore(b, now) - bucketPriorityScore(a, now));
  return [...trade, ...gossip];
}
