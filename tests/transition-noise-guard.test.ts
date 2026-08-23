import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runs the ACTUAL inline script out of TransitionNoiseGuard.astro rather than a
 * copy of its logic. A copy is exactly how this test would rot: the predicate
 * decides whether a real bug gets swallowed, so the thing under test has to be
 * the thing that ships.
 *
 * Background: Astro's ClientRouter attaches `.finally()` to the view
 * transition's `updateCallbackDone` and `finished` promises and never catches
 * the derived promises, so every aborted transition escapes as an unhandled
 * rejection (twice — verified in Chromium against Astro's exact shape). The
 * rosters diagnostic banner reported one of those to an owner as a full-width
 * red error box over a roster page that had rendered perfectly.
 */

const GUARD = resolve(__dirname, '../src/components/TransitionNoiseGuard.astro');
const LAYOUT = resolve(__dirname, '../src/layouts/TheLeagueLayout.astro');

/** Pull the inline script body out of the component. */
function guardSource(): string {
  const file = readFileSync(GUARD, 'utf8');
  const match = file.match(/<script is:inline>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('TransitionNoiseGuard.astro has no inline script');
  return match[1];
}

interface FakeEvent {
  reason: unknown;
  defaultPrevented: boolean;
  preventDefault(): void;
}

interface Harness {
  /** Dispatch an unhandledrejection and report whether it was suppressed. */
  reject(reason: unknown): boolean;
  listenerCount(): number;
  win: Record<string, unknown>;
  warnings: unknown[][];
}

/** Install the guard into a throwaway window and return a driver for it. */
function install(win: Record<string, unknown> = {}): Harness {
  const listeners: Array<(e: FakeEvent) => void> = [];
  const warnings: unknown[][] = [];

  win.addEventListener = (type: string, fn: (e: FakeEvent) => void) => {
    if (type === 'unhandledrejection') listeners.push(fn);
  };

  const fakeConsole = { warn: (...args: unknown[]) => { warnings.push(args); } };

  // eslint-disable-next-line no-new-func
  new Function('window', 'console', guardSource())(win, fakeConsole);

  return {
    win,
    warnings,
    listenerCount: () => listeners.length,
    reject(reason: unknown) {
      const event: FakeEvent = {
        reason,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
      };
      for (const fn of listeners) fn(event);
      return event.defaultPrevented;
    },
  };
}

let guard: Harness;
beforeEach(() => { guard = install(); });

describe('suppresses an aborted ClientRouter view transition', () => {
  it('silences the abort the owner actually screenshotted', () => {
    // Chrome's wording when the document goes hidden mid-navigation — an owner
    // on Android switching apps between taps.
    const reason = new DOMException(
      'Transition was aborted because of invalid state',
      'InvalidStateError',
    );
    expect(guard.reject(reason)).toBe(true);
  });

  it('silences the superseded-navigation abort too', () => {
    // Astro triggers this one ITSELF, on every fast double-tap of the nav bar:
    // it calls skipTransition() on the in-flight transition before starting
    // the next. Pure self-inflicted noise.
    const reason = new DOMException('Transition was skipped', 'AbortError');
    expect(guard.reject(reason)).toBe(true);
  });

  it('still says so in the console — suppressed is not invisible', () => {
    guard.reject(new DOMException('Transition was skipped', 'AbortError'));
    expect(guard.warnings).toHaveLength(1);
    expect(String(guard.warnings[0][0])).toContain('client-router');
  });
});

describe('does NOT suppress anything else', () => {
  // The whole risk of this guard is a real bug swallowed. Each of these is a
  // rejection that must still reach the diagnostic banner.
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
    // The other frequent flyer on these two DOMException names. One letter of
    // difference in the noun is the entire thing keeping them apart, which is
    // why the predicate matches \btransition\b rather than a loose substring.
    const reason = new DOMException(
      "Failed to execute 'objectStore' on 'IDBTransaction': The transaction has finished.",
      'InvalidStateError',
    );
    expect(guard.reject(reason)).toBe(false);
  });

  it('leaves an abort that is not about a transition alone', () => {
    const reason = new DOMException('The user aborted a request.', 'AbortError');
    expect(guard.reject(reason)).toBe(false);
  });
});

describe('installation', () => {
  it('registers exactly one listener even when the script re-runs', () => {
    // ClientRouter re-runs scripts from the incoming document on every soft
    // navigation, and `window` outlives the swap — without the install flag the
    // listener would stack one copy per navigation for the life of the tab.
    const win: Record<string, unknown> = {};
    const first = install(win);
    install(win);
    install(win);
    expect(first.listenerCount()).toBe(1);
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
