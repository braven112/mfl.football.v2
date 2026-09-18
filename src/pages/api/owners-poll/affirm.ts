/**
 * POST /api/owners-poll/affirm — "Still good": my ballot stands as-is.
 *
 * Standing votes have exactly one failure mode, and it is not turnout. An
 * owner who files a ballot in Week 2 and never revisits it is republished in
 * every snapshot as though they re-affirmed it, so by midseason a large share
 * of the consensus is inertia rather than opinion. This endpoint is what turns
 * standing pat back into an affirmative act: one tap, no re-ranking.
 *
 * Three surfaces call it — the column's poll section, the homepage card's
 * staleness prompt, and the Thursday push — and they all send the SAME thing:
 * nothing. The request has no body.
 *
 * **Why no ranking travels.** The obvious implementation is for the button to
 * re-POST the ranking the client is already holding. That is a lost-update bug
 * waiting to happen: an owner who edits their ballot on their phone and then
 * presses "Still good" on a desktop tab opened an hour earlier would write the
 * older ranking back over the newer one, and neither the client nor the server
 * would have any way to notice. The ranking is read from storage and written
 * back with a fresh `updatedAt`, so the race cannot be expressed at all.
 *
 * See docs/plans/owners-poll.md.
 */

import type { APIRoute } from 'astro';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { checkRateLimit } from '../../../utils/rate-limit';
import {
  resolveOwnersPollCaller,
  readOwnersPollWindow,
  windowState,
  affirmBallot,
} from '../../../utils/owners-poll-store';

const headers = JSON_HEADERS_NO_STORE;

const REFUSAL: Record<string, { status: number; error: string }> = {
  unauthenticated: { status: 401, error: 'Sign in to vote' },
  'no-franchise': { status: 403, error: 'Your account is not linked to a franchise' },
  'unknown-league': { status: 400, error: 'Unknown league' },
  'league-mismatch': { status: 401, error: 'Wrong league for this session' },
  'poll-disabled': { status: 404, error: 'This league does not run the Owners’ Poll' },
};

export const POST: APIRoute = async ({ request }) => {
  const resolved = resolveOwnersPollCaller(request);
  if (!resolved.ok) {
    const { status, error } = REFUSAL[resolved.reason];
    return json({ error }, status, headers);
  }
  const { scope, franchiseId } = resolved.caller;

  // Far tighter than the ballot's own limit: affirming is idempotent and a
  // human does it once. Anything beyond a few a day is a loop.
  const limit = await checkRateLimit('owners-poll-affirm', franchiseId, 10, 300);
  if (!limit.allowed) {
    return json({ error: 'Too many requests — try again shortly' }, 429, headers);
  }

  const window = await readOwnersPollWindow(scope);
  const state = windowState(window);
  if (!window || state !== 'open') {
    return json({ error: 'The ballot is not open', status: state }, 409, headers);
  }

  const bumped = await affirmBallot(scope, window, franchiseId);
  if (!bumped) {
    // No ballot on file. This is a 409 rather than a 404 because it is a state
    // problem, not a missing route — and the client's correct response is to
    // send the owner to the builder, not to retry.
    return json({ error: 'You have no ballot on file to affirm' }, 409, headers);
  }

  return json({ success: true, ballot: bumped }, 200, headers);
};
