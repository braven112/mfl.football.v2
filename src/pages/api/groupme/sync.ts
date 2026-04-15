/**
 * GroupMe Sync — Poll GroupMe API and store messages in Redis
 *
 * GET /api/groupme/sync  (auth: Bearer CRON_SECRET)
 *
 * Called every 15 minutes by Vercel Cron.
 * Uses GROUPME_SERVICE_TOKEN to read the group chat.
 * Stores normalized messages in a Redis sorted set.
 */

import type { APIRoute } from 'astro';
import { fetchMessages } from '../../../utils/groupme-client';
import { normalizeGroupMeMessage } from '../../../types/groupme';
import {
  storeMessages,
  getLastMessageId,
  setLastMessageId,
  setLastSyncTs,
  getFranchiseIdFromMap,
  seedFranchiseMappings,
} from '../../../utils/groupme-storage';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  // Allow Vercel Cron (Bearer CRON_SECRET) to trigger sync
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    if (!process.env.GROUPME_SERVICE_TOKEN || !process.env.GROUPME_GROUP_ID) {
      return json({ error: 'GroupMe not configured' }, 503);
    }

    const lastId = await getLastMessageId();
    const rawMessages = await fetchMessages({ sinceId: lastId ?? undefined, limit: 100 });

    if (rawMessages.length === 0) {
      await setLastSyncTs();
      return json({ synced: 0, message: 'No new messages' });
    }

    // Sort oldest-first for processing
    const sorted = [...rawMessages].sort((a, b) => a.created_at - b.created_at);

    // Seed franchise mappings into Redis (idempotent)
    await seedFranchiseMappings();

    // Resolve franchise mappings from hardcoded map
    const normalized = sorted.map((raw) => {
      const franchiseId = getFranchiseIdFromMap(raw.user_id);
      return normalizeGroupMeMessage(raw, franchiseId);
    });

    const stored = await storeMessages(normalized);

    // Update watermark to the newest message ID
    const newest = sorted[sorted.length - 1];
    if (newest) {
      await setLastMessageId(newest.id);
    }

    await setLastSyncTs();

    return json({
      synced: stored,
      newest: newest?.id,
      oldestProcessed: sorted[0]?.id,
    });
  } catch (err) {
    console.error('[groupme/sync] Error:', err);
    return json({ error: 'Sync failed', detail: String(err) }, 500);
  }
};
