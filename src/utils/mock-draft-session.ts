/**
 * Reading a mock draft's session back out of the store, for a page.
 *
 * This lives in a util, and the ROUTES call it, for one specific reason:
 * `Astro.redirect()` only redirects from a PAGE. Returned from a component's
 * frontmatter it merely stops rendering that component, and the response is
 * still a 200 with a blank body — which is exactly what shipped when the /cr
 * page's auth gate was extracted into a shared component (see CLAUDE.md).
 *
 * The results page has the same shape: it must bounce to the lobby when the
 * session is missing or unreachable. So the DECISION is shared here and each
 * thin route owns its own redirect, the same split `resolveCustomRankingsAccess`
 * uses.
 */

import { readMockDraft } from './mock-draft-store';

/** A mock session as the store keeps it. Deliberately loose — the page reads it defensively. */
export type MockSession = Record<string, any>;

/** Session ids are ours (`create` makes them base-36; official ones are `{navSlug}-official-{year}`). */
export function isValidMockDraftId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/i.test(id);
}

/**
 * Fetch one mock session, or null.
 *
 * Null covers every reason a results page cannot render — no store
 * configured, the session expired, a network failure — because the caller's
 * response to all of them is the same bounce. It never throws.
 */
export async function fetchMockSession(sessionId: string): Promise<MockSession | null> {
  if (!isValidMockDraftId(sessionId)) return null;
  try {
    return await readMockDraft(sessionId);
  } catch (err) {
    console.error('[mock-draft] Failed to read session:', (err as Error).message);
    return null;
  }
}
