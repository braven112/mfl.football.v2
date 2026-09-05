/**
 * The Owners' Poll — read and cast the caller's own ballot.
 *
 *   GET  /api/owners-poll/ballot   → the caller's ballot + window state
 *   POST /api/owners-poll/ballot   → upsert the caller's ballot
 *
 * A caller can only ever read or write THEIR OWN ballot: the franchise comes
 * from the signed session, never from the request body or query. Nothing here
 * returns another owner's ballot or the running tally — during the open window
 * that data is deliberately unavailable to everyone, because releasing running
 * totals would let late voters game the result. Ballots become public only
 * after the close pass writes them into the week's committed issue JSON.
 *
 * See docs/plans/owners-poll.md.
 */

import type { APIRoute } from 'astro';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { checkRateLimit } from '../../../utils/rate-limit';
import {
  buildBallotRecord,
  validateBallot,
} from '../../../utils/owners-poll-ballot.mjs';
import {
  countBallots,
  readBallot,
  readOwnersPollWindow,
  readPreviousBallot,
  resolveOwnersPollCaller,
  windowState,
  writeBallot,
  type OwnersPollRefusal,
} from '../../../utils/owners-poll-store';

/** Refusals map to a status + message here, so the routes stay uniform. */
const REFUSAL: Record<OwnersPollRefusal, { status: number; error: string }> = {
  unauthenticated: { status: 401, error: 'Sign in to cast a ballot' },
  'no-franchise': { status: 401, error: 'Your session is not linked to a franchise' },
  'unknown-league': { status: 401, error: 'Your session is not linked to a league' },
  'league-mismatch': { status: 403, error: 'That ballot belongs to a different league' },
  'poll-disabled': { status: 404, error: 'This league does not run the Owners’ Poll' },
};

/**
 * No-store on every response. A ballot is per-owner and the window state
 * changes on a deadline — a cached copy would show one owner another's state,
 * or keep the ballot "open" past close.
 */
const headers = JSON_HEADERS_NO_STORE;

export const GET: APIRoute = async ({ request }) => {
  const resolved = resolveOwnersPollCaller(request);
  if (!resolved.ok) {
    const { status, error } = REFUSAL[resolved.reason];
    return json({ error }, status, headers);
  }
  const { scope, franchiseId } = resolved.caller;

  const window = await readOwnersPollWindow(scope);
  const state = windowState(window);
  if (!window || state !== 'open') {
    return json({ status: state, window: null, ballot: null }, 200, headers);
  }

  const [ballot, previous, ballotsIn] = await Promise.all([
    readBallot(scope, window, franchiseId),
    readPreviousBallot(scope, window, franchiseId),
    countBallots(scope, window),
  ]);

  return json(
    {
      status: 'open',
      window: publicWindow(window),
      ballot,
      // Only offered when they haven't voted THIS week — once a ballot exists
      // it is the thing to edit, and shipping both would let a stale prefill
      // overwrite a submitted ballot.
      prefill: ballot ? null : (previous?.ranking ?? null),
      turnout: { ballotsIn, eligible: window.eligibleFranchiseIds.length },
    },
    200,
    headers,
  );
};

export const POST: APIRoute = async ({ request }) => {
  const resolved = resolveOwnersPollCaller(request);
  if (!resolved.ok) {
    const { status, error } = REFUSAL[resolved.reason];
    return json({ error }, status, headers);
  }
  const { scope, franchiseId } = resolved.caller;

  // Generous enough that normal editing never trips it, tight enough that a
  // loop can't hammer Redis. Keyed on the franchise from the session.
  const limit = await checkRateLimit('owners-poll-ballot', franchiseId, 30, 300);
  if (!limit.allowed) {
    return json({ error: 'Too many ballot submissions — try again shortly' }, 429, headers);
  }

  const window = await readOwnersPollWindow(scope);
  const state = windowState(window);
  if (!window || state !== 'open') {
    // 'closed' covers both "already closed" and "never opened"; the client
    // shows the window state it last read rather than guessing from a 409.
    return json({ error: 'The ballot is not open', status: state }, 409, headers);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400, headers);
  }

  const ranking = (body as { ranking?: unknown })?.ranking;
  const result = validateBallot({
    ranking,
    slots: window.slots,
    eligibleFranchiseIds: window.eligibleFranchiseIds,
  });
  if (!result.ok) {
    return json({ error: result.error }, 400, headers);
  }

  // Preserve the original submittedAt across an edit so a re-submission is
  // never mistaken for a first ballot on the accountability page.
  const previous = await readBallot(scope, window, franchiseId);
  const record = buildBallotRecord({
    franchiseId,
    ranking: result.ranking,
    now: new Date(),
    previous,
  });

  const saved = await writeBallot(scope, window, record);
  if (!saved) {
    return json({ error: 'Could not save your ballot — storage unavailable' }, 503, headers);
  }

  const ballotsIn = await countBallots(scope, window);
  return json(
    {
      success: true,
      ballot: record,
      turnout: { ballotsIn, eligible: window.eligibleFranchiseIds.length },
    },
    200,
    headers,
  );
};

/**
 * The window fields safe to hand a client.
 *
 * `eligibleFranchiseIds` is dropped — the client already knows the league's
 * teams from the page, and echoing the tally's own eligibility list invites a
 * client to treat it as authoritative and drift from the server.
 */
function publicWindow(window: {
  year: number;
  week: number;
  opensAt: string;
  closesAt: string;
  slots: number;
}) {
  const { year, week, opensAt, closesAt, slots } = window;
  return { year, week, opensAt, closesAt, slots };
}
