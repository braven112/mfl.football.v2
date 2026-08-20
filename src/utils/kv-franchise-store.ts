/**
 * Franchise-scoped KV store factory.
 *
 * Phase 2 registry sweep: api/cr.ts (Custom Rankings) and api/ri.ts (Import
 * Rankings) were 85% identical — same GET/POST shape, same Redis-backed
 * per-franchise key, same error-handling structure. The only real
 * differences were the key prefix and whether writes are admin-gated. Both
 * routes are now thin instantiations of this factory; each keeps its exact
 * prior auth semantics (cr: commissioner/admin only, ri: any authenticated
 * owner) via the `requireAdmin` option.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from './auth';
import { getRedis } from './redis-client';
import { json, unauthorized } from './api-response';
import { rankingsScopeForLeagueId, scopedKvKey } from './rankings-scope';

export interface CreateKvFranchiseStoreOptions {
  /**
   * When true, both GET and POST require `isCommissionerOrAdmin(user)` (cr.ts's
   * behavior). When false (default), any authenticated user may read/write
   * their own franchise's key (ri.ts's behavior).
   */
  requireAdmin?: boolean;
  /** Human-readable label for console error logs, e.g. 'custom rankings'. */
  label?: string;
}

/**
 * Build a { GET, POST } Astro route pair backed by a Redis key namespaced
 * `${prefix}:${franchiseId}`. GET returns `{ data }`; POST accepts a JSON
 * body and stores it verbatim, returning `{ success: true }`.
 */
export function createKvFranchiseStore(
  prefix: string,
  options: CreateKvFranchiseStoreOptions = {},
): { GET: APIRoute; POST: APIRoute } {
  const { requireAdmin = false, label = prefix } = options;

  /**
   * Resolve the Redis key for this request, or null if the caller may not
   * touch it.
   *
   * The key carries a LEAGUE SCOPE (see rankings-scope.ts) because franchise
   * ids collide across leagues — AFL 0001 and TheLeague 0001 are different
   * teams, so the old bare `${prefix}:0001` was ambiguous the moment a second
   * league started writing. TheLeague's scope still produces that exact
   * legacy string, so existing owners keep their data.
   *
   * The scope comes from the SESSION's league, never from the request. The
   * optional `?league=` param is a check, not an input: the client sends the
   * league whose page it is on, and a mismatch is rejected. Without that, an
   * owner logged into TheLeague who opens the AFL rankings page — where
   * localStorage is reading and writing the AFL bucket — would sync that AFL
   * board into their TheLeague KV key. Callers that omit the param keep the
   * prior behavior of using their own session's scope.
   */
  const resolveKey = (request: Request): string | null => {
    const user = getAuthUser(request);
    if (!user) return null;
    // A session without a franchise would read/write the shared bare key
    // `${prefix}:` — reject it so malformed sessions can't pool data.
    if (!user.franchiseId) return null;
    if (requireAdmin && !isCommissionerOrAdmin(user)) return null;

    const scope = rankingsScopeForLeagueId(user.leagueId);
    const requested = new URL(request.url).searchParams.get('league');
    if (requested && requested !== scope) return null;

    return scopedKvKey(prefix, scope, user.franchiseId);
  };

  const GET: APIRoute = async ({ request }) => {
    const key = resolveKey(request);
    if (!key) {
      return unauthorized({ error: 'Unauthorized' });
    }

    const redis = await getRedis();
    if (!redis) {
      return json({ data: null, error: 'Storage not configured' });
    }

    try {
      const data = await redis.get(key);
      return json({ data: data ?? null });
    } catch (err) {
      console.error(`Failed to load ${label} from KV:`, err);
      return json({ data: null, error: 'Read failed' });
    }
  };

  const POST: APIRoute = async ({ request }) => {
    const key = resolveKey(request);
    if (!key) {
      return unauthorized({ error: 'Unauthorized' });
    }

    const redis = await getRedis();
    if (!redis) {
      return json({ success: false, error: 'Storage not configured' }, 503);
    }

    try {
      const body = await request.json();
      await redis.set(key, body);
      return json({ success: true });
    } catch (err) {
      console.error(`Failed to save ${label} to KV:`, err);
      return json({ success: false, error: 'Write failed' }, 500);
    }
  };

  return { GET, POST };
}
