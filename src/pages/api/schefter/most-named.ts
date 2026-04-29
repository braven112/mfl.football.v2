/**
 * GET /api/schefter/most-named
 *
 * Top-N most-named franchises in the Schefter rumor mill over a rolling
 * window. Powers the "Hottest desks this week" sidebar widget on
 * /theleague/news. Each named-team post (explicit-pick, multi-source, or
 * trade-bait scope) bumps a per-team ZSET counter; this endpoint reads
 * those counters via the shared `getTopNamedTeams` helper.
 *
 * Query params:
 *   ?days=7      rolling window in days (default 7, min 1, max 30)
 *   ?limit=5     max rows to return (default 5, min 1, max 16)
 *
 * Response:
 *   {
 *     teams: Array<{
 *       franchiseId: string,
 *       franchiseName: string,    // chooseTeamName short form
 *       division: string | null,
 *       count: number,
 *       lastNamedAt: number,      // epoch ms
 *     }>,
 *     windowDays: number,
 *     limit: number,
 *   }
 *
 * Public — no identity signal. Counts of named teams are already public
 * via the feed; this just aggregates them.
 */

import type { APIRoute } from 'astro';
import { chooseTeamName } from '../../../utils/team-names';
import theLeagueConfig from '../../../data/theleague.config.json';
// @ts-expect-error — JS module without bundled types; runtime exports verified.
import { getTopNamedTeams } from '../../../../scripts/lib/schefter-team-naming.mjs';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const DEFAULT_DAYS = 7;
const MIN_DAYS = 1;
const MAX_DAYS = 30;
const DEFAULT_LIMIT = 5;
const MIN_LIMIT = 1;
const MAX_LIMIT = 16;

type ScanResult = [number | string, string[]] | { cursor: number | string; keys: string[] };

type ZRangeOptions = {
  byScore?: boolean;
  rev?: boolean;
  offset?: number;
  count?: number;
  withScores?: boolean;
};

/**
 * Minimal interface against @upstash/redis — only the methods we actually
 * call. Lets the typechecker catch arity/typo mistakes without coupling us
 * to a particular client version's full surface area.
 */
type RedisClient = {
  scan: (cursor: number | string, opts?: { match?: string; count?: number }) => Promise<ScanResult>;
  zcount: (key: string, min: number | string, max: number | string) => Promise<number>;
  zrange: (
    key: string,
    min: number | string,
    max: number | string,
    opts?: ZRangeOptions,
  ) => Promise<Array<string | number>>;
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
    _redis = new Redis({ url, token }) as RedisClient;
    return _redis;
  } catch (err) {
    console.warn('[most-named] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  if (raw == null) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

type TeamConfig = {
  franchiseId: string;
  name: string;
  nameMedium?: string;
  nameShort?: string;
  abbrev?: string;
  division?: string;
};

const teamsById = new Map<string, TeamConfig>(
  ((theLeagueConfig as { teams?: TeamConfig[] }).teams ?? []).map((t) => [t.franchiseId, t]),
);

export const GET: APIRoute = async ({ url }) => {
  const days = clampInt(url.searchParams.get('days'), DEFAULT_DAYS, MIN_DAYS, MAX_DAYS);
  const limit = clampInt(url.searchParams.get('limit'), DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);

  const redis = await getRedis();
  if (!redis) {
    return json({ teams: [], windowDays: days, limit });
  }

  let rows: Array<{ franchiseId: string; count: number; lastNamedAt: number }> = [];
  try {
    rows = await getTopNamedTeams(redis, days, limit);
  } catch (err) {
    console.warn('[most-named] getTopNamedTeams failed:', err);
    return json({ teams: [], windowDays: days, limit });
  }

  const teams = rows
    .map((row) => {
      const t = teamsById.get(row.franchiseId);
      if (!t) return null;
      return {
        franchiseId: row.franchiseId,
        franchiseName: chooseTeamName(
          {
            fullName: t.name,
            nameMedium: t.nameMedium,
            nameShort: t.nameShort,
            abbrev: t.abbrev,
          },
          'short',
        ),
        division: t.division ?? null,
        count: row.count,
        lastNamedAt: row.lastNamedAt,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return json({ teams, windowDays: days, limit });
};
