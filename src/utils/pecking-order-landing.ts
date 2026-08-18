/**
 * Landing-state resolver for The Pecking Order.
 *
 * The column publishes weekly during the season and then goes quiet for seven
 * months, so its landing page spends most of the calendar year showing an
 * issue that is NOT current. Owners who have never seen the column — it
 * launched in August 2026, with the first real AFL issues still a month out —
 * cannot tell that from the page: it renders last season's rankings with the
 * same hero, the same numbers, and no hint that the season is over.
 *
 * So the page has two states, and this decides which:
 *
 * - `live`    — the newest issue belongs to the season being played. Render it.
 * - `preview` — everything else. Lead with what the column IS, and label the
 *               issue below it as a sample so nobody reads last December's
 *               rankings as this week's.
 *
 * Pure on purpose (no Astro, no fs): the decision is what regressions land in,
 * and it is worth testing directly rather than through rendered markup.
 */
import {
  isSeasonWindowOpen,
  upcomingFirstIssueDate,
} from './pecking-order-season-window.mjs';

export type PeckingOrderMode = 'live' | 'preview';

export interface LandingIssue<T> {
  year: number;
  week: number;
  data: T;
}

export interface LandingState<T> {
  mode: PeckingOrderMode;
  /** Newest issue, whatever its season. Null when the league has none yet. */
  latest: LandingIssue<T> | null;
  /** Everything older than `latest`, newest first. */
  older: LandingIssue<T>[];
  /**
   * When the next season's first issue lands, for the preview copy. Null once
   * that Tuesday has passed (say so as "every Tuesday" instead of a date).
   */
  firstIssueDate: Date | null;
}

/** Newest first: later season wins, then later week. */
export function sortIssues<T>(issues: LandingIssue<T>[]): LandingIssue<T>[] {
  return [...issues].sort((a, b) => b.year - a.year || b.week - a.week);
}

export function resolvePeckingOrderLanding<T>(
  issues: LandingIssue<T>[],
  now: Date = new Date(),
): LandingState<T> {
  const sorted = sortIssues(issues);
  const latest = sorted[0] ?? null;

  // A league with no issues at all is a preview too — a page that greets an
  // owner with "run pnpm generate:pecking-order" is not a page for owners.
  const mode: PeckingOrderMode =
    latest && isSeasonWindowOpen(latest.year, now) ? 'live' : 'preview';

  return {
    mode,
    latest,
    older: sorted.slice(1),
    firstIssueDate: mode === 'preview' ? upcomingFirstIssueDate(now) : null,
  };
}
