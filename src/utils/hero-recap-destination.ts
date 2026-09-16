/**
 * Where "READ THE RECAP" actually goes.
 *
 * The Tuesday recap hero in BOTH leagues used to punt: the AFL's `slot:recap`
 * hardcoded `/afl-fantasy/news` (the whole feed — every external wire item and
 * transaction, no recap in sight) and TheLeague's `RecapCompositeHero` sent
 * "See the full week" to `/theleague/standings`. A card headlined "THE WEEK IN
 * REVIEW." has to land on the week in review, not on a news dump the reader
 * then has to search.
 *
 * Two rules make that work:
 *
 * **1. The week is the one in the BOOKS, not `getCurrentNFLWeek`.** `nflWeekFor`
 * rolls to the upcoming week on TUESDAY — the exact morning this slot runs — so
 * on Tue Sep 15 2026 it answered 2 while Week 1 was what had just finished, and
 * the hero read "Week 2 is in the books" over games nobody had played. Callers
 * pass `getWeekInTheBooks` (`src/utils/offseason-hero-data.ts`) — the scored
 * week, capped at the calendar's last completable one — and both the copy and
 * the link key off that. Not the raw `getLatestScoredWeek`: the playerScores
 * feed holds only whatever week MFL considers live, so once MFL rolls it, it
 * names the unplayed week too.
 *
 * **2. The destination is Top Players, scoped to that week.** The card casts
 * the week's highest scorer, so it lands on the page that ranks exactly that:
 * `/<league>/top-players?week=N`, which re-ranks every player — rostered or
 * free agent — by that week's points alone.
 *
 * It used to prefer Schefter's weekly recap column and fall back to the week's
 * scoreboard. Both are gone. The recap GENERATOR itself was removed in Sept
 * 2026 (`scripts/article-types/weekly-recap.mjs` and its Tuesday 6am PT cron,
 * issue #1086 F3) because a column every week is not something owners wanted to
 * read, and none had generated for either league all season regardless — so
 * that branch was dormant, not merely unpreferred. `findWeeklyRecapPost` is
 * still exported below because `RecapHero.astro` renders such a column when one
 * EXISTS, which is a different job from choosing where a button points; a
 * back-filled or re-imported archive stays reachable through /news.
 *
 * Only a league year with nothing scored at all falls through to the news feed.
 *
 * Note the hero and the page can name DIFFERENT leaders, on purpose.
 * `getWeeklyTopScorerCandidates` casts ROSTERED players only, because the card
 * renders its subject's franchise colours and crest and a free agent has no
 * franchise to key those off. The hero answers "whose player went off this
 * week"; the page answers "who went off this week". Do not "fix" the filter.
 */
import type { CanonicalLeagueSlug } from '../config/leagues';

export interface RecapDestination {
  /** The week the destination covers — the one in the books. 0 when nothing is scored yet. */
  week: number;
  href: string;
  /** Sentence case; surfaces that shout their CTAs upper-case it themselves. */
  label: string;
}

/** The subset of a Schefter post `findWeeklyRecapPost` needs. */
export interface RecapCandidatePost {
  id: string;
  type?: string;
  link?: string;
}

/**
 * The id a week's recap carries. Fixed by the removed generator's `config.id`
 * and by whatever it wrote before it was removed, so it is history now rather
 * than a contract with live code — pinned by tests/hero-recap-destination.test.ts.
 */
export function weeklyRecapPostId(year: number, week: number): string {
  return `sf_${year}_weekly_recap_w${String(week).padStart(2, '0')}`;
}

/**
 * Schefter's recap column for exactly this week, or null. Matched on the
 * generated id, so an unrelated article published the same morning can never
 * stand in for a recap that was never written.
 *
 * NOT used by `resolveRecapDestination` any more — the CTA goes to Top Players
 * unconditionally. This remains because `RecapHero.astro` renders the COLUMN
 * ITSELF (headline, excerpt, byline) when one exists, which is a different job
 * from choosing where a button points. When the weekly recap type is retired,
 * that component and this pair go together.
 */
export function findWeeklyRecapPost<T extends RecapCandidatePost>(
  posts: readonly T[] | undefined,
  year: number,
  week: number,
): T | null {
  if (!posts?.length || !week) return null;
  const id = weeklyRecapPostId(year, week);
  return posts.find((p) => p.id === id && (p.type ?? 'article') === 'article') ?? null;
}

export interface ResolveRecapDestinationInput {
  league: CanonicalLeagueSlug;
  /**
   * The week actually in the books — `getWeekInTheBooks`
   * (`src/utils/offseason-hero-data.ts`). NOT `getCurrentNFLWeek`, which rolls to
   * the upcoming week on the Tuesday morning this slot runs, and NOT the raw
   * `getLatestScoredWeek`, which reads a one-week feed MFL rolls on that same
   * morning and so names the unplayed week from the other direction.
   */
  completedWeek: number;
}

/**
 * League-prefixed paths. Each surface still runs the result through its own
 * `resolveLeaguePath`, which strips the prefix on an apex domain.
 */
export function resolveRecapDestination({
  league,
  completedWeek,
}: ResolveRecapDestinationInput): RecapDestination {
  const week = Number.isFinite(completedWeek) && completedWeek > 0 ? completedWeek : 0;

  if (week > 0) {
    return {
      week,
      // Top Players validates `?week=` against the weeks it actually has and
      // degrades to season totals rather than rendering an empty table, so a
      // stale link can never land the reader on a blank page.
      href: `/${league}/top-players?week=${week}`,
      label: "See the week's top scorers",
    };
  }

  // Nothing scored this season yet — there is genuinely no week to recap.
  return { week: 0, href: `/${league}/news`, label: 'Read the latest' };
}
