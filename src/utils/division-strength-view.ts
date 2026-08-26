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
import type {
  DivisionAllTime,
  DivisionMember,
  DivisionMembershipEra,
  DivisionStrengthFile,
} from '../types/division-strength';

/**
 * Columns the all-time table can sort on.
 *
 * There is deliberately no `titles` key. A division crowns exactly one winner
 * every season it exists, so a DIVISION's all-time division-title count is its
 * season count wearing a trophy — 15 titles in 15 seasons, for every division
 * in both leagues. It was sortable and rendered here until Aug 2026 and it
 * ordered the table identically to `seasons` while reading as an achievement.
 * Postseason results are what actually separate divisions, so the column is
 * `playoffs` (berth rate) and `championships`. Division titles still mean
 * something per OWNER inside a division and are still reported there.
 *
 * A bookmarked `?sort=titles` clamps to the default like any other unknown
 * key — see `resolveDivisionStrengthView`.
 */
export const ALL_TIME_SORT_KEYS = [
  'name',
  'seasons',
  'record',
  'interPct',
  'playoffs',
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

/* ── Postseason ────────────────────────────────────────────────────────────
 *
 * What a division actually achieved, as opposed to how long it existed.
 *
 * Division titles are NOT that: every division hands one out every season, so
 * counting them at the division level counts seasons (see ALL_TIME_SORT_KEYS).
 * Playoff berths and championships are earned against the rest of the league,
 * so both vary between divisions — the Northwest and Southwest have run the
 * same 15 seasons in TheLeague and separate at 28 berths / 3 titles against
 * 27 / 3.
 */

/**
 * Playoff berths per franchise-season — the share of the chances a division
 * had that it converted.
 *
 * The raw berth count is longevity in disguise for the same reason the title
 * count was: a division twice as old has had twice as many shots. The
 * denominator is franchise-seasons rather than seasons because divisions have
 * not always been the same size (the AFL ran six divisions of four through
 * 2012 and four of six after), so "berths per season" would flatter the
 * bigger ones.
 *
 * Null, never 0, when there are no franchise-seasons to divide by — an
 * upcoming alignment that has not played.
 */
export function berthRate(berths: number, teamSeasons: number): number | null {
  return teamSeasons > 0 ? berths / teamSeasons : null;
}

/**
 * Franchise-seasons inside a membership era.
 *
 * Exact rather than approximate: an era is by definition the same franchise
 * set in every one of its seasons, so the product is the count.
 */
export function eraTeamSeasons(
  era: Pick<DivisionMembershipEra, 'franchiseIds' | 'seasons'>
): number {
  return era.franchiseIds.length * era.seasons;
}

/**
 * How many teams the league has seeded in a season, smallest and largest, over
 * the seasons on file.
 *
 * A berth rate only compares within a fixed field, so a league that changed
 * how many teams it seeds owes the reader a caveat. Neither of these has:
 * TheLeague has seeded 7 of 16 every season since 2007 and the AFL 8 of 24
 * every season since 2003, which `tests/playoff-field-size.test.ts` checks
 * against MFL's own bracket metadata season by season. The page reports the
 * range only when it varies, so today it stays quiet in both leagues — and
 * would speak up on its own the year one of them changes.
 *
 * Seasons with zero berths are excluded rather than counted as a small field:
 * a season in progress has not seeded anyone yet, and 0 is "not known", not
 * "nobody made it".
 */
export function playoffFieldRange(
  data: Pick<DivisionStrengthFile, 'years'>
): { min: number; max: number } | null {
  const fields = data.years
    .map((y) => y.divisions.reduce((n, d) => n + d.playoffBerths, 0))
    .filter((n) => n > 0);
  if (!fields.length) return null;
  return { min: Math.min(...fields), max: Math.max(...fields) };
}

/* ── Membership eras ───────────────────────────────────────────────────────
 *
 * A division name outlives the teams that earned its record, so ranking names
 * against each other ranks seven different sets of franchises. An ERA — a run
 * of consecutive seasons with an identical franchise set — is the slice where
 * two divisions are compared as the same group over their whole shared span.
 *
 * These shape `membershipEras[]` (already computed in
 * `scripts/compute-division-strength.mjs`) for display. They live here rather
 * than in the page's frontmatter so they can be tested without rendering.
 */

/**
 * Consecutive seasons a lineup must survive to earn a place on the era board.
 *
 * The whole point of the board is comparing groups that actually have shared
 * history; a lineup that lasted a single season has a record, not a story.
 * Three is the owner's call — it shows more eras than four did while still
 * excluding the scatter of one-and-two-season lineups both leagues' realignments
 * produce (the AFL's West has ten eras, six of them a single season) that would
 * otherwise dominate any rate metric and bury the real ones.
 */
export const ERA_MIN_SEASONS = 3;

/** "2012–2016", or "2016–present" for the era still running. */
export function formatEraYears(era: Pick<DivisionMembershipEra, 'yearStart' | 'yearEnd' | 'current'>): string {
  if (era.yearStart === era.yearEnd && !era.current) return String(era.yearStart);
  return `${era.yearStart}–${era.current ? 'present' : era.yearEnd}`;
}

/** One lineup on the cross-division era board. */
export interface RankedEra {
  era: DivisionMembershipEra;
  divisionName: string;
  divisionSlug: string;
  /** How many qualifying eras this division contributes — 2 when it realigned. */
  divisionEraCount: number;
  /** "2012–2016". */
  years: string;
  /** "Northwest (2012–2016)" — the label the owner asked for. */
  label: string;
}

/**
 * Every division's membership eras, long enough to count, ranked against each
 * other.
 *
 * Sorted on OVERALL win%, matching the all-time ranking directly above it on
 * the page and the record each row leads with — a board sorted on one number
 * while showing another in the big type reads as broken. That is the owner's
 * call, made knowing the two metrics no longer agree everywhere: an era's
 * intra-division games are exactly zero-sum, so overall win% is the
 * interdivisional rate compressed toward .500, but only by an APPROXIMATELY
 * equal factor. They ordered every era identically at the old four-season
 * floor; at three, the AFL's North 2008–2010 beats three rows above it against
 * the rest of the league (South 2019–present and both East runs) while trailing
 * all three overall, so those pairs sit in the opposite order from an
 * interdivisional ranking. The widest of them is .009 apart on the ranked
 * number. Both figures are on every row, which is what keeps that honest. Ties break toward the longer run,
 * which is the one carrying more evidence.
 */
export function rankEras(
  divisions: DivisionAllTime[],
  minSeasons: number = ERA_MIN_SEASONS
): RankedEra[] {
  const rows: RankedEra[] = [];
  for (const division of divisions) {
    const qualifying = division.membershipEras.filter(
      (era) => era.seasons >= minSeasons && era.totals.games > 0
    );
    for (const era of qualifying) {
      const years = formatEraYears(era);
      rows.push({
        era,
        divisionName: division.name,
        divisionSlug: division.slug,
        divisionEraCount: qualifying.length,
        years,
        label: `${division.name} (${years})`,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      (b.era.totals.winPct ?? 0) - (a.era.totals.winPct ?? 0) ||
      b.era.seasons - a.era.seasons ||
      b.era.yearStart - a.era.yearStart ||
      a.divisionName.localeCompare(b.divisionName)
  );
}

/** A franchise that has been in a division at some point, with its latest look. */
export interface DivisionAlumnus extends DivisionMember {
  /** In the lineup that is still running. False for every departed franchise. */
  current: boolean;
}

/**
 * Every franchise that has ever sat in a division, current lineup first.
 *
 * Walking the eras NEWEST first does two jobs at once: it orders the crests by
 * recency (so a reader scanning the row sees today's teams before a franchise
 * that left in 2010), and it resolves each franchise to the identity it wore
 * the LAST time it was in this division. `membershipEras[].members` is already
 * stamped as of its own era's final season, so first-seen wins.
 */
export function divisionAlumni(division: DivisionAllTime): DivisionAlumnus[] {
  const currentIds = new Set(division.currentEra?.franchiseIds ?? []);
  const seen = new Set<string>();
  const out: DivisionAlumnus[] = [];
  for (let i = division.membershipEras.length - 1; i >= 0; i -= 1) {
    for (const member of division.membershipEras[i].members) {
      if (seen.has(member.franchiseId)) continue;
      seen.add(member.franchiseId);
      out.push({ ...member, current: currentIds.has(member.franchiseId) });
    }
  }
  return out;
}
