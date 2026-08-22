/**
 * Schedule Release Day — the reveal endpoint.
 *
 *   GET   any signed-in member of the league. Returns either the countdown
 *         (before the reveal) or the locked schedule with its marquee games.
 *   POST  locks the reveal. Commissioner, or the release cron via
 *         SCHEDULE_RELEASE_TOKEN. First write wins.
 *
 * The lock is the point. Generating twice gives two different valid schedules
 * (simulated annealing), so without it every owner would see a different
 * season and the commissioner would paste one of them. See
 * src/utils/schedule-release-store.ts.
 *
 * This endpoint never writes to MFL — MFL has no schedule write API. It hands
 * back `WW,AAAA,HHHH` text for the commissioner to paste.
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { getAuthUser, isCommissionerOrAdmin, isAuthorizedForLeague } from '../../utils/auth';
import { getLeagueBySlug } from '../../config/leagues';
import { byeWeeksForSeason } from '../../utils/nfl-bye-weeks';
import { getRelease, lockRelease, type ScheduleRelease } from '../../utils/schedule-release-store';
// @ts-expect-error - .mjs helpers shared with the node scripts (see their headers)
import { planSchedule, SCHEDULE_POLICY } from '../../utils/schedule-plan.mjs';
// @ts-expect-error - .mjs helpers shared with the node scripts (see their headers)
import { marqueeMatchups, priorWinRates, releaseIsReady, scheduleReleaseDate } from '../../utils/schedule-release.mjs';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const readFeed = (dataPath: string, year: number, feed: string): any => {
  try {
    const file = path.join(process.cwd(), dataPath, 'mfl-feeds', String(year), `${feed}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
};

const readChampionship = (dataPath: string, year: number): any => {
  try {
    const file = path.join(process.cwd(), dataPath, 'championship-history.json');
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const all = raw?.championships ?? raw;
    return Object.values(all).find((c: any) => Number(c?.year) === year) ?? null;
  } catch {
    return null;
  }
};

const asArray = (v: any): any[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** Franchise/division/conference shape, and the display names the page needs. */
const seasonShape = (leagueJson: any) => {
  const meta = leagueJson?.league;
  if (!meta) return null;
  const divisionName: Record<string, string> = {};
  const divisionConference: Record<string, string> = {};
  for (const d of asArray(meta.divisions?.division)) {
    divisionName[d.id] = d.name;
    divisionConference[d.id] = d.conference;
  }
  const name: Record<string, string> = {};
  const divisionOf: Record<string, string> = {};
  const conferenceOf: Record<string, string> = {};
  for (const f of asArray(meta.franchises?.franchise)) {
    name[f.id] = f.name;
    divisionOf[f.id] = divisionName[String(f.division)] ?? String(f.division);
    conferenceOf[f.id] = divisionConference[String(f.division)] ?? '00';
  }
  return { meta, name, divisionOf, conferenceOf, lastWeek: Number(meta.lastRegularSeasonWeek) };
};

/** Season the reveal is FOR: the upcoming one, which is this calendar year. */
const releaseYear = (now: Date) => now.getUTCFullYear();

/** Build the record the lock will store. Throws if the schedule fails validation. */
const buildRelease = (slug: string, year: number): ScheduleRelease => {
  const league = getLeagueBySlug(slug)!;
  const byes = byeWeeksForSeason(year);
  if (!byes) throw new Error(`No NFL bye calendar stored for ${year}`);

  const plan = planSchedule({
    slug,
    year,
    byes,
    readFeed: (y: number, feed: string) => readFeed(league.dataPath, y, feed),
    search: { restarts: 6, iterations: 12000 },
  });
  if (plan.problems.length) {
    throw new Error(`generated schedule breaks ${plan.problems.length} rule(s): ${plan.problems.join('; ')}`);
  }

  const shape = seasonShape(readFeed(league.dataPath, year, 'league'))!;
  const winRate = priorWinRates(readFeed(league.dataPath, year - 1, 'standings')?.leagueStandings?.franchise);
  const marquee = marqueeMatchups(
    plan.weeks,
    {
      divisionOf: shape.divisionOf,
      conferenceOf: shape.conferenceOf,
      name: shape.name,
      winRate,
      lastChampionship: readChampionship(league.dataPath, year - 1),
      lastWeek: shape.lastWeek,
      doubleheaderWeeks: plan.doubleheaderWeeks,
    },
    4,
  );

  return {
    league: slug,
    year,
    revealedAt: new Date().toISOString(),
    text: plan.text,
    weeks: Object.fromEntries([...plan.weeks.entries()].sort((a: any, b: any) => a[0] - b[0])),
    doubleheaderWeeks: plan.doubleheaderWeeks,
    byeFreeWeeks: plan.byeFreeWeeks,
    marquee,
    summary: {
      games: plan.plan.games,
      byeFreeDivisionGames: plan.plan.byeFreeDivisionGames,
      divisionGameCeiling: plan.divisionGameCeiling.ceiling,
      netByeSpread: plan.plan.netByeSpread,
      homeGames: plan.plan.homeGames,
      minRematchGap: plan.plan.minRematchGap,
    },
  };
};

