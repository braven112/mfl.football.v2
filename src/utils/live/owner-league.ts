/**
 * Which league, as which team, an MFL Football app request may act in.
 *
 * Every "manage your team" endpoint for the app (`src/pages/api/mfl-live/*`:
 * lineups, players, waivers, trades, chat, the team page) takes the league
 * from the request — `?league=<MFL id>` — because the app serves ANY MFL
 * league the account is in, not just the ones this site runs. That id comes
 * from the phone, so it is a claim, never an input: it is only honoured when
 * the owner's OWN MFL account lists a team in that league, which is the same
 * check the league board makes (`/api/league-board?mfl=`, via
 * `discoverBoardLeagues`). An id can therefore only narrow what the session
 * may already see, never widen it.
 *
 * Those endpoints never call `getMflLiveUser` themselves. They call
 * `requireAppUser` / `requireOwnerLeague` here, which do, so the
 * `getMflLiveUser` allowlist (`tests/mfl-live-open-sign-in.test.ts`) carries
 * this one file instead of growing a line per endpoint, and
 * `tests/mfl-live-owner-league.test.ts` fails on any file under
 * `src/pages/api/mfl-live/` that does not go through it.
 *
 * What a caller gets back is the franchise MFL says this account owns in
 * that league. Use THAT franchise id, never one from the request: both of our
 * leagues have a franchise 0001, and so does every league on MFL.
 */

import type { AuthUser } from '../auth';
import { getMflLiveUser } from '../auth';
import { getLeagueYearForMflId, getLeagueYearForSlug } from '../league-year';
import { fetchMyLeagues } from '../my-leagues';
import { buildBoardLeagues } from '../broadcast-live-source';

/** One team the signed-in account owns, in one MFL league. */
export interface OwnerLeague {
  /** MFL league id. */
  leagueId: string;
  leagueName: string;
  /** 4-digit, zero-padded — the franchise MFL lists for THIS account. */
  franchiseId: string;
  franchiseName: string;
  /** The league's MFL league year (its own rollover clock when we run it). */
  year: number;
  /** `https://wwwNN.myfantasyleague.com` for the league's exports; null → the api host. */
  host: string | null;
}

export type OwnerLeaguesResult =
  | { ok: true; leagues: OwnerLeague[] }
  /** `signed-out`: MFL no longer accepts the account's cookie. */
  | { ok: false; reason: 'signed-out' | 'unavailable' };

/**
 * Every league this account owns a team in, for the app's league switcher.
 *
 * A league where the account has no franchise (a commissioner who does not
 * play) is left out: every screen this feeds acts AS a team.
 */
export async function listOwnerLeagues(user: AuthUser): Promise<OwnerLeaguesResult> {
  // MFL lists the leagues of the year whose directory it created — the
  // LEAGUE year, on TheLeague's clock, exactly as `discoverBoardLeagues` asks.
  const listYear = getLeagueYearForSlug('theleague');
  const mine = await fetchMyLeagues(user.id, listYear).catch(() => null);
  if (!mine) return { ok: false, reason: 'unavailable' };
  if (!mine.ok) return { ok: false, reason: mine.reason === 'dead-cookie' ? 'signed-out' : 'unavailable' };

  const leagues = buildBoardLeagues(mine.leagues, { leagueId: user.leagueId, franchiseId: user.franchiseId })
    .filter((l) => l.provider !== 'sleeper' && /^\d+$/.test(l.id) && /^\d{4}$/.test(l.franchiseId))
    .map((l) => ({
      leagueId: l.id,
      leagueName: l.name,
      franchiseId: l.franchiseId,
      franchiseName: l.franchiseName,
      // A league we run keeps its own clock (the AFL rolls June 1); any other
      // league is the year MFL just listed it under.
      year: l.registered ? getLeagueYearForMflId(l.id) : listYear,
      host: l.host,
    }));
  return { ok: true, leagues };
}

/** The account's team in `leagueId`, or null when it has none there. */
export async function resolveOwnerLeague(
  user: AuthUser,
  leagueId: string,
): Promise<{ ok: true; league: OwnerLeague | null } | Extract<OwnerLeaguesResult, { ok: false }>> {
  const all = await listOwnerLeagues(user);
  if (!all.ok) return all;
  return { ok: true, league: all.leagues.find((l) => l.leagueId === leagueId) ?? null };
}

/** The app's signed-in user, or the 401 to send. */
export function requireAppUser(request: Request): { user: AuthUser } | Response {
  const user = getMflLiveUser(request);
  return user ? { user } : appJson({ ok: false, error: 'signed-out' }, 401);
}

/**
 * The app's user and their team in the requested league, or the response to
 * send instead: 401 signed out, 400 no league named, 403 not this account's
 * league, 503 MFL did not answer.
 */
export async function requireOwnerLeague(
  request: Request,
  leagueId: string | null | undefined,
): Promise<{ user: AuthUser; league: OwnerLeague } | Response> {
  const gate = requireAppUser(request);
  if (gate instanceof Response) return gate;
  const id = `${leagueId ?? ''}`.trim();
  if (!/^\d+$/.test(id)) return appJson({ ok: false, error: 'league-required' }, 400);

  const found = await resolveOwnerLeague(gate.user, id);
  if (!found.ok) {
    return found.reason === 'signed-out'
      ? appJson({ ok: false, error: 'signed-out' }, 401)
      : appJson({ ok: false, error: 'teams-unavailable' }, 503);
  }
  if (!found.league) return appJson({ ok: false, error: 'not-your-league' }, 403);
  return { user: gate.user, league: found.league };
}

/** JSON for the app. Never cached: it is one owner's data. */
export function appJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
    },
  });
}
