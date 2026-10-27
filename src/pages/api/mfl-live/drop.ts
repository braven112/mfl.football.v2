/**
 * POST /api/mfl-live/drop?league= — cut one player: `{ playerId, year? }`.
 *
 * The site's `/api/cut-player`, for any MFL league the account is in: MFL's
 * own add_drop page, the owner's own cookie, and the roster read back before
 * it says the cut landed (`src/utils/cut-player-action.ts`).
 * Wire shape: packages/shared-types/src/mfl-live-app-l.ts.
 */

import type { APIRoute } from 'astro';
import { requireOwnerLeague, appJson } from '../../../utils/live/owner-league';
import { handledFailure, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { appOwnerContext } from '../../../utils/live/mfl-live-app-waivers';
import { cutPlayerForOwner } from '../../../utils/cut-player-action';
import { checkRateLimit } from '../../../utils/rate-limit';

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
  const owner = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (owner instanceof Response) return owner;
  const ctx = appOwnerContext(owner.user, owner.league);
  if (!ctx) return handledFailure('MFL did not say where this league lives. Try again shortly.', 503, {}, JSON_HEADERS_NO_STORE);

  // An authenticated write that fans out to MFL. The site's route has no
  // limit because KeeperPlanner fires ten cuts back to back; the app cuts one
  // at a time.
  const limit = await checkRateLimit('mfl-live-drop', ctx.cookie, 20, 60);
  if (!limit.allowed) return appJson({ success: false, message: 'Too many requests — wait a moment and try again.' }, 429);

  return cutPlayerForOwner(ctx, request);
};
