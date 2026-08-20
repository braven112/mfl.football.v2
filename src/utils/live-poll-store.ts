/**
 * Shared polling store for live islands.
 *
 * The live-scoring page renders TWO separate React islands (LiveScoreboard and
 * NflGamesStrip) that both want the same NFL scoreboard. Astro hydrates each
 * island into its own root, so React state cannot be shared between them — but
 * a MODULE is shared: the bundler hoists a module both islands import into one
 * chunk, evaluated once per page. So the store lives at module scope and each
 * island subscribes to it, which is what keeps the page on one scoreboard fetch
 * instead of one per island.
 *
 * Three behaviors worth stating, because each is a bug we would otherwise ship:
 *
 *  - **An error never destroys good data.** A failed poll flips `status` to
 *    'error' and LEAVES `data` alone. "We couldn't reach the feed" and "the
 *    feed says there is nothing" have to stay separate states all the way to
 *    the UI — merging them is the recurring bug class in this repo (see
 *    resolveLineupFillState, and the player-news empty/error split).
 *  - **Concurrent callers share one request.** An in-flight fetch is memoized
 *    per key, so a second island mounting mid-request joins it.
 *  - **The interval is the MINIMUM any live subscriber asks for**, so a
 *    subscriber that has backed off to POLL_STALE can't slow down one that is
 *    still watching a live game, and the whole page backs off together once
 *    every subscriber does.
 */

export type PollStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface PollState<T> {
  /** Last successful payload. Survives a subsequent failure on purpose. */
  data: T | null;
  status: PollStatus;
  /** epoch ms of the last SUCCESSFUL load; 0 when nothing has landed yet. */
  fetchedAt: number;
}

interface Entry<T> {
  state: PollState<T>;
  listeners: Set<() => void>;
  /** Requested interval per subscriber id; the timer runs at the minimum. */
  intervals: Map<number, number>;
  inFlight: Promise<void> | null;
  timer: ReturnType<typeof setInterval> | null;
  timerMs: number;
}

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

const IDLE: PollState<never> = { data: null, status: 'idle', fetchedAt: 0 };

let subscriberSeq = 0;

export function createSharedPoller<P, T>(
  keyOf: (params: P) => string,
  load: (params: P) => Promise<T>,
): SharedPoller<P, T> {
  const entries = new Map<string, Entry<T>>();

  const entryFor = (key: string): Entry<T> => {
    let e = entries.get(key);
    if (!e) {
      e = {
        state: IDLE as unknown as PollState<T>,
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

  const emit = (e: Entry<T>) => {
    for (const fn of [...e.listeners]) fn();
  };

  const setState = (e: Entry<T>, next: PollState<T>) => {
    e.state = next;
    emit(e);
  };

  const run = (params: P): Promise<void> => {
    const e = entryFor(keyOf(params));
    if (e.inFlight) return e.inFlight;

    // 'loading' only while nothing has ever landed. Once we hold data, a
    // refresh must not flash the empty state on every tick.
    if (e.state.status === 'idle') setState(e, { ...e.state, status: 'loading' });

    const p = load(params)
      .then((data) => {
        setState(e, { data, status: 'ok', fetchedAt: Date.now() });
      })
      .catch(() => {
        // Keep `data` and `fetchedAt` — the last good payload is still the
        // best thing we know, it is just no longer being confirmed.
        setState(e, { ...e.state, status: 'error' });
      })
      .finally(() => {
        e.inFlight = null;
      });

    e.inFlight = p;
    return p;
  };

  const retime = (params: P) => {
    const e = entryFor(keyOf(params));
    const wanted = Math.min(...e.intervals.values());
    if (!Number.isFinite(wanted) || e.intervals.size === 0) {
      if (e.timer) clearInterval(e.timer);
      e.timer = null;
      e.timerMs = 0;
      return;
    }
    if (e.timer && e.timerMs === wanted) return;
    if (e.timer) clearInterval(e.timer);
    e.timerMs = wanted;
    e.timer = setInterval(() => { void run(params); }, wanted);
  };

  return {
    getState(params) {
      return entries.get(keyOf(params))?.state ?? (IDLE as unknown as PollState<T>);
    },

    subscribe(params, intervalMs, onChange) {
      const key = keyOf(params);
      const e = entryFor(key);
      const id = ++subscriberSeq;
      e.listeners.add(onChange);
      e.intervals.set(id, Math.max(1000, intervalMs));
      retime(params);
      // Load immediately for the first subscriber, or if the only data we have
      // is from a failed attempt. A later joiner reuses what is already there.
      if (e.state.status === 'idle' || (e.state.status === 'error' && !e.state.data)) {
        void run(params);
      }
      return () => {
        e.listeners.delete(onChange);
        e.intervals.delete(id);
        retime(params);
      };
    },

    refresh(params) {
      return run(params);
    },
  };
}
