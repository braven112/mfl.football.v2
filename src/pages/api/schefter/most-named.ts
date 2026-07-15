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
import { getRedis } from '../../../utils/redis-client';

export const prerender = false;

// Edge-cacheable: the leaderboard is non-personalized (counts per franchise
// over a public window), so a short shared cache absorbs bursts without
// losing freshness. SWR keeps the response warm for an extra minute past
// expiry while a background revalidation fetches a fresh count.
const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
};
const DEFAULT_DAYS = 7;
const MIN_DAYS = 1;
const MAX_DAYS = 30;
const DEFAULT_LIMIT = 5;
const MIN_LIMIT = 1;
const MAX_LIMIT = 16;

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
