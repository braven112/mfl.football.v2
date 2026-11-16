/**
 * The owner's saved GM office plan — simulated contract moves on the Rosters
 * GM view, kept to their account so a reload or another device finds them.
 *
 * GET    /api/gm-plan → { moves, savedAt }
 * PUT    /api/gm-plan  { moves } → saves (an empty list deletes)
 * DELETE /api/gm-plan → clears
 *
 * OWNER ONLY. The franchise and league come from the SESSION, never the
 * request: nobody, the commissioner included, can read another owner's plan
 * through this route (Brandon, 2026-11-15). Keyed by league slug, because
 * both leagues have a franchise 0001. Only a league with contracts has a GM
 * office plan.
 *
 * A saved plan files nothing. Submit in the review panel does that, through
 * the routes each move already had (src/utils/rosters/gm-plan.ts).
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getLeagueById, leagueHasFeature } from '../../config/leagues';
import { json, unauthorized, JSON_HEADERS_NO_STORE } from '../../utils/api-response';
import { getRedis } from '../../utils/redis-client';
import { gmPlanKey, sanitizeSavedPlan } from '../../utils/rosters/gm-plan';

/** A plan outlives a whole offseason, and no longer: a year-old plan is noise. */
const PLAN_TTL_SECONDS = 200 * 24 * 60 * 60;

interface SavedPlan {
  moves: unknown[];
  savedAt: string;
}

function resolveOwner(request: Request): { key: string; franchiseId: string } | Response {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return unauthorized({ error: 'Sign in to save your plan.' }, JSON_HEADERS_NO_STORE);
  const league = user.leagueId ? getLeagueById(user.leagueId) : null;
  if (!league || !leagueHasFeature(league.slug, 'contracts')) {
    return json({ error: 'This league has no contract plan.' }, 404, JSON_HEADERS_NO_STORE);
  }
  return { key: gmPlanKey(league.slug, user.franchiseId), franchiseId: user.franchiseId };
}

export const GET: APIRoute = async ({ request }) => {
  const owner = resolveOwner(request);
  if (owner instanceof Response) return owner;
  const redis = await getRedis();
  if (!redis) return json({ moves: [], savedAt: null, storage: false }, 200, JSON_HEADERS_NO_STORE);
  try {
    const raw = await redis.get<SavedPlan>(owner.key);
    const moves = sanitizeSavedPlan(raw?.moves, owner.franchiseId);
    return json({ moves, savedAt: raw?.savedAt ?? null }, 200, JSON_HEADERS_NO_STORE);
  } catch (err) {
    console.error('[gm-plan] read failed:', err);
    return json({ error: 'Could not load your saved plan.' }, 503, JSON_HEADERS_NO_STORE);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const owner = resolveOwner(request);
  if (owner instanceof Response) return owner;
  const body = (await request.json().catch(() => null)) as { moves?: unknown } | null;
  if (!body || !Array.isArray(body.moves)) {
    return json({ error: 'Expected { moves: [...] }.' }, 400, JSON_HEADERS_NO_STORE);
  }
  const moves = sanitizeSavedPlan(body.moves, owner.franchiseId);
  const redis = await getRedis();
  if (!redis) return json({ error: 'Saving is unavailable right now.' }, 503, JSON_HEADERS_NO_STORE);
  try {
    if (moves.length === 0) {
      await redis.del(owner.key);
      return json({ moves: [], savedAt: null }, 200, JSON_HEADERS_NO_STORE);
    }
    const savedAt = new Date().toISOString();
    await redis.set(owner.key, { moves, savedAt }, { ex: PLAN_TTL_SECONDS });
    return json({ moves, savedAt }, 200, JSON_HEADERS_NO_STORE);
  } catch (err) {
    console.error('[gm-plan] write failed:', err);
    return json({ error: 'Could not save your plan.' }, 503, JSON_HEADERS_NO_STORE);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const owner = resolveOwner(request);
  if (owner instanceof Response) return owner;
  const redis = await getRedis();
  if (!redis) return json({ moves: [], savedAt: null }, 200, JSON_HEADERS_NO_STORE);
  try {
    await redis.del(owner.key);
    return json({ moves: [], savedAt: null }, 200, JSON_HEADERS_NO_STORE);
  } catch (err) {
    console.error('[gm-plan] delete failed:', err);
    return json({ error: 'Could not clear your plan.' }, 503, JSON_HEADERS_NO_STORE);
  }
};
