/**
 * GET /api/beat/snippet?league=<slug>
 *
 * The paste-in snippet (with its key) for a league's MFL Home Page Message.
 * Commissioner of that league, or a platform admin, only: the key is what
 * turns the widget on, so it is never shown to anyone else.
 */
import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { resolveAdministeredLeague } from '../../../utils/league-admin';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { SHARED_APP_ORIGIN } from '../../../config/leagues';
import { widgetKey, widgetSecret, widgetSnippet } from '../../../utils/beat-widget.mjs';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const resolved = resolveAdministeredLeague(getAuthUser(request), url.searchParams.get('league'));
  if (!resolved.ok) return json({ ok: false, error: resolved.error }, resolved.status, JSON_HEADERS_NO_STORE);
  const secret = widgetSecret();
  if (!secret) return json({ ok: false, error: 'Server has no signing secret' }, 503, JSON_HEADERS_NO_STORE);
  const league = resolved.league;
  const snippet = widgetSnippet({ origin: SHARED_APP_ORIGIN, key: widgetKey(league.id, secret) });
  if (url.searchParams.get('format') === 'text') {
    return new Response(snippet, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  return json({ ok: true, league: league.slug, snippet }, 200, JSON_HEADERS_NO_STORE);
};
