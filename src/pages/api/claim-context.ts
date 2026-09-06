/**
 * GET /api/claim-context
 *
 * "May I claim players here, on what terms, and who is already taken?" — one
 * answer, fetched once per page by src/utils/player-claim-client.ts so the
 * player modal can decide whether to show its Claim button.
 *
 * WHY AN ENDPOINT AND NOT SSR: the player modal is mounted on eight pages
 * (both rosters, the homepage, insights, projected FAs, What's New, both free
 * agent pages). Resolving this in each page's frontmatter would put three MFL
 * round-trips in front of every one of those renders, to decide whether a
 * button appears inside a dialog most visits never open. Here it costs
 * nothing until someone opens the modal.
 *
 * Session-scoped, so:
 * - The league comes from the session JWT, exactly as `POST /api/waiver-claim`
 *   resolves it. `?league=` is a CHECK on top of that, never an input — the
 *   same contract as /api/watch-list, /api/draft-list and kv-franchise-store.
 *   It is load-bearing: MFL player ids are GLOBAL, so a TheLeague owner
 *   browsing an AFL page, answered for TheLeague, would see AFL free agents
 *   who happen to be unrostered in TheLeague come back claimable — a button on
 *   the wrong league's page that files a real bid in the other one. A mismatch
 *   401s and the modal quietly shows Watch alone, which is correct.
 * - `Cache-Control: no-store`. The body carries the viewer's own roster.
 *
 * Rate-limited because it fans out to MFL (league, calendar, rosters, names).
 * The cap is generous: this is a read, and the client caches per page load.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { json, unauthorized, JSON_HEADERS_NO_STORE } from '../../utils/api-response';
import { rankingsScopeForLeagueId } from '../../utils/rankings-scope';
import { checkRateLimit } from '../../utils/rate-limit';
import { resolveClaimContext } from '../../utils/claim-context';
import { readViewerClock } from '../../utils/viewer-preferences-page';

export const prerender = false;

/** Signed-out (or unknown-league) shape: no claiming, and nothing to leak. */
const NO_CLAIMS = {
  signedIn: false,
  canClaim: false,
  verb: 'Claim' as const,
  rosteredIds: [] as string[],
};

export const GET: APIRoute = async ({ request, cookies }) => {
  const user = getAuthUser(request);
  // 200, not 401: a signed-out visitor asking "can I claim?" gets a real
  // answer ("no"), and the modal renders Watch alone. A 401 here would make
  // every anonymous page view log a failed request.
  if (!user?.franchiseId) return json(NO_CLAIMS, 200, JSON_HEADERS_NO_STORE);

  // The page's league, checked against the session's. See the header note.
  const requested = new URL(request.url).searchParams.get('league');
  if (requested && requested !== rankingsScopeForLeagueId(user.leagueId)) {
    return unauthorized({ error: 'League mismatch.' }, JSON_HEADERS_NO_STORE);
  }

  // Keyed on the MFL user id, not the franchise id: both leagues have a
  // franchise 0001, so a franchise-keyed bucket would have two owners sharing
  // one limit and a 429 would render as "no claim button". Same key as
  // /api/waiver-claims.
  const limit = await checkRateLimit('claim-context', user.id, 60, 60);
  if (!limit.allowed) {
    return json({ ...NO_CLAIMS, signedIn: true, error: 'Slow down' }, 429, JSON_HEADERS_NO_STORE);
  }

  // The waiver deadline in the modal is a LEAGUE event; a viewer who has named
  // their own clock reads it in that one, with PT beside it. Read-only — this
  // route must not write a preference cookie onto a background fetch.
  const clock = await readViewerClock(cookies, user);
  const context = await resolveClaimContext(user, clock);
  if (!context) return json(NO_CLAIMS, 200, JSON_HEADERS_NO_STORE);

  return json(context, 200, JSON_HEADERS_NO_STORE);
};
