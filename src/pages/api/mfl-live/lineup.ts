/**
 * Set Lineup for the MFL Football app — any MFL league the signed-in account
 * is in (package J).
 *
 * GET  /api/mfl-live/lineup?league=<id>&week=<n>  → MflLiveAppLineup
 * POST /api/mfl-live/lineup?league=<id>  {week, starters[]} → submit to MFL
 *
 * The league comes from the request and is VERIFIED against the account's own
 * leagues by `requireOwnerLeague` before anything else; the team acted on is
 * the one MFL lists for this account there, never one from the request. The
 * write goes through `submitLineupToMfl` — the same helper as the site's
 * `/api/lineup` — with the owner's own cookie, never our env credentials.
 *
 * A POST is refused unless the server's own read of the week says a submit is
 * allowed: a week whose saved lineup we couldn't read must never be
 * overwritten from a phone holding a suggestion (docs/claude/rules/lineups.md).
 */

import type { APIRoute } from 'astro';
import { appJson, requireOwnerLeague } from '../../../utils/live/owner-league';
import { loadAppLineup, webHostOf } from '../../../utils/live/mfl-live-app-lineup';
import { parseLineupSubmission, submitLineupToMfl } from '../../../utils/lineup-write';
import { getLeagueById } from '../../../config/leagues';

export const prerender = false;

function parseWeek(raw: string | null): number | null | 'invalid' {
  if (raw === null || raw === '') return null;
  const week = Number(raw);
  return Number.isInteger(week) && week >= 1 && week <= 22 ? week : 'invalid';
}

export const GET: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;
  const week = parseWeek(url.searchParams.get('week'));
  if (week === 'invalid') return appJson({ error: 'Invalid week.' }, 400);
  try {
    return appJson(await loadAppLineup({ league: gate.league, ownerCookie: gate.user.id, week }));
  } catch (error) {
    console.error('[mfl-live/lineup] GET error:', error);
    return appJson({ error: 'Couldn’t load your lineup. Please try again.' }, 500);
  }
};

export const POST: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;
  const { user, league } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return appJson({ error: 'Invalid request body.' }, 400);
  }
  const week = (body as { week?: unknown })?.week;
  if (typeof week !== 'number' || !Number.isInteger(week) || week < 1 || week > 22) {
    return appJson({ error: 'Invalid lineup: must provide week (1-22).' }, 400);
  }

  // The server's own read of the week decides whether a submit is allowed,
  // and how many starters this league takes.
  let view;
  try {
    view = await loadAppLineup({ league, ownerCookie: user.id, week });
  } catch (error) {
    console.error('[mfl-live/lineup] POST read error:', error);
    return appJson({ error: 'Couldn’t check your lineup with MFL. Please try again.' }, 503);
  }
  if (!view.supported) {
    return appJson({ error: 'This league’s lineup rules can’t be set from the app yet. Use MFL’s site.' }, 422);
  }
  if (!view.canSubmit) {
    const error = view.mode === 'read-failed'
      ? 'Couldn’t read your saved lineup from MFL, so nothing was changed. Try again in a minute.'
      : 'This week’s lineup can’t be changed.';
    return appJson({ error, mode: view.mode }, 409);
  }

  const parsed = parseLineupSubmission(body, view.starterCount);
  if (!parsed.ok) return appJson({ error: parsed.error }, 400);
  // Only this team's own active players may start.
  const startable = new Set(view.players.filter((p) => p.canStart).map((p) => p.id));
  if (parsed.value.starters.some((id) => !startable.has(id))) {
    return appJson({ error: 'Every starter must be on your active roster.' }, 400);
  }

  const result = await submitLineupToMfl({
    ...parsed.value,
    leagueId: league.leagueId,
    year: league.year,
    ownerCookie: user.id,
    mflHost: webHostOf(league.host),
    irEligibleStatuses: getLeagueById(league.leagueId)?.irEligibleInjuryStatuses,
  });
  if (!result.ok) {
    const { ok: _ok, status, ...rest } = result;
    return appJson(rest, status);
  }
  return appJson({ success: true, message: 'Lineup submitted.' });
};
