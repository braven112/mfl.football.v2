/**
 * Import Rankings API Endpoint
 *
 * GET  /api/ri — Load synced import rankings from Vercel KV
 * POST /api/ri — Save import rankings to Vercel KV
 *
 * Auth: Any authenticated franchise owner.
 * Storage: Upstash Redis via @upstash/redis, keyed by ri:{franchiseId}.
 *
 * Phase 2 registry sweep: thin instantiation of createKvFranchiseStore —
 * see src/utils/kv-franchise-store.ts for the shared GET/POST implementation
 * this and api/cr.ts now share.
 */

import { createKvFranchiseStore } from '../../utils/kv-franchise-store';

export const { GET, POST } = createKvFranchiseStore('ri', {
  label: 'import rankings',
});
