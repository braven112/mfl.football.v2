/**
 * POST /api/newsletter/monthly-draft — drafts last month's newsletter in Kit.
 *
 * Called once a month by .github/workflows/newsletter-monthly-draft.yml with
 * the CRON_SECRET bearer. It builds the issue from the month's What's New
 * articles (src/utils/newsletter-issue.ts) and creates it in Kit as a DRAFT.
 * Nothing is sent: Brandon reads it in Kit, adds a line if he likes, and
 * presses send himself.
 *
 * Idempotent on the subject line, so a re-run or a manual dispatch never
 * leaves two drafts for one month. `?month=YYYY-MM` drafts a specific month;
 * `?dryRun=1` returns the issue without touching Kit.
 */
import type { APIRoute } from 'astro';
import whatsNew from '../../../data/whats-new.json';
import { getLeagueBySlug, leagueUrl } from '../../../config/leagues';
import { buildMonthlyIssue, previousMonth, type WhatsNewEntry } from '../../../utils/newsletter-issue';
import { createBroadcastDraft, isKitConfigured, listRecentBroadcasts } from '../../../utils/kit';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request, url }) => {
  const secret = process.env.CRON_SECRET;
  // Fail CLOSED on an unconfigured secret, same as api/cron/push-fanout.ts.
  if (!secret) return json({ error: 'Not configured' }, 503);
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const requested = url.searchParams.get('month');
  let target = previousMonth(new Date());
  if (requested) {
    const m = /^(\d{4})-(\d{2})$/.exec(requested);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return json({ error: 'month must be YYYY-MM' }, 400);
    target = { year: Number(m[1]), month: Number(m[2]) };
  }

  const league = getLeagueBySlug('theleague');
  if (!league) return json({ error: 'Source league missing from registry' }, 500);

  const issue = buildMonthlyIssue(
    whatsNew as WhatsNewEntry[],
    target.year,
    target.month,
    (id) => leagueUrl(league, `/whats-new/${id}`),
    (file) => leagueUrl(league, `/assets/whats-new/${file}`),
  );
  if (!issue) return json({ ok: true, skipped: 'no articles that month', ...target });
  if (url.searchParams.get('dryRun') === '1') return json({ ok: true, dryRun: true, issue });

  if (!isKitConfigured()) return json({ error: 'KIT_API_SECRET is not set' }, 503);

  const existing = await listRecentBroadcasts();
  if (!existing.ok) return json({ error: 'Could not list Kit broadcasts', kit: existing }, 502);
  if (existing.data.some((b) => b.subject === issue.subject)) {
    return json({ ok: true, skipped: 'draft already exists', subject: issue.subject });
  }

  const created = await createBroadcastDraft(issue);
  if (!created.ok) return json({ error: 'Kit rejected the draft', kit: created }, 502);
  return json({ ok: true, drafted: issue.subject, items: issue.items.length, broadcast: created.data.broadcast?.id });
};
