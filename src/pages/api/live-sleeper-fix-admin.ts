/**
 * Approve or reject a crowd player fix — the admin half of `player-fixes.ts`.
 *
 * Gated exactly like `/live/analytics` (`canViewSiteInsights`): one viewer,
 * the site's own admin. Anyone else is sent to the board. A plain form posts
 * here and is sent back to `/live/player-fixes` with `?done=` (303).
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { canViewSiteInsights } from '../../utils/site-insights';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { loadMflPlayerIndex } from '../../utils/sleeper/players';
import { MFL_PLAYER_ID, SLEEPER_PLAYER_ID, approvePlayerFix, rejectPlayerFix } from '../../utils/sleeper/player-fixes';

export const prerender = false;

const to = (location: string) =>
  new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });


export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!canViewSiteInsights(user)) return to('/live');

  const form = await request.formData().catch(() => null);
  const action = String(form?.get('action') ?? '');
  const sid = String(form?.get('sid') ?? '');
  const mfl = String(form?.get('mfl') ?? '');
  if (!SLEEPER_PLAYER_ID.test(sid) || !MFL_PLAYER_ID.test(mfl)) return to('/live/player-fixes?done=invalid');

  if (action === 'approve') {
    if (!loadMflPlayerIndex(getCurrentSeasonYear()).has(mfl)) return to('/live/player-fixes?done=invalid');
    return to(`/live/player-fixes?done=${(await approvePlayerFix(sid, mfl)) ? 'approved' : 'error'}`);
  }
  if (action === 'reject') {
    return to(`/live/player-fixes?done=${(await rejectPlayerFix(sid, mfl)) ? 'rejected' : 'error'}`);
  }
  return to('/live/player-fixes?done=invalid');
};
