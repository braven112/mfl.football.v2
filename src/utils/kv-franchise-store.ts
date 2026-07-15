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

  const makeKey = (franchiseId: string): string => `${prefix}:${franchiseId}`;

  const authorize = (request: Request) => {
    const user = getAuthUser(request);
    if (!user) return null;
    // A session without a franchise would read/write the shared bare key
    // `${prefix}:` — reject it so malformed sessions can't pool data.
    if (!user.franchiseId) return null;
    if (requireAdmin && !isCommissionerOrAdmin(user)) return null;
    return user;
  };

  const GET: APIRoute = async ({ request }) => {
    const user = authorize(request);
    if (!user) {
      return unauthorized({ error: 'Unauthorized' });
    }

    const redis = await getRedis();
    if (!redis) {
      return json({ data: null, error: 'Storage not configured' });
    }

    try {
      const data = await redis.get(makeKey(user.franchiseId));
      return json({ data: data ?? null });
    } catch (err) {
      console.error(`Failed to load ${label} from KV:`, err);
      return json({ data: null, error: 'Read failed' });
    }
  };

  const POST: APIRoute = async ({ request }) => {
    const user = authorize(request);
    if (!user) {
      return unauthorized({ error: 'Unauthorized' });
    }

    const redis = await getRedis();
    if (!redis) {
      return json({ success: false, error: 'Storage not configured' }, 503);
    }

    try {
      const body = await request.json();
      await redis.set(makeKey(user.franchiseId), body);
      return json({ success: true });
    } catch (err) {
      console.error(`Failed to save ${label} to KV:`, err);
      return json({ success: false, error: 'Write failed' }, 500);
    }
  };

  return { GET, POST };
}
