/**
 * POST /api/mock-draft/delete
 *
 * Removes a mock draft session from the league registry so it disappears
 * from the lobby list. Authorization: the session creator can always
 * delete; commissioners / admins can delete anyone's session.
 *
 * We intentionally don't wipe the underlying session room — PartyKit
 * garbage-collects rooms with no traffic, and leaving stale storage for
 * anyone who happens to have a direct link open is harmless.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../utils/auth';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../../utils/api-response';
import { DEFAULT_LEAGUE_ID, getLeagueById } from '../../../config/leagues';
import { conferenceUnit, mockRegistryRoom, parseConference } from '../../../utils/mock-draft-scope';

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(
      JSON.stringify({ success: false, message: 'Authentication required.' }),
      { status: 401, headers: JSON_HEADERS },
    );
  }

  const body = await request.json().catch(() => null) as
    | { sessionId?: string; conference?: string }
    | null;
  const sessionId = body?.sessionId;
  if (!sessionId || typeof sessionId !== 'string') {
    return new Response(
      JSON.stringify({ success: false, message: 'sessionId is required.' }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  const leagueId = user.leagueId || DEFAULT_LEAGUE_ID;
  // Same registry the lobby listed from, or the lookup below finds nothing and
  // reports a phantom success while the session stays on screen.
  const isAfl = getLeagueById(leagueId)?.slug === 'afl-fantasy';
  const conference = isAfl ? parseConference(body?.conference) : null;
  if (isAfl && !conference) {
    // Fail loudly rather than falling back to the unscoped registry. That
    // registry is empty for the AFL, so the lookup below would find nothing,
    // take the idempotent "already deleted" path, and answer success — while
    // the session sat untouched in its conference's registry and came back on
    // the next reload. A silent no-op reported as success is worse than a 400.
    return new Response(
      JSON.stringify({ success: false, message: 'A conference is required to delete an AFL mock draft.' }),
      { status: 400, headers: JSON_HEADERS },
    );
  }
  const rawPartyHost = import.meta.env.PUBLIC_PARTYKIT_HOST;
  if (!rawPartyHost) {
    return new Response(
      JSON.stringify({ success: false, message: 'PartyKit not configured.' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
  const partyHost = rawPartyHost.startsWith('http') ? rawPartyHost : `https://${rawPartyHost}`;
  const registryUrl = `${partyHost}/party/${mockRegistryRoom(
    leagueId,
    conference ? conferenceUnit(conference) : null,
  )}`;

  // Fetch the registry so we can verify ownership before unregistering.
  let createdBy: string | null = null;
  try {
    const listRes = await fetch(registryUrl, { method: 'GET' });
    if (listRes.ok) {
      const data = (await listRes.json()) as { sessions?: Array<{ id: string; createdBy: string }> };
      const entry = data.sessions?.find((s) => s.id === sessionId);
      createdBy = entry?.createdBy ?? null;
    }
  } catch (err) {
    console.warn('[mock-draft/delete] Registry fetch failed:', (err as Error).message);
  }

  if (!createdBy) {
    // Session isn't in the registry. Either it was already deleted or
    // never registered. Treat idempotent: report success.
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: JSON_HEADERS });
  }

  const isOwner = createdBy === user.franchiseId;
  const isAdmin = isCommissionerOrAdmin(user);
  if (!isOwner && !isAdmin) {
    return new Response(
      JSON.stringify({ success: false, message: 'You can only delete your own mock drafts.' }),
      { status: 403, headers: JSON_HEADERS },
    );
  }

  try {
    const unregRes = await fetch(registryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unregister', sessionId }),
    });
    if (!unregRes.ok) {
      return new Response(
        JSON.stringify({ success: false, message: 'Failed to unregister session.' }),
        { status: 502, headers: JSON_HEADERS },
      );
    }
  } catch (err) {
    console.error('[mock-draft/delete] Unregister failed:', err);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: JSON_HEADERS });
};
