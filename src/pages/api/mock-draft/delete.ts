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

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(
      JSON.stringify({ success: false, message: 'Authentication required.' }),
      { status: 401, headers: JSON_HEADERS },
    );
  }

  const body = await request.json().catch(() => null) as { sessionId?: string } | null;
  const sessionId = body?.sessionId;
  if (!sessionId || typeof sessionId !== 'string') {
    return new Response(
      JSON.stringify({ success: false, message: 'sessionId is required.' }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  const leagueId = user.leagueId || '13522';
  const rawPartyHost = import.meta.env.PUBLIC_PARTYKIT_HOST;
  if (!rawPartyHost) {
    return new Response(
      JSON.stringify({ success: false, message: 'PartyKit not configured.' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
  const partyHost = rawPartyHost.startsWith('http') ? rawPartyHost : `https://${rawPartyHost}`;
  const registryUrl = `${partyHost}/party/${leagueId}-registry`;

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
