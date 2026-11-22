/**
 * Browser half of "My Rank": the one ranks list every rankings surface shows.
 *
 * Every page under the league layout carries <MyRanksMarker />, which names
 * the league. Every owner gets the default board (FantasySharks, from
 * /api/default-ranks); the site owner's marker also carries `data-owner`,
 * which switches it to his own ranks by kind from /api/my-ranks (Brandon,
 * 2026-11-22). Either is fetched once per league, kept in this tab's memory,
 * and announced with the `rankingsUpdated` event so every surface re-renders.
 *
 * Read the marker per call, never at module load: with the ClientRouter one
 * module instance survives navigation between leagues (CLAUDE.md, "Rankings
 * are per-league"). Nothing is written to localStorage.
 */

import type { MyRankKind, MyRankList, MyRanks } from './my-ranks';

type State =
  | { status: 'loading' }
  | { status: 'ready'; kinds: MyRanks | null; fallback: MyRankList | null }
  | { status: 'failed' };

const byKey = new Map<string, State>();

const MARKER = '[data-my-ranks][data-league]';

function marker(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(MARKER);
}

/** The league the marker names, or null off the league pages. */
export function myRanksLeague(): string | null {
  return marker()?.dataset.league || null;
}

function isOwnerView(): boolean {
  return marker()?.hasAttribute('data-owner') ?? false;
}

function showFailure(): void {
  const el = marker();
  if (el?.hasAttribute('data-owner')) el.hidden = false;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function fetchDefault(league: string): Promise<MyRankList | null> {
  // The default board is public; let the browser and CDN cache it.
  const res = await fetch(`/api/default-ranks?league=${encodeURIComponent(league)}`, { credentials: 'omit' });
  if (!res.ok) return null;
  const data = (await res.json()) as { label?: string; ranks?: Record<string, number> };
  return data?.ranks ? { label: data.label ?? 'FantasySharks', ranks: data.ranks } : null;
}

function load(league: string, owner: boolean): void {
  const key = `${league}|${owner ? 'owner' : 'default'}`;
  byKey.set(key, { status: 'loading' });
  const work = owner
    ? fetchJson(`/api/my-ranks?league=${encodeURIComponent(league)}`)
        .then((data: { kinds?: MyRanks }) => {
          if (!data?.kinds) throw new Error('no ranks');
          byKey.set(key, { status: 'ready', kinds: data.kinds, fallback: null });
        })
        .catch(async () => {
          // His board failed: say so, and show the default rather than nothing.
          showFailure();
          const fallback = await fetchDefault(league).catch(() => null);
          byKey.set(key, { status: 'ready', kinds: null, fallback });
        })
    : fetchDefault(league)
        .then((fallback) => byKey.set(key, { status: 'ready', kinds: null, fallback }))
        .catch(() => byKey.set(key, { status: 'failed' }));
  work.finally(() => window.dispatchEvent(new CustomEvent('rankingsUpdated')));
}

/**
 * The "My Rank" list this viewer sees for `kind`, `'loading'` while it is on
 * its way, or null when there is none (off the league pages, or it failed).
 * `kind` only matters to the site owner; everyone else gets one board.
 */
export function myRankList(kind: MyRankKind): MyRankList | 'loading' | null {
  const league = myRanksLeague();
  if (!league) return null;
  const owner = isOwnerView();
  const state = byKey.get(`${league}|${owner ? 'owner' : 'default'}`);
  if (!state) {
    load(league, owner);
    return 'loading';
  }
  if (state.status === 'loading') return 'loading';
  if (state.status === 'failed') return null;
  if (state.kinds) return state.kinds[kind] ?? null;
  if (owner) showFailure();
  return state.fallback;
}

/** Reload the owner's ranks (after the Blend slider moves). */
export function refreshMyRanks(): void {
  const league = myRanksLeague();
  if (league && isOwnerView()) load(league, true);
}
