import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runs the ACTUAL inline script out of TransitionNoiseGuard.astro rather than a
 * copy of its logic. A copy is exactly how this test would rot: the predicate
 * decides whether a real bug gets swallowed, and the rescue decides whether the
 * browser does a full page load, so the thing under test has to be the thing
 * that ships.
 *
 * Background: Astro's ClientRouter attaches `.finally()` to the view
 * transition's `updateCallbackDone` and `finished` promises and never catches
 * the derived promises, so an aborted transition escapes as an unhandled
 * rejection (twice — verified in Chromium against Astro's exact shape). Astro
 * never observes the native `ready` promise, so a rejection that reaches us
 * means the SWAP failed, not the animation: the tap went nowhere.
 */

const GUARD = resolve(__dirname, '../src/components/TransitionNoiseGuard.astro');
const LAYOUT = resolve(__dirname, '../src/layouts/TheLeagueLayout.astro');

function guardSource(): string {
  const file = readFileSync(GUARD, 'utf8');
  const match = file.match(/<script is:inline>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('TransitionNoiseGuard.astro has no inline script');
  return match[1];
}

interface FakeEvent {
  reason?: unknown;
  to?: unknown;
  defaultPrevented: boolean;
  preventDefault(): void;
}

interface Harness {
  /** Dispatch an unhandledrejection; returns whether it was suppressed. */
  reject(reason: unknown): boolean;
  /** Fire one of Astro's navigation lifecycle events. */
  astro(type: 'astro:before-preparation' | 'astro:after-swap' | 'astro:page-load', to?: string): void;
  /** Run every timer the guard scheduled. */
  flushTimers(): void;
  /** The URL the guard hard-navigated to, if it did. */
  navigatedTo(): string | null;
  rejectionListeners(): number;
  win: Record<string, unknown>;
  warnings: string[];
}

function install(shared?: {
  win?: Record<string, unknown>;
  store?: Map<string, string>;
  href?: string;
}): Harness {
  const rejectionListeners: Array<(e: FakeEvent) => void> = [];
  const docListeners = new Map<string, Array<(e: FakeEvent) => void>>();
  const timers: Array<() => void> = [];
  const warnings: string[] = [];
  const store = shared?.store ?? new Map<string, string>();

  const location = { href: shared?.href ?? 'https://theleague.us/theleague/rosters' };

  const win: Record<string, unknown> = shared?.win ?? {};
  win.addEventListener = (type: string, fn: (e: FakeEvent) => void) => {
    if (type === 'unhandledrejection') rejectionListeners.push(fn);
  };
  win.location = location;
  win.setTimeout = (fn: () => void) => { timers.push(fn); return timers.length; };
  win.sessionStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
  };

  const doc = {
    addEventListener(type: string, fn: (e: FakeEvent) => void) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type)!.push(fn);
    },
  };

  const fakeConsole = { warn: (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); } };

  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'console', guardSource())(win, doc, fakeConsole);

  return {
    win,
    warnings,
    rejectionListeners: () => rejectionListeners.length,
    navigatedTo: () => (location.href === (shared?.href ?? 'https://theleague.us/theleague/rosters')
      ? null
      : location.href),
    astro(type, to) {
      const event: FakeEvent = { to, defaultPrevented: false, preventDefault() {} };
      for (const fn of docListeners.get(type) ?? []) fn(event);
    },
    flushTimers() {
      const queued = timers.splice(0, timers.length);
      for (const fn of queued) fn();
    },
    reject(reason: unknown) {
      const event: FakeEvent = {
        reason,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
      };
      for (const fn of rejectionListeners) fn(event);
      return event.defaultPrevented;
    },
  };
}

const ABORT = () =>
  new DOMException('Transition was aborted because of invalid state', 'InvalidStateError');
const TARGET = 'https://theleague.us/theleague/standings';

let guard: Harness;
beforeEach(() => { guard = install(); });

describe('suppresses an aborted ClientRouter view transition', () => {
  it('silences the abort the owner actually screenshotted', () => {
    expect(guard.reject(ABORT())).toBe(true);
  });

  it('silences the superseded-navigation abort too', () => {
    expect(guard.reject(new DOMException('Transition was skipped', 'AbortError'))).toBe(true);
  });

  it('still says so in the console — suppressed is not invisible', () => {
    guard.reject(ABORT());
    expect(guard.warnings.join('\n')).toContain('client-router');
  });
});

describe('does NOT suppress anything else', () => {
  // The whole risk of this guard is a real bug swallowed. Each of these must
  // still reach the rosters diagnostic banner.
  it('leaves an ordinary page bug alone', () => {
    for (const reason of [
      new TypeError("Cannot read properties of undefined (reading 'roster')"),
      new Error('Transition was aborted because of invalid state'), // right words, wrong type
      'Transition was skipped',                                     // a bare string
      null,
      undefined,
      { name: 'InvalidStateError' },                                // no message at all
    ]) {
      expect(guard.reject(reason)).toBe(false);
    }
  });

  it('leaves IndexedDB alone — a transaction is not a transition', () => {
    const reason = new DOMException(
      "Failed to execute 'objectStore' on 'IDBTransaction': The transaction has finished.",
      'InvalidStateError',
    );
    expect(guard.reject(reason)).toBe(false);
  });

  it('leaves an abort that is not about a transition alone', () => {
    expect(guard.reject(new DOMException('The user aborted a request.', 'AbortError'))).toBe(false);
  });
});

