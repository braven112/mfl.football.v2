/**
 * GET /api/schefter/style-book
 *
 * Public (no auth) read of the Style Book leaderboards — running tallies of
 * personal attacks on Schefter. Two separate pools:
 *
 *   - `named` — GroupMe-chat attackers, keyed on the public display name.
 *     Public authorship already makes these identifiable.
 *   - `anonymous` — web-tip attackers, keyed internally on the tipster hash
 *     but displayed ONLY as a codename ("Burner Phone", "The Ghost" …). The
 *     raw hash never appears in the response.
 *
 * The two leaderboards are returned side by side so web tipsters compete
 * against each other (by codename) and GroupMe attackers compete against each
 * other (by name) — never mixed.
 *
 * Response shape:
 *   {
 *     seasonYear: number,
 *     named: {
 *       entries: Array<{ author, seasonCount, lifetimeCount, lastShotAt }>,
 *       totals: { seasonShots, authors }
 *     },
 *     anonymous: {
 *       entries: Array<{ codename, seasonCount, lifetimeCount, lastShotAt }>,
 *       totals: { seasonShots, authors }
 *     }
 *   }
 */

import type { APIRoute } from 'astro';
import { resolveSchefterLeague, leagueHasSchefterTips, schefterSeasonYear } from '../../../utils/schefter-league';
import { getCodename } from '../../../utils/schefter-codenames';
import { getRedis, type RedisClient } from '../../../utils/redis-client';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../../utils/api-response';
import { schefterKey } from '../../../../scripts/lib/schefter-keys.mjs';

export const prerender = false;

const LEADERBOARD_LIMIT = 25;
const CACHE_TTL_MS = 30_000;

// Style Book key prefixes, league-scoped. Named (GroupMe) attackers key on
// public display name; anonymous (web-tip) attackers key on the tipster hash.
function styleBookKeys(navSlug: string) {
  return {
    namedLifetimePrefix: schefterKey(navSlug, 'style_book:'),
    namedLastShotPrefix: schefterKey(navSlug, 'style_book:last_shot_at:'),
    namedLeaderboardPrefix: schefterKey(navSlug, 'style_book:leaderboard:'),
    anonLifetimePrefix: schefterKey(navSlug, 'style_book:anon:'),
    anonLastShotPrefix: schefterKey(navSlug, 'style_book:anon:last_shot_at:'),
    anonLeaderboardPrefix: schefterKey(navSlug, 'style_book:anon_leaderboard:'),
  };
}

type NamedEntry = {
  author: string;
  seasonCount: number;
  lifetimeCount: number;
  lastShotAt: number | null;
};

type AnonEntry = {
  codename: string;
  seasonCount: number;
  lifetimeCount: number;
  lastShotAt: number | null;
};

type StyleBookResponse = {
  seasonYear: number;
  named: {
    entries: NamedEntry[];
    totals: { seasonShots: number; authors: number };
  };
  anonymous: {
    entries: AnonEntry[];
    totals: { seasonShots: number; authors: number };
  };
};

