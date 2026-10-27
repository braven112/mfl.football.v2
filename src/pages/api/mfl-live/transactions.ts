/**
 * The MFL Football app's transactions feed for one league (package O):
 * `GET /api/mfl-live/transactions?league=<id>&filter=all|adds|trades|mine&limit=&before=`.
 *
 * Read only. `requireOwnerLeague` answers every refusal (signed out, no
 * league, not your league) and hands back the league as MFL lists it for this
 * account; the read uses the owner's own MFL cookie, never our credentials.
 * Parsing and naming live in `src/utils/live/mfl-live-transactions.ts`.
 */

import type { APIRoute } from 'astro';
import { requireOwnerLeague } from '../../../utils/live/owner-league';
import { transactionsResponse } from '../../../utils/live/mfl-live-transactions';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;
  return transactionsResponse(gate.league, gate.user.id, url.searchParams);
};
