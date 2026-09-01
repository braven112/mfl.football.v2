/**
 * useSharedQuery — React binding for a module-scope query store.
 *
 * Replaces the `useState` + `useEffect` + `fetch` triple that every island in
 * this repo currently hand-rolls (67 of them at last count), and the
 * `useSyncExternalStore` wiring that the two live-scoring hooks hand-roll on
 * top of the poller.
 *
 * "Shared" is the operative word and the reason this is not TanStack Query:
 * the cache lives in the STORE at module scope, not in a provider above a
 * React tree, so two Astro islands — each its own React root, with no shared
 * context possible — read one cache and issue one request. See query-store.ts.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { QueryState, QueryStatus, QueryStore } from '../utils/query-store';

export interface SharedQueryResult<T> {
  /** Last successful payload; null until one lands. Survives a later failure. */
  data: T | null;
  status: QueryStatus;
  /** epoch ms of the last SUCCESSFUL load; 0 when nothing has landed yet. */
  fetchedAt: number;
  error: Error | null;
  /**
   * True only while the FIRST load is in flight. A background refresh over
   * existing data is not "loading" — rendering a spinner there replaces a good
   * screen with a worse one every poll tick.
   */
  isLoading: boolean;
  /**
   * The last attempt failed. Check `data` too: `isError && data` means stale
   * but usable, which should render the data plus a staleness marker, NOT an
   * error screen.
   */
  isError: boolean;
  /** Force a reload now. Never rejects. */
  refresh: () => Promise<void>;
}

export interface UseSharedQueryOptions {
  /**
   * When false the hook subscribes to nothing and issues no request, but still
   * reports any data the store already holds. Use for a query gated on another
   * value (a franchise id that has not resolved yet, demo mode, an island the
   * page renders but a tab hides).
   */
  enabled?: boolean;
  /** Poll while mounted. Omit for a one-shot read. Floored at 1s by the store. */
  intervalMs?: number;
}

export function useSharedQuery<P, T>(
  store: QueryStore<P, T>,
  params: P,
  options: UseSharedQueryOptions = {},
): SharedQueryResult<T> {
  const { enabled = true, intervalMs } = options;

  // Subscribe on the KEY, not on `params` identity. Callers build params
  // inline (`{ week, year }`), so a params-identity dependency would tear the
  // subscription down and rebuild it on every render — one unsubscribe and
  // resubscribe per render, and with it a re-load whenever the store's gate
  // says the key needs one.
  const key = store.keyOf(params);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!enabled) return () => {};
      return store.subscribe(
        paramsRef.current,
        onChange,
        intervalMs === undefined ? undefined : { intervalMs },
      );
    },
    // `key` stands in for `params` here on purpose — see above.
    [store, key, enabled, intervalMs],
  );

  // Both the client and server snapshot getters return the store's state
  // object by identity. The store only allocates a new state object when
  // something actually changed, and hands out one frozen shared IDLE for every
  // unloaded key, so this never tears and never loops.
  const getSnapshot = useCallback(
    (): QueryState<T> => store.getState(paramsRef.current),
    [store, key],
  );

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const refresh = useCallback(() => store.refresh(paramsRef.current), [store, key]);

  return {
    data: state.data,
    status: state.status,
    fetchedAt: state.fetchedAt,
    error: state.error ?? null,
    isLoading: state.status === 'loading' && state.data === null,
    isError: state.status === 'error',
    refresh,
  };
}
