/**
 * Shared polling store for live islands.
 *
 * This is now a thin adapter over `createQueryStore` (query-store.ts), which
 * is the generalized version of what this module used to implement on its own.
 * The semantics here are unchanged — the poller's tests
 * (tests/live-poll-store.test.ts) are what pin that, and they were written
 * against this behavior before the extraction.
 *
 * The reason to keep this name rather than rewrite its two callers: `subscribe`
 * here REQUIRES an interval, which is exactly right for a live feed and wrong
 * as a default for everything else. The general store makes the interval
 * optional; a live caller should still be reading a type that demands one.
 *
 * See query-store.ts for why the cache lives at module scope (Astro hydrates
 * every island into its own React root, so React state cannot be shared
 * between them, but a module can).
 */

import { createQueryStore, type QueryState, type QueryStatus } from './query-store';

export type PollStatus = QueryStatus;
export type PollState<T> = QueryState<T>;

export interface SharedPoller<P, T> {
  /** Read the current state for a key without subscribing. */
  getState(params: P): PollState<T>;
  /**
   * Subscribe. Returns an unsubscribe function. The first subscriber for a key
   * triggers an immediate load and starts the timer; the last one stops it.
   */
  subscribe(params: P, intervalMs: number, onChange: () => void): () => void;
  /** Force a load now (ignores the timer, still shares an in-flight request). */
  refresh(params: P): Promise<void>;
}

export function createSharedPoller<P, T>(
  keyOf: (params: P) => string,
  load: (params: P) => Promise<T>,
): SharedPoller<P, T> {
  const store = createQueryStore<P, T>(keyOf, load);
  return {
    getState: (params) => store.getState(params),
    subscribe: (params, intervalMs, onChange) =>
      store.subscribe(params, onChange, { intervalMs }),
    refresh: (params) => store.refresh(params),
  };
}
