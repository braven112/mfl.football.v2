/**
 * My Draft List API — pull from and push to MFL.
 *
 * GET  /api/draft-list           → the owner's live MFL board + last snapshot
 * POST /api/draft-list           → snapshot, then overwrite the MFL board
 * POST /api/draft-list?restore=1 → push the snapshot back
 *
 * Auth is the SESSION's own MFL cookie (`user.id`), the same credential the
 * roster-move endpoints use. That is not a preference: MFL's myDraftList
 * import refuses APIKEYs outright and exposes no FRANCHISE_ID, so there is no
 * commissioner path and no server-side path — a push only happens while its
 * owner is logged in. See src/utils/mfl-draft-list.ts.
 *
 * Every owner may use this for their OWN franchise. Unlike /api/cr this is not
 * admin-gated; the franchise is whoever the cookie belongs to, so an owner
 * cannot reach another owner's list even by asking.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getLeagueById } from '../../config/leagues';
import { getLeagueYearForSlug } from '../../utils/league-year';
import { rankingsScopeForLeagueId, scopedKvKey } from '../../utils/rankings-scope';
import { getRedis } from '../../utils/redis-client';
import { json, unauthorized } from '../../utils/api-response';
import { checkRateLimit } from '../../utils/rate-limit';
import { pullDraftList, pushDraftList, normalizePlayerIds } from '../../utils/mfl-draft-list';

/** A board is a few hundred ids; anything past this is not a real draft list. */
const MAX_PLAYERS = 1000;

/** Writes hit a third party and overwrite league data — keep them scarce. */
const WRITE_MAX_PER_WINDOW = 20;
const WRITE_WINDOW_SECONDS = 300;

interface Snapshot {
  playerIds: string[];
  takenAt: string;
}

/**
 * Resolve the caller, their league, and their snapshot key — or a Response.
 *
 * The league comes from the SESSION, never the request. `?league=` is a check
 * exactly as it is in kv-franchise-store: an owner logged into one league can
 * browse the other's page, and without the check that page's push would carry
 * their session cookie into the wrong league's board.
 */
function resolveContext(request: Request) {
  const user = getAuthUser(request);
  if (!user) return unauthorized({ error: 'Sign in to use your draft list.' });
  if (!user.franchiseId) return unauthorized({ error: 'This session has no franchise.' });

  const league = user.leagueId ? getLeagueById(user.leagueId) : null;
  if (!league) return unauthorized({ error: 'This session has no recognized league.' });

  const scope = rankingsScopeForLeagueId(user.leagueId);
  const requested = new URL(request.url).searchParams.get('league');
  if (requested && requested !== scope) {
    return unauthorized({ error: 'League mismatch.' });
  }

  return {
    user,
    league,
    year: getLeagueYearForSlug(league.slug),
    snapshotKey: scopedKvKey('dl:snapshot', scope, user.franchiseId),
  };
}

async function readSnapshot(key: string): Promise<Snapshot | null> {
  try {
    const redis = await getRedis();
    if (!redis) return null;
    const raw = (await redis.get(key)) as Snapshot | null;
    if (!raw || !Array.isArray(raw.playerIds)) return null;
    return raw;
  } catch (err) {
    console.error('[draft-list] snapshot read failed:', err);
    return null;
  }
}

/**
 * Store the board MFL held before we overwrote it.
 *
 * Best-effort by design: the push is what the owner asked for, and failing it
 * because our undo buffer is unavailable would be the worse outcome. The
 * caller is told whether the snapshot landed so the UI can say "no undo"
 * rather than imply one exists.
 */
async function writeSnapshot(key: string, playerIds: string[]): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) return false;
    await redis.set(key, { playerIds, takenAt: new Date().toISOString() } satisfies Snapshot);
    return true;
  } catch (err) {
    console.error('[draft-list] snapshot write failed:', err);
    return false;
  }
}

export const GET: APIRoute = async ({ request }) => {
  const ctx = resolveContext(request);
  if (ctx instanceof Response) return ctx;

  const result = await pullDraftList({
    league: ctx.league,
    year: ctx.year,
    mflUserCookie: ctx.user.id,
  });

  if (!result.ok) {
    return json({ ok: false, error: result.error ?? 'Could not read your MFL draft list.' }, 502);
  }

  return json({
    ok: true,
    playerIds: result.playerIds,
    snapshot: await readSnapshot(ctx.snapshotKey),
  });
};

export const POST: APIRoute = async ({ request }) => {
  const ctx = resolveContext(request);
  if (ctx instanceof Response) return ctx;

  const limit = await checkRateLimit(
    'draft-list-write',
    `${ctx.league.id}:${ctx.user.franchiseId}`,
    WRITE_MAX_PER_WINDOW,
    WRITE_WINDOW_SECONDS,
  );
  if (!limit.allowed) {
    return json({ ok: false, error: 'Too many draft list writes. Try again in a few minutes.' }, 429);
  }

  const restoring = new URL(request.url).searchParams.get('restore') === '1';

  let playerIds: string[];
  if (restoring) {
    const snapshot = await readSnapshot(ctx.snapshotKey);
    if (!snapshot || snapshot.playerIds.length === 0) {
      return json({ ok: false, error: 'No snapshot to restore.' }, 404);
    }
    playerIds = snapshot.playerIds;
  } else {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'Expected a JSON body.' }, 400);
    }
    const raw = (body as { playerIds?: unknown })?.playerIds;
    if (!Array.isArray(raw)) {
      return json({ ok: false, error: 'Expected { playerIds: string[] }.' }, 400);
    }
    if (raw.length > MAX_PLAYERS) {
      return json({ ok: false, error: `A draft list cannot exceed ${MAX_PLAYERS} players.` }, 400);
    }
    playerIds = normalizePlayerIds(raw);
    if (playerIds.length === 0) {
      return json({ ok: false, error: 'No valid MFL player ids in that list.' }, 400);
    }
  }

  // Snapshot what MFL holds RIGHT NOW, not what we last saw. The write is a
  // complete overwrite with no undo of its own, and the owner may have edited
  // the board on MFL since this page loaded.
  let snapshotSaved = false;
  if (!restoring) {
    const current = await pullDraftList({
      league: ctx.league,
      year: ctx.year,
      mflUserCookie: ctx.user.id,
    });
    // A failed READ before a destructive WRITE is a stop, not a warning: we
    // would be overwriting a board we could not capture.
    if (!current.ok) {
      return json(
        { ok: false, error: `Could not read your current MFL list, so nothing was overwritten. ${current.error ?? ''}`.trim() },
        502,
      );
    }
    if (current.playerIds.length > 0) {
      snapshotSaved = await writeSnapshot(ctx.snapshotKey, current.playerIds);
    } else {
      // Nothing to lose — an owner with no board yet needs no undo buffer.
      snapshotSaved = true;
    }
  }

  const result = await pushDraftList({
    league: ctx.league,
    year: ctx.year,
    mflUserCookie: ctx.user.id,
    playerIds,
  });

  if (!result.ok) {
    return json({ ok: false, error: result.error ?? 'MFL rejected the draft list.' }, 502);
  }

  return json({ ok: true, count: playerIds.length, snapshotSaved, restored: restoring });
};
