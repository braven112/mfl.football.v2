import type { APIRoute } from 'astro';
import { appJson, requireOwnerLeague } from '../../../utils/live/owner-league';
import { makeDraftPick } from '../../../utils/live/mfl-live-draft-actions';
import { checkRateLimit } from '../../../utils/rate-limit';

export const prerender = false;

/** A real owner makes one pick per turn; this only stops a stuck button. */
const PICK_MAX = 10;
const PICK_WINDOW_SECONDS = 60;

/**
 * Make your pick from the app's draft room, for any MFL league the account is
 * in. `{ playerId, overall }`, where `overall` is the slot the app showed you
 * on the clock: the server re-reads the live board and refuses any other slot.
 *
 * Every outcome the app has to render (made, not your pick, taken, sent but
 * not yet on the board, MFL said no) is a 200 with `ok` and `error` deciding,
 * carrying the board as it is now where we could read it.
 */
export const POST: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;

  let body: { playerId?: unknown; overall?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body || body.playerId === undefined || body.overall === undefined) {
    return appJson({ ok: false, error: 'bad-request', message: 'Expected { playerId, overall }.' }, 400);
  }

  const limit = await checkRateLimit(
    'mfl-live-draft-pick',
    `${gate.league.leagueId}:${gate.league.franchiseId}`,
    PICK_MAX,
    PICK_WINDOW_SECONDS,
  );
  if (!limit.allowed) {
    return appJson({ ok: false, error: 'rate-limited', message: 'Too many tries in a minute. Check the board, then try again.' }, 429);
  }

  return appJson(await makeDraftPick(gate.league, gate.user.id, { playerId: body.playerId, overall: body.overall }));
};
