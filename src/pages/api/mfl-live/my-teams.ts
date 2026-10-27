import type { APIRoute } from 'astro';
import type { MflLiveAppMyTeam, MflLiveAppMyTeamsResponse } from '../../../../packages/shared-types/src/mfl-live-app-teams';
import { appJson, listOwnerLeagues, requireAppUser } from '../../../utils/live/owner-league';

export const prerender = false;

/**
 * Every league and team the MFL Football app's account can act in — the
 * list behind the app's league switcher. Each entry's `leagueId` is what the
 * app sends back as `?league=` to the other `/api/mfl-live/*` endpoints,
 * which re-check it with `requireOwnerLeague`.
 */
export const GET: APIRoute = async ({ request }) => {
  const gate = requireAppUser(request);
  if (gate instanceof Response) return gate;

  const result = await listOwnerLeagues(gate.user);
  if (!result.ok) {
    return result.reason === 'signed-out'
      ? appJson({ ok: false, error: 'signed-out' }, 401)
      : appJson({ ok: false, error: 'teams-unavailable' } satisfies MflLiveAppMyTeamsResponse, 503);
  }
  // The host is where the server reads MFL from; the app has no use for it.
  const teams: MflLiveAppMyTeam[] = result.leagues.map(({ host: _host, ...team }) => team);
  return appJson({ ok: true, teams } satisfies MflLiveAppMyTeamsResponse);
};
