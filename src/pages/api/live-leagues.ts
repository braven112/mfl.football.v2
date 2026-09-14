/**
 * Persist MFL Live's league selection.
 *
 * Exists so the settings page can be INSTANT. The first cut made each toggle a
 * link that carried `?leagues=` and let the route write the cookie — correct,
 * no JavaScript, and it felt like a page refresh on every tap, because that is
 * what it was. A settings switch has to move under your thumb; the writing
 * down can happen afterwards.
 *
 * So the island flips optimistically and calls this in the background. The
 * links did NOT stay as a no-JS path — they were removed with the rewrite, so
 * this endpoint is the only writer the switches have.
 *
 * POST rather than GET: it changes stored state, so it must not be something a
 * prefetch or a crawler can trigger.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import {
  MFL_LIVE_LEAGUE_COOKIE,
  MFL_LIVE_LEAGUE_MAX_AGE,
} from '../../utils/mfl-live-selection';

export const prerender = false;

const NO_STORE = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

/**
 * A selection is a short list of MFL league ids, or the literal "default".
 *
 * Validated for SHAPE only. It is not checked against the owner's real leagues
 * here and does not need to be: the cookie is only ever read back through
 * `resolveMflLiveLeagues`, which intersects it with the leagues this owner's
 * own MFL cookie returns. A junk value can therefore only ever cost the person
 * who sent it their own selection — it can never widen what they see.
 *
 * The bound is here so nobody can park a large string in a cookie that then
 * rides every request to this origin.
 */
const MAX_LEAGUES = 40;
const ID = /^[A-Za-z0-9_-]{1,24}$/;

function normalize(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value === 'default') return 'default';
  const ids = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > MAX_LEAGUES) return null;
  if (!ids.every((id) => ID.test(id))) return null;
  return ids.join(',');
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(JSON.stringify({ ok: false, reason: 'unauthenticated' }), {
      status: 401,
      headers: NO_STORE,
    });
  }

  const body = await request.json().catch(() => null);
  const leagues = normalize((body as { leagues?: unknown } | null)?.leagues);
  if (leagues === null) {
    return new Response(JSON.stringify({ ok: false, reason: 'bad-selection' }), {
      status: 400,
      headers: NO_STORE,
    });
  }

  cookies.set(MFL_LIVE_LEAGUE_COOKIE, leagues, {
    maxAge: MFL_LIVE_LEAGUE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
  });

  return new Response(JSON.stringify({ ok: true, leagues }), { status: 200, headers: NO_STORE });
};
