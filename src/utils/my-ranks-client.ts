/**
 * Browser half of My Ranks: the site owner's own ranks under "My Rank".
 *
 * A page opts in by rendering <MyRanksMarker /> (which renders NOTHING unless
 * the viewer is the site owner in that league). When the marker is on the
 * page, `myRankList(kind)` fetches /api/my-ranks once per league, keeps it in
 * memory, and announces it with the same `rankingsUpdated` event the
 * localStorage boards use, so every rankings surface re-renders on its own.
 *
 * Read the marker per call, never at module load: with the ClientRouter one
 * module instance survives navigation between leagues (CLAUDE.md, "Rankings
 * are per-league"). The ranks live only in this tab's memory; nothing is
 * written to localStorage.
 */

import type { MyRankKind, MyRankList, MyRanks } from './my-ranks';

type State = { status: 'loading' } | { status: 'ready'; kinds: MyRanks } | { status: 'failed' };
const byLeague = new Map<string, State>();

const MARKER = '[data-my-ranks][data-league]';

/** The league the marker names, or null when this viewer gets the default. */
export function myRanksLeague(): string | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector<HTMLElement>(MARKER);
  return el?.dataset.league || null;
}

function showFailure(): void {
  const el = document.querySelector<HTMLElement>(MARKER);
  if (el) el.hidden = false;
}

function load(league: string): void {
  byLeague.set(league, { status: 'loading' });
  fetch(`/api/my-ranks?league=${encodeURIComponent(league)}`, { credentials: 'same-origin', cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { kinds?: MyRanks };
      if (!data?.kinds) throw new Error('no ranks');
      byLeague.set(league, { status: 'ready', kinds: data.kinds });
    })
    .catch(() => {
      byLeague.set(league, { status: 'failed' });
      showFailure();
    })
    .finally(() => window.dispatchEvent(new CustomEvent('rankingsUpdated')));
}

/**
 * The owner's list for `kind`, `'loading'` while it is on its way, or null
 * when this viewer gets the default board (no marker, or the board failed).
 */
export function myRankList(kind: MyRankKind): MyRankList | 'loading' | null {
  const league = myRanksLeague();
  if (!league) return null;
  const state = byLeague.get(league);
  if (!state) {
    load(league);
    return 'loading';
  }
  if (state.status === 'loading') return 'loading';
  if (state.status === 'failed') {
    showFailure();
    return null;
  }
  return state.kinds[kind] ?? null;
}

/** Drop the cached ranks (after the Blend slider moves). */
export function refreshMyRanks(): void {
  const league = myRanksLeague();
  if (league) load(league);
}
