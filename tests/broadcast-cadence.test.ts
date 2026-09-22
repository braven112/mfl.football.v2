/**
 * The policy that keeps a television alive overnight.
 *
 * A board left on `/broadcast` was OOM-killing Edge's renderer by morning
 * (`SBOX_FATAL_MEMORY_EXCEEDED`) and then sitting on a browser error page until
 * somebody walked over to the set. The cause was not a leak — nothing in the
 * island grows without bound — it was that `isQuiet` raised the screensaver and
 * changed nothing else, so a screen reading "No games live" kept the full
 * Sunday cadence all night.
 *
 * These are ARITHMETIC relationships between constants, which is why they are
 * tested here rather than scanned in the island: a grep for the right ternary
 * pins the spelling and proves nothing about the numbers.
 */

import { describe, it, expect } from 'vitest';
import {
  ERRORS_BEFORE_BACKOFF,
  POLL_BACKOFF_MS,
  POLL_IDLE_MS,
  POLL_MS,
  POLL_TIMEOUT_MS,
  POLL_WATCHDOG_MS,
  QUIET_MS,
  RELOAD_AFTER_MS,
  RELOAD_CHECK_MS,
  STALE_MS,
  TICK_IDLE_MS,
  TICK_MS,
  pollDelay,
  shouldReload,
  tickInterval,
  watchdogLimit,
} from '../src/utils/broadcast-cadence';

describe('pollDelay', () => {
  it('runs the afternoon cadence while anything is live', () => {
    expect(pollDelay({ errors: 0, idle: false })).toBe(POLL_MS);
  });

  it('slows down once the board has nothing to say', () => {
    expect(pollDelay({ errors: 0, idle: true })).toBe(POLL_IDLE_MS);
    expect(POLL_IDLE_MS).toBeGreaterThan(POLL_MS);
  });

  it('lets errors outrank quiet, in both tiers', () => {
    // A failing board should retry on the backoff, not doze at the idle
    // cadence because the failures also left it with nothing live to show.
    for (const idle of [true, false]) {
      expect(pollDelay({ errors: ERRORS_BEFORE_BACKOFF, idle })).toBe(POLL_BACKOFF_MS);
      expect(pollDelay({ errors: ERRORS_BEFORE_BACKOFF + 9, idle })).toBe(POLL_BACKOFF_MS);
    }
  });

  it('does not back off one error early', () => {
    expect(pollDelay({ errors: ERRORS_BEFORE_BACKOFF - 1, idle: false })).toBe(POLL_MS);
  });

  it('never returns a delay shorter than the fetch timeout can resolve', () => {
    // A cadence faster than the timeout stacks in-flight requests on a board
    // whose feed has gone slow — the overlap is what the backoff exists for.
    expect(POLL_BACKOFF_MS).toBeGreaterThan(POLL_TIMEOUT_MS);
  });
});

describe('watchdogLimit', () => {
  it('always exceeds the cadence it is watching', () => {
    // THE invariant. The watchdog forces a poll when one has not COMPLETED in
    // this long; if it is ever shorter than the gap between healthy polls it
    // fires on every one of them, re-polling on its own interval and quietly
    // restoring the afternoon cadence overnight — negating the throttle.
    for (const idle of [true, false]) {
      expect(watchdogLimit(idle)).toBeGreaterThan(pollDelay({ errors: 0, idle }));
    }
  });

  it('exceeds the backoff cadence too, so a failing board is not double-polled', () => {
    for (const idle of [true, false]) {
      expect(watchdogLimit(idle)).toBeGreaterThan(
        pollDelay({ errors: ERRORS_BEFORE_BACKOFF, idle }),
      );
    }
  });

  it('catches a genuinely broken chain within one idle cycle', () => {
    // The throttle must not turn the failsafe into a no-op: a suspended
    // machine or a fetch that never settles is still caught in minutes.
    expect(watchdogLimit(true)).toBeLessThanOrEqual(5 * 60_000);
  });

  it('leaves the live tier failsafe where it was', () => {
    expect(watchdogLimit(false)).toBe(POLL_WATCHDOG_MS);
  });
});

describe('tickInterval', () => {
  it('beats at 1 Hz while the board is working', () => {
    expect(tickInterval(false)).toBe(TICK_MS);
  });

  it('slows while quiet, but stays under the screensaver scene', () => {
    expect(tickInterval(true)).toBe(TICK_IDLE_MS);
    expect(tickInterval(true)).toBeGreaterThan(tickInterval(false));
    // The saver clock reads h:mm and the freshness pill reads whole minutes,
    // so anything at or under a minute is invisible — but a tick slower than
    // a scene change would leave the clock visibly wrong as scenes rotate.
    expect(tickInterval(true)).toBeLessThan(30_000);
  });
});

