/**
 * POST /api/league-story — a new league's story intake, sent from /league-story.
 *   { league, name?, email, platform?, answers: { [questionId]: text }, pasted?, website?: '' }
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
  let body: { league?: unknown; name?: unknown; email?: unknown; platform?: unknown; answers?: unknown; pasted?: unknown; website?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: 'Fill in a few answers first.' }, 400);
  }
  if (typeof body.website === 'string' && body.website.trim()) return json({ ok: true });
  const email = normalizeEmail(body.email);
  if (!email) return json({ ok: false, message: 'Add an email we can reach you at, so we can follow up.' }, 400);
  const submission = cleanSubmission(body, email);
  if (!submission) return json({ ok: false, message: 'Add your league’s name and at least one answer.' }, 400);
  if (!(await checkRateLimit('league-story-all', 'all', STORY_LIMITS.perDay, DAY)).allowed) {
    return json({ ok: false, message: 'We’ve had a lot of these today. Try again tomorrow.' }, 429);
  }
  try {
    return (await saveSubmission(submission)) ? json({ ok: true }) : json({ ok: false, message: SAVE_FAILED }, 503);
  } catch {
    return json({ ok: false, message: SAVE_FAILED }, 503);
  }
};
