/**
 * Link or unlink a Sleeper account on MFL Live.
 *
 * A plain HTML form posts here and is sent back to `/live/settings` with a
 * one-word outcome in `?sleeper=`, so the page works without JavaScript and a
 * refresh never re-submits (303, not 200).
 *
 * Linking is a USERNAME, not a sign-in: Sleeper's API is public and read-only,
 * so there is nothing to authorize and no credential to hold (decided Oct
 * 2026). The username is looked up first and only a real account is stored —
 * under the MFL Live viewer's own key, so a link can only ever change what
 * that viewer's own board reads.
 *
 * POST only: it changes stored state. The session cookie is SameSite=Lax, so
 * another site's form cannot post here as the viewer.
 */

import type { APIRoute } from 'astro';
import { getMflLiveUser } from '../../utils/auth';
import { fetchSleeperUser, normalizeSleeperUsername } from '../../utils/sleeper/client';
import { clearSleeperLink, setSleeperLink } from '../../utils/sleeper/link';
import { discoverSleeperBoardLeagues } from '../../utils/sleeper/live';
import { getCurrentSeasonYear } from '../../utils/league-year';
import {
  MFL_LIVE_LEAGUE_COOKIE,
  MFL_LIVE_LEAGUE_MAX_AGE,
  withLeaguesEnabled,
} from '../../utils/mfl-live-selection';

export const prerender = false;

const back = (outcome: string) =>
  new Response(null, {
    status: 303,
    headers: { Location: `/live/settings?sleeper=${outcome}`, 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request, cookies }) => {
  const user = getMflLiveUser(request);
  if (!user) return back('signed-out');

  const form = await request.formData().catch(() => null);
  const action = String(form?.get('action') ?? 'link');

  if (action === 'unlink') {
    return back((await clearSleeperLink(user)) ? 'unlinked' : 'error');
  }

  const username = normalizeSleeperUsername(form?.get('username'));
  if (!username) return back('invalid');

  const { ok, user: sleeper } = await fetchSleeperUser(username);
  if (!ok) return back('unavailable');
  if (!sleeper) return back('not-found');

  const link = {
    userId: sleeper.user_id,
    username: sleeper.username,
    displayName: sleeper.display_name,
    avatar: sleeper.avatar,
  };
  const saved = await setSleeperLink(user, link);
  if (!saved) return back('error');

  // An owner who has ever toggled a league has an explicit selection, which
  // never widens by itself, so the leagues they just linked would arrive
  // switched OFF. Switch them on. A failed discovery leaves the selection as
  // it was; the toggles on settings still offer them.
  const leagues = await discoverSleeperBoardLeagues({ ...link, linkedAt: '' }, getCurrentSeasonYear()).catch(() => []);
  const next = withLeaguesEnabled(cookies.get(MFL_LIVE_LEAGUE_COOKIE)?.value, leagues.map((l) => l.id));
  if (next) {
    cookies.set(MFL_LIVE_LEAGUE_COOKIE, next, {
      maxAge: MFL_LIVE_LEAGUE_MAX_AGE,
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
    });
  }
  return back('linked');
};
