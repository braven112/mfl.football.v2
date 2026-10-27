/**
 * /api/mfl-live/waivers?league= — the MFL Football app's waivers, for ANY MFL
 * league the account is in.
 *
 * GET  → the add/drop sheet's context (bid rules, FAAB balance, which window
 *        is open, the drop picker, who is taken) plus the claims already filed.
 * POST → file claims, or in an FCFS window add one player now:
 *        `{ claims: [{ addPlayerId, bid?, dropPlayerId? }], round?, year? }`.
 *
 * The league is checked against the account's own MFL league list
 * (`requireOwnerLeague`) and the write acts as the team MFL lists for this
 * account, never one from the request. Everything after that is the site's
 * own `/api/waiver-claim` code (`src/utils/waiver-claim-actions.ts`), with the
 * owner's own MFL cookie. Wire shape: packages/shared-types/src/mfl-live-app-l.ts.
 */

import type { APIRoute } from 'astro';
import { requireOwnerLeague, appJson } from '../../../utils/live/owner-league';
import { handledFailure, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { appOwnerContext, buildWaiversView } from '../../../utils/live/mfl-live-app-waivers';
import { submitWaiverClaims } from '../../../utils/waiver-claim-actions';
import { checkRateLimit } from '../../../utils/rate-limit';

export const prerender = false;

// A 5xx goes out as a handled 200 like every claim failure: the edge eats a 5xx body.
const noHost = () =>
  handledFailure('MFL did not say where this league lives. Try again shortly.', 503, {}, JSON_HEADERS_NO_STORE);

export const GET: APIRoute = async ({ request, url }) => {
  const owner = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (owner instanceof Response) return owner;
  const ctx = appOwnerContext(owner.user, owner.league);
  if (!ctx) return noHost();

  // A read that fans out to MFL (league, calendar, rosters, names, claims).
  // Keyed on the MFL cookie, same budget as the site's /api/claim-context.
  const limit = await checkRateLimit('claim-context', ctx.cookie, 60, 60);
  if (!limit.allowed) return appJson({ success: false, message: 'Too many requests — wait a moment and try again.' }, 429);

  return appJson(await buildWaiversView(ctx));
};

export const POST: APIRoute = async ({ request, url }) => {
  const owner = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (owner instanceof Response) return owner;
  const ctx = appOwnerContext(owner.user, owner.league);
  if (!ctx) return noHost();
  return submitWaiverClaims(ctx, request);
};
