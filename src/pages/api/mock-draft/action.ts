/**
 * POST /api/mock-draft/action
 *
 * Body: `{ sessionId, type, ...fields }` — the same messages the PartyKit
 * socket took (join, pick, pause, resume, skip, reset, undo, set-timer,
 * set-auto-draft, start, toggle-auto). Returns `{ session, serverNow }` so the
 * caller's board moves without waiting for its next poll.
 *
 * The acting franchise is the SIGNED-IN owner's, never a body field: PartyKit
 * took `franchiseId` from the message, so anyone could pause, reset or pick
 * for any team. And it must be an owner of the draft's own league, because
 * every league has a franchise 0001.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../../utils/api-response';
import { MOCK_DRAFT_ACTIONS, type MockDraftAction } from '../../../utils/mock-draft-engine';
import { actOnMockDraft, MockDraftStoreError, readMockDraft } from '../../../utils/mock-draft-store';
import { isValidMockDraftId } from '../../../utils/mock-draft-session';

export const prerender = false;

const reply = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return reply({ error: 'Sign in to draft.' }, 401);

  const body = (await request.json().catch(() => null)) as (Record<string, unknown> & { sessionId?: unknown }) | null;
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
  const type = body?.type as MockDraftAction['type'] | undefined;
  if (!isValidMockDraftId(sessionId) || !type || !MOCK_DRAFT_ACTIONS.has(type)) {
    return reply({ error: 'Unknown draft action.' }, 400);
  }

  try {
    const existing = await readMockDraft(sessionId);
    if (!existing) return reply({ error: 'Session not found' }, 404);
    if (existing.leagueId !== user.leagueId) {
      return reply({ error: 'You are not in this draft’s league.' }, 403);
    }

    const { sessionId: _id, ...action } = body!;
    const result = await actOnMockDraft(sessionId, user.franchiseId, action as unknown as MockDraftAction);
    if (!result.ok) return reply({ error: result.error }, result.status);
    return reply({ session: result.session, serverNow: Date.now() }, 200);
  } catch (err) {
    const status = err instanceof MockDraftStoreError ? err.status : 500;
    console.error('[mock-draft/action] Failed:', (err as Error).message);
    return reply({ error: 'The draft could not be updated.' }, status);
  }
};
