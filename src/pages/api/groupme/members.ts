/**
 * GroupMe Members — Admin endpoint for viewing and mapping members
 *
 * GET  /api/groupme/members       — List all GroupMe members + current mappings
 * POST /api/groupme/members       — Bulk map GroupMe user IDs to franchise IDs
 *   Body: { mappings: { groupMeUserId: string, franchiseId: string }[] }
 *
 * Admin-only.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../utils/auth';
import { fetchGroupMembers } from '../../../utils/groupme-client';
import { getAllLinkedUserIds, linkFranchise, loadTeamConfig } from '../../../utils/groupme-storage';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user || !isCommissionerOrAdmin(user)) {
    return json({ error: 'Admin access required' }, 403);
  }

  try {
    const [members, linkedMap, teamConfig] = await Promise.all([
      fetchGroupMembers(),
      getAllLinkedUserIds(),
      loadTeamConfig(),
    ]);

    const memberList = members.map(m => {
      const franchiseId = linkedMap[m.user_id] ?? null;
      const team = franchiseId ? teamConfig.find(t => t.franchiseId === franchiseId) : null;
      return {
        userId: m.user_id,
        nickname: m.nickname,
        avatarUrl: m.image_url,
        franchiseId,
        teamName: team?.name ?? null,
      };
    });

    return json({ members: memberList });
  } catch (err) {
    console.error('[groupme/members] Error:', err);
    return json({ error: 'Failed to fetch members' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user || !isCommissionerOrAdmin(user)) {
    return json({ error: 'Admin access required' }, 403);
  }

  let body: { mappings: { groupMeUserId: string; franchiseId: string }[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  if (!Array.isArray(body.mappings) || body.mappings.length === 0) {
    return json({ error: 'mappings array is required' }, 400);
  }

  const results: { groupMeUserId: string; franchiseId: string; success: boolean }[] = [];

  for (const { groupMeUserId, franchiseId } of body.mappings) {
    if (!groupMeUserId || !franchiseId) {
      results.push({ groupMeUserId, franchiseId, success: false });
      continue;
    }
    const success = await linkFranchise(franchiseId, groupMeUserId);
    results.push({ groupMeUserId, franchiseId, success });
  }

  return json({
    mapped: results.filter(r => r.success).length,
    total: results.length,
    results,
  });
};
