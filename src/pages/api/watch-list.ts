/**
 * My Watch List API — MFL's myWatchList behind a Redis mirror.
 *
 * GET  /api/watch-list            → the owner's list (mirror, refreshed from
 *                                    MFL when stale or on ?refresh=1)
 * POST /api/watch-list            → { add?: string[], remove?: string[] }
 *                                    written straight through to MFL, then
 *                                    the mirror is updated
 *
 * Auth is the SESSION's own MFL cookie (`user.id`), exactly as /api/draft-list:
 * MFL's myWatchList import refuses APIKEYs and exposes no FRANCHISE_ID, so the
 * franchise is whoever the cookie belongs to. Every owner may use this for
 * their OWN list and can reach nobody else's.
 *
 * Why write-through and not the draft list's pull/push buttons: MFL's watch
 * list import is incremental (ADD/REMOVE), so a click can be sent as exactly
 * the change the owner made and nothing on MFL is ever overwritten. The
 * mirror exists so reads feel instant and so server-side readers (Schefter
 * highlights, the push sender) can see the list without an owner cookie.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getLeagueById } from '../../config/leagues';
import { getLeagueYearForSlug } from '../../utils/league-year';
import { rankingsScopeForLeagueId } from '../../utils/rankings-scope';
import { json, unauthorized } from '../../utils/api-response';
import { checkRateLimit } from '../../utils/rate-limit';
import { pullWatchList, updateWatchList, normalizeWatchIds } from '../../utils/mfl-watch-list';
import { readWatchListMirror, writeWatchListMirror } from '../../utils/watch-list-store';

/** A mirror older than this is re-read from MFL on the next GET. */
const MIRROR_FRESH_SECONDS = 10 * 60;

/** Per change, not per list — the largest plausible click batch is small. */
const MAX_IDS_PER_WRITE = 100;

/** Writes hit MFL; a click per second for five minutes is more than any owner does. */
const WRITE_MAX_PER_WINDOW = 120;
const WRITE_WINDOW_SECONDS = 300;

function resolveContext(request: Request) {
  const user = getAuthUser(request);
  if (!user) return unauthorized({ error: 'Sign in to use your watch list.' });
  if (!user.franchiseId) return unauthorized({ error: 'This session has no franchise.' });

  const league = user.leagueId ? getLeagueById(user.leagueId) : null;
  if (!league) return unauthorized({ error: 'This session has no recognized league.' });

  // `?league=` is a CHECK, never an input — see /api/draft-list and
  // kv-franchise-store for why a cross-league page must be refused.
  const scope = rankingsScopeForLeagueId(user.leagueId);
  const requested = new URL(request.url).searchParams.get('league');
  if (requested && requested !== scope) {
    return unauthorized({ error: 'League mismatch.' });
  }

  return {
    user,
    league,
    year: getLeagueYearForSlug(league.slug),
    franchiseId: user.franchiseId,
  };
}

function isFresh(syncedAt: string): boolean {
  const t = Date.parse(syncedAt);
  return Number.isFinite(t) && Date.now() - t < MIRROR_FRESH_SECONDS * 1000;
}

export const GET: APIRoute = async ({ request }) => {
  const ctx = resolveContext(request);
  if (ctx instanceof Response) return ctx;

  const forceRefresh = new URL(request.url).searchParams.get('refresh') === '1';
  const mirror = await readWatchListMirror(ctx.league.slug, ctx.franchiseId);

  if (mirror && !forceRefresh && isFresh(mirror.syncedAt)) {
    return json({ ok: true, playerIds: mirror.playerIds, source: 'mirror', syncedAt: mirror.syncedAt });
  }

  const live = await pullWatchList({ league: ctx.league, year: ctx.year, mflUserCookie: ctx.user.id });
  if (live.ok) {
    await writeWatchListMirror(ctx.league.slug, ctx.franchiseId, live.playerIds);
    return json({ ok: true, playerIds: live.playerIds, source: 'mfl', syncedAt: new Date().toISOString() });
  }

  // MFL is down or refused us. A stale mirror is still the owner's list as
  // of their last visit — serve it and say so rather than blanking the page.
  if (mirror) {
    return json({
      ok: true,
      playerIds: mirror.playerIds,
      source: 'mirror-stale',
      syncedAt: mirror.syncedAt,
      warning: live.error ?? 'Could not refresh from MFL.',
    });
  }
  return json({ ok: false, error: live.error ?? 'Could not read your MFL watch list.' }, 502);
};