describe('rescues a navigation whose swap failed', () => {
  it('completes the tap the hard way instead of leaving the owner put', () => {
    // Exactly the reported sequence: a nav starts, the swap never lands, the
    // abort escapes. Without the rescue the owner is still on the old page
    // wondering why their tap did nothing.
    guard.astro('astro:before-preparation', TARGET);
    guard.reject(ABORT());
    guard.flushTimers();
    expect(guard.navigatedTo()).toBe(TARGET);
  });

  it('does NOT hard-navigate when the swap landed', () => {
    // after-swap means the DOM was replaced and the URL moved. Anything the
    // transition does after that really is only animation, and throwing away a
    // good soft navigation for it would be a self-inflicted full page load.
    guard.astro('astro:before-preparation', TARGET);
    guard.astro('astro:after-swap');
    guard.reject(ABORT());
    guard.flushTimers();
    expect(guard.navigatedTo()).toBeNull();
  });

  it('does NOT hard-navigate when the swap lands during the grace period', () => {
    // The rejection can arrive a beat before after-swap on a slow page.
    guard.astro('astro:before-preparation', TARGET);
    guard.reject(ABORT());
    guard.astro('astro:after-swap');   // lands inside the settle window
    guard.flushTimers();
    expect(guard.navigatedTo()).toBeNull();
  });

  it('does NOT hard-navigate when no navigation was in flight', () => {
    // An abort with nothing pending — e.g. on first paint. Nothing to rescue.
    guard.reject(ABORT());
    guard.flushTimers();
    expect(guard.navigatedTo()).toBeNull();
  });

  it('does NOT hard-navigate for a rejection it did not suppress', () => {
    guard.astro('astro:before-preparation', TARGET);
    guard.reject(new TypeError('a real bug'));
    guard.flushTimers();
    expect(guard.navigatedTo()).toBeNull();
  });

  it('refuses to rescue the same URL twice — that is a reload loop', () => {
    // The rescue triggers a full load. If the destination fails the same way
    // every time, re-rescuing would pin the owner in a reload cycle.
    const store = new Map<string, string>();
    const first = install({ store });
    first.astro('astro:before-preparation', TARGET);
    first.reject(ABORT());
    first.flushTimers();
    expect(first.navigatedTo()).toBe(TARGET);

    // Fresh page after the hard load, same session storage.
    const second = install({ store });
    second.astro('astro:before-preparation', TARGET);
    second.reject(ABORT());
    second.flushTimers();
    expect(second.navigatedTo()).toBeNull();
  });

  it('declines to rescue when sessionStorage is unavailable', () => {
    // No loop guard means no rescue: being stuck on one page beats a reload
    // cycle the owner cannot escape.
    const win: Record<string, unknown> = {};
    const h = install({ win });
    win.sessionStorage = {
      getItem() { throw new Error('storage disabled'); },
      setItem() { throw new Error('storage disabled'); },
    };
    h.astro('astro:before-preparation', TARGET);
    h.reject(ABORT());
    h.flushTimers();
    expect(h.navigatedTo()).toBeNull();
  });

  it('does not navigate to where it already is', () => {
    const here = 'https://theleague.us/theleague/rosters';
    const h = install({ href: here });
    h.astro('astro:before-preparation', here);
    h.reject(ABORT());
    h.flushTimers();
    expect(h.navigatedTo()).toBeNull();
  });
});

describe('installation', () => {
  it('registers exactly one listener even when the script re-runs', () => {
    // ClientRouter re-runs scripts from the incoming document on every soft
    // navigation, and `window` outlives the swap — without the install flag the
    // listener would stack one copy per navigation for the life of the tab.
    const win: Record<string, unknown> = {};
    const first = install({ win });
    install({ win });
    install({ win });
    expect(first.rejectionListeners()).toBe(1);
  });

  it('shares its predicate so the rosters banner cannot keep a second copy', () => {
    const predicate = guard.win.__isAbortedViewTransition as (r: unknown) => boolean;
    expect(typeof predicate).toBe('function');
    expect(predicate(new DOMException('Transition was skipped', 'AbortError'))).toBe(true);
    expect(predicate(new TypeError('nope'))).toBe(false);
  });
});

describe('load order is load-bearing', () => {
  it('mounts ahead of ClientRouter in the shared layout', () => {
    // Listeners fire in registration order and the banner decides by reading
    // `defaultPrevented`, so a guard that mounts later cannot set it in time.
    // There is no runtime observable for this in a unit test — the ordering IS
    // the contract, so the layout is where it has to be asserted.
    const layout = readFileSync(LAYOUT, 'utf8');
    const guardAt = layout.indexOf('<TransitionNoiseGuard />');
    const routerAt = layout.indexOf('<ClientRouter />');
    expect(guardAt).toBeGreaterThan(-1);
    expect(routerAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(routerAt);
  });
});
