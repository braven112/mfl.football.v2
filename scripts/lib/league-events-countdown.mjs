/**
 * `resolved-events.json` is recomputed on every Schefter scan, and most days
 * the only thing that moves is each event's countdown: `daysUntil` drops by
 * one, `isPast` follows it, `computedAt` is the run's clock. Committing that
 * was a production build a day that changed nothing on the site, because the
 * site reads only each event's `startDate` (src/utils/schefter-season-mode.ts)
 * and every script that wants the countdown recomputes the file in its own job
 * first (schefter-scan.yml runs compute-league-events.mjs before the scan).
 *
 * So the working copy is always fresh for the job that wrote it, and the
 * commit carries the file only when an event itself changed: a new event, a
 * moved date, a renamed one.
 *
 * Dependency-free, like the commit step it feeds.
 */
import { jsonEquivalent } from './canonical-json.mjs';

/** Fields that tick with the clock alone. */
export const COUNTDOWN_KEYS = ['computedAt', 'daysUntil', 'isPast'];

/** True when `current` differs from `committed` only in its countdown fields. */
export function countdownOnlyChange(committed, current) {
  return jsonEquivalent(committed, current, { ignoreKeys: COUNTDOWN_KEYS });
}
