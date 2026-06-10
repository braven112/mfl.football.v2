/**
 * Pin the test suite to Pacific Time.
 *
 * Hero/matchup date logic operates in PT and many tests construct PT
 * wall-clock Dates with `new Date(y, m, d, h)`. Without this pin the suite
 * fails on UTC runners (GitHub Actions, cloud containers).
 *
 * This must run as vitest `globalSetup` — it executes in the main process
 * before worker threads spawn, so each worker's V8 isolate initializes its
 * timezone from the already-updated TZ. Setting TZ inside `setupFiles`
 * (in the worker) is too late: the isolate has already cached the zone.
 */
export default function setup(): void {
  process.env.TZ = 'America/Los_Angeles';
}
