/**
 * POST /api/demo/lead — the questionnaire on demo.mfl.football
 * (docs/plans/custom-site-demo.md, phase 3).
 *
 * Validates the answers, issues the prospect's private demo link on the spot,
 * keeps a copy of the lead in the demo's own Redis, and relays it — signed —
 * to the production site, which stores it and pushes the owner. A relay
 * failure never costs the prospect their link: the local copy is the record
 * and the failure is logged.
 *
 * Demo deployments only; 404 everywhere else.
 */
import type { APIRoute } from 'astro';
import { isDemoDeploy } from '../../../utils/deploy-environment';
import { createDemoLink, DEMO_START_PATH } from '../../../utils/demo-access';
import {
  isBotSubmission,
  matchDemo,
  newLeadId,
  RELAY_SECRET_ENV,
  SIGNATURE_HEADER,
  signRelayBody,
  validateQuestionnaire,
} from '../../../utils/demo-leads-core.mjs';
import { checkRateLimit } from '../../../utils/rate-limit';
import { getClientIdentity } from '../../../utils/client-ip';
import { getRedis } from '../../../utils/redis-client';
import { demoLeaguePaths, LEAGUES, leagueUrl } from '../../../config/leagues-data.mjs';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Five submissions an hour per client is plenty for a person and useless to a script. */
const MAX_PER_HOUR = 5;

const DEMO_LABELS: Record<string, string> = {
  dynasty: 'salary-cap dynasty',
  keeper: 'keeper',
  bigleague: 'large multi-conference',
  redraft: 'redraft and best-ball',
};

/** Where production receives leads. Overridable for a local end-to-end run. */
function relayUrl(): string {
  return process.env.DEMO_LEAD_RELAY_URL || leagueUrl(LEAGUES.theleague, '/api/demo-leads');
}

export const POST: APIRoute = async ({ request }) => {
  if (!isDemoDeploy()) return new Response(null, { status: 404 });

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ message: 'Send the form as JSON.' }, 400);
  }

  // A bot that filled the hidden field gets a quiet, useless success.
  if (isBotSubmission(input)) return json({ link: '/', note: '' });

  const identity = getClientIdentity(request);
  if (identity.client) {
    const { allowed } = await checkRateLimit('demo-lead', identity.client, MAX_PER_HOUR, 3600);
    if (!allowed) return json({ message: 'Too many requests — please try again later.' }, 429);
  }

  const result = validateQuestionnaire(input);
  if ('errors' in result) return json({ errors: result.errors }, 400);
  const lead = result.lead;

  const { wanted, path } = matchDemo(lead, Object.keys(demoLeaguePaths()));
  const leadId = newLeadId();
  let link;
  try {
    link = await createDemoLink({ label: `${lead.name} — ${lead.leagueName}`, leadId });
  } catch (err) {
    console.error('[demo-lead] could not issue a link:', err);
    return json({ message: 'We could not set up your demo just now — please try again shortly.' }, 503);
  }

  const origin = new URL(request.url).origin;
  const url = `${origin}/${path}${DEMO_START_PATH}?t=${link.token}`;
  const record = {
    id: leadId,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    token: link.token,
    link: url,
    wanted,
    path,
    ...lead,
  };

  // The demo's own copy first, so a relay failure loses nothing.
  const redis = await getRedis();
  await redis?.set(`demo-leads:${leadId}`, JSON.stringify(record)).catch(() => null);

  const secret = process.env[RELAY_SECRET_ENV];
  if (secret) {
    try {
      const body = JSON.stringify(record);
      const res = await fetch(relayUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [SIGNATURE_HEADER]: signRelayBody(body, secret) },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) console.error(`[demo-lead] relay answered ${res.status} for ${leadId}`);
    } catch (err) {
      console.error(`[demo-lead] relay failed for ${leadId}:`, err);
    }
  } else {
    console.error(`[demo-lead] ${RELAY_SECRET_ENV} is not set — lead ${leadId} kept on the demo only.`);
  }

  const note =
    wanted === path
      ? `We've opened the ${DEMO_LABELS[path]} demo — the closest fit to your league.`
      : `A ${DEMO_LABELS[wanted]} demo is on the way. In the meantime we've opened the ${DEMO_LABELS[path]} demo, which shows the same tools.`;
  return json({ link: url, note });
};
