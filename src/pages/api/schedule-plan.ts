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
import fs from 'node:fs';
import path from 'node:path';
import { getAuthUser, isCommissionerOrAdmin, isAuthorizedForLeague } from '../../utils/auth';
import { getLeagueBySlug } from '../../config/leagues';
import { byeWeeksForSeason } from '../../utils/nfl-bye-weeks';
// @ts-expect-error - .mjs planner shared with the CLI scripts (see its header)
import { planSchedule, SCHEDULE_POLICY } from '../../utils/schedule-plan.mjs';

export const prerender = false;

/** Feeds live under data/<league>/mfl-feeds/<year>/. The newest three seasons
 *  ship into the serverless function (scripts/lib/archived-feed-files.mjs), so
 *  a request-time read of the current or prior season resolves. */
const readFeedFile = (dataPath: string, year: number, feed: string): any => {
  try {
    const file = path.join(process.cwd(), dataPath, 'mfl-feeds', String(year), `${feed}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** Player values for the projected-starter bye model. Shared across leagues. */
const readRankingSources = (year: number): any => {
  try {
    const file = path.join(process.cwd(), 'data', 'ranking-sources', `${year}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

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
    const plan = planSchedule({
      slug,
      year,
      byes,
      mode,
      // Player values for the projected-starter bye model. Shared across
      // leagues, so it does not come through readFeed (which is scoped to one
      // league's mfl-feeds directory). Null degrades to whole-roster counts.
      rankingSources: readRankingSources(year),
      readFeed: (y: number, feed: string) => readFeedFile(league.dataPath, y, feed),
      // Bounded so the request finishes inside the function's 30s ceiling.
      // Quality plateaus well before this; the structure does the heavy lifting.
      // Bounded for the function's 30s ceiling. The colouring refinement needs
      // ~150k iterations to clear the structured seed's local optimum and that
      // takes ~30s alone, so the admin preview gets a small budget and returns
      // at or near the seed. The CLI and the release cron run the full search.
      search: { restarts: 6, iterations: 12000, coloringIterations: 8000, coloringRestarts: 1 },
    });
    // `weeks` is a Map and carries nothing the client needs beyond the text and
    // the per-week summary already in `plan.plan.byWeek`.
    const { weeks, ...rest } = plan;
    void weeks;
    return json(rest);
  } catch (err: any) {
    return json({ error: err?.message ?? 'Could not generate a schedule' }, 500);
  }
};
