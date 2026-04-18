#!/usr/bin/env node
/**
 * Schefter — Tip of the Week Award (Phase 10)
 *
 * Run weekly (target: Sunday night PT). For each rumor_mill post committed in
 * the last 7 days, read impressions, pick the top, look up the contributing
 * hashedOwnerIds via the stored tipIds, and mark each one with a "tip of the
 * week" badge keyed by ISO week.
 *
 *   node scripts/schefter-award-tip-of-the-week.mjs          # live
 *   node scripts/schefter-award-tip-of-the-week.mjs --dry-run
 *
 * Redis keys touched:
 *   schefter:rumor:impressions:{postId}      READ
 *   schefter:tips:processed                  READ (tip payloads archived by scanner)
 *   schefter:tipster:badges:{hashedOwnerId}  WRITE  SADD `totw-YYYY-WNN`
 *   schefter:rumor:totw:{YYYY-WNN}           WRITE  SET postId (one winner per week)
 *
 * The tips queue is drained after each scanner run, but the scanner archives
 * each batch's processed tip payloads under `schefter:tips:processed` with a
 * 24h TTL. Because TOTW runs weekly, that's too short — this script opens
 * the feed-side `tipIds` array as the primary source of truth and resolves
 * tipster hashes via `schefter:tipster_hash_for_tip:{tipId}`, which the
 * scanner records alongside each processed tip payload.
 *
 * If those lookups fail (e.g. because the audit TTL expired or the scanner
 * predates this feature), the script still records the winning postId so the
 * feed card can display it — the badges are best-effort.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DRY_RUN = process.argv.includes('--dry-run');
const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FEED_PATH = path.join(projectRoot, 'src', 'data', 'theleague', 'schefter-feed.json');

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const IMPRESSION_KEY_PREFIX = 'schefter:rumor:impressions:';
const BADGE_KEY_PREFIX = 'schefter:tipster:badges:';
const TOTW_POST_KEY_PREFIX = 'schefter:rumor:totw:';
const HASH_FOR_TIP_KEY_PREFIX = 'schefter:tipster_hash_for_tip:';

function log(...a) { console.log(...a); }
function warn(...a) { console.warn(...a); }

async function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    warn('[totw] Redis credentials not set — exiting');
    return null;
  }
  const { Redis } = await import('@upstash/redis');
  return new Redis({ url, token });
}

function isoWeekKey(date = new Date()) {
  // ISO 8601 week — algorithm from Date Wiki (Mondays, week 1 contains Jan 4).
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const diff = (d - firstThursday) / 86400000;
  const week = 1 + Math.round(diff / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function main() {
  const redis = await getRedis();
  if (!redis) return 0;

  const feed = JSON.parse(await fs.readFile(FEED_PATH, 'utf8'));
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  const candidates = (feed.posts || []).filter((p) => {
    if (p.transactionSubType !== 'rumor_mill') return false;
    const ts = new Date(p.timestamp).getTime();
    return Number.isFinite(ts) && ts >= cutoff && ts <= now;
  });

  log(`[totw] ${candidates.length} rumor_mill posts in last 7 days`);
  if (candidates.length === 0) {
    log('[totw] No candidates — skipping award');
    return 0;
  }

  // Pull impressions for each candidate
  let winner = null;
  let winnerImpressions = -1;
  for (const post of candidates) {
    try {
      const raw = await redis.get(IMPRESSION_KEY_PREFIX + post.id);
      const n = raw === null || raw === undefined ? 0 : parseInt(String(raw), 10);
      const impressions = Number.isFinite(n) ? n : 0;
      log(`  ${post.id}  impressions=${impressions}`);
      if (impressions > winnerImpressions) {
        winner = post;
        winnerImpressions = impressions;
      }
    } catch (err) {
      warn(`  [totw] impression read failed for ${post.id}: ${err.message}`);
    }
  }

  if (!winner || winnerImpressions <= 0) {
    log('[totw] No post has any impressions yet — nothing to award');
    return 0;
  }

  const weekKey = isoWeekKey(new Date(winner.timestamp));
  const badge = `totw-${weekKey}`;
  const tipIds = Array.isArray(winner.tipIds) ? winner.tipIds : [];

  log(`[totw] Winner: ${winner.id} (${weekKey}) with ${winnerImpressions} impressions, ${tipIds.length} contributing tipIds`);

  if (DRY_RUN) {
    log(`[totw] [dry-run] Would SET ${TOTW_POST_KEY_PREFIX}${weekKey} = ${winner.id}`);
    log(`[totw] [dry-run] Would SADD badge ${badge} to up to ${tipIds.length} tipsters`);
    return 0;
  }

  // Record the winning post id per week (idempotent — rerun overwrites on ties)
  try {
    await redis.set(TOTW_POST_KEY_PREFIX + weekKey, winner.id);
  } catch (err) {
    warn(`[totw] winner set failed: ${err.message}`);
  }

  // Resolve contributing hashes and award badges. If the hash-for-tip audit
  // key is gone (24h TTL on processed list), skip that tipster — the badge
  // is best-effort and should never crash the run.
  let awarded = 0;
  for (const tipId of tipIds) {
    try {
      const hash = await redis.get(HASH_FOR_TIP_KEY_PREFIX + tipId);
      if (!hash || typeof hash !== 'string') continue;
      await redis.sadd(BADGE_KEY_PREFIX + hash, badge);
      awarded++;
    } catch (err) {
      warn(`[totw] badge award failed for tip ${tipId}: ${err.message}`);
    }
  }
  log(`[totw] Awarded ${badge} to ${awarded} tipster(s)`);
  return awarded;
}

main()
  .then((n) => {
    log(`\n=== TOTW done. Badges issued: ${n} ===`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('[totw] Fatal:', err);
    process.exit(1);
  });
