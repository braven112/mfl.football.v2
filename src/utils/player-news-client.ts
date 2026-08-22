/**
 * Browser-side player news: fetch, cache, and render.
 *
 * Shared by PlayerDetailsModal and PlayerNewsModal so both surfaces behave
 * identically. Three things here are load-bearing rather than incidental:
 *
 *  1. A generation token. Opening player A then quickly player B must never
 *     paint A's articles under B's name.
 *  2. `empty` and `error` never collapse. Both render zero articles, and calling
 *     an ESPN outage "no recent news" is a confident lie to the owner.
 *  3. The list is built with createElement/textContent, NOT innerHTML. Headlines
 *     are third-party free text; escaping you can forget is worse than escaping
 *     you can't. (The weekly-results table in PlayerDetailsModal does use
 *     innerHTML — that is fine there because every value it interpolates is a
 *     number or one of our own filenames. Don't copy that pattern here.)
 */

import { formatRelativeTime } from './schefter-feed';
import { getDefSpotlightPlayer } from '../data/theleague/def-spotlight-players';
import type { PlayerNewsItem } from './player-news';

/**
 * Who to fetch news for. `mflId` is the normal path — the route resolves it to
 * a known-NFL ESPN id server-side, so no page has to thread a second id through
 * its modal payload. `espnId` is for the team DEF stand-in, whose id comes from
 * def-spotlight-players and is already known-NFL.
 */
export interface PlayerNewsSubject {
  mflId?: string | null;
  espnId?: string | null;
}

/** Resolved news target: who to ask about, and how to label it. */
export interface ResolvedNewsSubject {
  subject: PlayerNewsSubject;
  /** Sub-line shown when the news is not the player's own (team DEF). */
  label: string;
  /** Whose news this actually is, for the screen-reader announcement. */
  subjectName: string;
}

/**
 * Decide who a modal should show news for.
 *
 * Shared by both modals on purpose. When this lived only in PlayerDetailsModal,
 * PlayerNewsModal had no DEF handling and reported "No recent ESPN stories" for
 * players it had never actually asked about — the exact lie this module's header
 * warns against.
 */
export function resolveNewsSubject(
  playerData: Record<string, unknown> | null | undefined,
): ResolvedNewsSubject | null {
  const position = String((playerData as { position?: unknown })?.position ?? '').toUpperCase();
  const team = String((playerData as { nflTeam?: unknown })?.nflTeam ?? '');

  if (position === 'DEF') {
    // A team defense has no ESPN athlete id (0 of 32 in the MFL feed, and
    // structurally always will be), so it borrows its marquee defender's.
    const star = getDefSpotlightPlayer(team);
    if (!star?.espnId) return null;
    return {
      subject: { espnId: star.espnId },
      // Spelled out rather than implied by a separator: a reader who skims the
      // headlines and not the sub-line would otherwise take one player's news
      // for the whole unit's.
      label: `No ESPN feed for this defense \u2014 showing ${star.name}'s news`,
      subjectName: star.name,
    };
  }

  // Send the MFL id, never playerData.espnId — the route resolves it to the
  // feed's own espn_id, the only id guaranteed to be an NFL athlete. A college
  // id is numerically indistinguishable and would return a DIFFERENT player.
  const mflId = (playerData as { id?: unknown })?.id;
  if (mflId === undefined || mflId === null || !/^\d{1,12}$/.test(String(mflId))) return null;

  return {
    subject: { mflId: String(mflId) },
    label: '',
    subjectName: String((playerData as { name?: unknown })?.name ?? 'this player'),
  };
}

export type PlayerNewsState =
  | { kind: 'loading' }
  | { kind: 'ok'; items: PlayerNewsItem[] }
  /** `windowDays` is the recency window the server applied, so the note can
   *  name it. Absent when we never reached the server (no id to ask about). */
  | { kind: 'empty'; windowDays?: number }
  | { kind: 'error' };

/**
 * The one-line note shown when there is nothing to list.
 *
 * It names the window on purpose. "No recent ESPN stories" invites the owner to
 * conclude the feature is broken for a player who genuinely has had no news
 * since minicamp; "in the last 90 days" says what was searched, so a quiet
 * player reads as quiet rather than as a bug. The window comes from the
 * response — the browser never re-derives the season clock, because two copies
 * of that math disagree at exactly the rollovers nobody is watching.
 */
export function playerNewsEmptyMessage(
  windowDays: number | undefined,
  subjectName?: string,
): string {
  const who = subjectName ? ` for ${subjectName}` : '';
  return typeof windowDays === 'number' && Number.isFinite(windowDays)
    ? `No ESPN stories${who} in the last ${windowDays} days.`
    : `No recent ESPN stories${who}.`;
}

const CACHE_TTL_MS = 5 * 60_000;

