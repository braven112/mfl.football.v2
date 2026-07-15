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
import { unauthorized } from './api-response';

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
      return new Response(
        JSON.stringify({ data: null, error: 'Storage not configured' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    try {
      const data = await redis.get(makeKey(user.franchiseId));
      return new Response(JSON.stringify({ data: data ?? null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error(`Failed to load ${label} from KV:`, err);
      return new Response(JSON.stringify({ data: null, error: 'Read failed' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };

  const POST: APIRoute = async ({ request }) => {
    const user = authorize(request);
    if (!user) {
      return unauthorized({ error: 'Unauthorized' });
    }

    const redis = await getRedis();
    if (!redis) {
      return new Response(
        JSON.stringify({ success: false, error: 'Storage not configured' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }

    try {
      const body = await request.json();
      await redis.set(makeKey(user.franchiseId), body);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error(`Failed to save ${label} to KV:`, err);
      return new Response(
        JSON.stringify({ success: false, error: 'Write failed' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  };

  return { GET, POST };
}
