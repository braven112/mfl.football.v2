/**
 * Custom Rankings API Endpoint
 *
 * GET  /api/cr — Load custom rankings from Vercel KV
 * POST /api/cr — Save custom rankings to Vercel KV
 *
 * Auth: Admin franchise only (franchise 0001).
 * Storage: Upstash Redis via @upstash/redis, keyed by cr:{franchiseId}.
 *
 * Phase 2 registry sweep: thin instantiation of createKvFranchiseStore —
 * see src/utils/kv-franchise-store.ts for the shared GET/POST implementation
 * this and api/ri.ts now share.
 */

import { createKvFranchiseStore } from '../../utils/kv-franchise-store';

export const { GET, POST } = createKvFranchiseStore('cr', {
  requireAdmin: true,
  label: 'custom rankings',
});