/** A rosters session can open dozens of modals; don't grow without bound. */
const CACHE_MAX = 60;

interface CacheEntry {
  at: number;
  state: PlayerNewsState;
}

const cache = new Map<string, CacheEntry>();

let generation = 0;
let inFlight: AbortController | null = null;

function readCache(key: string): PlayerNewsState | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.state;
}

function writeCache(key: string, state: PlayerNewsState): void {
  // Never cache `error` — a cached failure makes the Retry button a no-op that
  // looks broken.
  if (state.kind === 'error' || state.kind === 'loading') return;
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), state });
}

/**
 * Load news for one athlete, invoking `onState` with `loading` first and then a
 * terminal state. Safe to call repeatedly; the previous call is cancelled.
 */
export function loadPlayerNews(
  subject: PlayerNewsSubject,
  onState: (state: PlayerNewsState) => void,
  limit = 3,
): void {
  const token = ++generation;

  inFlight?.abort();
  inFlight = null;

  const param = subject.mflId
    ? `mflId=${encodeURIComponent(subject.mflId)}`
    : subject.espnId
      ? `espnId=${encodeURIComponent(subject.espnId)}`
      : '';

  if (!param) {
    onState({ kind: 'empty' });
    return;
  }

  // The limit is part of the response, so it must be part of the key — caching
  // on the id alone would serve a 4-item result to a later 6-item request.
  const cacheKey = `${param}&limit=${limit}`;

  const cached = readCache(cacheKey);
  if (cached) {
    onState(cached);
    return;
  }

  onState({ kind: 'loading' });

  const controller = new AbortController();
  inFlight = controller;

  fetch(`/api/player-news?${param}&limit=${limit}`, {
    signal: controller.signal,
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((body: { status?: string; items?: PlayerNewsItem[]; windowDays?: number }) => {
      if (token !== generation) return;

      const items = Array.isArray(body?.items) ? body.items : [];
      const windowDays = typeof body?.windowDays === 'number' ? body.windowDays : undefined;
      const state: PlayerNewsState =
        body?.status === 'ok' && items.length
          ? { kind: 'ok', items }
          : body?.status === 'empty'
            ? { kind: 'empty', windowDays }
            : { kind: 'error' };

      writeCache(cacheKey, state);
      onState(state);
    })
    .catch((error: unknown) => {
      // A cancelled request is not a network failure — the user simply moved on.
      // Reporting it as an error would flash "Couldn't reach ESPN" every time
      // someone clicks two players quickly.
      if ((error as { name?: string } | null)?.name === 'AbortError') return;
      if (token !== generation) return;
      onState({ kind: 'error' });
    });
}

/** Cancel any in-flight request and invalidate pending renders (modal closed). */
export function cancelPlayerNews(): void {
  generation++;
  inFlight?.abort();
  inFlight = null;
}

/** Build one article node. Anchor when the link survived validation, else a div. */
function buildItem(item: PlayerNewsItem, now?: Date): HTMLElement {
  const node = document.createElement(item.link ? 'a' : 'div');
  node.className = item.link ? 'pn-item' : 'pn-item pn-item--nolink';

  if (item.link && node instanceof HTMLAnchorElement) {
    node.href = item.link;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
  }

  const meta = document.createElement('div');
  meta.className = 'pn-item__meta';

  const type = document.createElement('span');
  type.className = 'pn-item__type';
  type.textContent = item.type || 'Story';
  meta.appendChild(type);

  if (item.published) {
    const date = document.createElement('span');
    date.className = 'pn-item__date';
    date.textContent = formatRelativeTime(item.published, now);
    meta.appendChild(date);
  }

  node.appendChild(meta);

  const headline = document.createElement('h5');
  headline.className = 'pn-item__headline';
  headline.textContent = item.headline;
  node.appendChild(headline);

  if (item.description) {
    const description = document.createElement('p');
    description.className = 'pn-item__description';
    description.textContent = item.description;
    node.appendChild(description);
  }

  return node;
}

/** Replace `listEl`'s contents with the rendered articles. */
export function renderPlayerNewsList(
  listEl: HTMLElement,
  items: PlayerNewsItem[],
  now?: Date,
): void {
  listEl.replaceChildren(...items.map((item) => buildItem(item, now)));
}

/** Build the skeleton placeholder rows shown while loading. */
export function renderPlayerNewsSkeleton(statusEl: HTMLElement, rows = 3): void {
  const nodes: HTMLElement[] = [];
  for (let i = 0; i < rows; i++) {
    const row = document.createElement('div');
    row.className = 'pn-skeleton';
    nodes.push(row);
  }
  statusEl.replaceChildren(...nodes);
}

/** Test seam — mirrors __resetLiveStandingsCacheForTests. */
export function __resetPlayerNewsCacheForTests(): void {
  cache.clear();
  generation = 0;
  inFlight = null;
}
