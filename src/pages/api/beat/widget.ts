/**
 * GET /api/beat/widget?L=<mfl id>&k=<league key>
 *
 * The Beat Reporter widget for a league's own myfantasyleague.com pages
 * (src/utils/beat-widget.mjs holds every rule; public/mfl/beat.js is the thin
 * loader the commissioner pastes). Returns `{ html, css }`, rendered here so
 * no logic ships to the page.
 *
 * A league sees its news when it runs the reporter on our side AND sends its
 * own key. Anything else, including a snippet copied into another league,
 * gets the ad card. CORS is open only to myfantasyleague.com pages.
 */
import type { APIRoute } from 'astro';
import { getLeagueById, leagueUrl, SHARED_APP_ORIGIN } from '../../../config/leagues';
import { getSchefterFeedIfAny } from '../../../utils/schefter-league-data';
import { getLeaguePersona } from '../../../utils/persona-server';
import { absolutePersonaAvatar, personaLabels, BEAT_REPORTER_PERSONA } from '../../../utils/persona.mjs';
import { checkRateLimit } from '../../../utils/rate-limit';
import {
  WIDGET_CSS,
  isMflOrigin,
  renderAdWidget,
  renderNewsWidget,
  selectWidgetPosts,
  verifyWidgetKey,
  widgetSecret,
} from '../../../utils/beat-widget.mjs';

export const prerender = false;

function headers(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
    Vary: 'Origin',
  };
  if (origin && isMflOrigin(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

export const GET: APIRoute = async ({ request, url }) => {
  const origin = request.headers.get('origin');
  // A browser on any other site is refused outright; a request with no
  // Origin (curl, a server) gets the same answer as an unpaid league.
  if (origin && !isMflOrigin(origin)) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: headers(null) });
  }

  const mflId = (url.searchParams.get('L') ?? '').replace(/\D/g, '');
  const key = url.searchParams.get('k') ?? '';
  const ad = () =>
    new Response(JSON.stringify({ html: renderAdWidget({ origin: SHARED_APP_ORIGIN, avatar: BEAT_REPORTER_PERSONA.avatarUrl, name: BEAT_REPORTER_PERSONA.name }), css: WIDGET_CSS }), {
      status: 200,
      headers: headers(origin),
    });

  const league = mflId ? getLeagueById(mflId) : null;
  // Paid, for now: a registry league that runs the reporter. Outside leagues
  // join through the subscriber list in a later phase.
  if (!league || !league.features?.schefterFeed || !verifyWidgetKey(mflId, key, widgetSecret())) return ad();

  const limit = await checkRateLimit('beat-widget', league.slug, 600, 60);
  if (!limit.allowed) return new Response(JSON.stringify({ error: 'slow down' }), { status: 429, headers: headers(origin) });

  const [feed, persona] = await Promise.all([getSchefterFeedIfAny(league), getLeaguePersona(league.slug)]);
  const labels = personaLabels(persona);
  const html = renderNewsWidget({
    posts: selectWidgetPosts(feed),
    reporter: {
      name: labels.name,
      report: labels.report,
      avatar: absolutePersonaAvatar({ avatarUrl: labels.avatar }, SHARED_APP_ORIGIN),
    },
    absolute: (path: string) => leagueUrl(league, path),
    leagueSlug: league.slug,
  });
  return new Response(JSON.stringify({ html, css: WIDGET_CSS }), { status: 200, headers: headers(origin) });
};
