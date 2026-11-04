/**
 * Vercel Cron → GitHub Actions bridge for the Schefter scan.
 *
 * The second bridge, built on the first (`api/cron/roster-sync.ts`) once that
 * one was proven in production. Same reason, same shape, different subject.
 *
 * ## Why the news feed needs this more than the rosters did
 *
 * GitHub drops this repo's `schedule` events in bulk — from 2026-08-27 the
 * scan's quarter-hourly schedule was delivered 5-8 times a day, measured at
 * 01:10, 22:52, 19:59, 16:58, 12:07, 06:36. Two things ride on that workflow
 * and neither tolerates a five-hour gap:
 *
 *  - **Roger's deadline reminders** (`scanEventReminders` in
 *    scripts/schefter-scan.mjs). They are push-first and held through quiet
 *    hours, so the first tick after 07:00 PT is the one that fires them. If
 *    that tick is delivered at noon, the reminder lands at noon.
 *  - **The Schefter feed itself**, which is genuinely build-baked. Rosters and
 *    transactions have a live MFL overlay to hide a missed sync behind; the
 *    feed has none, because it is authored by our own crons and written to
 *    committed JSON. There is no upstream to read it from — a scan that does
 *    not run is a feed that cannot move.
 *
 * ## Not every tick dispatches
 *
 * Vercel fires this on the same flat tick as the roster sync and
 * `sync-cadence.ts` decides which ones become dispatches — the SAME tiers, on
 * purpose: news breaks when rosters churn, so the waiver tail and the game
 * window are exactly the moments worth scanning hard, and the quiet hours in
 * between are worth an hourly look and nothing more.
 *
 * That matters here because a scan that finds something COMMITS, and every
 * commit to `main` is a production build (91% of the Vercel bill). It used to
 * commit whether it found something or not: two of the six files it writes
 * carried a per-run timestamp, so an empty scan still produced a one-line
 * diff. Both writers now skip an unchanged payload, which is what makes the
 * idle tier actually cheap rather than merely slower.
 *
 * Required env vars:
 *   CRON_SECRET   – shared secret Vercel sends as Bearer token
 *   GH_PAT        – GitHub personal access token with `actions:write` scope
 *   GH_REPO_OWNER – e.g. "braven112"
 *   GH_REPO_NAME  – e.g. "mfl.football.v2"
 */

import type { APIRoute } from 'astro';
import { dispatchWorkflow } from '../../../utils/workflow-dispatch';
import { syncCadenceDecision } from '../../../utils/sync-cadence';
import type { MflCalendarEvent } from '../../../utils/waiver-window';
import { listLeagueData, loadLeagueData } from '../../../utils/league-data';

/**
 * Every league's calendar and NFL schedule, so the cadence can see a waiver run
 * or a kickoff in EITHER league (see sync-cadence.ts § "Both leagues").
 *
 * Read through the league-data loader per request (cached while the instance
 * is warm), never a static import or a glob: these are cron-generated files, a
 * static specifier hard-fails the build for every league that does not have one
 * yet (CLAUDE.md / storage-and-build.md), and a glob compiles every league's
 * feeds into the function. The `*` covers the league directories so no slug is
 * hardcoded, and the current-era filter keeps it to the seasons that matter.
 */
const CURRENT_ERA_FEED = /\/mfl-feeds\/20(?:2[5-9]|[3-9]\d)\//;

async function loadCurrentEra(file: string): Promise<unknown[]> {
  const paths = listLeagueData(`data/*/mfl-feeds/*/${file}`).filter((p) => CURRENT_ERA_FEED.test(p));
  return Promise.all(paths.map((p) => loadLeagueData(p)));
}

async function loadCadenceInputs(): Promise<{ calendars: MflCalendarEvent[][]; kickoffs: string[] }> {
  const [calendarFeeds, scheduleFeeds] = await Promise.all([
    loadCurrentEra('calendar.json'),
    loadCurrentEra('nflSchedule.json'),
  ]);
  const calendars = calendarFeeds.filter((events): events is MflCalendarEvent[] => Array.isArray(events));
  // Flatten every league's matchup list down to the kickoff instants.
  const kickoffs: string[] = scheduleFeeds.flatMap((data) => {
    const matchups = (data as any)?.nflSchedule?.matchup;
    return Array.isArray(matchups) ? matchups.map((g: any) => g?.kickoff).filter(Boolean) : [];
  });
  return { calendars, kickoffs };
}

export const GET: APIRoute = async ({ request }) => {
  // Fail CLOSED on an unconfigured secret. Comparing straight against
  // `Bearer ${process.env.CRON_SECRET}` reads as a check but is not one when
  // the variable is missing: the template literal becomes the literal string
  // "Bearer undefined", which anyone may send — at a route that starts a
  // workflow which commits to main, posts to GroupMe and pushes to devices.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response(
      JSON.stringify({ error: 'CRON_SECRET not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Checked BEFORE the credentials, as in the roster sync: most ticks skip, and
  // a skip needs nothing to decide.
  const cadence = syncCadenceDecision(new Date(), await loadCadenceInputs());
  if (!cadence.dispatch) {
    return new Response(
      JSON.stringify({ skipped: true, ...cadence }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return dispatchWorkflow('schefter-scan.yml');
};
