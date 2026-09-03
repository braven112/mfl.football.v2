/**
 * Throwback Week owner preference API
 *
 * GET  /api/throwback-preference — the caller's own stored era pick (or null)
 * POST /api/throwback-preference — set the caller's own era pick
 *
 * Auth: owner-scoped only — a franchise can only read/write its own pick,
 * never another franchise's (no commissioner override; see CLAUDE.md's
 * "Commish credentials restricted to contracts only").
 *
 * League: serves every league that runs Throwback Week. The scope comes from
 * the SESSION (`user.leagueId`), never from a request parameter, so there is
 * nothing for a client to spoof — an AFL session can only ever read and write
 * the AFL bucket. That matters here more than usual: both leagues have a
 * franchise 0001, so before the scope existed an AFL owner's write would have
 * landed on a TheLeague team's key.
 *
 * Storage: Upstash Redis, keyed by `scopedThrowbackKey` (see throwback-store).
 */

import type { APIRoute } from 'astro';
import { getAuthUser, type AuthUser } from '../../utils/auth';
import {
  eraPickKey,
  getEligibleThrowbackEras,
  getImposedThrowbackEra,
  throwbackPickKey,
} from '../../utils/throwback-identity';
import { getThrowbackPreference, setThrowbackPreference } from '../../utils/throwback-store';
import { strictThrowbackScopeForLeagueId, type ThrowbackScope } from '../../utils/throwback-scope';
import theleagueConfig from '../../data/theleague.config.json';
import aflConfig from '../../../data/afl-fantasy/afl.config.json';
import { JSON_HEADERS, unauthorized } from '../../utils/api-response';

/** The team list each scope resolves eligibility against. */
const TEAMS_BY_SCOPE: Record<ThrowbackScope, any[]> = {
  theleague: (theleagueConfig as any).teams ?? [],
  afl: (aflConfig as any).teams ?? [],
};

interface ThrowbackSession {
  user: AuthUser & { franchiseId: string };
  scope: ThrowbackScope;
}

/**
 * Resolve the caller to a franchise AND a league that actually runs Throwback
 * Week. Returns null for anything else — an unauthenticated request, a session
 * with no franchise, or a league that does not run the feature.
 *
 * STRICT resolution is the half that cannot be skipped. The lenient
 * `throwbackScopeForLeagueId` falls back to TheLeague for any league it does
 * not recognize, so a Best Ball session — no `history[]`, no throwback week —
 * would otherwise read and write TheLeague's storage under a franchise id
 * both leagues use.
 */
function resolveSession(request: Request): ThrowbackSession | null {
  const user = getAuthUser(request);
  if (!user?.franchiseId || !user.leagueId) return null;
  const scope = strictThrowbackScopeForLeagueId(user.leagueId);
  if (!scope) return null;
  return { user: user as AuthUser & { franchiseId: string }, scope };
}

export const GET: APIRoute = async ({ request }) => {
  const session = resolveSession(request);
  if (!session) return unauthorized();

  const data = await getThrowbackPreference(session.user.franchiseId, session.scope);
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: JSON_HEADERS,
  });
};

export const POST: APIRoute = async ({ request }) => {
  const session = resolveSession(request);
  if (!session) return unauthorized();

  const { user, scope } = session;
  const team = TEAMS_BY_SCOPE[scope].find((t: any) => t.franchiseId === user.franchiseId);
  if (!team) {
    return new Response(JSON.stringify({ error: 'No franchise associated with your account' }), {
      status: 403,
      headers: JSON_HEADERS,
    });
  }

  // A franchise serving the Throwback Rebrand has its era imposed and cannot
  // save one. Accepting the write would store a pick that never reaches the
  // scoreboard — a lie the owner has no way to detect.
  const imposed = getImposedThrowbackEra(user.franchiseId, scope);
  if (imposed) {
    return new Response(
      JSON.stringify({
        error: `Your franchise is serving the Throwback Rebrand and wears ${imposed.name} this year.`,
      }),
      { status: 409, headers: JSON_HEADERS },
    );
  }

  let body: { yearStart?: unknown; sourceFranchiseId?: unknown };
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

  // Present only for an era inherited from a franchise slot this team used to
  // occupy, where the year alone does not identify it.
  const sourceFranchiseId = body.sourceFranchiseId;
  if (sourceFranchiseId !== undefined && typeof sourceFranchiseId !== 'string') {
    return new Response(JSON.stringify({ error: 'sourceFranchiseId must be a string' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  // Never trust the client: the chosen era must be one of this franchise's
  // actual eligible eras IN THIS LEAGUE (rejects bogus years, the excluded
  // asset-conflict entries, an era that only exists in the other league's
  // config for the same franchise id, and — now that eras can be inherited —
  // an era from a slot this franchise never occupied).
  const pick = { yearStart, sourceFranchiseId };
  const eligible = getEligibleThrowbackEras(team, scope, TEAMS_BY_SCOPE[scope]);
  if (!eligible.some((e) => eraPickKey(e) === throwbackPickKey(pick))) {
    return new Response(JSON.stringify({ error: 'yearStart is not an eligible throwback era for your franchise' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const saved = await setThrowbackPreference(user.franchiseId, pick, scope);
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
