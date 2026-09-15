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
 * **2. The article is matched by ID, never by headline.** A recap column's id
 * is `sf_<year>_weekly_recap_w<NN>`, so asking for that exact id answers "is
 * there a recap for THIS week" with no false positives. `RecapHero.astro` greps
 * headlines for /recap|review|results|week \d+/ and then falls back to
 * `recentArticles[0]` — i.e. any article from the last 7 days — which is how a
 * cut-watch column or a schedule breakdown ends up behind a "Read full recap"
 * button.
 *
 * **The scoreboard is now the only live path.** The weekly recap GENERATOR is
 * gone: `scripts/article-types/weekly-recap.mjs` and its Tuesday 6am PT cron
 * were removed in Sept 2026 (issue #1086 F3) because a recap column every week
 * is not something owners wanted to read, and none had generated for either
 * league all season regardless. No feed in either league contains a post with
 * this id, so the article branch below is dormant rather than reachable. It is
 * kept — not deleted — so a back-filled or re-imported archive still resolves
 * correctly instead of silently landing on the scoreboard.
 *
 * The fallback, and in practice the answer, is the completed week's own
 * scoreboard (`/<league>/live-scoring?week=N`), which renders every matchup
 * with final scores and per-player detail. The schedule page carries final
 * scores too but is a whole-SEASON grid with no week scoping, so it does not
 * read as "the week that just ended". Only a league year with nothing scored at
 * all falls through to the news feed.
 */
import type { CanonicalLeagueSlug } from '../config/leagues';

/** The subset of a Schefter post this module needs. */
export interface RecapCandidatePost {
  id: string;
  type?: string;
  link?: string;
}

export interface RecapDestination {
  /** The week the destination covers — the one in the books. 0 when nothing is scored yet. */
  week: number;
  href: string;
  /** Sentence case; surfaces that shout their CTAs upper-case it themselves. */
  label: string;
  /** True when this resolves to Schefter's own recap column rather than the scoreboard. */
  isArticle: boolean;
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
  /** Season the scores belong to — used to build the recap article's id. */
  seasonYear: number;
  /**
   * The week actually in the books — `getWeekInTheBooks`
   * (`src/utils/offseason-hero-data.ts`). NOT `getCurrentNFLWeek`, which rolls to
   * the upcoming week on the Tuesday morning this slot runs, and NOT the raw
   * `getLatestScoredWeek`, which reads a one-week feed MFL rolls on that same
   * morning and so names the unplayed week from the other direction.
   */
  completedWeek: number;
  /** The league's Schefter feed posts, loaded by the caller (a static import specifier can't be a runtime variable). */
  posts?: readonly RecapCandidatePost[];
}

/**
 * League-prefixed paths. Each surface still runs the result through its own
 * `resolveLeaguePath`, which strips the prefix on an apex domain.
 */
export function resolveRecapDestination({
  league,
  seasonYear,
  completedWeek,
  posts,
}: ResolveRecapDestinationInput): RecapDestination {
  const week = Number.isFinite(completedWeek) && completedWeek > 0 ? completedWeek : 0;

  const article = findWeeklyRecapPost(posts, seasonYear, week);
  if (article) {
    return {
      week,
      // CONSTRUCTED, never `article.link`. The removed generator's `buildPost`
      // hardcoded `link: '/theleague/news/<id>'` and `league: 'theleague'` and
      // ignored its own `{ league }` option, while the workflow ran that type
      // for `--league afl-fantasy` too — so any recap sitting in an AFL feed
      // carries a TheLeague permalink for a post that only exists in the AFL's.
      // The canonical route is `/<league>/news/<id>` in both leagues; building
      // it is immune to that.
      href: `/${league}/news/${article.id}`,
      label: 'Read the recap',
      isArticle: true,
    };
  }

  if (week > 0) {
    return {
      week,
      href: `/${league}/live-scoring?week=${week}`,
      label: 'See the scores',
      isArticle: false,
    };
  }

  // Nothing scored this season yet — there is genuinely no week to recap.
  return { week: 0, href: `/${league}/news`, label: 'Read the latest', isArticle: false };
}
