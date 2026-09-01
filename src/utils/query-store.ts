/**
 * Shared query store — the app's client data layer.
 *
 * This is the generalization of the live-scoring poller (live-poll-store.ts),
 * which is now a thin adapter over it. That poller solved the hard problem
 * already and solved it correctly, so this module keeps its shape rather than
 * replacing it with a library:
 *
 *   **Astro gives every island its own React root.** React state and React
 *   context cannot cross that boundary, so two islands wanting the same data
 *   is two fetches — unless the cache lives BELOW React. A module does cross
 *   it: the bundler hoists a module both islands import into one chunk,
 *   evaluated once per page. So the cache is module scope and each island
 *   subscribes. This is also why a provider-based library (TanStack Query,
 *   SWR) fits this app poorly: it wants one provider above one tree, and this
 *   app has ~45 trees per page in the worst case.
 *
 *   **Plain scripts are first-class clients.** `subscribe`/`ensure` are pure
 *   TypeScript with no React import, so a `<script>` in a .astro file shares
 *   one cache with the islands around it. That matters here: `/api/auth/me`
 *   is currently fetched by two islands AND two inline scripts, four
 *   implementations of one read.
 *
 * Behaviors that are load-bearing, each one a bug we would otherwise ship:
 *
 *  - **An error never destroys good data.** A failed load flips `status` to
 *    'error' and LEAVES `data` and `fetchedAt` alone. "We couldn't reach the
 *    feed" and "the feed says there is nothing" have to stay separate states
 *    all the way to the UI — merging them is the recurring bug class in this
 *    repo (see resolveLineupFillState, and the player-news empty/error split).
 *  - **Concurrent callers share one request.** An in-flight load is memoized
 *    per key, so a second island mounting mid-request joins it instead of
 *    starting its own.
 *  - **`status: 'loading'` only while nothing has ever landed.** Once a key
 *    holds data, a refresh must not flash the empty state on every tick.
 *  - **A polled key runs at the MINIMUM interval any subscriber asks for**, so
 *    a subscriber that has backed off cannot slow down one still watching a
 *    live game, and the page backs off only once every subscriber has.
 *  - **`staleTime` defaults to Infinity.** Cached data is reused until it is
 *    explicitly invalidated, refreshed, or re-polled. Time-based revalidation
 *    is opt-in per store, because the default that silently refetches is how a
 *    "cache" becomes a request amplifier.
 */

export type QueryStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface QueryState<T> {
  /** Last successful payload. Survives a subsequent failure on purpose. */
  data: T | null;
  status: QueryStatus;
  /** epoch ms of the last SUCCESSFUL load; 0 when nothing has landed yet. */
  fetchedAt: number;
  /**
   * Why the last attempt failed, when it did. OPTIONAL and absent (not null)
   * on a key nobody has loaded — the idle state is compared by value in tests
   * and by identity in `useSyncExternalStore`, and both want one canonical
   * empty object rather than one that grew a null field.
   */
  error?: Error | null;
}

export interface SubscribeOptions {
  /**
   * Poll this key while subscribed. Omit for a one-shot read: the first
   * subscriber loads, later ones reuse the cache, and nothing repeats.
   * Floored at 1s.
   */
  intervalMs?: number;
}

export interface QueryStoreOptions {
  /**
   * How long a successful payload is served without re-loading, in ms.
   * Default Infinity — see the module note. A finite value makes `ensure` and
   * a new subscriber re-load once the data is older than this.
   */
  staleTime?: number;
}

export interface QueryStore<P, T> {
  /** The cache key for `params`. Exposed so callers can build `invalidate` matchers. */
  keyOf(params: P): string;
  /** Read current state for a key without subscribing. Never triggers a load. */
  getState(params: P): QueryState<T>;
  /**
   * Subscribe to a key. Returns an unsubscribe function. The first subscriber
   * loads (unless fresh cached data is already there); with `intervalMs` it
   * also starts the timer, which the last unsubscribe stops.
   */
  subscribe(params: P, onChange: () => void, opts?: SubscribeOptions): () => void;
  /**
   * Force a load now, ignoring freshness. Still shares an in-flight request.
   * Never rejects — the failure lands in `getState(params).status` instead, so
   * a fire-and-forget `void refresh(...)` cannot raise an unhandled rejection.
   */
  refresh(params: P): Promise<void>;
  /**
   * Imperative read: resolves cached data when fresh, otherwise loads.
   * Unlike `refresh` this DOES reject, so `await`ing callers (inline scripts,
   * event handlers) can try/catch. A failure that still has last-known-good
   * data resolves with that data rather than throwing.
   */
  ensure(params: P): Promise<T>;
  /**
   * Drop cached data so it reloads. Keys with live subscribers reload
   * immediately and notify; keys with none are evicted and reload on next use.
   * Pass a matcher to invalidate a subset — `invalidate(k => k.startsWith('roster:'))`.
   * Call this after a write instead of reloading the page.
   */
  invalidate(match?: (key: string) => boolean): void;
  /**
   * Write cached data directly, for an optimistic update after a mutation.
   * Marks the key successful and notifies subscribers.
   */
  setData(params: P, updater: T | ((prev: T | null) => T)): void;
}

interface Entry<P, T> {
  /**
   * The params this key was created from. Kept so `invalidate` can re-run a
   * load it was not handed params for — the cache is keyed by string, but
   * `load` takes params.
   */
  params: P;
  state: QueryState<T>;
  listeners: Set<() => void>;
  /** Requested interval per subscriber id; the timer runs at the minimum. */
  intervals: Map<number, number>;
  inFlight: Promise<void> | null;
  timer: ReturnType<typeof setInterval> | null;
  timerMs: number;
}

