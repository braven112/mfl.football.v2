/**
 * Custom Rankings API Endpoint
 *
 * GET  /api/cr — Load custom rankings from Vercel KV
 * POST /api/cr — Save custom rankings to Vercel KV
 *
 * Auth: any authenticated owner, for their OWN franchise's key. Was
 * admin-only while the board was an unreleased experiment; opened when it
 * became the My Draft List importer/exporter that every owner uses. The key
 * is franchise-scoped, so an owner still cannot read or write another's.
 * Storage: Upstash Redis via @upstash/redis, keyed by cr:{franchiseId}.
 *
 * Phase 2 registry sweep: thin instantiation of createKvFranchiseStore —
 * see src/utils/kv-franchise-store.ts for the shared GET/POST implementation
 * this and api/ri.ts now share.
 */

import { createKvFranchiseStore } from '../../utils/kv-franchise-store';

export const { GET, POST } = createKvFranchiseStore('cr', {
  label: 'custom rankings',
});
