/**
 * GroupMe Sync — Poll GroupMe API and store messages in Redis
 *
 * POST /api/groupme/sync
 *
 * Called by a scheduled task or manually by an admin. Both are authenticated
 * — see isAuthorizedSyncCaller. Scheduled runs normally go through
 * scripts/groupme-sync.ts rather than this route.
 *
 * Uses GROUPME_SERVICE_TOKEN to read the group chat.
 * Stores normalized messages in a Redis sorted set.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin, isAuthorizedForLeague } from '../../../utils/auth';
import { getLeagueBySlug } from '../../../config/leagues';
import { fetchMessages, checkServiceTokenHealth } from '../../../utils/groupme-client';
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

/**
 * Who may trigger a sync.
 *
 * Previously nobody was checked — the handler was `async ()` and did not even
 * receive the request — so any anonymous caller could make us poll the
 * GroupMe API, write to Redis, and (on the error path below) read back the
 * Upstash/KV URL prefixes this route reports for debugging.
 *
 * Two callers are legitimate, matching this route's docstring:
 *   - a scheduled run holding CRON_SECRET, the same bearer contract as
 *     /api/cron/push-fanout;
 *   - a commissioner triggering it by hand while signed in.
 *
 * The session is checked FIRST so that an environment with no CRON_SECRET set
 * still lets a commissioner run it. An unset secret then authorizes nobody:
 * accepting `Bearer undefined` from a stranger is precisely the hole this is
 * closing, so the empty case returns false rather than falling through.
 */
/** The league whose GroupMe group GROUPME_GROUP_ID refers to. */
const GROUPME_LEAGUE_ID = getLeagueBySlug('theleague')!.id;

export function isAuthorizedSyncCaller(request: Request): boolean {
  const user = getAuthUser(request);
  // League-scoped, not merely commissioner: GROUPME_GROUP_ID names ONE group,
  // TheLeague's, so another league's commissioner has no business driving this
  // sync — or reading the Upstash/KV prefixes the error path reports. Same
  // rule as CLAUDE.md's cross-league admin note.
  if (user && isCommissionerOrAdmin(user) && isAuthorizedForLeague(user, GROUPME_LEAGUE_ID)) {
    return true;
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorizedSyncCaller(request)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    if (!process.env.GROUPME_GROUP_ID) {
      return json({ error: 'GroupMe not configured' }, 503);
    }

    // Presence is not health — a revoked token is still a truthy string, and
    // the old `!!process.env.GROUPME_SERVICE_TOKEN` guard let every sync sail
    // past it into a 401. `unreachable` is not evidence the token is bad, so
    // we still attempt the sync and let fetchMessages report the real failure.
    const tokenHealth = await checkServiceTokenHealth();
    if (tokenHealth.state === 'not-set') {
      return json({ error: 'GroupMe not configured' }, 503);
    }
    if (tokenHealth.state === 'rejected') {
      return json({
        error: 'GroupMe token rejected',
        detail: tokenHealth.detail,
        // Name the var that supplied the dead token, not a hardcoded guess.
        hint: `Regenerate the token at https://dev.groupme.com/ and update ${tokenHealth.source ?? 'GROUPME_SERVICE_TOKEN'}.`,
      }, 503);
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
      redisSource: process.env.UPSTASH_REDIS_REST_URL ? 'UPSTASH' : process.env.KV_REST_API_URL ? 'KV' : 'none',
    });
  } catch (err) {
    console.error('[groupme/sync] Error:', err);
    return json({
      error: 'Sync failed',
      detail: String(err),
      redisSource: process.env.UPSTASH_REDIS_REST_URL ? 'UPSTASH' : process.env.KV_REST_API_URL ? 'KV' : 'none',
      upstashUrlPrefix: process.env.UPSTASH_REDIS_REST_URL?.substring(0, 40) ?? 'NOT SET',
      kvUrlPrefix: process.env.KV_REST_API_URL?.substring(0, 40) ?? 'NOT SET',
    }, 500);
  }
};
