/**
 * How fast the broadcast board works, and when it reboots.
 *
 * Pure, because the alternative is a scan. These four decisions are the whole
 * of what keeps a television alive overnight, and every one of them is an
 * arithmetic relationship between constants — a test that greps the island for
 * the right ternary pins the SPELLING and proves nothing about the numbers.
 * `watchdogLimit(true) > pollDelay(idle)` is the property that matters, and it
 * is only assertable from here.
 *
 * Same split as the rest of live scoring (`docs/claude/rules/live-scoring.md`):
 * the policy is pure and unit-tested, the timers live in the island.
 *
 * Background: a board left on `/broadcast` overnight was OOM-killing Edge's
 * renderer (`SBOX_FATAL_MEMORY_EXCEEDED`) and then sitting on a browser error
 * page until somebody walked over to the set. Nothing in the island grows
 * without bound — what was wrong is that `isQuiet` raised the screensaver and
 * changed nothing else, so a screen reading "No games live" kept the full
 * Sunday cadence all night. See
 * `docs/claude/insights/features/live-broadcast.md`.
 */

/**
 * Poll cadence. Slower than the draft board's 4s: this payload is N leagues
 * wide and a fantasy score moves more slowly than a draft pick.
 */
export const POLL_MS = 8_000;
export const POLL_BACKOFF_MS = 20_000;
export const ERRORS_BEFORE_BACKOFF = 3;

/**
 * Two independent failsafes, neither optional on a screen that runs unattended
 * for eight hours. The loop is a SELF-CHAINING timeout, so a fetch that hangs
 * forever does not merely delay the next poll — it BREAKS the chain, and the
 * board freezes on whatever it last drew with no indication anything is wrong.
 * That exact failure froze the 2026 draft rehearsal board at pick 7.
 */
export const POLL_TIMEOUT_MS = 15_000;
export const POLL_WATCHDOG_MS = 40_000;

/**
 * The idle cadence — and the reason it is a MINUTE.
 *
 * When nothing is live, only a poll can end the idle: the heartbeat reads
 * `nowTick` and `nowTick` cannot discover a kickoff. Detection latency for the
 * first snap is therefore exactly this number, by construction. Five minutes
 * would serve the memory argument better and would be a board that looks
 * broken to the room for most of the opening drive.
 */
export const POLL_IDLE_MS = 60_000;

/** Past this, the board says so from ten feet rather than looking current. */
export const STALE_MS = 5 * 60_000;

/** All games final this long → the screensaver takes over. */
export const QUIET_MS = 10 * 60_000;

/**
 * The heartbeat that ages the freshness pill and drives the saver clock.
 *
 * While the screensaver is up its only readers are an h:mm clock and an age
 * printed in whole minutes, neither of which can show fifteen seconds.
 */
export const TICK_MS = 1_000;
export const TICK_IDLE_MS = 15_000;

/** How long one renderer is trusted, and how often that is re-checked. */
export const RELOAD_AFTER_MS = 6 * 60 * 60_000;
export const RELOAD_CHECK_MS = 60_000;

/**
 * How long to wait before the next poll.
 *
 * Errors outrank quiet, deliberately: a board that is failing should retry on
 * the backoff, not doze at the idle cadence because the failures also left it
 * with nothing live to show. That ordering is the difference between a board
 * that recovers in twenty seconds and one that recovers in a minute.
 */
export function pollDelay(opts: { errors: number; idle: boolean }): number {
  if (opts.errors >= ERRORS_BEFORE_BACKOFF) return POLL_BACKOFF_MS;
  return opts.idle ? POLL_IDLE_MS : POLL_MS;
}

/**
 * How stale a completed poll may get before the watchdog forces one.
 *
 * It TRACKS the cadence, and that is the whole point. `POLL_WATCHDOG_MS` is
 * 40s while the idle cadence is 60s, so a flat threshold marks every HEALTHY
 * idle poll as a broken chain and re-polls on the watchdog's own 20s interval
 * — quietly restoring the afternoon cadence overnight and negating the
 * throttle completely. The invariant that stops that is
 * `watchdogLimit(idle) > pollDelay({ errors: 0, idle })`, for every tier.
 */
export function watchdogLimit(idle: boolean): number {
  return idle ? POLL_IDLE_MS * 2 : POLL_WATCHDOG_MS;
}

/** The heartbeat's period for the tier the board is in. */
export function tickInterval(idle: boolean): number {
  return idle ? TICK_IDLE_MS : TICK_MS;
}

/**
 * May the board reboot itself right now?
 *
 * Gated three ways, and none of them is redundant:
 *
 * - `demo` — the rehearsal is watched deliberately and runs in minutes.
 * - `idle` — never during play.
 * - `hasStage` — a reveal OUTRANKS the screensaver, so `idle` can be true with
 *   a moment still on screen (a final play landing after the last game went
 *   quiet). A reload that blanks the board mid-touchdown would be a worse bug
 *   than the one this fixes.
 *
 * `uptimeMs` is measured from MOUNT, so a board that has just reloaded starts
 * a fresh six hours and cannot loop.
 */
export function shouldReload(opts: {
  demo: boolean;
  idle: boolean;
  hasStage: boolean;
  uptimeMs: number;
}): boolean {
  if (opts.demo || !opts.idle || opts.hasStage) return false;
  return opts.uptimeMs >= RELOAD_AFTER_MS;
}
