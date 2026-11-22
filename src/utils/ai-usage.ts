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

// ── Reading it back: the Site Insights "AI spend" card ─────────────────────

/** One league's spend in one month, summed over every model it used. */
export type AiSpendCell = { questions: number; costUsd: number };

export type AiSpendLeague = {
  /** The slug the usage was recorded under (`<slug>-guest` for signed-out demo visitors). */
  key: string;
  slug: string;
  guest: boolean;
  /** Short model names seen in the window, e.g. ['Sonnet']. */
  models: string[];
  byMonth: Record<string, AiSpendCell>;
};

export type AiSpendReport = {
  /** Newest first, YYYY-MM. */
  months: string[];
  leagues: AiSpendLeague[];
  totals: Record<string, AiSpendCell>;
};

const GUEST_SUFFIX = '-guest';

/** The months to show, newest first, ending at `at`'s Pacific month. */
export function aiSpendMonths(count: number, at: Date = new Date()): string[] {
  const [y, m] = usageMonth(at).split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** A model id's family name: the Sonnet id → 'Sonnet'. */
export function modelFamily(model: string): string {
  const fam = /claude-([a-z]+)/.exec(model)?.[1];
  return fam ? fam[0].toUpperCase() + fam.slice(1) : model;
}

/**
 * Fold raw `ai-usage:<slug>:<month>` hashes into a per-league, per-month
 * report. Pure, so the card is testable without Redis. Leagues sort by the
 * newest month's cost, then the month before, then name.
 */
export function summarizeAiSpend(
  hashes: Array<{ slug: string; month: string; fields: Record<string, unknown> }>,
  months: string[],
): AiSpendReport {
  const wanted = new Set(months);
  const empty = (): Record<string, AiSpendCell> => Object.fromEntries(months.map((m) => [m, { questions: 0, costUsd: 0 }]));
  const byKey = new Map<string, AiSpendLeague & { modelSet: Set<string> }>();
  const totals = empty();

  for (const { slug: key, month, fields } of hashes) {
    if (!wanted.has(month)) continue;
    let row = byKey.get(key);
    if (!row) {
      const guest = key.endsWith(GUEST_SUFFIX);
      row = { key, slug: guest ? key.slice(0, -GUEST_SUFFIX.length) : key, guest, models: [], modelSet: new Set(), byMonth: empty() };
      byKey.set(key, row);
    }
    for (const [field, raw] of Object.entries(fields ?? {})) {
      const cut = field.lastIndexOf(':');
      if (cut < 0) continue;
      const model = field.slice(0, cut);
      const counter = field.slice(cut + 1);
      const value = Number(raw) || 0;
      if (counter === 'questions') {
        row.byMonth[month].questions += value;
        totals[month].questions += value;
        if (value > 0) row.modelSet.add(modelFamily(model));
      } else if (counter === 'microUsd') {
        row.byMonth[month].costUsd += value / 1e6;
        totals[month].costUsd += value / 1e6;
      }
    }
  }

  const leagues = [...byKey.values()].map(({ modelSet, ...rest }) => ({ ...rest, models: [...modelSet].sort() }));
  leagues.sort((a, b) => {
    for (const m of months) {
      const d = b.byMonth[m].costUsd - a.byMonth[m].costUsd;
      if (Math.abs(d) > 1e-9) return d;
    }
    return a.key.localeCompare(b.key);
  });
  return { months, leagues, totals };
}

/** Read the last `count` months of Ask the History spend. Null when Redis is unavailable. */
export async function readAiSpend(count = 3, at: Date = new Date()): Promise<AiSpendReport | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const months = aiSpendMonths(count, at);
  const keys: string[] = [];
  let cursor: string | number = 0;
  do {
    const [next, found]: [string, string[]] = await redis.scan(cursor, { match: 'ai-usage:*', count: 1000 });
    keys.push(...found);
    cursor = next;
  } while (String(cursor) !== '0');

  const wanted = keys
    .map((key) => {
      const parts = key.split(':');
      return { key, slug: parts.slice(1, -1).join(':'), month: parts[parts.length - 1] };
    })
    .filter((k) => k.slug && months.includes(k.month));
  const fields = await Promise.all(wanted.map((k) => redis.hgetall<unknown>(k.key)));
  return summarizeAiSpend(
    wanted.map((k, i) => ({ slug: k.slug, month: k.month, fields: fields[i] ?? {} })),
    months,
  );
}
