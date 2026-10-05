/**
 * POST /api/admin/league-launcher/analyze   { mflId: "12345", year?: 2026 }
 *
 * Step 1 of the League Launcher: read the league's public MFL settings,
 * pre-tick the feature checkboxes by rule, then have Claude review the boxes
 * the rules cannot decide (src/utils/league-launcher.ts). Returns the draft
 * the Launcher page renders; nothing is written anywhere.
 *
 * Who: a platform admin only — launching a league is a site-level act, not
 * any one league's commissioner's. Rate-limited (LLM-backed, per CLAUDE.md).
 */
import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../../utils/auth';
import { isPlatformAdmin } from '../../../../utils/league-admin';
import { checkRateLimit } from '../../../../utils/rate-limit';
import { json, JSON_HEADERS_NO_STORE } from '../../../../utils/api-response';
import { draftFromMfl, fetchMflLeagueSettings, reviewWithClaude } from '../../../../utils/league-launcher';
import { ALL_LEAGUES } from '../../../../config/leagues';

export const prerender = false;

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = 3600;

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user || !isPlatformAdmin(user)) {
    return json({ ok: false, error: 'Only a platform admin can launch a league.' }, 403, JSON_HEADERS_NO_STORE);
  }

  let body: { mflId?: unknown; year?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Send JSON: { "mflId": "12345" }' }, 400, JSON_HEADERS_NO_STORE);
  }
  const mflId = String(body.mflId ?? '').trim();
  if (!/^\d{3,6}$/.test(mflId)) {
    return json({ ok: false, error: 'MFL league id must be 3–6 digits.' }, 400, JSON_HEADERS_NO_STORE);
  }
  const existing = ALL_LEAGUES.find((l) => l.id === mflId);
  if (existing) {
    return json({ ok: false, error: `That MFL league is already on the site as ${existing.name}.` }, 409, JSON_HEADERS_NO_STORE);
  }
  const year = Number(body.year) || new Date().getFullYear();

  const limit = await checkRateLimit('league-launcher', user.name ?? user.franchiseId ?? 'admin', RATE_LIMIT_MAX, RATE_LIMIT_WINDOW);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Too many analyses this hour.' }, 429, JSON_HEADERS_NO_STORE);
  }

  const fetched = await fetchMflLeagueSettings(mflId, year);
  if ('error' in fetched) return json({ ok: false, error: fetched.error }, 502, JSON_HEADERS_NO_STORE);

  const draft = draftFromMfl(mflId, fetched.league);
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ ok: true, draft: { ...draft, reviewSkipped: 'No ANTHROPIC_API_KEY on this deployment; the rules-only boxes stand.' } }, 200, JSON_HEADERS_NO_STORE);
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const reviewed = await reviewWithClaude(fetched.league, draft, client as never);
  return json({ ok: true, draft: reviewed }, 200, JSON_HEADERS_NO_STORE);
};
