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
import { getLeagueTeamBrands } from '../../utils/league-team-brands';
import { getThrowbackFranchiseBrand } from '../../utils/franchise-brand';
import { DEFAULT_THROWBACK_ERA } from '../../data/theleague/throwback-config';
// @ts-expect-error - .mjs helper shared with the node scripts (see its header)
import { THROWBACK_REASON } from '../../utils/schedule-release.mjs';
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
    // MFL stores a few franchise names with stray leading space.
    name[f.id] = String(f.name ?? '').trim();
    divisionOf[f.id] = divisionName[String(f.division)] ?? String(f.division);
    conferenceOf[f.id] = divisionConference[String(f.division)] ?? '00';
  }
  return { meta, name, divisionOf, conferenceOf, lastWeek: Number(meta.lastRegularSeasonWeek) };
};


/**
 * Old-school brands for the Throwback Week marquee pick, or null.
 *
 * TheLeague is the only league that runs Throwback Week today, and
 * `getThrowbackFranchiseBrand` reads its config directly — so this is gated on
 * the registry's `throwbackWeeks` rather than a slug test, and returns null
 * everywhere else instead of resolving a franchise id against the wrong
 * league's teams.
 */
const throwbackBrands = (slug: string, _leagueId: string, release: any) => {
  const weeks = getLeagueBySlug(slug)?.throwbackWeeks;
  if (!weeks?.length) return null;
  const pick = (release?.marquee ?? []).find((m: any) => m.why?.includes(THROWBACK_REASON));
  if (!pick) return null;
  const brandOf = (id: string) => {
    const b = getThrowbackFranchiseBrand(id, true, DEFAULT_THROWBACK_ERA[id]);
    // No dark variant: `getThrowbackFranchiseBrand` deliberately clears the
    // *Dark colors when it swaps in an era palette, because those belong to the
    // CURRENT brand and eras have none. The one colour is used in both themes.
    return {
      name: b.name,
      icon: b.icon ?? '',
      colorPrimary: b.colorPrimary ?? b.color,
    };
  };
  return { week: pick.week, away: brandOf(pick.away), home: brandOf(pick.home) };
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
      // Whether this league plays a cross-conference round. The page needs it
      // to state the constraints correctly — that round's fixed Week 1 slot is
      // the reason the AFL's bye-free division ceiling is short of its whole
      // schedule, and The League has no such clause. Sent from the policy
      // rather than inferred client-side, so no league literal reaches the
      // browser bundle.
      crossConference: Boolean(SCHEDULE_POLICY[slug as keyof typeof SCHEDULE_POLICY]?.crossConference),
      // Crests + brand colours for the marquee cards. Sent alongside the
      // archived reveal rather than baked into it: the reveal is a COMMITTED
      // record of a season's games and must not go stale the day a franchise
      // rebrands. Names in `release.marquee` are the ones the draw was made
      // under; these are how the team looks today.
      teams: getLeagueTeamBrands(slug),
      // Throwback Week's old-school identities for the one marquee game played
      // in them. Resolved from the COMMISSIONER DEFAULT era, never an owner's
      // saved preference: the reveal is a league event and every owner has to
      // be looking at the same card. (An owner may still pick a different era
      // for the week itself — that is a live-scoring decision, months away.)
      throwback: throwbackBrands(slug, league.id, existing),
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
