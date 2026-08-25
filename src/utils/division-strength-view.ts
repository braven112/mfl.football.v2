/**
 * Which Division Strength view a request asks for, and how the all-time table
 * is sorted.
 *
 * This lives apart from the page for one reason that is not style: the invalid
 * `?year=` case is a REDIRECT, and `Astro.redirect()` only redirects from a
 * page. Returning it from a shared component's frontmatter just stops rendering
 * that component — the response is still a 200, now with a blank body. That
 * exact bug shipped once already when TheLeague's `/cr` auth gate moved into a
 * shared component (see CLAUDE.md). So the decision lives here, and each thin
 * route wrapper owns the redirect, mirroring `resolveCustomRankingsAccess`.
 */
import type { DivisionStrengthFile } from '../types/division-strength';

/** Columns the all-time table can sort on. */
export const ALL_TIME_SORT_KEYS = [
  'name',
  'seasons',
  'record',
  'interPct',
  'titles',
  'championships',
] as const;

export type AllTimeSortKey = (typeof ALL_TIME_SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';

/**
 * The default sort is `seasons`, and that is a product decision rather than an
 * arbitrary pick.
 *
 * The page deliberately crowns no all-time strongest division — the two
 * metrics it reports disagree, and raw interdivisional win% flatters a
 * division that ran four seasons. But whichever column the table sorts by ON
 * ARRIVAL reads as the answer no matter what the prose says. Sorting by
 * longevity is neutral between the two metrics, and it puts the small-sample
 * divisions at the bottom, which is the honest place for them.
 */
export const DEFAULT_SORT: AllTimeSortKey = 'seasons';
export const DEFAULT_DIR: SortDir = 'desc';

export type DivisionStrengthView =
  | { kind: 'redirect'; to: string }
  | { kind: 'all-time'; sort: AllTimeSortKey; dir: SortDir }
  | { kind: 'season'; year: number; sort: AllTimeSortKey; dir: SortDir };

const isSortKey = (v: string | null): v is AllTimeSortKey =>
  !!v && (ALL_TIME_SORT_KEYS as readonly string[]).includes(v);

/**
 * Resolve the view for a request.
 *
 * - no `year` → all-time
 * - `year` in `yearsCovered` → that season
 * - `year` present but unparseable or uncovered → redirect to `basePath`
 *
 * A bad `sort` / `dir` clamps silently instead of redirecting: a typo in a
 * sort param is not worth a round trip, and the page renders correctly either
 * way. A bad YEAR is different — rendering "all-time" under a URL that says
 * `?year=1999` would misreport what the reader is looking at.
 *
 * `basePath` must already be league-resolved (the caller has the league and
 * the hide-prefix flag; this module has neither).
 */
export function resolveDivisionStrengthView(
  url: URL,
  data: DivisionStrengthFile,
  basePath: string
): DivisionStrengthView {
  const rawSort = url.searchParams.get('sort');
  const rawDir = url.searchParams.get('dir');
  const sort: AllTimeSortKey = isSortKey(rawSort) ? rawSort : DEFAULT_SORT;
  const dir: SortDir = rawDir === 'asc' ? 'asc' : rawDir === 'desc' ? 'desc' : DEFAULT_DIR;

  const rawYear = url.searchParams.get('year');
  if (rawYear === null) return { kind: 'all-time', sort, dir };

  // `Number('')` is 0 and `Number(' 2015 ')` is 2015 — neither is a year a
  // reader typed, so parse strictly and let anything else fall to the redirect.
  const year = /^\d{4}$/.test(rawYear) ? Number(rawYear) : NaN;
  if (!Number.isInteger(year) || !data.yearsCovered.includes(year)) {
    // 302, not 301: a year not covered today may well be covered next season,
    // and a permanent redirect would be cached in readers' browsers past that.
    return { kind: 'redirect', to: basePath };
  }
  return { kind: 'season', year, sort, dir };
}
