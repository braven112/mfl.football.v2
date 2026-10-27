import type { APIRoute } from 'astro';
import { appJson, requireOwnerLeague } from '../../../utils/live/owner-league';
import { MAX_QUEUE, saveDraftQueue } from '../../../utils/live/mfl-live-draft-actions';
import { checkRateLimit } from '../../../utils/rate-limit';

export const prerender = false;

/** Writes overwrite the owner's MFL list; keep them scarce, as /api/draft-list does. */
const WRITE_MAX = 30;
const WRITE_WINDOW_SECONDS = 300;

/**
 * Replace your MFL pre-draft list from the app's draft room, for any MFL league
 * the account is in. `{ playerIds, basedOn }`: nothing is written unless MFL
 * still holds `basedOn` (see `saveDraftQueue`).
 *
 * Outcomes the app has to render (saved, or changed on MFL with the list as it
 * is now) come back as 200 with `ok` deciding; a malformed request is a 400.
 */
export const POST: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;

  let body: { playerIds?: unknown; basedOn?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body || !Array.isArray(body.playerIds) || !Array.isArray(body.basedOn)) {
    return appJson({ ok: false, error: 'bad-request', message: 'Expected { playerIds, basedOn }.' }, 400);
  }
  if (body.playerIds.length > MAX_QUEUE) {
    return appJson({ ok: false, error: 'bad-request', message: `A list can’t be longer than ${MAX_QUEUE} players.` }, 400);
  }

  const limit = await checkRateLimit(
    'mfl-live-draft-queue',
    `${gate.league.leagueId}:${gate.league.franchiseId}`,
    WRITE_MAX,
    WRITE_WINDOW_SECONDS,
  );
  if (!limit.allowed) {
    return appJson({ ok: false, error: 'rate-limited', message: 'Too many changes in a row. Try again in a few minutes.' }, 429);
  }

  return appJson(await saveDraftQueue(gate.league, gate.user.id, { playerIds: body.playerIds, basedOn: body.basedOn }));
};
