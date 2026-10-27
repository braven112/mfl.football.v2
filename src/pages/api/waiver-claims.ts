/**
 * /api/waiver-claims — read and manage the claims an owner has ALREADY filed.
 *
 * GET   → the franchise's pending claims for the current league year.
 * POST  → { action: 'delete' | 'editDrop', round, addPlayerId, dropPlayerId, … }
 *
 * WHY THESE TWO ACTIONS AND NOT REORDERING. MFL exposes no reorder control at
 * all. A round is ONE record whose `addsDrops` is an ordered list, MFL appends
 * to it, and nothing edits the order:
 *
 *   - `import?TYPE=waiverRequest` + `REPLACE=1` is documented as replacing a
 *     round's entries and is INERT for these leagues — proven live by replaying
 *     a claim's own picks and watching the timestamp not move;
 *   - MFL's own Edit page exposes the DROP and the COMMENT, nothing else.
 *
 * So reordering could only be delete-then-refile, which leaves a window where
 * the owner holds no claim. Deliberately not shipped here. Delete and edit-drop
 * each map to a SINGLE MFL primitive with no such window, which is why they are
 * safe to offer during a live waiver period.
 * See docs/claude/insights/features/waiver-claims.md (2026-09-03).
 *
 * Every write is verified by reading `pendingWaivers` back, because MFL's page
 * handlers answer with a 200 and an HTML page whether or not anything happened.
 * `success` means MFL accepted; `verified` means we saw the result.
 *
 * The logic lives in `src/utils/waiver-claim-actions.ts`, shared with the
 * phone app's `/api/mfl-live/waivers`.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS, handledFailure } from '../../utils/api-response';
import { siteOwnerContext, getFiledClaims, manageFiledClaim } from '../../utils/waiver-claim-actions';

// Every failure goes through `handledFailure`, which sends a 5xx as 200: the
// edge replaces a 5xx body, and the message is the whole point of the reply.
// Guard: tests/claim-route-handled-failure-guard.test.ts.
const fail = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  handledFailure(message, status, extra, JSON_HEADERS);

export const GET: APIRoute = async ({ request }) => {
  const resolved = siteOwnerContext(getAuthUser(request));
  if (!resolved.ok) return fail(resolved.message, resolved.status);
  return getFiledClaims(resolved.ctx);
};

export const POST: APIRoute = async ({ request }) => {
  const resolved = siteOwnerContext(getAuthUser(request));
  if (!resolved.ok) return fail(resolved.message, resolved.status);
  return manageFiledClaim(resolved.ctx, request);
};
