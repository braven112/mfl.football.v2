/**
 * POST /api/demo/links — link management for the owner's admin page on the
 * production site (docs/plans/custom-site-demo.md, phase 3).
 *
 * Production never holds the demo's database credentials; it sends a signed
 * command here instead (`DEMO_LEAD_RELAY_SECRET`, demo-leads-core.mjs):
 *
 *   { action: 'create', label, days?, leadId? }  → { link, token, expiresAt }
 *   { action: 'extend', token, days }            → { expiresAt }
 *   { action: 'revoke', token }                  → { revoked: true }
 *
 * Unsigned or stale requests are refused. Demo deployments only.
 */
import type { APIRoute } from 'astro';
import { isDemoDeploy } from '../../../utils/deploy-environment';
import { createDemoLink, DEMO_START_PATH, extendDemoLink, revokeDemoLink } from '../../../utils/demo-access';
import { RELAY_SECRET_ENV, SIGNATURE_HEADER, verifyRelaySignature } from '../../../utils/demo-leads-core.mjs';
import { demoLeaguePaths } from '../../../config/leagues-data.mjs';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  if (!isDemoDeploy()) return new Response(null, { status: 404 });
  const body = await request.text();
  if (!verifyRelaySignature(body, request.headers.get(SIGNATURE_HEADER), process.env[RELAY_SECRET_ENV])) {
    return json({ message: 'Unsigned or expired request.' }, 401);
  }
  let cmd: { action?: string; token?: string; days?: number; label?: string; leadId?: string; path?: string };
  try {
    cmd = JSON.parse(body);
  } catch {
    return json({ message: 'Bad JSON.' }, 400);
  }
  const days = Number(cmd.days ?? 14);
  if (!Number.isFinite(days) || days <= 0 || days > 90) return json({ message: 'days must be 1-90.' }, 400);

  switch (cmd.action) {
    case 'create': {
      const link = await createDemoLink({ label: String(cmd.label ?? 'Manual link'), days, leadId: cmd.leadId });
      const paths = Object.keys(demoLeaguePaths());
      const path = cmd.path && paths.includes(cmd.path) ? cmd.path : paths[0];
      const origin = new URL(request.url).origin;
      return json({ link: `${origin}/${path}${DEMO_START_PATH}?t=${link.token}`, token: link.token, expiresAt: link.expiresAt });
    }
    case 'extend': {
      const link = await extendDemoLink(String(cmd.token ?? ''), days);
      return link ? json({ expiresAt: link.expiresAt }) : json({ message: 'No such live link.' }, 404);
    }
    case 'revoke':
      return (await revokeDemoLink(String(cmd.token ?? ''))) ? json({ revoked: true }) : json({ message: 'No such link.' }, 404);
    default:
      return json({ message: 'Unknown action.' }, 400);
  }
};
