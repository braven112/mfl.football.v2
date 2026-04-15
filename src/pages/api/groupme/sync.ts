/**
 * GroupMe Sync — Poll GroupMe API and store messages in Redis
 *
 * POST /api/groupme/sync
 *
 * Called by a scheduled task or manually by an admin.
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
  debugRedisStatus,
} from '../../../utils/groupme-storage';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async () => {
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

    let stored = 0;
    let storeError: string | undefined;
    try {
      stored = await storeMessages(normalized);
    } catch (err) {
      storeError = String(err);
      console.error('[groupme/sync] storeMessages error:', err);
    }

    // Update watermark to the newest message ID
    const newest = sorted[sorted.length - 1];
    let watermarkError: string | undefined;
    try {
      if (newest) {
        await setLastMessageId(newest.id);
      }
      await setLastSyncTs();
    } catch (err) {
      watermarkError = String(err);
      console.error('[groupme/sync] watermark/ts error:', err);
    }

    const redisStatus = await debugRedisStatus();

    return json({
      synced: stored,
      fetched: normalized.length,
      newest: newest?.id,
      oldestProcessed: sorted[0]?.id,
      redis: redisStatus,
      ...(storeError && { storeError }),
      ...(watermarkError && { watermarkError }),
    });
  } catch (err) {
    console.error('[groupme/sync] Error:', err);
    return json({ error: 'Sync failed', detail: String(err) }, 500);
  }
};
