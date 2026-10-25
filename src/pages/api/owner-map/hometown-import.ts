/**
 * Owner Map — the commissioner's paste-in import of many hometowns at once.
 *
 * POST /api/owner-map/hometown-import?league=<slug>
 *   { text, franchiseIds }  → saves every line, or nothing
 *
 * `text` is one team per line, `<franchise id> <place>` (see
 * parseHometownImport). `franchiseIds` is the page's own team list, used only
 * to refuse an id the league does not have; it can only narrow what is saved.
 * All or nothing: a list with any bad line saves none of it and says which
 * lines, so a commissioner fixes the list rather than guessing what landed.
 *
 * Commissioner only, for the session's own league; `?league=` is a check,
 * never an input (both leagues have a franchise 0001).
 */
import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdminForLeague } from '../../../utils/auth';
import { getLeagueById } from '../../../config/leagues';
import { handledFailure, json, unauthorized } from '../../../utils/api-response';
import { parseHometownImport, writeHometowns } from '../../../utils/owner-hometowns';

export const prerender = false;

const MAX_CHARS = 20_000;

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return unauthorized({ success: false, message: 'Sign in to import hometowns.' });
  const league = user.leagueId ? getLeagueById(user.leagueId) : null;
  if (!league) return unauthorized({ success: false, message: 'This session has no recognized league.' });
  const requested = new URL(request.url).searchParams.get('league');
  if (requested && requested !== league.slug) {
    return unauthorized({ success: false, message: `You're signed in to a different league than this page.` });
  }
  if (!isCommissionerOrAdminForLeague(user, league.id)) {
    return json({ success: false, message: 'Only the commissioner can import hometowns.' }, 403);
  }

  let body: { text?: unknown; franchiseIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: 'Bad request.' }, 400);
  }
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) return json({ success: false, message: 'Paste the list first.' }, 400);
  if (text.length > MAX_CHARS) return json({ success: false, message: 'That list is too long.' }, 400);
  const known = Array.isArray(body.franchiseIds)
    ? new Set(body.franchiseIds.filter((id): id is string => typeof id === 'string'))
    : null;

  const { rows, errors } = parseHometownImport(text, known ?? undefined);
  if (errors.length) return json({ success: false, message: 'Nothing was saved. Fix these lines first.', errors }, 400);

  try {
    const saved = await writeHometowns(league.slug, rows);
    if (!saved) return handledFailure('Hometowns can’t be saved right now. Try again later.', 503);
  } catch (err) {
    console.error('[owner-map] hometown import failed:', err);
    return handledFailure('Hometowns can’t be saved right now. Try again later.', 503);
  }
  return json({ success: true, saved: rows.length });
};
