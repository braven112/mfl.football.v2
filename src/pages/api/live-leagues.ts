/**
 * MFL Live's league selection: read it (the phone app) and change it (the
 * phone app and `/live/settings`).
 *
 * The choice is stored per MFL ACCOUNT (`mfl-live-selection-store.ts`), so a
 * switch flipped on the phone is what the web board shows and the reverse.
 * The `live_leagues` cookie is still written for the web, and still read as
 * the fallback for an owner whose choice predates the store.
 *
 * Two POST bodies, one per caller:
 *  - `{ leagues: "id,id" | "default" }` — the settings island, which already
 *    holds the whole list and toggles optimistically in the browser.
 *  - `{ league, enabled }` — the app, which cannot import site code and so
 *    must not have to know the "last league" and "collapse to default" rules.
 *    The server applies `toggleMflLiveLeague`, the same rule the island uses.
 *
 * Both callers sign in through `getMflLiveUser`, the one reader that accepts
 * the app's `Authorization: Bearer` header. POST rather than GET for changes:
 * it changes stored state, so a prefetch or a crawler must not trigger it.
 */

import type { APIRoute } from 'astro';
import { getMflLiveUser, type AuthUser } from '../../utils/auth';
import { discoverBoardLeagues } from '../../utils/cross-league-live';
import {
  MFL_LIVE_LEAGUE_COOKIE,
  MFL_LIVE_LEAGUE_MAX_AGE,
  resolveMflLiveLeagues,
  toggleMflLiveLeague,
  type BoardLeague,
} from '../../utils/mfl-live-selection';
import {
  mflLiveLeagueChoices,
  normalizeMflLiveSelection,
  readMflLiveSelection,
  saveMflLiveSelection,
} from '../../utils/mfl-live-selection-store';
import { getSleeperLink } from '../../utils/sleeper/link';
import { discoverSleeperBoardLeagues } from '../../utils/sleeper/live';
import { getCurrentSeasonYear } from '../../utils/league-year';

export const prerender = false;

const NO_STORE = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: NO_STORE });

const fail = (status: number, reason: string) => reply(status, { ok: false, reason });

/**
 * Every league the selection ranges over, Sleeper included. The app never
 * lists a Sleeper league, but the selection is one list for every screen, so
 * the server must know them to keep the web's Sleeper choices intact when the
 * phone toggles an MFL league. Sleeper is never fatal.
 */
async function allLeagues(user: AuthUser): Promise<BoardLeague[]> {
  const link = await getSleeperLink(user).catch(() => null);
  const [mfl, sleeper] = await Promise.all([
    discoverBoardLeagues(user),
    discoverSleeperBoardLeagues(link, getCurrentSeasonYear()).catch(() => []),
  ]);
  return [...mfl, ...sleeper];
}

function view(leagues: readonly BoardLeague[], enabled: readonly string[], explicit: boolean) {
  return { ok: true as const, leagues: mflLiveLeagueChoices(leagues, enabled), explicit };
}

export const GET: APIRoute = async ({ request, cookies }) => {
  const user = getMflLiveUser(request);
  if (!user) return fail(401, 'unauthenticated');

  const leagues = await allLeagues(user).catch(() => null);
  if (!leagues || leagues.length === 0) return fail(502, 'load-failed');

  const stored = await readMflLiveSelection(user, cookies.get(MFL_LIVE_LEAGUE_COOKIE)?.value);
  const { enabled, explicit } = resolveMflLiveLeagues(null, stored, leagues);
  return reply(200, view(leagues, enabled, explicit));
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const user = getMflLiveUser(request);
  if (!user) return fail(401, 'unauthenticated');

  const body = (await request.json().catch(() => null)) as
    | { leagues?: unknown; league?: unknown; enabled?: unknown }
    | null;

  // ── The app: one league on or off, rules applied here. ──
  if (body && typeof body.league === 'string') {
    if (typeof body.enabled !== 'boolean') return fail(400, 'bad-selection');
    const leagues = await allLeagues(user).catch(() => null);
    if (!leagues || leagues.length === 0) return fail(502, 'load-failed');
    const target = leagues.find((l) => l.id === body.league && l.provider !== 'sleeper');
    if (!target) return fail(400, 'unknown-league');

    const allIds = leagues.map((l) => l.id);
    const stored = await readMflLiveSelection(user, cookies.get(MFL_LIVE_LEAGUE_COOKIE)?.value);
    const { enabled, explicit } = resolveMflLiveLeagues(null, stored, leagues);
    if (enabled.includes(target.id) === body.enabled) {
      return reply(200, view(leagues, enabled, explicit)); // already so; a repeated tap is not an error
    }

    const { selection, refused } = toggleMflLiveLeague(enabled, allIds, target.id);
    if (refused) return fail(409, 'last-league');
    const value = selection ? selection.join(',') : 'default';
    if (!(await saveMflLiveSelection(user, value))) return fail(503, 'save-failed');
    writeCookie(cookies, value);
    return reply(200, view(leagues, selection ?? allIds, selection !== null));
  }

  // ── The settings island: the whole list. ──
  const leagues = normalizeMflLiveSelection(body?.leagues);
  if (leagues === null) return fail(400, 'bad-selection');

  // The cookie is written even when the account save fails, so the web never
  // loses a toggle to a Redis outage; it is the fallback the store reads.
  writeCookie(cookies, leagues);
  const saved = await saveMflLiveSelection(user, leagues);
  return reply(200, { ok: true, leagues, saved });
};

function writeCookie(cookies: Parameters<APIRoute>[0]['cookies'], value: string): void {
  cookies.set(MFL_LIVE_LEAGUE_COOKIE, value, {
    maxAge: MFL_LIVE_LEAGUE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
  });
}
