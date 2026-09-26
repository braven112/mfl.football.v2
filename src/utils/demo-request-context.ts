/**
 * Who a request belongs to, on the custom-site demo (docs/plans/custom-site-demo.md).
 *
 * Set by src/middleware.ts for every demo request from the signed-in session,
 * read by the MFL stand-in (so a public roster read still shows THIS prospect's
 * moves) and by the Redis key namespace (so no two prospects share a key).
 * AsyncLocalStorage because both are reached from deep inside ordinary site
 * code — a roster cache, a writer util — that has no way to be handed it.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface DemoRequestContext {
  /** The prospect's link token, or null for a visitor who has not signed in. */
  token: string | null;
  /** The franchise the prospect chose, or null. */
  franchiseId: string | null;
}

export const demoRequestContext = new AsyncLocalStorage<DemoRequestContext>();

export function currentDemoContext(): DemoRequestContext {
  return demoRequestContext.getStore() ?? { token: null, franchiseId: null };
}

/** The Redis namespace for the current prospect: `demo:<token>:` or `demo:anon:`. */
export function demoKeyPrefix(ctx: DemoRequestContext = currentDemoContext()): string {
  return ctx.token ? `demo:${ctx.token}:` : 'demo:anon:';
}