export const GET: APIRoute = async ({ request, url }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Sign in to see the schedule release' }, 401);

  const slug = url.searchParams.get('league') ?? '';
  const league = getLeagueBySlug(slug);
  if (!league || !SCHEDULE_POLICY[slug]) return json({ error: `No schedule release for "${slug}"` }, 400);
  // Every signed-in member of THIS league sees the reveal — it is a league
  // event, not an admin tool. Members of the other league do not.
  if (!isAuthorizedForLeague(user, league.id)) return json({ error: 'Not authorized for this league' }, 401);

  const now = new Date();
  const year = Number(url.searchParams.get('year')) || releaseYear(now);
  const releaseDate = scheduleReleaseDate(slug, year);
  const existing = await getRelease(slug, year);

  if (existing) {
    return json({
      state: 'revealed',
      leagueName: league.name,
      year,
      releaseDate: releaseDate?.toISOString() ?? null,
      canPaste: isCommissionerOrAdmin(user),
      release: existing,
    });
  }

  const ready = releaseIsReady(slug, year, now, byeWeeksForSeason(year));
  return json({
    state: 'countdown',
    leagueName: league.name,
    year,
    releaseDate: releaseDate?.toISOString() ?? null,
    // True once the date has passed and the bye calendar exists but the cron
    // has not locked yet — the page says "any moment now" rather than showing
    // a countdown that already hit zero.
    due: ready.ready,
    reason: ready.reason ?? null,
    canPaste: isCommissionerOrAdmin(user),
  });
};

export const POST: APIRoute = async ({ request, url }) => {
  const slug = url.searchParams.get('league') ?? '';
  const league = getLeagueBySlug(slug);
  if (!league || !SCHEDULE_POLICY[slug]) return json({ error: `No schedule release for "${slug}"` }, 400);

  // Two ways in: the release cron (shared token) or a league commissioner.
  // The token is checked first so the cron needs no session.
  const token = request.headers.get('x-schedule-release-token');
  const expected = process.env.SCHEDULE_RELEASE_TOKEN;
  const viaToken = Boolean(expected && token && token === expected);
  if (!viaToken) {
    const user = getAuthUser(request);
    if (!user || !isCommissionerOrAdmin(user) || !isAuthorizedForLeague(user, league.id)) {
      return json({ error: 'Not authorized' }, 401);
    }
  }

  const now = new Date();
  const year = Number(url.searchParams.get('year')) || releaseYear(now);

  const existing = await getRelease(slug, year);
  if (existing) return json({ status: 'already', release: existing });

  // The date guard applies to the cron, not to a commissioner: someone has to
  // be able to rehearse the reveal before release day.
  if (viaToken) {
    const ready = releaseIsReady(slug, year, now, byeWeeksForSeason(year));
    if (!ready.ready) return json({ status: 'not-yet', reason: ready.reason }, 409);
  }

  try {
    const outcome = await lockRelease(buildRelease(slug, year));
    if (outcome.status === 'unavailable') return json({ error: outcome.reason }, 503);
    return json({ status: outcome.status, release: outcome.release });
  } catch (err: any) {
    return json({ error: err?.message ?? 'Could not build the schedule' }, 500);
  }
};
