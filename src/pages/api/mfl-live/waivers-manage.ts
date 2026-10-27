/**
 * POST /api/mfl-live/waivers-manage?league= — change a claim already filed:
 * `{ action: 'delete' | 'editDrop', round, addPlayerId, dropPlayerId?, comment? }`.
 *
 * The site's `/api/waiver-claims` POST, for any MFL league the account is in.
 * There is no reorder: MFL has no primitive for it (see waiver-claim-actions.ts).
 * Wire shape: packages/shared-types/src/mfl-live-app-l.ts.
 */

import type { APIRoute } from 'astro';
import { requireOwnerLeague } from '../../../utils/live/owner-league';
import { handledFailure, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { appOwnerContext } from '../../../utils/live/mfl-live-app-waivers';
import { manageFiledClaim } from '../../../utils/waiver-claim-actions';

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
  const owner = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (owner instanceof Response) return owner;
  const ctx = appOwnerContext(owner.user, owner.league);
  if (!ctx) return handledFailure('MFL did not say where this league lives. Try again shortly.', 503, {}, JSON_HEADERS_NO_STORE);
  return manageFiledClaim(ctx, request, { storeSafe: true });
};
