/**
 * August Auto-Cut Admin Controls (commissioner-gated)
 *
 * GET  /api/admin/autocut-control
 *        → { paused, pausedBy, pausedAt, year }
 * POST /api/admin/autocut-control
 *        { action: 'pause' }  → sets autocut:paused:{year} to JSON { by, at }
 *        { action: 'resume' } → deletes autocut:paused:{year}
 *        { action: 'manual-done', franchiseId, playerId }
 *          → appends a { type: 'manual-done', playerId, by, at } outcome to
 *            the franchise's autocut:snapshot:{year} entry (read-modify-write)
 *            so the commissioner's manual-cleanup tracking survives reloads.
 *        { action: 'retry-franchise', franchiseId }
 *          → HDELs the franchise's field from autocut:done:{year} so the next
 *            deadline tick reprocesses it from scratch (recovery after a
 *            belated owner login or an exhausted retry). Never touches cred keys.
 *
 * The paused flag's VALUE is informational only — the deadline job
 * (scripts/apply-august-cuts.mjs) treats ANY value as "halt everything",
 * so storing { by, at } JSON is backward-compatible with that contract.
 *
 * Auth: session JWT only; requires isCommissionerOrAdmin (401 no session,
 * 403 non-admin). Storage unconfigured → 503 (mirrors api/autocut-list.ts).
 *
 * SECURITY INVARIANT (plan custody rules — DO NOT WEAKEN): this route never
 * reads or writes `autocut:cred:*` keys, and no credential material ever
 * crosses the response boundary. tests/autocut-control.test.ts enforces it.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../utils/auth';
import { json as jsonResponse } from '../../../utils/api-response';
import { getRedis } from '../../../utils/redis-client';
import { getCurrentLeagueYear } from '../../../utils/league-year';
// Shared normalization (matches auth.ts / autocut-storage.ts): '1' and '0001'
// address the same records.
import { normalizeFranchiseId } from '../../../utils/franchise-id.mjs';

const PLAYER_ID_RE = /^\d{1,8}$/;

export const pausedKey = (year: number) => `autocut:paused:${year}`;
export const snapshotKey = (year: number) => `autocut:snapshot:${year}`;
export const doneKey = (year: number) => `autocut:done:${year}`;

export interface PausedState {
  paused: boolean;
  pausedBy: string | null;
  pausedAt: string | null;
}

/**
 * Parse whatever lives at autocut:paused:{year}. The job's contract is
 * "any value = paused", so an unparseable/legacy plain-string flag still
 * reads as paused — just without attribution.
 */
export function parsePausedValue(value: unknown): PausedState {
  if (value === null || value === undefined || value === '') {
    return { paused: false, pausedBy: null, pausedAt: null };
  }
  let record: unknown = value;
  if (typeof value === 'string') {
    try {
      record = JSON.parse(value);
    } catch {
      record = null;
    }
  }
  const rec = record as { by?: unknown; at?: unknown } | null;
  return {
    paused: true,
    pausedBy: typeof rec?.by === 'string' ? rec.by : null,
    pausedAt: typeof rec?.at === 'string' ? rec.at : null,
  };
}

function gate(request: Request): { user: NonNullable<ReturnType<typeof getAuthUser>> } | Response {
  const user = getAuthUser(request);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!isCommissionerOrAdmin(user)) return jsonResponse({ error: 'Commissioner access required' }, 403);
  return { user };
}

export const GET: APIRoute = async ({ request }) => {
  const gated = gate(request);
  if (gated instanceof Response) return gated;

  const redis = await getRedis();
  if (!redis) return jsonResponse({ error: 'Storage not configured' }, 503);

  const year = getCurrentLeagueYear();
  const state = parsePausedValue(await redis.get(pausedKey(year)));
  return jsonResponse({ ...state, year });
};

export const POST: APIRoute = async ({ request }) => {
  const gated = gate(request);
  if (gated instanceof Response) return gated;
  const { user } = gated;

  const redis = await getRedis();
  if (!redis) return jsonResponse({ success: false, error: 'Storage not configured' }, 503);

  let body: { action?: unknown; franchiseId?: unknown; playerId?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const year = getCurrentLeagueYear();
  const at = new Date().toISOString();

  if (body.action === 'pause') {
    const flag = { by: user.name, at };
    await redis.set(pausedKey(year), flag);
    return jsonResponse({ success: true, paused: true, pausedBy: flag.by, pausedAt: flag.at, year });
  }

  if (body.action === 'resume') {
    await redis.del(pausedKey(year));
    return jsonResponse({ success: true, paused: false, pausedBy: null, pausedAt: null, year });
  }

  if (body.action === 'retry-franchise') {
    // Commissioner recovery (item C3): clear one franchise's done-hash field so
    // the next deadline tick reprocesses it from scratch. Useful after the
    // owner belatedly logs in (heals a no-credential skip) or a genuine failure
    // exhausted its retries. Never touches autocut:cred:* — the security
    // invariant holds — and never clears the whole hash.
    if (typeof body.franchiseId !== 'string' || !body.franchiseId.trim()) {
      return jsonResponse({ success: false, error: 'franchiseId is required' }, 400);
    }
    const fid = normalizeFranchiseId(body.franchiseId);
    await redis.hdel(doneKey(year), fid);
    return jsonResponse({ success: true, action: 'retry-franchise', franchiseId: fid, year });
  }

  if (body.action === 'manual-done') {
    if (typeof body.franchiseId !== 'string' || !body.franchiseId.trim()) {
      return jsonResponse({ success: false, error: 'franchiseId is required' }, 400);
    }
    if (typeof body.playerId !== 'string' || !PLAYER_ID_RE.test(body.playerId)) {
      return jsonResponse({ success: false, error: 'playerId must be an MFL player id string' }, 400);
    }
    const fid = normalizeFranchiseId(body.franchiseId);
    const playerId = body.playerId;

    const snapshot = (await redis.get<Record<string, unknown>>(snapshotKey(year))) as {
      franchises?: Record<string, { outcomes?: Array<Record<string, unknown>> }>;
    } | null;
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.franchises) {
      return jsonResponse(
        { success: false, error: `No execution snapshot for ${year} — nothing to annotate yet` },
        404,
      );
    }
    const entry = snapshot.franchises[fid];
    if (!entry || typeof entry !== 'object') {
      return jsonResponse({ success: false, error: `No snapshot entry for franchise ${fid}` }, 404);
    }

    const outcomes = Array.isArray(entry.outcomes) ? entry.outcomes : [];
    const alreadyDone = outcomes.some(
      (o) => o && o.type === 'manual-done' && o.playerId === playerId,
    );
    if (alreadyDone) {
      // Idempotent — the checkbox state is already durable.
      return jsonResponse({ success: true, alreadyDone: true });
    }

    // Append-only, immutable-style (mirrors august-cuts-logic.mjs#appendOutcome):
    // the frozen plan (markedList / rosterAtExecution / slate) is never modified.
    const outcome = { type: 'manual-done', playerId, by: user.name, at };
    snapshot.franchises[fid] = { ...entry, outcomes: [...outcomes, outcome] };
    await redis.set(snapshotKey(year), snapshot);

    return jsonResponse({ success: true, outcome });
  }

  return jsonResponse({ success: false, error: 'Unknown action' }, 400);
};
