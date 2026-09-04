/**
 * GET /api/schefter/tipster-stats
 *
 * Returns the authenticated tipster's personal scorecard + the top-10 season
 * leaderboard. Everything is keyed on the one-way tipster hash server-side;
 * the response only ever exposes codenames and counts, never hashes or ids.
 *
 * Response shape:
 *   {
 *     me: {
 *       codename: string | null,
 *       rumorsTotal: number,
 *       rumorsSeason: number,
 *       badges: string[],
 *       lastReceipt: TipReceipt | null
 *     } | null,
 *     leaderboard: Array<{ codename: string, rumorsSeason: number, isMe: boolean }>,
 *     seasonYear: number
 *   }
 *
 * `me.codename === null` means the tipster has submitted tips but none have
 * produced a rumor yet (codenames are only issued when a scan commits a post).
 *
 * `me.lastReceipt` is the outcome of this tipster's most recent tip, written
 * by the scanner (`recordTipReceipt`) when the tip leaves the queue for good.
 * It exists so "I sent a tip and nothing happened" stops being indisputable:
 * a suppressed or expired tip now has a visible ending. Null means the last
 * tip is still in the queue (or predates receipts / aged past the 14d TTL).
 * The receipt is keyed on the tipster hash and read only for the caller's own
 * hash — it is never listed, aggregated, or exposed for anyone else.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { hashTipsterId } from '../../../utils/schefter-tipster-hash';
import { resolveSchefterLeague, leagueHasSchefterTips, schefterSeasonYear } from '../../../utils/schefter-league';
import { getCodename } from '../../../utils/schefter-codenames';
import { schefterKey } from '../../../../scripts/lib/schefter-keys.mjs';
import { getRedis } from '../../../utils/redis-client';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../../utils/api-response';

export const prerender = false;

const LEADERBOARD_LIMIT = 10;

/** Outcome of a tipster's most recent tip. Mirrors `recordTipReceipt`. */
export type TipReceipt = {
  /** published = a rumor shipped; spiked = gate suppressed it to exhaustion; expired = aged out unposted */
  status: 'published' | 'spiked' | 'expired';
  postId: string | null;
  topic: string | null;
  submittedAt: number | null;
  at: number;
};

const RECEIPT_STATUSES = new Set(['published', 'spiked', 'expired']);

/**
 * Parse a receipt written by the scanner. Upstash may hand back either a JSON
 * string or an already-parsed object depending on client version, and a
 * receipt written by an older scanner may be missing fields — so validate
 * `status` rather than trusting the blob, and drop anything unrecognized
 * instead of rendering a broken card.
 */
function parseReceipt(raw: unknown): TipReceipt | null {
  if (!raw) return null;
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const r = obj as Record<string, unknown>;
  if (typeof r.status !== 'string' || !RECEIPT_STATUSES.has(r.status)) return null;
  return {
    status: r.status as TipReceipt['status'],
    postId: typeof r.postId === 'string' ? r.postId : null,
    topic: typeof r.topic === 'string' ? r.topic : null,
    submittedAt: typeof r.submittedAt === 'number' ? r.submittedAt : null,
    at: typeof r.at === 'number' ? r.at : 0,
  };
}

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

/**
 * Normalize `redis.zrange` results across Upstash client versions. Some return
 * a flat [member, score, member, score] list; others return [{member, score}].
 */
function normalizeZrange(raw: unknown): Array<{ member: string; score: number }> {
  if (!Array.isArray(raw)) return [];
  if (raw.length === 0) return [];

  const first = raw[0];
  if (first && typeof first === 'object' && 'member' in (first as Record<string, unknown>)) {
    return (raw as Array<{ member: string; score: number | string }>)
      .map((row) => ({
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

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!user.franchiseId) return json({ error: 'no_franchise' }, 403);

  const league = resolveSchefterLeague({ user, url: new URL(request.url) });
  if (!league) return json({ error: 'bad_league' }, 400);
  if (!leagueHasSchefterTips(league)) return json({ error: 'feature_disabled' }, 404);
  const navSlug = league.navSlug;

  let hashedOwnerId: string;
  try {
    hashedOwnerId = hashTipsterId(user.id);
  } catch {
    return json({ error: 'server_misconfigured' }, 500);
  }

  const seasonYear = schefterSeasonYear(league);
  const redis = await getRedis();
  if (!redis) {
    return json({
      me: { codename: null, rumorsTotal: 0, rumorsSeason: 0, badges: [], lastReceipt: null },
      leaderboard: [],
      seasonYear,
    });
  }

  const leaderboardKey = `${schefterKey(navSlug, 'tipster:leaderboard:')}${seasonYear}`;
  const totalKey = `${schefterKey(navSlug, 'tipster:rumors_total:')}${hashedOwnerId}`;
  const seasonKey = `${schefterKey(navSlug, 'tipster:rumors_season:')}${seasonYear}:${hashedOwnerId}`;

  let codename: string | null = null;
  let rumorsTotal = 0;
  let rumorsSeason = 0;
  let rawLeaderboard: unknown = [];
  let badges: string[] = [];
  let lastReceipt: TipReceipt | null = null;

  try {
    const [cn, total, season, zrangeRaw, rawBadges, rawReceipt] = await Promise.all([
      getCodename(redis, hashedOwnerId, navSlug),
      redis.get<string | number>(totalKey),
      redis.get<string | number>(seasonKey),
      redis.zrange(leaderboardKey, 0, LEADERBOARD_LIMIT - 1, { rev: true, withScores: true }),
      redis.smembers(`${schefterKey(navSlug, 'tipster:badges:')}${hashedOwnerId}`).catch(() => []),
      redis
        .get<string>(`${schefterKey(navSlug, 'tipster:last_receipt:')}${hashedOwnerId}`)
        .catch(() => null),
    ]);
    codename = cn;
    rumorsTotal = coerceCount(total);
    rumorsSeason = coerceCount(season);
    rawLeaderboard = zrangeRaw;
    badges = Array.isArray(rawBadges) ? rawBadges.map((b) => String(b)).sort().reverse() : [];
    lastReceipt = parseReceipt(rawReceipt);
  } catch (err) {
    console.error('[tipster-stats] Read error:', err);
    return json({ error: 'redis_unavailable' }, 503);
  }

  const rows = normalizeZrange(rawLeaderboard);

  // Resolve codenames for each leaderboard entry. A tipster's member is their
  // hashedOwnerId, so we look up their codename under the same Redis key used
  // during assignment. Entries without a codename (shouldn't happen — scanner
  // issues one before incrementing the zset) are skipped so the raw hash
  // never leaks to the client.
  const leaderboard: Array<{ codename: string; rumorsSeason: number; isMe: boolean }> = [];
  for (const row of rows) {
    try {
      const name = await getCodename(redis, row.member, navSlug);
      if (!name) continue;
      leaderboard.push({
        codename: name,
        rumorsSeason: row.score,
        isMe: row.member === hashedOwnerId,
      });
    } catch {
      // If a single lookup fails we still return the rest — do not surface
      // the hash and do not bail the whole request.
    }
  }

  return json({
    me: { codename, rumorsTotal, rumorsSeason, badges, lastReceipt },
    leaderboard,
    seasonYear,
  });
};
