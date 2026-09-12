/**
 * Remember the television's choices.
 *
 * Called from the ROUTE and nowhere else. `Astro.cookies.set()` from an
 * imported component runs after the response headers are committed, throws
 * `ResponseSentError`, and blanks the page — the Sunday Ticket board shipped
 * exactly that on its first country click. Reading is side-effect free and
 * fine anywhere; WRITING belongs to the route.
 */

import type { AstroCookies } from 'astro';
import {
  BROADCAST_LEAGUE_COOKIE,
  BROADCAST_LEAGUE_MAX_AGE,
  BROADCAST_SOUND_COOKIE,
} from './broadcast-selection';

/**
 * Persist `?leagues=` and `?sound=` when the URL carries them.
 *
 * Only an EXPLICIT param writes. A visit with no params must not stamp the
 * current default set into the cookie — that would freeze a board that should
 * follow the registry, so an owner joining a new league would never see it
 * appear.
 */
export function rememberBroadcastChoices(url: URL, cookies: AstroCookies): void {
  const leagues = url.searchParams.get('leagues');
  if (leagues !== null) {
    cookies.set(BROADCAST_LEAGUE_COOKIE, leagues, {
      path: '/',
      maxAge: BROADCAST_LEAGUE_MAX_AGE,
      sameSite: 'lax',
      httpOnly: false,
    });
  }

  const sound = url.searchParams.get('sound');
  if (sound !== null) {
    cookies.set(BROADCAST_SOUND_COOKIE, sound === '1' || sound === 'on' || sound === 'true' ? '1' : '0', {
      path: '/',
      maxAge: BROADCAST_LEAGUE_MAX_AGE,
      sameSite: 'lax',
      httpOnly: false,
    });
  }
}
