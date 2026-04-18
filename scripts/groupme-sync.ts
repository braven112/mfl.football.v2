/**
 * GroupMe Sync — poll GroupMe and store new messages in Upstash Redis.
 *
 * Replaces the `POST /api/groupme/sync` endpoint for scheduled runs so the
 * GitHub Action doesn't have to traverse Cloudflare (which now challenges
 * unattended curl POSTs to www.theleague.us).
 *
 * Usage: tsx scripts/groupme-sync.ts
 *
 * Env required:
 *   GROUPME_SERVICE_TOKEN, GROUPME_GROUP_ID
 *   UPSTASH_REDIS_REST_URL (or KV_REST_API_URL), UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_TOKEN)
 */

import { fetchMessages } from '../src/utils/groupme-client.js';
import { normalizeGroupMeMessage } from '../src/types/groupme.js';
import {
  storeMessages,
  getLastMessageId,
  setLastMessageId,
  setLastSyncTs,
  getFranchiseIdFromMap,
  seedFranchiseMappings,
} from '../src/utils/groupme-storage.js';

async function main() {
  if (!process.env.GROUPME_SERVICE_TOKEN || !process.env.GROUPME_GROUP_ID) {
    console.error('[groupme-sync] GROUPME_SERVICE_TOKEN or GROUPME_GROUP_ID not configured');
    process.exit(1);
  }

  const redisSource = process.env.UPSTASH_REDIS_REST_URL
    ? 'UPSTASH'
    : process.env.KV_REST_API_URL
    ? 'KV'
    : 'none';

  if (redisSource === 'none') {
    console.error('[groupme-sync] No Redis credentials configured (UPSTASH_REDIS_REST_URL or KV_REST_API_URL)');
    process.exit(1);
  }

  const lastId = await getLastMessageId();
  const rawMessages = await fetchMessages({ sinceId: lastId ?? undefined, limit: 100 });

  if (rawMessages.length === 0) {
    await setLastSyncTs();
    console.log(JSON.stringify({ synced: 0, message: 'No new messages', redisSource }));
    return;
  }

  const sorted = [...rawMessages].sort((a, b) => a.created_at - b.created_at);

  await seedFranchiseMappings();

  const normalized = sorted.map((raw) => {
    const franchiseId = getFranchiseIdFromMap(raw.user_id);
    return normalizeGroupMeMessage(raw, franchiseId);
  });

  const stored = await storeMessages(normalized);

  const newest = sorted[sorted.length - 1];
  if (newest) {
    await setLastMessageId(newest.id);
  }
  await setLastSyncTs();

  console.log(
    JSON.stringify({
      synced: stored,
      newest: newest?.id,
      oldestProcessed: sorted[0]?.id,
      redisSource,
    }),
  );
}

main().catch((err) => {
  console.error('[groupme-sync] Error:', err);
  process.exit(1);
});
