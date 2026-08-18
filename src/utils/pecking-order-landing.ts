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
  expectedIssueTuesday,
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

/**
 * Days after a week's own Tuesday that a publish date is still credible as a
 * publish date. Covers a cron that was late, re-run, or dispatched by hand.
 */
const PUBLISH_GRACE_DAYS = 14;

/**
 * Was this issue's `publishedAt` stamped long after the week it covers?
 *
 * `publishedAt` is written at generation time, which for a contemporaneous
 * Tuesday run IS the publication date. For an issue generated later — the
 * launch seeds, a backfill, or (before the season gate existed) a stray
 * preseason run — it is just the day the file was written, and rendering it
 * as a dateline makes a months-old issue read as breaking news. That is what
 * put "August 14, 2026" on a Week 14 2025 issue.
 *
 * There is no honest date to show in that case: the issue was never
 * published, so the surface should show none rather than invent one from the
 * week it covers. An unparseable date counts as untrustworthy too — better
 * blank than "Invalid Date".
 */
export function isRetroactivelyGenerated(
  issue: { year: number; week: number; publishedAt?: string },
  graceDays: number = PUBLISH_GRACE_DAYS,
): boolean {
  if (!issue.publishedAt) return true;
  const published = new Date(issue.publishedAt);
  if (Number.isNaN(published.getTime())) return true;
  const expected = expectedIssueTuesday(issue.year, issue.week);
  return published.getTime() - expected.getTime() > graceDays * 24 * 60 * 60 * 1000;
}

export interface PermalinkState<T> {
  /** True when this issue is the one the landing page would render as live. */
  isCurrent: boolean;
  /** Next issue back in time, for the footer nav. */
  older: LandingIssue<T> | null;
  /** Next issue forward in time, for the footer nav. */
  newer: LandingIssue<T> | null;
}

/**
 * Where a permalinked issue sits relative to everything else on disk.
 *
 * `isCurrent` deliberately reuses the landing resolver rather than asking its
 * own question, so the two pages can never disagree about whether an issue is
 * this week's verdict or an archived one.
 */
export function resolveIssuePermalink<T>(
  issues: LandingIssue<T>[],
  target: { year: number; week: number },
  now: Date = new Date(),
): PermalinkState<T> {
  const sorted = sortIssues(issues);
  const idx = sorted.findIndex(i => i.year === target.year && i.week === target.week);
  const { mode, latest } = resolvePeckingOrderLanding(sorted, now);
  return {
    isCurrent:
      mode === 'live' && latest?.year === target.year && latest?.week === target.week,
    older: idx >= 0 ? sorted[idx + 1] ?? null : null,
    newer: idx > 0 ? sorted[idx - 1] ?? null : null,
  };
}