const _cache = new Map<string, { data: StyleBookResponse; expiresAt: number }>();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function coerceCount(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  if (typeof raw === 'string') {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return 0;
}

function coerceTimestamp(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Mirrors normalizeAuthorKey() in scripts/schefter-groupme-listen.mjs for the
 * NAMED leaderboard. Both paths must produce the same key for the same display
 * name or lifetime/last-shot lookups will miss.
 */
export function normalizeAuthorKey(name: string): string {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Normalize `zrange` results across Upstash client versions. */
function normalizeZrange(raw: unknown): Array<{ member: string; score: number }> {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const first = raw[0];
  if (first && typeof first === 'object' && 'member' in (first as Record<string, unknown>)) {
    return (raw as Array<{ member: string; score: number | string }>).map((row) => ({
      member: String(row.member),
      score: coerceCount(row.score),
    }));
  }
  const out: Array<{ member: string; score: number }> = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    out.push({ member: String(raw[i]), score: coerceCount(raw[i + 1]) });
  }
  return out;
}

export function _resetStyleBookCacheForTests(): void {
  _cache.clear();
}

async function fetchNamedEntries(
  redis: RedisClient,
  seasonYear: number,
  navSlug: string,
): Promise<{ entries: NamedEntry[]; authorCount: number }> {
  const { namedLeaderboardPrefix, namedLifetimePrefix, namedLastShotPrefix } = styleBookKeys(navSlug);
  const leaderboardKey = `${namedLeaderboardPrefix}${seasonYear}`;
  const [rawLeaderboard, rawCount] = await Promise.all([
    redis.zrange(leaderboardKey, 0, LEADERBOARD_LIMIT - 1, { rev: true, withScores: true }),
    redis.zcard(leaderboardKey).catch(() => 0),
  ]);
  const rows = normalizeZrange(rawLeaderboard);
  const authorCount = typeof rawCount === 'number' ? rawCount : rows.length;
  if (rows.length === 0) return { entries: [], authorCount };

  const entries = await Promise.all(
    rows.map(async (row) => {
      const authorKey = normalizeAuthorKey(row.member);
      let lifetimeCount = 0;
      let lastShotAt: number | null = null;
      if (authorKey) {
        try {
          const [lifeRaw, shotRaw] = await Promise.all([
            redis.get<string | number>(`${namedLifetimePrefix}${authorKey}`),
            redis.get<string | number>(`${namedLastShotPrefix}${authorKey}`),
          ]);
          lifetimeCount = coerceCount(lifeRaw);
          lastShotAt = coerceTimestamp(shotRaw);
        } catch {
          /* degrade */
        }
      }
      return {
        author: row.member,
        seasonCount: row.score,
        lifetimeCount,
        lastShotAt,
      } satisfies NamedEntry;
    }),
  );
  return { entries, authorCount };
}

/**
 * Anon entries — ZSET members are tipster HASHES. The hash is NEVER returned
 * to the client; we resolve each to its codename via getCodename and drop
 * entries whose codename we can't resolve (shouldn't happen — tip.ts calls
 * assignCodename on every attack — but a belt-and-suspenders guard).
 */
async function fetchAnonEntries(
  redis: RedisClient,
  seasonYear: number,
  navSlug: string,
): Promise<{ entries: AnonEntry[]; authorCount: number }> {
  const { anonLeaderboardPrefix, anonLifetimePrefix, anonLastShotPrefix } = styleBookKeys(navSlug);
  const leaderboardKey = `${anonLeaderboardPrefix}${seasonYear}`;
  const [rawLeaderboard, rawCount] = await Promise.all([
    redis.zrange(leaderboardKey, 0, LEADERBOARD_LIMIT - 1, { rev: true, withScores: true }),
    redis.zcard(leaderboardKey).catch(() => 0),
  ]);
  const rows = normalizeZrange(rawLeaderboard);
  const authorCount = typeof rawCount === 'number' ? rawCount : rows.length;
  if (rows.length === 0) return { entries: [], authorCount };

  const entries: AnonEntry[] = [];
  for (const row of rows) {
    const hashedOwnerId = row.member;
    let codename: string | null = null;
    try {
      codename = await getCodename(redis, hashedOwnerId, navSlug);
    } catch {
      codename = null;
    }
    if (!codename) continue; // never leak a raw hash into the response

    let lifetimeCount = 0;
    let lastShotAt: number | null = null;
    try {
      const [lifeRaw, shotRaw] = await Promise.all([
        redis.get<string | number>(`${anonLifetimePrefix}${hashedOwnerId}`),
        redis.get<string | number>(`${anonLastShotPrefix}${hashedOwnerId}`),
      ]);
      lifetimeCount = coerceCount(lifeRaw);
      lastShotAt = coerceTimestamp(shotRaw);
    } catch {
      /* degrade */
    }
    entries.push({
      codename,
      seasonCount: row.score,
      lifetimeCount,
      lastShotAt,
    });
  }
  return { entries, authorCount };
}

export const GET: APIRoute = async ({ request }) => {
  // Public route — league from ?league= (slug or navSlug), TheLeague default.
  const league = resolveSchefterLeague({ url: new URL(request.url) });
  if (!league) return json({ error: 'bad_league' }, 400);
  if (!leagueHasSchefterTips(league)) return json({ error: 'feature_disabled' }, 404);
  const navSlug = league.navSlug;

  const now = Date.now();
  const cached = _cache.get(navSlug);
  if (cached && cached.expiresAt > now) {
    return json(cached.data);
  }

  const seasonYear = schefterSeasonYear(league);
  const redis = await getRedis();

  if (!redis) {
    const empty: StyleBookResponse = {
      seasonYear,
      named: { entries: [], totals: { seasonShots: 0, authors: 0 } },
      anonymous: { entries: [], totals: { seasonShots: 0, authors: 0 } },
    };
    _cache.set(navSlug, { data: empty, expiresAt: now + CACHE_TTL_MS });
    return json(empty);
  }

  let named: { entries: NamedEntry[]; authorCount: number };
  let anonymous: { entries: AnonEntry[]; authorCount: number };
  try {
    [named, anonymous] = await Promise.all([
      fetchNamedEntries(redis, seasonYear, navSlug),
      fetchAnonEntries(redis, seasonYear, navSlug),
    ]);
  } catch (err) {
    console.error('[style-book] Read error:', err);
    return json({ error: 'redis_unavailable' }, 503);
  }

  const namedTotal = named.entries.reduce((sum, e) => sum + e.seasonCount, 0);
  const anonTotal = anonymous.entries.reduce((sum, e) => sum + e.seasonCount, 0);

  const response: StyleBookResponse = {
    seasonYear,
    named: {
      entries: named.entries,
      totals: { seasonShots: namedTotal, authors: named.authorCount },
    },
    anonymous: {
      entries: anonymous.entries,
      totals: { seasonShots: anonTotal, authors: anonymous.authorCount },
    },
  };

  _cache.set(navSlug, { data: response, expiresAt: now + CACHE_TTL_MS });
  return json(response);
};
