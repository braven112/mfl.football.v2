/**
 * GET/PUT /api/admin/branding?league=<slug>
 *
 * The commissioner branding editor's back end. GET returns every team's
 * editable identity as currently PUBLISHED, plus any edits still on their way
 * to the site. PUT validates one team's edit and dispatches
 * .github/workflows/branding-edit.yml, which commits it; the next deploy
 * carries it everywhere (~2-3 minutes). Branding is read at build time in
 * hundreds of places, so the committed config stays the single source of
 * truth — there is deliberately no live override.
 *
 * Who: the league's commissioner, or a platform admin for any league
 * (src/utils/league-admin.ts). Where: only a league with
 * `features.brandingEditor` on.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { resolveAdministeredLeague } from '../../../utils/league-admin';
import type { LeagueDefinition } from '../../../config/leagues';
import { getLeagueTeamConfigs } from '../../../utils/league-team-brands';
import { getRedis } from '../../../utils/redis-client';
import { dispatchWorkflow } from '../../../utils/workflow-dispatch';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { EDITABLE_FIELDS, BRANDING_LIMITS, validateBrandingEdit } from '../../../utils/branding-edit.mjs';

export const prerender = false;

/** Edits in flight, by franchise. Cleared once the published config matches. */
const pendingKey = (slug: string) => `branding:pending:${slug}`;
const PENDING_TTL_SEC = 24 * 60 * 60;

type Gate = { ok: true; league: LeagueDefinition; by: string } | { ok: false; response: Response };

function gate(request: Request, url: URL): Gate {
  const user = getAuthUser(request);
  const resolved = resolveAdministeredLeague(user, url.searchParams.get('league'));
  const fail = (status: number, error: string) => ({
    ok: false as const,
    response: json({ ok: false, error, errors: [error] }, status, JSON_HEADERS_NO_STORE),
  });
  if (!resolved.ok) return fail(resolved.status, resolved.error);
  if (!resolved.league.features.brandingEditor) return fail(403, 'The branding editor is not turned on for this league.');
  return { ok: true, league: resolved.league, by: user?.name ?? 'unknown' };
}

/** The editable slice of each team, as published. */
function publishedTeams(slug: string) {
  return getLeagueTeamConfigs(slug).map((t: Record<string, unknown>) => {
    const out: Record<string, unknown> = { franchiseId: t.franchiseId, division: t.division ?? '' };
    for (const f of EDITABLE_FIELDS) if (t[f] !== undefined) out[f] = t[f];
    return out;
  });
}

type Pending = { edit: Record<string, unknown>; at: number; by: string };

function parsePending(raw: unknown): Pending | null {
  const v = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  return v && typeof v === 'object' && (v as Pending).edit ? (v as Pending) : null;
}

/** An edit has landed once every field it set reads back from the published config. */
function landed(edit: Record<string, unknown>, team: Record<string, unknown> | undefined): boolean {
  if (!team) return false;
  return Object.entries(edit).every(([k, v]) =>
    v === null ? team[k] === undefined : JSON.stringify(team[k]) === JSON.stringify(v),
  );
}

export const GET: APIRoute = async ({ request, url }) => {
  const g = gate(request, url);
  if (!g.ok) return g.response;
  const teams = publishedTeams(g.league.slug);
  const byId = new Map(teams.map((t) => [t.franchiseId as string, t]));

  const pending: Record<string, Pending> = {};
  const redis = await getRedis();
  if (redis) {
    const all = ((await redis.hgetall(pendingKey(g.league.slug)).catch(() => null)) ?? {}) as Record<string, unknown>;
    for (const [fid, raw] of Object.entries(all)) {
      const p = parsePending(raw);
      if (!p) continue;
      if (landed(p.edit, byId.get(fid))) {
        await redis.hdel(pendingKey(g.league.slug), fid).catch(() => undefined);
      } else pending[fid] = p;
    }
  }
  return json({ ok: true, league: g.league.slug, teams, pending, limits: BRANDING_LIMITS }, 200, JSON_HEADERS_NO_STORE);
};

export const PUT: APIRoute = async ({ request, url }) => {
  const g = gate(request, url);
  if (!g.ok) return g.response;

  let body: { franchiseId?: unknown; edit?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, errors: ['Body must be JSON.'] }, 400, JSON_HEADERS_NO_STORE);
  }
  const franchiseId = typeof body.franchiseId === 'string' ? body.franchiseId : '';
  const current = getLeagueTeamConfigs(g.league.slug).find((t: Record<string, unknown>) => t.franchiseId === franchiseId);
  if (!current) return json({ ok: false, errors: ['Unknown team.'] }, 400, JSON_HEADERS_NO_STORE);

  const checked = validateBrandingEdit(body.edit as Record<string, unknown>, { leagueSlug: g.league.slug, current });
  if (!checked.ok) return json({ ok: false, errors: checked.errors }, 400, JSON_HEADERS_NO_STORE);

  const res = await dispatchWorkflow('branding-edit.yml', {
    inputs: {
      league: g.league.slug,
      franchise: franchiseId,
      patch: JSON.stringify(checked.patch),
      requested_by: g.by,
    },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    return json(
      { ok: false, errors: [(detail as { error?: string }).error ?? 'Could not start publishing — try again.'] },
      502,
      JSON_HEADERS_NO_STORE,
    );
  }

  const pending: Pending = { edit: checked.patch, at: Date.now(), by: g.by };
  const redis = await getRedis();
  if (redis) {
    await redis.hset(pendingKey(g.league.slug), { [franchiseId]: JSON.stringify(pending) }).catch(() => undefined);
    await redis.expire(pendingKey(g.league.slug), PENDING_TTL_SEC).catch(() => undefined);
  }
  return json({ ok: true, franchiseId, pending }, 200, JSON_HEADERS_NO_STORE);
};
