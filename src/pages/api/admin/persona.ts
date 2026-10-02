/**
 * GET/PUT/DELETE /api/admin/persona
 *
 * The commissioner's control over who writes the league's automated columns
 * (src/utils/persona.mjs). GET returns the persona in effect and where it came
 * from; PUT validates and saves an override; DELETE clears it, returning the
 * league to its default.
 *
 * A commissioner acts on their SESSION's league only — a `?league=` naming
 * another is refused, so one league's commissioner cannot rename another
 * league's writer. A platform admin (src/utils/league-admin.ts) may name any.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { resolveAdministeredLeague } from '../../../utils/league-admin';
import type { LeagueDefinition } from '../../../config/leagues';
import { getRedis } from '../../../utils/redis-client';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import {
  DEFAULT_PERSONA,
  PERSONA_LIMITS,
  personaKey,
  resolvePersona,
  validatePersona,
} from '../../../utils/persona.mjs';

export const prerender = false;

type Gate = { ok: true; league: LeagueDefinition } | { ok: false; response: Response };

/**
 * The league this call acts on: the session's own for a commissioner, any
 * registered league for a platform admin (src/utils/league-admin.ts). The
 * editor always sends `?league=`; a commissioner naming another league is
 * refused rather than silently redirected to their own.
 */
function gate(request: Request, url: URL): Gate {
  const resolved = resolveAdministeredLeague(getAuthUser(request), url.searchParams.get('league'));
  if (!resolved.ok) {
    return { ok: false, response: json({ ok: false, error: resolved.error, errors: [resolved.error] }, resolved.status, JSON_HEADERS_NO_STORE) };
  }
  return { ok: true, league: resolved.league };
}

function view(league: LeagueDefinition, stored: unknown) {
  return {
    league: league.slug,
    persona: resolvePersona(league, stored),
    defaults: resolvePersona(league, null),
    schefter: DEFAULT_PERSONA,
    limits: PERSONA_LIMITS,
  };
}

export const GET: APIRoute = async ({ request, url }) => {
  const g = gate(request, url);
  if (!g.ok) return g.response;
  const redis = await getRedis();
  const stored = redis ? await redis.get(personaKey(g.league.slug)).catch(() => null) : null;
  return json({ ok: true, ...view(g.league, stored), storage: Boolean(redis) }, 200, JSON_HEADERS_NO_STORE);
};

export const PUT: APIRoute = async ({ request, url }) => {
  const g = gate(request, url);
  if (!g.ok) return g.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, errors: ['Body must be JSON.'] }, 400, JSON_HEADERS_NO_STORE);
  }
  const checked = validatePersona(body);
  if (!checked.ok) return json({ ok: false, errors: checked.errors }, 400, JSON_HEADERS_NO_STORE);

  const redis = await getRedis();
  if (!redis) return json({ ok: false, errors: ['Settings storage is unavailable.'] }, 503, JSON_HEADERS_NO_STORE);
  try {
    await redis.set(personaKey(g.league.slug), JSON.stringify(checked.persona));
  } catch {
    return json({ ok: false, errors: ['Could not save — try again.'] }, 502, JSON_HEADERS_NO_STORE);
  }
  return json({ ok: true, ...view(g.league, checked.persona) }, 200, JSON_HEADERS_NO_STORE);
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const g = gate(request, url);
  if (!g.ok) return g.response;
  const redis = await getRedis();
  if (!redis) return json({ ok: false, errors: ['Settings storage is unavailable.'] }, 503, JSON_HEADERS_NO_STORE);
  try {
    await redis.del(personaKey(g.league.slug));
  } catch {
    return json({ ok: false, errors: ['Could not reset — try again.'] }, 502, JSON_HEADERS_NO_STORE);
  }
  return json({ ok: true, ...view(g.league, null) }, 200, JSON_HEADERS_NO_STORE);
};
