/**
 * POST /api/app-install — "this owner has the app."
 *
 * Called by the install banner when it can prove it (the page is running in
 * standalone display mode, or the browser just fired `appinstalled`) and when
 * the owner says so themselves. Recording it against the ACCOUNT rather than
 * the browser is the whole point: an owner with the app on their phone was
 * still being pitched it in every desktop browser, because on that device the
 * app genuinely is installable and no client-side signal can know better.
 *
 * Identity comes only from the signed session JWT, like every other write
 * here — both leagues have a franchise 0001, so a client-supplied league or
 * franchise would let one league's owner silence the other's banner.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { json, JSON_HEADERS_NO_STORE } from '../../utils/api-response';
import { checkRateLimit } from '../../utils/rate-limit';
import { getLeagueById } from '../../config/leagues';
import { isInstallSource, recordInstalled } from '../../utils/app-install-state';

const headers = JSON_HEADERS_NO_STORE;

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId || !user.leagueId) {
    return json({ error: 'Authentication required' }, 401, headers);
  }
  const league = getLeagueById(user.leagueId);
  if (!league) return json({ error: 'Unknown league' }, 400, headers);

  // The banner reports once per device and then remembers locally, so a normal
  // owner spends one or two of these ever. The limit exists for a wedged
  // client looping on a failed write, not for the happy path.
  const limit = await checkRateLimit('app-install', `${league.id}:${user.franchiseId}`, 20, 3600);
  if (!limit.allowed) return json({ error: 'Too many requests' }, 429, headers);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const payload = (body as { source?: unknown; league?: unknown }) ?? {};

  // The page tells us which league's banner was clicked; the SESSION decides
  // which record gets written. An owner signed into one league can browse the
  // other's homepage, and filing that click against their own league would
  // silence a banner they never saw. A mismatch is not an error worth showing
  // — the banner already hid itself locally — so it 403s and stops there.
  if (typeof payload.league === 'string' && payload.league && payload.league !== league.slug) {
    return json({ error: 'League mismatch' }, 403, headers);
  }

  const source = isInstallSource(payload.source) ? payload.source : 'declared';

  const state = await recordInstalled(league.id, user.franchiseId, source);
  if (!state) return json({ error: 'Could not save — storage unavailable' }, 503, headers);

  return json({ success: true, installedAt: state.installedAt, source: state.source }, 200, headers);
};
