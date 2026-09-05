/**
 * My Watch List — the browser-side store every Watch toggle reads and writes.
 *
 * One module, one truth per league: the roster action modal, the free-agent
 * rows, the custom-rankings board and the player details modal all ask THIS
 * for "is he watched?" and all go through `toggleWatch`, so a click in one
 * surface is reflected in every other on the same page via the
 * `watchlist:change` document event.
 *
 * Feel-instant rules:
 * - The last known list is cached in localStorage per scope, so the first
 *   paint after navigation renders the right icons before the network answers.
 * - A toggle updates the set OPTIMISTICALLY and rolls back on failure. MFL's
 *   import is incremental, so the write is exactly the change the owner made.
 *
 * ClientRouter rule: the scope is re-read per call (`activeRankingsScope`),
 * never captured at module load — this module instance survives navigating
 * from one league's page to the other's. Same reason the cache is a Map keyed
 * by scope rather than one set.
 */

import { activeRankingsScope, scopedLocalKey, type RankingsScope } from './rankings-scope';

export const WATCH_LIST_CHANGE_EVENT = 'watchlist:change';

/** 'signed-out' is a 401 from the API; 'unknown' is "not asked yet / network down". */
export type WatchListAuth = 'unknown' | 'signed-in' | 'signed-out';

export interface WatchListChangeDetail {
  scope: RankingsScope;
  playerIds: string[];
  /** The id a toggle changed, when the event came from one. */
  changed?: string;
  watched?: boolean;
}

interface ScopeState {
  ids: Set<string>;
  auth: WatchListAuth;
  loading: Promise<Set<string>> | null;
  loaded: boolean;
}

const LOCAL_KEY_BASE = 'watchList.cache';
const states = new Map<RankingsScope, ScopeState>();

function stateFor(scope: RankingsScope): ScopeState {
  let s = states.get(scope);
  if (!s) {
    s = { ids: readLocalCache(scope), auth: 'unknown', loading: null, loaded: false };
    states.set(scope, s);
  }
  return s;
}

function readLocalCache(scope: RankingsScope): Set<string> {
  try {
    const raw = localStorage.getItem(scopedLocalKey(LOCAL_KEY_BASE, scope));
    const parsed = raw ? JSON.parse(raw) : null;
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeLocalCache(scope: RankingsScope, ids: Set<string>) {
  try {
    localStorage.setItem(scopedLocalKey(LOCAL_KEY_BASE, scope), JSON.stringify([...ids]));
  } catch {
    /* private mode / quota — the cache is a convenience */
  }
}

function clearLocalCache(scope: RankingsScope) {
  try {
    localStorage.removeItem(scopedLocalKey(LOCAL_KEY_BASE, scope));
  } catch { /* ignore */ }
}

function emit(scope: RankingsScope, ids: Set<string>, extra: Partial<WatchListChangeDetail> = {}) {
  if (typeof document === 'undefined') return;
  const detail: WatchListChangeDetail = { scope, playerIds: [...ids], ...extra };
  document.dispatchEvent(new CustomEvent(WATCH_LIST_CHANGE_EVENT, { detail }));
}

const apiUrl = (scope: RankingsScope, extra = '') =>
  `/api/watch-list?league=${encodeURIComponent(scope)}${extra}`;

/** Synchronous read of the best-known list. Never blocks; may be the local cache. */
export function getWatchedIds(scope: RankingsScope = activeRankingsScope()): Set<string> {
  return stateFor(scope).ids;
}

export function isWatched(playerId: string, scope: RankingsScope = activeRankingsScope()): boolean {
  return stateFor(scope).ids.has(String(playerId));
}

export function getWatchListAuth(scope: RankingsScope = activeRankingsScope()): WatchListAuth {
  return stateFor(scope).auth;
}

/**
 * Load the list from the server (once per scope per page session; pass
 * `force` to re-ask). Resolves to the set either way — on a failure it is the
 * cached set, so callers never need a fallback branch.
 */
export function loadWatchList(
  { force = false, scope = activeRankingsScope() }: { force?: boolean; scope?: RankingsScope } = {},
): Promise<Set<string>> {
  const s = stateFor(scope);
  if (s.loading) return s.loading;
  if (s.loaded && !force) return Promise.resolve(s.ids);

  s.loading = (async () => {
    try {
      const res = await fetch(apiUrl(scope, force ? '&refresh=1' : ''), { credentials: 'include' });
      if (res.status === 401) {
        s.auth = 'signed-out';
        s.ids = new Set();
        clearLocalCache(scope);
        s.loaded = true;
        emit(scope, s.ids);
        return s.ids;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !Array.isArray(data.playerIds)) {
        // Server trouble: keep whatever we had; do not flip auth.
        return s.ids;
      }
      s.auth = 'signed-in';
      s.ids = new Set(data.playerIds.map(String));
      s.loaded = true;
      writeLocalCache(scope, s.ids);
      emit(scope, s.ids);
      return s.ids;
    } catch {
      return s.ids;
    } finally {
      s.loading = null;
    }
  })();
  return s.loading;
}

export interface ToggleResult {
  ok: boolean;
  watched: boolean;
  error?: string;
  /** True when the server said the viewer is not signed in. */
  signedOut?: boolean;
}

/**
 * Watch or unwatch one player. `watched` forces a direction; omit it to flip.
 * Optimistic: listeners see the change immediately and a rollback on failure.
 */
export async function toggleWatch(
  playerId: string,
  watched?: boolean,
  scope: RankingsScope = activeRankingsScope(),
): Promise<ToggleResult> {
  const id = String(playerId);
  const s = stateFor(scope);
  const next = watched ?? !s.ids.has(id);
  const before = s.ids.has(id);
  if (next === before) return { ok: true, watched: next };

  if (next) s.ids.add(id); else s.ids.delete(id);
  emit(scope, s.ids, { changed: id, watched: next });

  const rollback = () => {
    if (before) s.ids.add(id); else s.ids.delete(id);
    emit(scope, s.ids, { changed: id, watched: before });
  };

  try {
    const res = await fetch(apiUrl(scope), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next ? { add: [id] } : { remove: [id] }),
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401) {
      s.auth = 'signed-out';
      rollback();
      return { ok: false, watched: before, signedOut: true, error: data?.error || 'Sign in to use your watch list.' };
    }
    if (!res.ok || !data?.ok) {
      rollback();
      return { ok: false, watched: before, error: data?.error || `Could not update your watch list (HTTP ${res.status}).` };
    }
    s.auth = 'signed-in';
    s.loaded = true;
    if (Array.isArray(data.playerIds)) {
      s.ids = new Set(data.playerIds.map(String));
    }
    writeLocalCache(scope, s.ids);
    emit(scope, s.ids, { changed: id, watched: s.ids.has(id) });
    return { ok: true, watched: s.ids.has(id) };
  } catch (err) {
    rollback();
    return { ok: false, watched: before, error: `Could not reach the site: ${(err as Error).message}` };
  }
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function onWatchListChange(
  handler: (detail: WatchListChangeDetail) => void,
): () => void {
  if (typeof document === 'undefined') return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<WatchListChangeDetail>).detail);
  document.addEventListener(WATCH_LIST_CHANGE_EVENT, listener);
  return () => document.removeEventListener(WATCH_LIST_CHANGE_EVENT, listener);
}

/** Test hook: forget everything (localStorage included). */
export function __resetWatchListClient() {
  for (const scope of states.keys()) clearLocalCache(scope);
  states.clear();
}
