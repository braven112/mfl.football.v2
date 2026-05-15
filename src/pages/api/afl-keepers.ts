/**
 * GET    /api/afl-keepers?franchise=0001&year=2025
 * POST   /api/afl-keepers   body: { year: 2025, franchise: "0001", keepers: ["12345", ...] }
 * DELETE /api/afl-keepers?franchise=0001&year=2025
 *
 * Per-franchise keeper plan persistence for AFL Fantasy. Scoped to the
 * authenticated user's franchise — owners can only read/write their own
 * plan. The plan is private (no public read) since it's a strategic
 * scratchpad.
 *
 * Keeper plans are NOT a formal MFL construct in AFL — this is purely a
 * client-side / server-side scratchpad. The actual roster mutations
 * happen when the owner clicks "Finalize keepers", which triggers a
 * sequence of /api/cut-player calls for the non-keepers.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import {
  KEEPER_LIMIT,
  getKeeperPlan,
  saveKeeperPlan,
  deleteKeeperPlan,
  sanitizeKeeperIds,
} from '../../utils/afl-keepers-storage';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const AFL_LEAGUE_ID = '19621';

function unauthorized(message: string) {
  return new Response(JSON.stringify({ success: false, message }), {
    status: 401,
    headers: JSON_HEADERS,
  });
}

function forbidden(message: string) {
  return new Response(JSON.stringify({ success: false, message }), {
    status: 403,
    headers: JSON_HEADERS,
  });
}

function badRequest(message: string) {
  return new Response(JSON.stringify({ success: false, message }), {
    status: 400,
    headers: JSON_HEADERS,
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const user = getAuthUser(request);
  if (!user) return unauthorized('Sign in to view your keeper plan.');

  const franchiseId = url.searchParams.get('franchise');
  const yearStr = url.searchParams.get('year');
  if (!franchiseId || !/^\d{4}$/.test(franchiseId)) {
    return badRequest('Missing or invalid franchise.');
  }
  const year = Number(yearStr);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return badRequest('Missing or invalid year.');
  }

  // Owners only see their own plan.
  if (user.leagueId !== AFL_LEAGUE_ID || user.franchiseId !== franchiseId) {
    return forbidden('You can only view your own keeper plan.');
  }

  const plan = await getKeeperPlan(AFL_LEAGUE_ID, year, franchiseId);
  return new Response(
    JSON.stringify({
      success: true,
      plan: plan ?? { leagueId: AFL_LEAGUE_ID, year, franchiseId, keepers: [], lastUpdated: null, version: 1 },
      limit: KEEPER_LIMIT,
    }),
    { status: 200, headers: JSON_HEADERS }
  );
};

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return unauthorized('Sign in to save your keeper plan.');

  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body.');
  }

  const franchiseId = body?.franchise;
  const year = Number(body?.year);
  if (!franchiseId || !/^\d{4}$/.test(String(franchiseId))) {
    return badRequest('Missing or invalid franchise.');
  }
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return badRequest('Missing or invalid year.');
  }

  // Owners only save their own plan.
  if (user.leagueId !== AFL_LEAGUE_ID || user.franchiseId !== franchiseId) {
    return forbidden('You can only save your own keeper plan.');
  }

  const keepers = sanitizeKeeperIds(body?.keepers);
  const plan = await saveKeeperPlan(AFL_LEAGUE_ID, year, franchiseId, keepers);

  return new Response(JSON.stringify({ success: true, plan, limit: KEEPER_LIMIT }), {
    status: 200,
    headers: JSON_HEADERS,
  });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const user = getAuthUser(request);
  if (!user) return unauthorized('Sign in to reset your keeper plan.');

  const franchiseId = url.searchParams.get('franchise');
  const yearStr = url.searchParams.get('year');
  if (!franchiseId || !/^\d{4}$/.test(franchiseId)) {
    return badRequest('Missing or invalid franchise.');
  }
  const year = Number(yearStr);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return badRequest('Missing or invalid year.');
  }

  if (user.leagueId !== AFL_LEAGUE_ID || user.franchiseId !== franchiseId) {
    return forbidden('You can only reset your own keeper plan.');
  }

  await deleteKeeperPlan(AFL_LEAGUE_ID, year, franchiseId);
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: JSON_HEADERS,
  });
};
