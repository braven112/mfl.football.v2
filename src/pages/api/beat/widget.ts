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
import { absolutePersonaAvatar, personaByline, personaLabels, BEAT_REPORTER_PERSONA } from '../../../utils/persona.mjs';
import { getAuthor, getAuthorAvatar } from '../../../types/schefter';
import { SOURCE_PREDICATES } from '../../../utils/schefter-sources';
import { getOwnRosterIds, postConcernsFranchise, postMentionsAny } from '../../../utils/schefter-watching';
import { getLeagueYearForSlug } from '../../../utils/league-year';
import { getCachedRosterFranchises } from '../../../utils/mfl-roster-cache';
import { loadLiveInjuryMap } from '../../../utils/mfl-injuries-live-map';
import { getPlayerMap, preloadPlayerIdentity } from '../../../utils/player-map';
import { resolveFeedMode } from '../../../utils/schefter-season-mode';
import { postPlayerIds } from '../../../utils/schefter-player-tagger.mjs';
import { checkRateLimit } from '../../../utils/rate-limit';
import {
  WIDGET_CSS,
  widgetCss,
  buildInjuryAlerts,
  isMflOrigin,
  pickBreaking,
  renderAdWidget,
  renderNewsWidget,
  selectWidgetPosts,
  verifyWidgetKey,
  widgetSecret,
} from '../../../utils/beat-widget.mjs';

export const prerender = false;

// Each league's light-theme palette (src/themes/<id>.json), for the widget's colors.
const THEME_LIGHT = import.meta.glob<Record<string, string | null>>('../../../themes/*.json', { eager: true, import: 'light' });
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/**
 * The widget wears the league's own two colors (Brandon, 2026-11-16): its
 * theme's primary and secondary, else its share-card color for both.
 */
function leagueWidgetColors(league: { theme?: string; shareCard?: { primary?: string }; themeColor?: string }) {
  const light = (league.theme && THEME_LIGHT[`../../../themes/${league.theme}.json`]) || {};
  const fallback = [league.shareCard?.primary, league.themeColor].find(isHex);
  const primary = isHex(light['--color-primary']) ? light['--color-primary'] : fallback;
  const secondary = isHex(light['--color-secondary']) ? light['--color-secondary'] : primary;
  return { primary, secondary };
}

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
  // The viewer's franchise, when MFL's page named one (public/mfl/beat.js).
  // Anyone can send any id, so it only decides which PUBLIC posts lead: the
  // roster is public on MFL, and nothing private (watch list, nudges) is read.
  const fid = (url.searchParams.get('F') ?? '').match(/^\d{4}$/)?.[0];
  const year = getLeagueYearForSlug(league.slug);
  const roster = fid && fid !== '0000' ? await getOwnRosterIds(league, year, fid).catch(() => new Set<string>()) : null;
  const personal = roster && roster.size > 0;
  const now = Date.now();
  const alerts = personal && resolveFeedMode(new Date(now)) === 'in-season'
    ? await injuryAlerts(league, year, fid!, roster!, feed?.posts ?? [], now).catch(() => [])
    : [];
  const isFirstTab = personal
    ? (p: any) => SOURCE_PREDICATES.theleague(p) || postMentionsAny(p, roster) || postConcernsFranchise(p, fid)
    : SOURCE_PREDICATES.theleague;
  const { posts, leagueIds } = selectWidgetPosts(feed, { isLeague: isFirstTab });
  const site = (src: string) => absolutePersonaAvatar({ avatarUrl: src }, SHARED_APP_ORIGIN);
  const html = renderNewsWidget({
    posts,
    leagueIds,
    firstTab: personal ? 'My News' : 'League',
    // Each post wears its own author's face: the league's reporter (persona
    // applied), Roger, Vegas Vic, Doc Rivers, or the ESPN writer.
    bylineFor: (post: any) => {
      const author = getAuthor(post.authorId);
      const by = personaByline(author, getAuthorAvatar(author), persona);
      return { name: by.name, avatar: site(by.avatar) };
    },
    reporter: {
      name: labels.name,
      report: labels.report,
      avatar: absolutePersonaAvatar({ avatarUrl: labels.avatar }, SHARED_APP_ORIGIN),
    },
    absolute: (path: string) => leagueUrl(league, path),
    leagueSlug: league.slug,
    breaking: pickBreaking(feed, now),
    alerts,
    // Relative on purpose: it resolves against the MFL page the widget sits
    // on (…/<year>/home/<id>), so it lands on that league's own lineup page.
    lineupHref: `options?L=${mflId}&O=02`,
    now,
  });
  return new Response(JSON.stringify({ html, css: widgetCss(leagueWidgetColors(league as any)) }), { status: 200, headers: headers(origin) });
};

/** Doc's word on a player only counts while it is this week's news. */
const DOC_TAKE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The owner's injury alerts: active-roster players (not IR, not taxi) MFL lists
 * as Out, Doubtful or Questionable, with Doc Rivers' latest post on each. Every
 * input is public (rosters, MFL's injury report, the feed), which is why a
 * franchise id the page could have faked is enough to ask for it.
 */
async function injuryAlerts(league: any, year: number, fid: string, roster: Set<string>, posts: any[], now: number) {
  const [franchises, injuries] = await Promise.all([
    getCachedRosterFranchises(String(year), league.id).catch(() => null),
    loadLiveInjuryMap(league.slug),
    // getPlayerMap reads synchronously; on a function the file must be loaded first.
    preloadPlayerIdentity([year]),
  ]);
  const mine = franchises?.find((f) => String(f.id) === fid);
  const active = mine
    ? mine.player.filter((p) => p.status === 'ROSTER').map((p) => String(p.id))
    : [...roster];
  const players = getPlayerMap(year);
  const docPosts = posts
    .filter((p) => p?.authorId === 'doc-rivers' && now - Date.parse(p.timestamp) <= DOC_TAKE_MAX_AGE_MS)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return buildInjuryAlerts({
    playerIds: active,
    injuries,
    player: (id) => players.get(id),
    docTake: (id) => {
      const post = docPosts.find((p) => postPlayerIds(p).includes(id));
      return post ? post.body || post.headline || null : null;
    },
  });
}