/**
 * The one canonical empty state. Shared by identity so that repeated
 * `getState` calls for an unloaded key return the SAME object —
 * `useSyncExternalStore` tears if its snapshot getter returns a fresh object
 * each call.
 */
const IDLE: Readonly<QueryState<unknown>> = Object.freeze({
  data: null,
  status: 'idle' as const,
  fetchedAt: 0,
});

const MIN_INTERVAL_MS = 1000;

let subscriberSeq = 0;

export function createQueryStore<P, T>(
  keyOf: (params: P) => string,
  load: (params: P) => Promise<T>,
  options: QueryStoreOptions = {},
): QueryStore<P, T> {
  const { staleTime = Infinity } = options;
  const entries = new Map<string, Entry<P, T>>();

  const idleState = () => IDLE as unknown as QueryState<T>;

  const entryFor = (params: P): Entry<P, T> => {
    const key = keyOf(params);
    let e = entries.get(key);
    if (!e) {
      e = {
        params,
        state: idleState(),
        listeners: new Set(),
        intervals: new Map(),
        inFlight: null,
        timer: null,
        timerMs: 0,
      };
      entries.set(key, e);
    }
    return e;
  };

  const emit = (e: Entry<P, T>) => {
    for (const fn of [...e.listeners]) fn();
  };

  const setState = (e: Entry<P, T>, next: QueryState<T>) => {
    e.state = next;
    emit(e);
  };

  /**
   * Does this key need a network load right now?
   *
   * With the default `staleTime: Infinity` the last clause is dead, leaving
   * exactly the original poller's rule: load when nothing has ever landed, or
   * when the only attempt so far failed with nothing to show for it. A key
   * holding data — even one whose latest refresh errored — is reused.
   */
  const needsLoad = (e: Entry<P, T>): boolean => {
    const { status, data, fetchedAt } = e.state;
    if (status === 'idle') return true;
    if (status === 'error' && data === null) return true;
    if (staleTime !== Infinity && status === 'ok' && Date.now() - fetchedAt >= staleTime) {
      return true;
    }
    return false;
  };

  /** Load, sharing an in-flight request. Never rejects. */
  const run = (params: P): Promise<void> => {
    const e = entryFor(params);
    if (e.inFlight) return e.inFlight;

    if (e.state.status === 'idle') setState(e, { ...e.state, status: 'loading' });

    const p = load(params)
      .then((data) => {
        setState(e, { data, status: 'ok', fetchedAt: Date.now(), error: null });
      })
      .catch((err: unknown) => {
        // Keep `data` and `fetchedAt` — the last good payload is still the
        // best thing we know, it is just no longer being confirmed.
        setState(e, {
          ...e.state,
          status: 'error',
          error: err instanceof Error ? err : new Error(String(err)),
        });
      })
      .finally(() => {
        e.inFlight = null;
      });

    e.inFlight = p;
    return p;
  };

  const retime = (e: Entry<P, T>) => {
    const wanted = e.intervals.size === 0 ? Infinity : Math.min(...e.intervals.values());
    if (!Number.isFinite(wanted)) {
      if (e.timer) clearInterval(e.timer);
      e.timer = null;
      e.timerMs = 0;
      return;
    }
    if (e.timer && e.timerMs === wanted) return;
    if (e.timer) clearInterval(e.timer);
    e.timerMs = wanted;
    e.timer = setInterval(() => {
      void run(e.params);
    }, wanted);
  };

  return {
    keyOf,

    getState(params) {
      return entries.get(keyOf(params))?.state ?? idleState();
    },

    subscribe(params, onChange, opts = {}) {
      const e = entryFor(params);
      const id = ++subscriberSeq;
      e.listeners.add(onChange);
      if (opts.intervalMs !== undefined) {
        e.intervals.set(id, Math.max(MIN_INTERVAL_MS, opts.intervalMs));
      }
      retime(e);
      if (needsLoad(e)) void run(params);
      return () => {
        e.listeners.delete(onChange);
        e.intervals.delete(id);
        retime(e);
      };
    },

    refresh(params) {
      return run(params);
    },

    async ensure(params) {
      const existing = entries.get(keyOf(params));
      if (existing && existing.state.status === 'ok' && !needsLoad(existing)) {
        return existing.state.data as T;
      }
      await run(params);
      const { state } = entryFor(params);
      // Only throw when there is genuinely nothing to hand back. A refresh
      // that failed over good data is still a usable answer, and throwing
      // there would make every caller re-implement the fallback.
      if (state.status === 'error' && state.data === null) {
        throw state.error ?? new Error(`query failed: ${keyOf(params)}`);
      }
      return state.data as T;
    },

    invalidate(match) {
      for (const [key, e] of [...entries]) {
        if (match && !match(key)) continue;
        if (e.listeners.size > 0) {
          // Something is on screen showing this. Reload it rather than
          // blanking it — dropping to idle would flash a spinner over data
          // that is about to be replaced by an almost identical payload.
          void run(e.params);
        } else {
          if (e.timer) clearInterval(e.timer);
          entries.delete(key);
        }
      }
    },

    setData(params, updater) {
      const e = entryFor(params);
      const next =
        typeof updater === 'function'
          ? (updater as (prev: T | null) => T)(e.state.data)
          : updater;
      setState(e, { data: next, status: 'ok', fetchedAt: Date.now(), error: null });
    },
  };
}
