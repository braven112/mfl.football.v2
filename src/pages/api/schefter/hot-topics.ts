/**
 * GET /api/schefter/hot-topics
 *
 * Rolling 7-day counts per tip topic (Phase 9). The tip submit endpoint writes
 * one entry per tip into `schefter:topic_timeline:{topic}` (ZSET scored by
 * submit timestamp). This endpoint counts each topic's membership in the last
 * 7 days via ZCOUNT and returns the totals sorted descending.
 *
 * Body:
 *   { topics: Array<{ topic: TipTopic, count: number }>, windowDays: number }
 *
 * Public — no identity signal. Counts ≠ tip content.
 */

import type { APIRoute } from 'astro';
import { TIP_TOPICS, type TipTopic } from '../../../types/schefter-tips';
import { getRedis } from '../../../utils/redis-client';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../../utils/api-response';

export const prerender = false;

const WINDOW_DAYS = 7;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export const GET: APIRoute = async () => {
  const redis = await getRedis();
  if (!redis) {
    return json({ topics: [], windowDays: WINDOW_DAYS });
  }

  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const results: Array<{ topic: TipTopic; count: number }> = [];

  await Promise.all(
    (TIP_TOPICS as readonly TipTopic[]).map(async (topic) => {
      try {
        const count = await redis.zcount(`${schefterKey(DEFAULT_SCHEFTER_NAV_SLUG, 'topic_timeline:')}${topic}`, windowStart, now);
        results.push({ topic, count: Math.max(0, Number.isFinite(count) ? count : 0) });
      } catch (err) {
        console.warn(`[hot-topics] zcount failed for ${topic}:`, err);
        results.push({ topic, count: 0 });
      }
    }),
  );

  results.sort((a, b) => b.count - a.count);

  return json({ topics: results, windowDays: WINDOW_DAYS });
};
