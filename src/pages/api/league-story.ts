/**
 * POST /api/league-story — a new league's story intake, sent from /league-story.
 *   { invite, league, name?, email, platform?, answers: { [questionId]: text }, pasted?, website?: '' }
 *
 * INVITE ONLY (Brandon, 2026-11-08: "I don't want random people to fill it
 * out"): a submission without a live invite token is refused before anything
 * is stored (src/utils/league-story/invites.ts). A saved one pushes a
 * notification to the site owner ('ops-league-story').
 *
 * Keeps the submission in Redis (src/utils/league-story/submissions.ts) for the
 * admin list at /live/league-stories. Public and unauthenticated (a league is
 * onboarding before it has a site), so it is limited per caller on the address
 * our platform appends (which a caller cannot forge) as well as the client
 * address, capped site-wide per day, size-capped, and `website` is a honeypot
 * only a bot fills in. The email is required: onboarding needs a reply.
 */
import type { APIRoute } from 'astro';
import { getClientIdentity } from '../../utils/client-ip';
import { checkRateLimit } from '../../utils/rate-limit';
import { normalizeEmail } from '../../utils/season-video/kit-optin';
import { cleanSubmission, MAX_ANSWER_CHARS, MAX_PASTED_CHARS, saveSubmission } from '../../utils/league-story/submissions';
import { STORY_QUESTION_IDS } from '../../data/league-story-questions';
import { getInvite, markInviteSubmitted } from '../../utils/league-story/invites';
import { sendPushToFranchise } from '../../utils/push-sender';
import { getLeagueBySlug, SHARED_APP_ORIGIN } from '../../config/leagues';
import { INSIGHTS_OWNER } from '../../utils/site-insights-model';

export const prerender = false;

const HOUR = 3600;
const DAY = 86_400;
/** A league sends this once, maybe twice; past a handful an hour is a bot. */
export const STORY_LIMITS = { perClient: 5, perHop: 10, perDay: 50 } as const;
/** Every box full, plus the paste box, plus room for the JSON around them. */
const MAX_BODY_BYTES = (STORY_QUESTION_IDS.length * MAX_ANSWER_CHARS + MAX_PASTED_CHARS) * 4 + 4000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });

const SAVE_FAILED = 'We couldn’t save that just now. Your answers are still on the page, so try again in a bit.';

export const POST: APIRoute = async ({ request }) => {
  const { client, nearestHop } = getClientIdentity(request);
  if (nearestHop && !(await checkRateLimit('league-story-hop', nearestHop, STORY_LIMITS.perHop, HOUR)).allowed) {
    return json({ ok: false, message: 'That’s a lot of sends. Wait a bit and try again.' }, 429);
  }
  if (client && !(await checkRateLimit('league-story', client, STORY_LIMITS.perClient, HOUR)).allowed) {
    return json({ ok: false, message: 'That’s a lot of sends. Wait a bit and try again.' }, 429);
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return json({ ok: false, message: 'That’s too long to send in one go.' }, 413);
  let body: { invite?: unknown; league?: unknown; name?: unknown; email?: unknown; platform?: unknown; answers?: unknown; pasted?: unknown; website?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: 'Fill in a few answers first.' }, 400);
  }
  if (typeof body.website === 'string' && body.website.trim()) return json({ ok: true });
  const invite = await getInvite(body.invite).catch(() => null);
  if (!invite) return json({ ok: false, message: 'This form is by invitation. Use the link we sent you, or ask us for a new one.' }, 403);
  const email = normalizeEmail(body.email);
  if (!email) return json({ ok: false, message: 'Add an email we can reach you at, so we can follow up.' }, 400);
  const submission = cleanSubmission(body, email, new Date(), invite.token);
  if (!submission) return json({ ok: false, message: 'Add your league’s name and at least one answer.' }, 400);
  if (!(await checkRateLimit('league-story-all', 'all', STORY_LIMITS.perDay, DAY)).allowed) {
    return json({ ok: false, message: 'We’ve had a lot of these today. Try again tomorrow.' }, 429);
  }
  try {
    if (!(await saveSubmission(submission))) return json({ ok: false, message: SAVE_FAILED }, 503);
  } catch {
    return json({ ok: false, message: SAVE_FAILED }, 503);
  }
  await markInviteSubmitted(invite).catch(() => undefined);
  await notifyOwner(submission.league, submission.name).catch((err) => console.error('[league-story] push failed:', err));
  return json({ ok: true });
};

/** Tell the site owner a story came in (the same franchise that reads /live/league-stories). */
async function notifyOwner(league: string, name: string | null): Promise<void> {
  const owner = getLeagueBySlug(INSIGHTS_OWNER.leagueSlug);
  if (!owner) return;
  await sendPushToFranchise(
    owner.id,
    INSIGHTS_OWNER.franchiseId,
    {
      title: 'New league story',
      body: name ? `${league}, sent by ${name}` : league,
      // Absolute: the push lands on the owner's TheLeague browser, where a
      // bare /live path would be rewritten under /theleague and 404.
      url: new URL('/live/league-stories', SHARED_APP_ORIGIN).href,
      tag: 'league-story',
    },
    'ops-league-story',
  );
}
