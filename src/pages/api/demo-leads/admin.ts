/**
 * POST /api/demo-leads/admin — the owner's link actions from
 * /theleague/admin/demo-leads (docs/plans/custom-site-demo.md, phase 3).
 *
 *   { action: 'extend', leadId, days }
 *   { action: 'revoke', leadId }
 *   { action: 'create', name, email, leagueName, days? }  — a link issued by hand
 *
 * Commissioner/admin sessions only. The demo's links live in the DEMO's
 * database, which production never holds credentials for, so each action is a
 * signed call to the demo's /api/demo/links; the lead record here is updated
 * to match.
 */
import type { APIRoute } from 'astro';
import { getAuthUser, isAuthorizedForLeague, isCommissionerOrAdmin } from '../../../utils/auth';
import { isDemoDeploy } from '../../../utils/deploy-environment';
import { newLeadId, RELAY_SECRET_ENV, SIGNATURE_HEADER, signRelayBody } from '../../../utils/demo-leads-core.mjs';
import { getDemoLead, saveDemoLead, type DemoLead } from '../../../utils/demo-leads-store';
import { getLeagueBySlug } from '../../../config/leagues';
import { DEMO_HOST } from '../../../config/leagues-data.mjs';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The demo's link API. Overridable for a local end-to-end run. */
const linksUrl = () => process.env.DEMO_LINKS_URL || `https://${DEMO_HOST}/api/demo/links`;

async function callDemo(cmd: Record<string, unknown>): Promise<{ ok: boolean; data: any }> {
  const secret = process.env[RELAY_SECRET_ENV];
  if (!secret) return { ok: false, data: { message: `${RELAY_SECRET_ENV} is not set on this deployment.` } };
  const body = JSON.stringify(cmd);
  try {
    const res = await fetch(linksUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [SIGNATURE_HEADER]: signRelayBody(body, secret) },
      body,
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } catch (err) {
    return { ok: false, data: { message: `Could not reach the demo: ${String(err)}` } };
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (isDemoDeploy()) return new Response(null, { status: 404 });
  const league = getLeagueBySlug('theleague')!;
  const user = getAuthUser(request);
  if (!user || !isAuthorizedForLeague(user, league.id) || !isCommissionerOrAdmin(user)) {
    return json({ message: 'Admins only.' }, 403);
  }
  let cmd: { action?: string; leadId?: string; days?: number; name?: string; email?: string; leagueName?: string };
  try {
    cmd = await request.json();
  } catch {
    return json({ message: 'Bad JSON.' }, 400);
  }
  const days = Number(cmd.days ?? 14);

  if (cmd.action === 'create') {
    const name = String(cmd.name ?? '').trim().slice(0, 80);
    const leagueName = String(cmd.leagueName ?? '').trim().slice(0, 120);
    if (!name || !leagueName) return json({ message: 'Name and league name are required.' }, 400);
    const leadId = newLeadId();
    const res = await callDemo({ action: 'create', label: `${name} — ${leagueName}`, days, leadId });
    if (!res.ok) return json(res.data, 502);
    const lead: DemoLead = {
      id: leadId,
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: res.data.expiresAt,
      token: res.data.token,
      link: res.data.link,
      wanted: 'dynasty',
      path: 'dynasty',
      name,
      email: String(cmd.email ?? '').trim().slice(0, 120),
      leagueName,
      leagueId: '',
      platform: '',
      format: '',
      draftType: '',
      teams: null,
      salaryCap: false,
      contracts: false,
      conferences: false,
      scoring: '',
      wishlist: '',
      heardFrom: '',
      source: 'manual',
    };
    await saveDemoLead(lead);
    return json({ lead });
  }

  const lead = await getDemoLead(String(cmd.leadId ?? ''));
  if (!lead) return json({ message: 'No such lead.' }, 404);

  if (cmd.action === 'extend') {
    const res = await callDemo({ action: 'extend', token: lead.token, days });
    if (!res.ok) return json(res.data, 502);
    const updated = { ...lead, expiresAt: res.data.expiresAt, revokedAt: undefined };
    await saveDemoLead(updated);
    return json({ lead: updated });
  }
  if (cmd.action === 'revoke') {
    const res = await callDemo({ action: 'revoke', token: lead.token });
    if (!res.ok) return json(res.data, 502);
    const updated = { ...lead, revokedAt: Math.floor(Date.now() / 1000) };
    await saveDemoLead(updated);
    return json({ lead: updated });
  }
  return json({ message: 'Unknown action.' }, 400);
};
