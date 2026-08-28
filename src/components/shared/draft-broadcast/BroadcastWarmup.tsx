/**
 * BroadcastWarmup — pull every image the board will need BEFORE the room needs
 * it, and say out loud when that is done.
 *
 * The failure this exists to remove: a reveal mounts, its `<img>` starts a
 * cold request for a ~240 KB ESPN PNG, and the card sits there with a name and
 * no face for as long as the room's wifi takes. Warming turns that request
 * into a cache read.
 *
 * Two things make this more than a `new Image()` loop:
 *
 *  1. **The origin's cache window is four minutes.** ESPN sends
 *     `cache-control: max-age=233` on headshots, so a browser-cache warm-up is
 *     stale before the first round ends. The durable store is the service
 *     worker's image cache (`public/sw.js`), which keeps these responses on
 *     its own clock — so this component WAITS for the worker to be in control
 *     before it spends the bandwidth, and says so when there isn't one.
 *  2. **It reports.** "Ensure every image is downloaded" is not a thing you
 *     can take on faith at 7pm with a room watching, so the pill counts up and
 *     then states the total it holds. It fades out on its own once the board
 *     is warm and there is nothing left to say.
 *
 * Rendered as its OWN component rather than inside `DraftBroadcast` because
 * progress ticks a few hundred times: keeping that state here means the board,
 * the reveal queue and the poll never re-render for it.
 */

import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Warm-up plan, most-needed first — see `planBroadcastImages`. */
  urls: string[];
  /** How many to fetch at once. */
  concurrency?: number;
}

/** Parallel requests. Six matches a browser's own per-host connection budget:
 *  more just queues, and queueing behind the warm-up is exactly what the live
 *  poll must never do. */
const DEFAULT_CONCURRENCY = 6;

/** How often the pill is allowed to re-render while counting. */
const PROGRESS_TICK_MS = 400;

/** How long the "ready" state stays on screen before fading out. */
const DONE_LINGER_MS = 8_000;

/** Longer when there is no durable cache — that is a condition worth reading
 *  and acting on before the room fills up. Still finite: this board spends the
 *  night on a TV, and a pill that never leaves becomes part of the furniture. */
const DONE_LINGER_NO_CACHE_MS = 45_000;

/** Longest we wait for a service worker to take control before warming anyway.
 *  Warming into the plain HTTP cache is worth much less (see the header) but is
 *  not worth nothing, and a page that never warms because a worker never
 *  claimed it would be the worse outcome. */
const CONTROLLER_WAIT_MS = 5_000;

/**
 * URLs this TAB has already pulled, across mounts.
 *
 * Module scope, not a ref: React 18 StrictMode mounts an island twice in dev,
 * and an Astro `ClientRouter` navigation back to this page remounts it for
 * real. Neither should re-spend a warm-up that already happened.
 */
const warmed = new Set<string>();

/** Resolves once a service worker controls this page, or the wait times out. */
async function waitForController(signal: AbortSignal): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  if (navigator.serviceWorker.controller) return true;

  // `ready` resolves on an ACTIVE registration, which is not the same as this
  // page being controlled — a page loaded before the worker activated stays
  // uncontrolled until `clients.claim()` lands, which arrives as
  // `controllerchange`. Wait on whichever comes first.
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      resolve(value);
    };
    const onChange = () => finish(true);
    const timer = setTimeout(() => finish(!!navigator.serviceWorker.controller), CONTROLLER_WAIT_MS);

    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    navigator.serviceWorker.ready.then(
      () => {
        if (navigator.serviceWorker.controller) finish(true);
      },
      () => {
        /* no worker — the timeout answers */
      }
    );
    signal.addEventListener('abort', () => finish(false), { once: true });
  });
}

/**
 * Pull one URL to completion.
 *
 * The body is read and dropped, and that is the point: a `fetch` whose body is
 * never consumed can leave the transfer unfinished, so neither the HTTP cache
 * nor the service worker ends up holding the whole image. `mode: 'cors'` for
 * the same reason the worker re-issues these as CORS — a `no-cors` response is
 * opaque, which is unreadable and charged to the origin quota at a padded size.
 * ESPN sends `access-control-allow-origin: *`, so this is free.
 */
async function warmOne(url: string, signal: AbortSignal): Promise<boolean> {
  const response = await fetch(url, {
    mode: 'cors',
    credentials: 'omit',
    signal,
  });
  if (!response.ok) return false;
  await response.blob();
  return true;
}

export function BroadcastWarmup({ urls, concurrency = DEFAULT_CONCURRENCY }: Props) {
  const [ready, setReady] = useState(0);
  const [failed, setFailed] = useState(0);
  const [done, setDone] = useState(false);
  const [durable, setDurable] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Counters live in refs and are published on a timer — a state update per
  // image would re-render this pill several hundred times for a number nobody
  // can read that fast.
  const readyRef = useRef(0);
  const failedRef = useRef(0);

  const total = urls.length;

  useEffect(() => {
    if (total === 0) {
      setDone(true);
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    const publish = setInterval(() => {
      setReady(readyRef.current);
      setFailed(failedRef.current);
    }, PROGRESS_TICK_MS);

    const run = async () => {
      setDurable(await waitForController(signal));
      if (cancelled) return;

      // A shared cursor rather than N pre-sliced lists: the plan is in priority
      // order, so a worker that finishes early must take the next MOST wanted
      // image, not the next one in its own slice.
      let cursor = 0;
      const worker = async () => {
        while (!cancelled) {
          const index = cursor;
          cursor += 1;
          if (index >= urls.length) return;
          const url = urls[index];
          if (warmed.has(url)) {
            readyRef.current += 1;
            continue;
          }
          try {
            const ok = await warmOne(url, signal);
            if (ok) {
              warmed.add(url);
              readyRef.current += 1;
            } else {
              // A 404 here is information, not a fault: the card's own error
              // cascade already covers a missing headshot, and counting it
              // separately is what tells you at a glance whether "1140 of 1180"
              // is a slow connection or forty players ESPN has no photo for.
              failedRef.current += 1;
            }
          } catch {
            if (cancelled) return;
            failedRef.current += 1;
          }
        }
      };

      await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
      if (cancelled) return;
      setReady(readyRef.current);
      setFailed(failedRef.current);
      setDone(true);
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(publish);
    };
  }, [urls, total, concurrency]);

  // Fade the pill out once it has nothing left to report — held longer when
  // the durable cache never engaged, so that warning is readable rather than
  // hidden after eight seconds.
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(
      () => setDismissed(true),
      durable === false ? DONE_LINGER_NO_CACHE_MS : DONE_LINGER_MS
    );
    return () => clearTimeout(id);
  }, [done, durable]);

  if (total === 0 || dismissed) return null;

  const held = ready;
  const pct = total > 0 ? Math.round((Math.min(ready + failed, total) / total) * 100) : 100;

  return (
    <div
      className={`dbc__warmup${done ? ' is-done' : ''}`}
      role="status"
      data-testid="broadcast-warmup"
      data-durable={durable === null ? 'pending' : String(durable)}
    >
      <span className="dbc__warmup-dot" aria-hidden="true" />
      {done ? (
        <span>
          {held.toLocaleString()} images ready
          {failed > 0 ? ` · ${failed.toLocaleString()} unavailable` : ''}
          {durable === false ? ' · no offline cache (open the deployed site)' : ''}
        </span>
      ) : (
        <span>
          Caching images… {Math.min(ready + failed, total).toLocaleString()} /{' '}
          {total.toLocaleString()} ({pct}%)
        </span>
      )}
    </div>
  );
}

export default BroadcastWarmup;
