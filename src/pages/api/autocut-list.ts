/**
 * August Auto-Cut List API
 *
 * GET  /api/autocut-list — Load the authenticated franchise's saved cut list.
 *        → { data: AutocutList | null }
 * POST /api/autocut-list — Save the cut list: { year, playerIds }.
 *        → { success: true, data: AutocutList, credentialStored, credentialCapturedAt }
 *
 * Auth: session JWT only (getAuthUser). 401 without a session, 403 without a
 * franchise. Storage unconfigured → 503 (mirrors api/trades/drafts.ts).
 *
 * Save-time credential guarantee (step-up auth, plan decision #7): a save
 * only persists when the session's MFL cookie (user.id) is proven live RIGHT
 * NOW via the cheap authenticated read `export?TYPE=myleagues&JSON=1` (an
 * empty leagues object or any fetch failure = dead cookie). A dead/missing
 * cookie → 401 { requiresReauth: true } and nothing is persisted; the UI
 * opens the inline MFL re-login modal and retries. On success the list is
 * saved AND captureCredential() re-encrypts + stores the just-verified
 * cookie, so every saved cut list carries a credential verified at save time.
 *
 * The response NEVER includes credential material — only the capture
 * timestamp (for "credentials verified <date>" UI copy).
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { json as jsonResponse } from '../../utils/api-response';
import { getRedis } from '../../utils/redis-client';
import { getCutList, saveCutList, captureCredential } from '../../utils/autocut-storage';
import { getCurrentLeagueYear } from '../../utils/league-year';
import { mflFetch } from '../../utils/mfl-fetch';

/** Hard cap on saved list length (rosters top out well under this). */
const MAX_CUT_LIST_LENGTH = 40;
const PLAYER_ID_RE = /^\d{1,8}$/;

/**
 * Validate an MFL_USER_ID cookie with the cheap authenticated read.
 * MFL returns {"leagues":{}} for a dead cookie — an empty list, a non-OK
 * status, unparseable JSON, or a thrown fetch all count as invalid.
 */
async function isMflCookieLive(mflUserCookie: string, year: number): Promise<boolean> {
  try {
    const response = await mflFetch({
      url: `https://api.myfantasyleague.com/${year}/export?TYPE=myleagues&JSON=1`,
      method: 'GET',
      mflUserCookie,
    });
    if (!response.ok) return false;
    const data = await response.json().catch(() => null);
    const leagues = data?.myleagues?.league ?? data?.leagues?.league ?? [];
    const leagueList = Array.isArray(leagues) ? leagues : leagues ? [leagues] : [];
    return leagueList.length > 0;
  } catch {
    return false;
  }
}

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!user.franchiseId) return jsonResponse({ error: 'No franchise associated with session' }, 403);

  const redis = await getRedis();
  if (!redis) return jsonResponse({ data: null, error: 'Storage not configured' }, 503);

  const data = await getCutList(user.franchiseId);
  return jsonResponse({ data });
};

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!user.franchiseId) return jsonResponse({ error: 'No franchise associated with session' }, 403);

  // Validate the request before checking storage so malformed input gets a
  // 400 even when Redis is down (a bad request can never succeed anyway).
  let body: { year?: unknown; playerIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }

  // --- Validate year: must be the current league year (stale saves rejected)
  const currentYear = getCurrentLeagueYear();
  if (body.year !== currentYear) {
    return jsonResponse(
      { success: false, error: `year must be the current league year (${currentYear})` },
      400,
    );
  }

  // --- Validate playerIds: ordered array of MFL player id strings
  if (!Array.isArray(body.playerIds)) {
    return jsonResponse({ success: false, error: 'playerIds must be an array' }, 400);
  }
  if (body.playerIds.length > MAX_CUT_LIST_LENGTH) {
    return jsonResponse(
      { success: false, error: `playerIds must contain at most ${MAX_CUT_LIST_LENGTH} entries` },
      400,
    );
  }
  if (!body.playerIds.every(id => typeof id === 'string' && PLAYER_ID_RE.test(id))) {
    return jsonResponse({ success: false, error: 'playerIds must be MFL player id strings' }, 400);
  }
  // Dedupe silently, preserving first-occurrence (highest-priority) position.
  const playerIds = [...new Set(body.playerIds as string[])];

  const redis = await getRedis();
  if (!redis) return jsonResponse({ success: false, error: 'Storage not configured' }, 503);

  // --- Step-up auth: the save persists ONLY with a live-verified MFL cookie.
  if (!user.id || !(await isMflCookieLive(user.id, currentYear))) {
    return jsonResponse(
      {
        success: false,
        requiresReauth: true,
        error: 'Your MFL credential could not be verified. Log in again to save your cut list.',
      },
      401,
    );
  }

  const saved = await saveCutList(user.franchiseId, { year: currentYear, playerIds });
  if (!saved) {
    return jsonResponse({ success: false, error: 'Write failed' }, 500);
  }

  // Refresh the stored (encrypted) credential with the just-verified cookie.
  // captureCredential never throws; null means capture was skipped (e.g.
  // AUTOCUT_CRED_KEY unset) — surfaced via credentialStored so the UI /
  // rehearsal runs can flag franchises the deadline job can't execute.
  const credentialCapturedAt = await captureCredential(user.franchiseId, user.id);

  return jsonResponse({
    success: true,
    data: saved,
    credentialStored: credentialCapturedAt !== null,
    credentialCapturedAt,
  });
};
