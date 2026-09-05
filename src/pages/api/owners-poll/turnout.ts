/**
 * The Owners' Poll — public turnout meter.
 *
 *   GET /api/owners-poll/turnout?league=<navSlug>
 *
 * Counts only: how many ballots are in, and how many owners there are. This
 * endpoint is deliberately unauthenticated, because the meter renders for
 * everyone on the article — including a reader who hasn't voted, for whom
 * seeing the count climb is the whole point.
 *
 * It must never grow a "who" — the count-only decision for the GroupMe nag
 * (docs/plans/owners-poll.md) applies here too, and an endpoint that names
 * non-voters would route straight around it. That is why this reads HLEN
 * rather than HGETALL.
 */

import type { APIRoute } from 'astro';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import {
  countBallots,
  readOwnersPollWindow,
  resolvePublicLeague,
  windowState,
} from '../../../utils/owners-poll-store';

export const GET: APIRoute = async ({ request }) => {
  const headers = JSON_HEADERS_NO_STORE;

  const league = resolvePublicLeague(request);
  if (!league) {
    return json({ error: 'Unknown league' }, 404, headers);
  }

  const window = await readOwnersPollWindow(league.navSlug);
  const state = windowState(window);
  if (!window || state !== 'open') {
    return json({ status: state, turnout: null }, 200, headers);
  }

  const ballotsIn = await countBallots(league.navSlug, window);
  return json(
    {
      status: 'open',
      week: window.week,
      year: window.year,
      closesAt: window.closesAt,
      turnout: { ballotsIn, eligible: window.eligibleFranchiseIds.length },
    },
    200,
    headers,
  );
};
