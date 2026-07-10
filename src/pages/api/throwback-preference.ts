/**
 * Throwback Week owner preference API
 *
 * GET  /api/throwback-preference — the caller's own stored era pick (or null)
 * POST /api/throwback-preference — set the caller's own era pick
 *
 * Auth: owner-scoped only — a franchise can only read/write its own pick,
 * never another franchise's (no commissioner override; see CLAUDE.md's
 * "Commish credentials restricted to contracts only").
 * Storage: Upstash Redis via @upstash/redis, keyed by throwback:{franchiseId}.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getEligibleThrowbackEras } from '../../utils/throwback-identity';
import { getThrowbackPreference, setThrowbackPreference } from '../../utils/throwback-store';
import leagueConfig from '../../data/theleague.config.json';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user || !user.franchiseId) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  const data = await getThrowbackPreference(user.franchiseId);
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: JSON_HEADERS,
  });
};

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user || !user.franchiseId) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  const team = leagueConfig.teams.find((t) => t.franchiseId === user.franchiseId);
  if (!team) {
    return new Response(JSON.stringify({ error: 'No franchise associated with your account' }), {
      status: 403,
      headers: JSON_HEADERS,
    });
  }

  let body: { yearStart?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const yearStart = body.yearStart;
  if (typeof yearStart !== 'number') {
    return new Response(JSON.stringify({ error: 'yearStart must be a number' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  // Never trust the client: the chosen era must be one of this franchise's
  // actual eligible eras (rejects both bogus years and the excluded
  // asset-conflict entries).
  const eligible = getEligibleThrowbackEras(team);
  if (!eligible.some((e) => e.yearStart === yearStart)) {
    return new Response(JSON.stringify({ error: 'yearStart is not an eligible throwback era for your franchise' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const saved = await setThrowbackPreference(user.franchiseId, yearStart);
  if (!saved) {
    return new Response(JSON.stringify({ success: false, error: 'Storage not configured or write failed' }), {
      status: 503,
      headers: JSON_HEADERS,
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: JSON_HEADERS,
  });
};
