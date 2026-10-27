/**
 * POST /api/cut-player
 *
 * Drop a player from the authenticated user's roster via MFL's `add_drop`
 * page handler. The logic (and why it is `add_drop`, not `fcfsWaiver`) lives
 * in `src/utils/cut-player-action.ts`, shared with the phone app's
 * `/api/mfl-live/drop`; this route only resolves the site session.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../utils/api-response';
import { siteOwnerContext } from '../../utils/waiver-claim-actions';
import { cutPlayerForOwner } from '../../utils/cut-player-action';

export const POST: APIRoute = async ({ request }) => {
  const resolved = siteOwnerContext(getAuthUser(request));
  if (!resolved.ok) {
    return new Response(JSON.stringify({ success: false, message: resolved.message }), {
      status: resolved.status,
      headers: JSON_HEADERS,
    });
  }
  return cutPlayerForOwner(resolved.ctx, request);
};
