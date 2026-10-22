/**
 * Ask Schefter about the old message board.
 *
 * POST /api/forum-archive/ask
 * Body: { question: string }
 * → a SchefterReport (ask-schefter.ts) with each card's `href` to the exact post.
 *   Every card's excerpt is verbatim from the database; only `take` is the
 *   model's own words, and the page labels it as opinion.
 *
 * Signed-in TheLeague owners only; rate-limited per franchise because every
 * call spends Claude tokens.
 */
import type { APIRoute } from 'astro';
import { forumArchiveAccess } from '../../../utils/forum-archive/archive-access';
import { loadForumArchive } from '../../../utils/forum-archive/forum-archive-store';
import { askSchefter, keywordReport, type SchefterReport } from '../../../utils/forum-archive/ask-schefter';
import { forumArchiveTopicPath } from '../../../utils/forum-archive/archive-paths';
import { checkRateLimit } from '../../../utils/rate-limit';
import { leagueClock } from '../../../config/leagues';

const RATE_LIMIT_MAX = 15;
const RATE_LIMIT_WINDOW = 3600;
const MAX_QUESTION = 500;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const access = forumArchiveAccess(request);
  if (!access.user) return json({ error: 'Sign in to ask about the archive.' }, 401);
  if (!access.member) return json({ error: 'The archive is for TheLeague owners.' }, 403);

  let question = '';
  try {
    const body = await request.json();
    question = typeof body?.question === 'string' ? body.question.trim() : '';
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }
  if (question.length < 3) return json({ error: 'Ask a question first.' }, 400);
  if (question.length > MAX_QUESTION) return json({ error: `Keep it under ${MAX_QUESTION} characters.` }, 400);

  const limit = await checkRateLimit(
    'forum-archive-ask',
    `${access.league.id}:${access.user.franchiseId}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW,
  );
  if (!limit.allowed) return json({ error: 'That is a lot of digging for one hour. Try again later.' }, 429);

  const load = await loadForumArchive();
  if (load.status === 'empty') return json({ error: 'The archive has not been loaded yet.' }, 404);
  if (load.status !== 'ok') return json({ error: 'Could not read the archive right now. Try again in a minute.' }, 503);

  const timeZone = leagueClock(access.league.slug).zone;
  let report: SchefterReport;
  try {
    report = await askSchefter(load.archive, question, { timeZone });
  } catch (e) {
    // The receipts never depended on the model — fall back to the owner's own words.
    console.error('[forum-archive/ask] AI search failed, using keyword search:', e);
    report = keywordReport(load.archive, question, timeZone);
  }
  return json({
    ...report,
    cards: report.cards.map((c) => ({ ...c, href: forumArchiveTopicPath(c.topicId, c.postId) })),
  });
};
