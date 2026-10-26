/**
 * Save MFL Live's TV settings (today: whether the viewer has NFL Sunday
 * Ticket). A plain HTML form posts here and is sent back to `/live/settings`
 * with a one-word outcome in `?tv=`, so it works without JavaScript and a
 * refresh never re-submits (303, not 200) — the Sleeper form's shape.
 *
 * POST only: it changes stored state. The session cookie is SameSite=Lax, so
 * another site's form cannot post here as the viewer. A paired TV's pass is
 * not accepted: the TV only reads this.
 */

import type { APIRoute } from 'astro';
import { getMflLiveUser } from '../../utils/auth';
import { setTvSettings } from '../../utils/mfl-live-tv-settings';

export const prerender = false;

const back = (outcome: string) =>
  new Response(null, {
    status: 303,
    headers: { Location: `/live/settings?tv=${outcome}#tv`, 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request }) => {
  const user = getMflLiveUser(request);
  if (!user) return back('signed-out');
  const form = await request.formData().catch(() => null);
  const sundayTicket = form?.get('sundayTicket') === 'on';
  return back((await setTvSettings(user, { sundayTicket })) ? 'saved' : 'error');
};