describe('shouldReload', () => {
  const past = RELOAD_AFTER_MS + 1;
  const base = { demo: false, idle: true, hasStage: false, healthy: true, fullscreen: false, uptimeMs: past };

  it('reboots a quiet board that has been up too long', () => {
    expect(shouldReload(base)).toBe(true);
  });

  it('never reboots while the board is live', () => {
    expect(shouldReload({ ...base, idle: false })).toBe(false);
  });

  it('never reboots with a moment on the stage', () => {
    // A reveal OUTRANKS the screensaver, so `idle` can be true with a
    // touchdown still on screen — a final play landing after the last game
    // went quiet. Blanking that is worse than the bug being fixed.
    expect(shouldReload({ ...base, hasStage: true })).toBe(false);
  });

  it('never reboots the rehearsal', () => {
    expect(shouldReload({ ...base, demo: true })).toBe(false);
  });

  it('never reboots a board that cannot reach the network', () => {
    // The regression this gate exists for, and it is the PR's own symptom
    // re-created by its own fix: a board that lost its connection overnight is
    // `idle` BY DEFINITION — nothing can be live when nothing can be fetched —
    // so an ungated reboot navigates away from a board still showing last
    // night's scores and into the browser's error page, which never recovers.
    expect(shouldReload({ ...base, healthy: false })).toBe(false);
  });

  it('never takes a fullscreen board off the television', () => {
    // Fullscreen needs transient activation and does not survive a navigation,
    // and the hardware this board is for has no keyboard to ask again.
    expect(shouldReload({ ...base, fullscreen: true })).toBe(false);
  });

  it('holds until the uptime is actually reached', () => {
    expect(shouldReload({ ...base, uptimeMs: 0 })).toBe(false);
    expect(shouldReload({ ...base, uptimeMs: RELOAD_AFTER_MS - 1 })).toBe(false);
    expect(shouldReload({ ...base, uptimeMs: RELOAD_AFTER_MS })).toBe(true);
  });

  it('cannot loop: a fresh board is not immediately eligible again', () => {
    // Uptime is measured from MOUNT, so the tick right after a reload sees
    // ~0 and the next one is a full window away.
    expect(shouldReload({ ...base, uptimeMs: RELOAD_CHECK_MS })).toBe(false);
  });

  it('survives a whole game day before it considers rebooting', () => {
    // A Sunday runs ~11h of live football; a board opened at kickoff must not
    // become reboot-eligible while the night game is still meaningful. It is
    // gated on `idle` anyway, but the window should not rely on that alone.
    expect(RELOAD_AFTER_MS).toBeGreaterThanOrEqual(6 * 60 * 60_000);
  });
});

describe('the idle tier does not make the board lie about itself', () => {
  it('polls well inside the staleness window', () => {
    // Past STALE_MS the board stops claiming to be current and prints
    // "Reconnecting — scores from Nm ago". An idle cadence at or beyond that
    // window would put that banner up all night on a board that is polling
    // perfectly happily, which is the same visible failure as the outage it
    // exists to report.
    expect(POLL_IDLE_MS).toBeLessThan(STALE_MS);
    // With headroom for one missed poll, not merely one.
    expect(POLL_IDLE_MS * 2).toBeLessThan(STALE_MS);
  });

  it('cannot go idle before the screensaver is even up', () => {
    // `isQuiet` is the throttle's trigger and QUIET_MS is its grace period, so
    // the board has already been saying nothing for ten minutes before any of
    // this engages.
    expect(QUIET_MS).toBeGreaterThan(POLL_IDLE_MS);
  });
});

describe('the overnight arithmetic', () => {
  it('cuts the idle poll count by at least 5x', () => {
    const night = 12 * 60 * 60_000;
    const before = night / POLL_MS;
    const after = night / POLL_IDLE_MS;
    expect(before / after).toBeGreaterThanOrEqual(5);
  });

  it('reboots before a second full night can accumulate', () => {
    expect(RELOAD_AFTER_MS).toBeLessThan(12 * 60 * 60_000);
  });

  it('checks for the reboot often enough to take the next lull', () => {
    expect(RELOAD_CHECK_MS).toBeLessThanOrEqual(POLL_IDLE_MS);
  });
});
