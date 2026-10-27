/**
 * POST /api/waiver-claim
 *
 * Submit a round of waiver claims for the authenticated user's franchise.
 * Owner-mode only — never commissioner credentials, never FRANCHISE_ID (MFL
 * treats that as commissioner impersonation).
 *
 * EVERY WRITE HERE REPLAYS MFL'S OWN `add_drop` PAGE, not `import?TYPE=…`, in
 * both the queued and the first-come windows. The import API has now failed
 * this route from both directions: `waiverRequest` answers an authenticated,
 * correctly-hosted claim with an empty 200 and stores nothing (proven twice
 * against a live owner session), and `fcfsWaiver` refuses an add/drop from a
 * roster already at the limit — scoring the ADD before the DROP — and refuses it
 * the same silent way (proven live on 2026-09-07, three pickups lost). The page
 * every owner uses works in both windows and says why when it doesn't.
 *
 * Body: {
 *   claims: [{ addPlayerId, bid, dropPlayerId? }],   // in priority order
 *   round: number,                                   // required (league is conditional)
 *   year?: number,                                   // page's league year, checked
 * }
 *
 * WHY THE VALIDATION IS HERE AND NOT ONLY IN THE UI: MFL rejects a bad bid with
 * a terse message after the owner has left the page, and a claim silently
 * dropped is indistinguishable from one that lost. Everything checkable is
 * checked before the write, and the write is verified by reading the round back
 * from `export?TYPE=pendingWaivers` — MFL returns HTTP 200 on failures, so the
 * response body is not evidence (see docs/claude/insights/domains/mfl-api.md).
 *
 * Security:
 * - The add must be a genuine free agent, the drop must be on the CALLER'S own
 *   roster; both verified against MFL, not against anything the client sent.
 * - Bid rules come from the live league payload, not constants.
 * - Rate-limited: this is an authenticated write that fans out to MFL.
 *
 * The logic lives in `src/utils/waiver-claim-actions.ts`, shared with the
 * phone app's `/api/mfl-live/waivers`; this route only resolves the site
 * session into an owner + league.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS, handledFailure } from '../../utils/api-response';
import { siteOwnerContext, submitWaiverClaims } from '../../utils/waiver-claim-actions';

// Every failure goes through `handledFailure`, which sends a 5xx as 200: the
// edge replaces a 5xx body, and the message is the whole point of the reply.
// Guard: tests/claim-route-handled-failure-guard.test.ts.
const fail = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  handledFailure(message, status, extra, JSON_HEADERS);

export const POST: APIRoute = async ({ request }) => {
  const resolved = siteOwnerContext(getAuthUser(request));
  if (!resolved.ok) return fail(resolved.message, resolved.status);
  return submitWaiverClaims(resolved.ctx, request);
};
