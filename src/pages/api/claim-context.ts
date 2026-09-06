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
 * - No `league` parameter. The league comes from the session JWT, exactly as
 *   `POST /api/waiver-claim` resolves it. A signed-in TheLeague owner browsing
 *   the AFL is answered for TheLeague and the AFL page's modal will offer
 *   nothing, which is the correct outcome — both leagues have a franchise
 *   0001, and trusting a client-supplied league is how you file a claim into
 *   the wrong one.
 * - `Cache-Control: no-store`. The body carries the viewer's own roster.
 *
 * Rate-limited because it fans out to MFL (league, calendar, rosters, names).
 * The cap is generous: this is a read, and the client caches per page load.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { json, JSON_HEADERS_NO_STORE } from '../../utils/api-response';
import { checkRateLimit } from '../../utils/rate-limit';
import { resolveClaimContext } from '../../utils/claim-context';

export const prerender = false;

/** Signed-out (or unknown-league) shape: no claiming, and nothing to leak. */
const NO_CLAIMS = {
  signedIn: false,
  canClaim: false,
  verb: 'Claim' as const,
  rosteredIds: [] as string[],
};

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  // 200, not 401: a signed-out visitor asking "can I claim?" gets a real
  // answer ("no"), and the modal renders Watch alone. A 401 here would make
  // every anonymous page view log a failed request.
  if (!user?.franchiseId) return json(NO_CLAIMS, 200, JSON_HEADERS_NO_STORE);

  const limit = await checkRateLimit('claim-context', user.franchiseId, 60, 60);
  if (!limit.allowed) {
    return json({ ...NO_CLAIMS, signedIn: true, error: 'Slow down' }, 429, JSON_HEADERS_NO_STORE);
  }

  const context = await resolveClaimContext(user);
  if (!context) return json(NO_CLAIMS, 200, JSON_HEADERS_NO_STORE);

  return json(context, 200, JSON_HEADERS_NO_STORE);
};
