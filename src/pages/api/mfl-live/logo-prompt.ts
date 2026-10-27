import type { APIRoute } from 'astro';
import { appJson, requireAppUser, requireOwnerLeague } from '../../../utils/live/owner-league';
import { buildTeamLogoPrompt, DEFAULT_LOGO_CHOICE, logoPromptOptions } from '../../../utils/team-logo-prompt';
import type { MflLiveAppLogoPrompt } from '../../../../packages/shared-types/src/mfl-live-app-logo';

export const prerender = false;

/**
 * The MFL Football app's team logo prompt builder (`src/utils/team-logo-prompt.ts`).
 *
 * GET  ?league=<id>  → the choices, the team's MFL name and a starter prompt.
 * POST {teamName, idea, style, colors, kind} → the prompt for those choices.
 *
 * Nothing here reaches MFL or an image model: it writes text. The GET is
 * gated by `requireOwnerLeague` because it reads the team's name from MFL; the
 * POST only needs a signed-in app user, since the name it draws is whatever
 * the owner typed, so a tap does not cost a round trip to MFL.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;

  const built = buildTeamLogoPrompt({ ...DEFAULT_LOGO_CHOICE, colors: [...DEFAULT_LOGO_CHOICE.colors] }, gate.league.franchiseName);
  const body: MflLiveAppLogoPrompt = {
    ok: true,
    teamName: gate.league.franchiseName,
    ...logoPromptOptions(),
    ...built,
  };
  return appJson(body);
};

export const POST: APIRoute = async ({ request }) => {
  const gate = requireAppUser(request);
  if (gate instanceof Response) return gate;

  let sent: unknown;
  try {
    sent = await request.json();
  } catch {
    return appJson({ ok: false, error: 'bad-request' }, 400);
  }
  if (!sent || typeof sent !== 'object') return appJson({ ok: false, error: 'bad-request' }, 400);

  const built = buildTeamLogoPrompt(sent as Record<string, unknown>, '');
  const body: MflLiveAppLogoPrompt = {
    ok: true,
    teamName: built.choice.teamName,
    ...logoPromptOptions(),
    ...built,
  };
  return appJson(body);
};
