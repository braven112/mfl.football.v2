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

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const WINDOW_DAYS = 7;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

type RedisClient = {
  zcount: (key: string, min: number | string, max: number | string) => Promise<number>;
};

let _redis: RedisClient | null | undefined;

async function getRedis(): Promise<RedisClient | null> {
  if (_redis !== undefined) return _redis;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.STORAGE_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.STORAGE_REST_API_TOKEN;
  if (!url || !token) {
    _redis = null;
    return null;
  }
  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token }) as unknown as RedisClient;
    return _redis;
  } catch (err) {
    console.warn('[hot-topics] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

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
        const count = await redis.zcount(`schefter:topic_timeline:${topic}`, windowStart, now);
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