export const POST: APIRoute = async ({ request }) => {
  const ctx = resolveContext(request);
  if (ctx instanceof Response) return ctx;

  const limit = await checkRateLimit(
    'watch-list-write',
    `${ctx.league.id}:${ctx.franchiseId}`,
    WRITE_MAX_PER_WINDOW,
    WRITE_WINDOW_SECONDS,
  );
  if (!limit.allowed) {
    return json({ ok: false, error: 'Too many watch list changes. Try again in a few minutes.' }, 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Expected a JSON body.' }, 400);
  }
  const rawAdd = (body as { add?: unknown })?.add ?? [];
  const rawRemove = (body as { remove?: unknown })?.remove ?? [];
  if (!Array.isArray(rawAdd) || !Array.isArray(rawRemove)) {
    return json({ ok: false, error: 'Expected { add?: string[], remove?: string[] }.' }, 400);
  }
  if (rawAdd.length > MAX_IDS_PER_WRITE || rawRemove.length > MAX_IDS_PER_WRITE) {
    return json({ ok: false, error: `A single change cannot touch more than ${MAX_IDS_PER_WRITE} players.` }, 400);
  }
  const add = normalizeWatchIds(rawAdd);
  const removeSet = new Set(normalizeWatchIds(rawRemove));
  for (const id of add) removeSet.delete(id);
  const remove = [...removeSet];
  if (add.length === 0 && remove.length === 0) {
    return json({ ok: false, error: 'No valid MFL player ids to add or remove.' }, 400);
  }

  const write = await updateWatchList({
    league: ctx.league,
    year: ctx.year,
    mflUserCookie: ctx.user.id,
    add,
    remove,
  });
  if (!write.ok) {
    return json({ ok: false, error: write.error ?? 'MFL rejected the change.' }, 502);
  }

  // MFL accepted the change. Apply the same change on top of a RECONCILED
  // base: a fresh mirror as is, otherwise MFL's own list (the export can lag
  // the import by a beat, which is why the delta is re-applied on top). If
  // neither is available the change is reported but the mirror is NOT
  // written — stamping a one-player list as fresh would serve a truncated
  // watch list to the news page and the push sender for ten minutes.
  const mirror = await readWatchListMirror(ctx.league.slug, ctx.franchiseId);
  let baseIds: string[] | null = mirror && isFresh(mirror.syncedAt) ? mirror.playerIds : null;
  if (baseIds === null) {
    const live = await pullWatchList({ league: ctx.league, year: ctx.year, mflUserCookie: ctx.user.id });
    if (live.ok) baseIds = live.playerIds;
  }
  const applyDelta = (base: string[]) => {
    const next = new Set(base);
    for (const id of add) next.add(id);
    for (const id of remove) next.delete(id);
    return normalizeWatchIds([...next]);
  };

  if (baseIds === null) {
    // Best effort for the response only. A stale mirror keeps its old
    // syncedAt so the next GET re-reads MFL instead of trusting it.
    const playerIds = applyDelta(mirror?.playerIds ?? []);
    return json({ ok: true, playerIds, added: add, removed: remove, mirrored: false, reconciled: false });
  }

  const playerIds = applyDelta(baseIds);
  const mirrored = await writeWatchListMirror(ctx.league.slug, ctx.franchiseId, playerIds);
  return json({ ok: true, playerIds, added: add, removed: remove, mirrored, reconciled: true });
};
