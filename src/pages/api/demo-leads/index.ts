/**
 * POST /api/demo-leads — receives questionnaire leads relayed from the
 * custom-site demo (docs/plans/custom-site-demo.md, phase 3).
 *
 * Only a request signed with `DEMO_LEAD_RELAY_SECRET` (shared with the demo
 * deployment) is accepted. The lead is stored for the owner's admin page and
 * pushed to the owner's franchise. Never served by the demo itself.
 */
import type { APIRoute } from 'astro';
import { isDemoDeploy } from '../../../utils/deploy-environment';
import { RELAY_SECRET_ENV, SIGNATURE_HEADER, verifyRelaySignature } from '../../../utils/demo-leads-core.mjs';
import { saveDemoLead, type DemoLead } from '../../../utils/demo-leads-store';
import { sendPushToFranchise } from '../../../utils/push-sender';
import { getLeagueBySlug } from '../../../config/leagues';

/** The owner's franchise in TheLeague — where a new lead is announced. */
export const DEMO_LEAD_NOTIFY_FRANCHISE = '0001';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const FORMATS: Record<string, string> = { dynasty: 'dynasty', keeper: 'keeper', redraft: 'redraft', bestball: 'best ball' };

export const POST: APIRoute = async ({ request }) => {
  if (isDemoDeploy()) return new Response(null, { status: 404 });
  const body = await request.text();
  if (!verifyRelaySignature(body, request.headers.get(SIGNATURE_HEADER), process.env[RELAY_SECRET_ENV])) {
    return json({ message: 'Unsigned or expired request.' }, 401);
  }
  let lead: DemoLead;
  try {
    lead = JSON.parse(body);
  } catch {
    return json({ message: 'Bad JSON.' }, 400);
  }
  if (!lead?.id || !lead.token || !lead.email) return json({ message: 'Incomplete lead.' }, 400);

  if (!(await saveDemoLead({ ...lead, source: lead.source ?? 'questionnaire' }))) {
    return json({ message: 'Lead storage unavailable.' }, 503);
  }

  const league = getLeagueBySlug('theleague')!;
  const size = lead.teams ? `${lead.teams}-team ` : '';
  await sendPushToFranchise(
    league.id,
    DEMO_LEAD_NOTIFY_FRANCHISE,
    {
      title: 'New custom-site lead',
      body: `${lead.name} — ${lead.leagueName} (${size}${FORMATS[lead.format] ?? lead.format})`,
      url: '/admin/demo-leads',
      tag: `demo-lead-${lead.id}`,
    },
    'ops-demo-lead',
  ).catch((err) => console.error('[demo-leads] push failed:', err));

  return json({ stored: true });
};
