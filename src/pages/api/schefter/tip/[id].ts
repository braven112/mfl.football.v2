/**
 * DELETE /api/schefter/tip/{id}
 *
 * 60-second undo for a just-submitted tip. A typo'd tip no longer burns one
 * of the day's 3 slots — within the window the tip is removed from the queue
 * and the rate-limit counter is refunded.
 *
 * Safety properties:
 *  - Ownership is verified server-side: the queued tip's hashedOwnerId must
 *    match the caller's session hash. A client-supplied id alone can never
 *    delete someone else's tip.
 *  - The window is enforced server-side (UNDO_WINDOW_MS + small grace), not
 *    just in the UI.
 *  - Pipeline-safe: the scanner marinates ≥1h before draining, so a 60s undo
 *    can never race a post that already consumed the tip. If the scanner DID
 *    drain it (tip no longer in the queue), we return gone:true and refund
 *    nothing.
 *  - Cleans up side effects of submission: topic-timeline ZSET entry is
 *    removed, and the marinate anchor is cleared when the queue empties.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../../utils/auth';
import { hashTipsterId } from '../../../../utils/schefter-tipster-hash';
import { getRedis } from '../../../../utils/redis-client';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../../../utils/api-response';
import { schefterKey } from '../../../../../scripts/lib/schefter-keys.mjs';
import { decrementNamingTarget } from '../../../../../scripts/lib/schefter-naming-rate-limit.mjs';
import { LEAGUE_WIDE_HINT, COMMISH_HINT } from '../../../../types/schefter-tips';
import {
  resolveSchefterLeague,
  leagueHasSchefterTips,
} from '../../../../utils/schefter-league';
import { UNDO_WINDOW_MS } from '../tip';

export const prerender = false;

/** Grace on top of the advertised window — absorbs clock skew + latency. */
const UNDO_GRACE_MS = 15_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export const DELETE: APIRoute = async ({ request, params }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!user.franchiseId) return json({ error: 'no_franchise' }, 403);

  const league = resolveSchefterLeague({ user, url: new URL(request.url) });
  if (!league) return json({ error: 'bad_league' }, 400);
  if (!leagueHasSchefterTips(league)) return json({ error: 'feature_disabled' }, 404);
  const navSlug = league.navSlug;
  const k = (suffix: string) => schefterKey(navSlug, suffix);

  const tipId = params.id;
  if (!tipId || typeof tipId !== 'string') return json({ error: 'id required' }, 400);

  let hashedOwnerId: string;
  try {
    hashedOwnerId = hashTipsterId(user.id);
  } catch {
    return json({ error: 'server_misconfigured' }, 500);
  }

  const redis = await getRedis();
  if (!redis) return json({ error: 'redis_unavailable' }, 503);

  try {
    const queueKey = k('tips:queue');
    // Tips are LPUSHed, so a tip still inside its undo window is always near
    // the head of the list. Bound the read so a backed-up queue (scanner
    // paused for weeks) can't turn every undo into a full-list transfer.
    const raw = await redis.lrange<string>(queueKey, 0, 49);
    const entries = Array.isArray(raw) ? raw : [];

    let matchedRaw: string | null = null;
    let matched: { id?: string; hashedOwnerId?: string; submittedAt?: number; topic?: string; franchiseHint?: string } | null = null;
    for (const entry of entries) {
      try {
        const parsed = typeof entry === 'string' ? JSON.parse(entry) : entry;
        if (parsed?.id === tipId) {
          matchedRaw = typeof entry === 'string' ? entry : JSON.stringify(entry);
          matched = parsed;
          break;
        }
      } catch {
        // Malformed queue entry — skip; the scanner has its own handling.
      }
    }

    if (!matched || !matchedRaw) {
      // Already drained (or never existed). Nothing to refund.
      return json({ ok: false, gone: true });
    }

    // Ownership check — the ONLY authorization that matters here.
    if (matched.hashedOwnerId !== hashedOwnerId) {
      // Deliberately the same shape as "gone" — don't confirm to a probing
      // client that someone else's tip id exists in the queue.
      return json({ ok: false, gone: true });
    }

    const submittedAt = typeof matched.submittedAt === 'number' ? matched.submittedAt : 0;
    if (Date.now() - submittedAt > UNDO_WINDOW_MS + UNDO_GRACE_MS) {
      return json({ ok: false, error: 'undo_window_closed', code: 'undo_window_closed' }, 409);
    }

    const removed = await redis.lrem(queueKey, 1, matchedRaw);
    if (!removed) {
      return json({ ok: false, gone: true });
    }

    // Refund/clean every durable signal the submit path wrote, in parallel —
    // the blocks are independent and each tolerates its own failure. The
    // invariant restored: counters correspond 1:1 with tips that STAY queued.
    const refundRateLimit = async () => {
      // Floor at 0 — DECR below zero would let a rapid submit/undo loop bank
      // extra submissions.
      try {
        const rateKey = `${k('tips:ratelimit:')}${hashedOwnerId}`;
        const next = await redis.decr(rateKey);
        if (typeof next === 'number' && next < 0) {
          await redis.incr(rateKey);
        }
      } catch (err) {
        console.warn('[schefter/tip-undo] rate refund failed:', err);
      }
    };
    const cleanTopicTimeline = async () => {
      // Keeps hot-topics counts honest.
      try {
        if (matched?.topic) {
          await redis.zrem(`${k('topic_timeline:')}${matched.topic}`, tipId);
        }
      } catch {
        /* non-fatal */
      }
    };
    const cleanOffTopicTimeline = async () => {
      // The A=C barometer entry's member IS the tip id (tip.ts mints the id
      // before the barometer write for exactly this reason).
      try {
        await redis.zrem(`${k('off_topic:timeline:')}${hashedOwnerId}`, tipId);
      } catch {
        /* non-fatal */
      }
    };
    const refundNamingTarget = async () => {
      // A withdrawn explicit pick must not burn one of the 2-per-30d naming
      // slots for that (tipster, target) pair.
      const hint = matched?.franchiseHint;
      if (hint && hint !== LEAGUE_WIDE_HINT && hint !== COMMISH_HINT) {
        await decrementNamingTarget(hashedOwnerId, hint, redis, navSlug);
      }
    };
    const resetMarinateAnchor = async () => {
      // If the queue just emptied, clear the marinate anchor so the next tip
      // starts a fresh clock instead of inheriting this one's.
      try {
        const len = await redis.llen(queueKey);
        if (len === 0) await redis.del(k('tips:first_tip_ts'));
      } catch {
        /* non-fatal */
      }
    };
    await Promise.all([
      refundRateLimit(),
      cleanTopicTimeline(),
      cleanOffTopicTimeline(),
      refundNamingTarget(),
      resetMarinateAnchor(),
    ]);

    return json({ ok: true });
  } catch (err) {
    console.error('[schefter/tip-undo] error:', err);
    return json({ error: 'redis_unavailable' }, 503);
  }
};
