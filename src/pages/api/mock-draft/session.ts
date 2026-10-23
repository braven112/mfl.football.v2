/**
 * GET /api/mock-draft/session?id=<sessionId>
 *
 * One mock (or best-ball official) draft, as of now. The draft room polls this
 * about once a second in place of PartyKit's socket: each read first catches
 * up anything overdue — an expired pick clock auto-picks, then the AI teams
 * pick in turn — so the board moves even though no server process is running
 * between requests (see `mock-draft-engine.ts`).
 *
 * Unauthenticated, as PartyKit's room GET was: a mock board is not private,
 * and the results page and the best-ball board read it for any viewer.
 * `serverNow` lets the client run its countdown against the server's clock
 * rather than trusting the phone's.
 */

import type { APIRoute } from 'astro';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../../utils/api-response';
import { MockDraftStoreError, readMockDraft } from '../../../utils/mock-draft-store';
import { isValidMockDraftId } from '../../../utils/mock-draft-session';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get('id') ?? '';
  if (!isValidMockDraftId(id)) {
    return new Response(JSON.stringify({ error: 'A session id is required.' }), { status: 400, headers: JSON_HEADERS });
  }
  try {
    const session = await readMockDraft(id);
    if (!session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404, headers: JSON_HEADERS });
    }
    return new Response(JSON.stringify({ session, serverNow: Date.now() }), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    const status = err instanceof MockDraftStoreError ? err.status : 500;
    console.error('[mock-draft/session] Read failed:', (err as Error).message);
    return new Response(JSON.stringify({ error: 'Could not load the draft.' }), { status, headers: JSON_HEADERS });
  }
};
