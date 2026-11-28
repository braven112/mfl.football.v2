import type { APIRoute } from 'astro';
import type { MflLiveAppLeagueThemesResponse } from '../../../../packages/shared-types/src/mfl-live-app-themes';
import { appJson, listOwnerLeagues, requireAppUser } from '../../../utils/live/owner-league';
import { appLeagueThemesFor } from '../../../utils/live/app-league-themes';

export const prerender = false;

/**
 * The league themes the MFL Football app can offer this account: one per
 * league we run that the account has a team in (store-app plan decision 22).
 * An account with none gets `themes: []` and the app keeps black and red.
 */
export const GET: APIRoute = async ({ request }) => {
  const gate = requireAppUser(request);
  if (gate instanceof Response) return gate;

  const result = await listOwnerLeagues(gate.user);
  if (!result.ok) {
    return result.reason === 'signed-out'
      ? appJson({ ok: false, error: 'signed-out' }, 401)
      : appJson({ ok: false, error: 'themes-unavailable' } satisfies MflLiveAppLeagueThemesResponse, 503);
  }
  const themes = appLeagueThemesFor(result.leagues.map((l) => l.leagueId));
  return appJson({ ok: true, themes } satisfies MflLiveAppLeagueThemesResponse);
};
