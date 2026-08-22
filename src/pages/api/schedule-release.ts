/**
 * Schedule Release Day — the reveal endpoint. READ ONLY.
 *
 * Any signed-in member of the league gets either the countdown (before the
 * reveal) or the locked schedule with its marquee games.
 *
 * There is no POST. Revealing is done by the release cron, which generates,
 * validates and COMMITS the schedule — see scripts/lock-schedule-release.mjs.
 * An endpoint that could mint a reveal would have needed a shared secret to
 * guard it, and this repo is public, so that secret could not live here. The
 * commit is a better lock anyway: it cannot be evicted, it is reviewable, and
 * there is exactly one of it.
 *
 * Nothing here writes to MFL either — MFL has no schedule write API. It hands
 * back `WW,AAAA,HHHH` text for the commissioner to paste.
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { getAuthUser, isCommissionerOrAdmin, isAuthorizedForLeague } from '../../utils/auth';
import { getLeagueBySlug } from '../../config/leagues';
import { byeWeeksForSeason } from '../../utils/nfl-bye-weeks';
import { getRelease } from '../../utils/schedule-release-store';
// @ts-expect-error - .mjs helpers shared with the node scripts (see their headers)
import { SCHEDULE_POLICY } from '../../utils/schedule-plan.mjs';
// @ts-expect-error - .mjs helpers shared with the node scripts (see their headers)
import { releaseIsReady, scheduleReleaseDate } from '../../utils/schedule-release.mjs';

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
