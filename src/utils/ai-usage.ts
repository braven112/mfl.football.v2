/**
 * What each league's AI questions really cost, by model, by month.
 *
 *   ai-usage:<league slug>:<YYYY-MM>   hash, fields `<model>:<counter>`
 *
 * Counters: questions, rounds, inputTokens, outputTokens, cacheWriteTokens,
 * cacheReadTokens, and microUsd (cost in millionths of a dollar, so it stays
 * an integer). Keyed by registry slug (both leagues have a franchise 0001,
 * and a league's spend is what the plan price has to cover). Kept 13 months.
 *
 * Written best-effort after the answer is computed: a Redis failure never
 * costs the owner their answer.
 */
import { getRedis } from './redis-client';
import type { AskUsage } from './league-history/ask';

const TTL = 400 * 24 * 3600;

export const aiUsageKey = (slug: string, month: string) => `ai-usage:${slug}:${month}`;

/** YYYY-MM in Pacific time, the league's billing clock. */
export function usageMonth(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).format(at).slice(0, 7);
}

export async function recordAiUsage(slug: string, usage: AskUsage, at: Date = new Date()): Promise<void> {
  console.log(
    `[ai-usage] ${slug} ${usage.model} rounds=${usage.rounds} in=${usage.inputTokens} out=${usage.outputTokens} cacheW=${usage.cacheWriteTokens} cacheR=${usage.cacheReadTokens} cost=$${usage.costUsd?.toFixed(4) ?? '?'}`,
  );
  const redis = await getRedis();
  if (!redis) return;
  const key = aiUsageKey(slug, usageMonth(at));
  const m = usage.model;
  await Promise.all([
    redis.hincrby(key, `${m}:questions`, 1),
    redis.hincrby(key, `${m}:rounds`, usage.rounds),
    redis.hincrby(key, `${m}:inputTokens`, usage.inputTokens),
    redis.hincrby(key, `${m}:outputTokens`, usage.outputTokens),
    redis.hincrby(key, `${m}:cacheWriteTokens`, usage.cacheWriteTokens),
    redis.hincrby(key, `${m}:cacheReadTokens`, usage.cacheReadTokens),
    redis.hincrby(key, `${m}:microUsd`, Math.round((usage.costUsd ?? 0) * 1e6)),
  ]);
  await redis.expire(key, TTL);
}
