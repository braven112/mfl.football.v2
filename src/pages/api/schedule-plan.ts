/**
 * Generate a season's schedule for the commissioner to paste into MFL.
 *
 * MFL has no schedule write API (the full import list carries no schedule or
 * matchup type; `TYPE=schedule` is export-only), so this endpoint never writes
 * anything anywhere. It reads committed feeds, runs the shared planner, and
 * returns text. Applying it is a human pasting into
 * Commissioner -> Setup -> Schedule -> the advanced editor, which OVERWRITES
 * the entire fantasy schedule.
 *
 * Commissioner/admin only, and additionally scoped to the league being planned
 * — a commissioner of one league must not be able to rewrite another's
 * schedule. See docs/claude/rules/schedule-optimization.md.
 */
import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin, isAuthorizedForLeague } from '../../utils/auth';
import { getLeagueBySlug } from '../../config/leagues';
import { byeWeeksForSeason } from '../../utils/nfl-bye-weeks';
import { planSchedule, SCHEDULE_POLICY } from '../../utils/schedule-plan.mjs';
import { leagueFeedPath, loadLeagueData } from '../../utils/league-data';

export const prerender = false;

/**
 * Every feed `planSchedule` asks its injected `readFeed` for, as
 * `[yearOffset, feed]`. planSchedule is sync and shared with the CLI scripts
 * (which read off disk), so this route loads the feeds first — through the
 * loader, because some (players.json) no longer ship inside the function —
 * and hands planSchedule a lookup over what it loaded.
 */
const PLAN_FEEDS: Array<[number, string]> = [
  [0, 'league'],
  [0, 'schedule'],
  [0, 'rosters'],
  [0, 'players'],
  [0, 'ranking-sources'],
  [-1, 'league'],
  [-1, 'standings'],
];

/** Load the feeds and return planSchedule's `readFeed`. A missing or unreadable feed reads as null. */
const loadFeedReader = async (dataPath: string, year: number) => {
  const loaded = new Map<string, any>();
  await Promise.all(
    PLAN_FEEDS.map(async ([offset, feed]) => {
      const y = year + offset;
      const value = await loadLeagueData(leagueFeedPath(dataPath, y, `${feed}.json`)).catch(() => null);
      loaded.set(`${y}/${feed}`, value);
    }),
  );
  return (y: number, feed: string): any => {
    const key = `${y}/${feed}`;
    if (!loaded.has(key)) {
      // A feed planSchedule started reading that PLAN_FEEDS does not list.
      console.warn(`[schedule-plan] feed ${key} was not preloaded; add it to PLAN_FEEDS`);
      return null;
    }
    return loaded.get(key);
  };
};

/**
 * Colouring iterations this route can afford. The full search is ~150k and takes
 * about as long as the whole request budget, so a preview cannot run it.
 */
const PREVIEW_COLORING_ITERATIONS = 8000;

/** Player values for the projected-starter bye model. Shared across leagues. */
const readRankingSources = (year: number): Promise<any> =>
  loadLeagueData(`data/ranking-sources/${year}.json`).catch(() => null);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ request, url }) => {
  const user = getAuthUser(request);
  if (!user || !isCommissionerOrAdmin(user)) return json({ error: 'Not authorized' }, 401);

  const slug = url.searchParams.get('league') ?? '';
  const league = getLeagueBySlug(slug);
  if (!league || !SCHEDULE_POLICY[slug]) {
    return json({ error: `No scheduling policy for league "${slug}"` }, 400);
  }
  // A commissioner of one league must not plan another's schedule. The slug is
  // checked against the session, never trusted as an input on its own.
  if (!isAuthorizedForLeague(user, league.id)) return json({ error: 'Not authorized for this league' }, 401);

  const year = Number(url.searchParams.get('year'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return json({ error: 'year must be a four-digit season' }, 400);
  }

  const byes = byeWeeksForSeason(year);
  if (!byes) {
    return json(
      {
        error: `No NFL bye calendar stored for ${year}. Run: node scripts/fetch-nfl-bye-weeks.mjs ${year}`,
      },
      409,
    );
  }

  // Which construction to use. A league's policy picks the default; the param
  // only lets a commissioner see the other one before choosing, so an unknown
  // value is rejected rather than silently falling back.
  const mode = url.searchParams.get('mode') ?? undefined;
  if (mode && mode !== 'simple' && mode !== 'constructive') {
    return json({ error: `mode must be "simple" or "constructive"` }, 400);
  }

  try {
    const [readFeed, rankingSources] = await Promise.all([
      loadFeedReader(league.dataPath, year),
      readRankingSources(year),
    ]);
    const plan = planSchedule({
      slug,
      year,
      byes,
      mode,
      // Player values for the projected-starter bye model. Shared across
      // leagues, so it does not come through readFeed (which is scoped to one
      // league's mfl-feeds directory). Null degrades to whole-roster counts.
      rankingSources,
      readFeed,
      // Bounded for the function's 30s ceiling. The colouring refinement needs
      // ~150k iterations to clear the structured seed's local optimum and that
      // alone takes ~30s, so this preview gets a fraction of it and returns at
      // or near the structured seed. The CLI and the release cron run the full
      // search and will generally produce a DIFFERENT schedule — which is why
      // the response says so and the page refuses to present this as pasteable.
      search: { restarts: 6, iterations: 12000, coloringIterations: PREVIEW_COLORING_ITERATIONS, coloringRestarts: 1 },
    });
    // `weeks` is a Map and carries nothing the client needs beyond the text and
    // the per-week summary already in `plan.plan.byWeek`.
    const { weeks, ...rest } = plan;
    void weeks;
    return json({
      ...rest,
      // The page needs to know this is not the draw the cron will lock.
      preview: { coloringIterations: PREVIEW_COLORING_ITERATIONS, full: false },
    });
  } catch (err: any) {
    return json({ error: err?.message ?? 'Could not generate a schedule' }, 500);
  }
};
