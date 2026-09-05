/**
 * Reading a finished mock draft's session back out of PartyKit.
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

/** A mock session as the party stores it. Deliberately loose — the page reads it defensively. */
export type MockSession = Record<string, any>;

/** Ensure a protocol: the env var may be a bare hostname. */
export function normalizePartyHost(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

/**
 * Fetch one mock session, or null.
 *
 * Null covers every reason a results page cannot render — no PartyKit host
 * configured, the room garbage-collected, a network failure — because the
 * caller's response to all of them is the same bounce. It never throws.
 */
export async function fetchMockSession(
  rawPartyHost: string | undefined | null,
  sessionId: string
): Promise<MockSession | null> {
  const partyHost = normalizePartyHost(rawPartyHost);
  if (!partyHost || !sessionId) return null;

  try {
    const res = await fetch(`${partyHost}/party/mock-${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data as { session?: MockSession }).session ?? null;
  } catch (err) {
    console.error('[mock-draft/results] Failed to fetch session:', (err as Error).message);
    return null;
  }
}
