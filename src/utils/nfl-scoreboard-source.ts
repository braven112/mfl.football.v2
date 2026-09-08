/**
 * The NFL scoreboard, fetched and parsed ONCE for every consumer.
 *
 * `/api/nfl-scoreboard` (the client poller's endpoint) and the three
 * live-scoring pages (server render) both need the same slate, and the parsing
 * — canonical team codes, the in-progress `situation`, the carrying network —
 * is the part that must never exist twice. The route is now a thin HTTP
 * wrapper over this; the pages call it directly.
 *
 * Why the pages fetch it at all, rather than letting the island do it: a
 * component that server-renders NOTHING gets an EMPTY `<astro-island>`, and
 * `client:visible` observes that island's CHILDREN. No children means nothing
 * is ever observed, so the island never hydrates and the rail never appears —
 * not "until kickoff", but never. `nflGames` used to be populated only under
 * `?demo=1`, which is exactly why the rail worked in demo and nowhere else.
 * See `docs/claude/insights/domains/frontend.md` — "a hydrating island must
 * SSR something".
 *
 * `ok` is not decoration. An empty slate on a Tuesday is a healthy answer; an
 * empty one because ESPN 500'd is an outage, and collapsing the two renders an
 * outage as "no games today" — the failure mode this repo keeps re-learning
 * (resolveLineupFillState, player-news).
 */

import type { NflGame, NflScoreboardResponse } from '../types/live-scoring';
import { getCurrentSeasonYear } from './league-year';
import { canonicalNflCode, parseBroadcast, parseGameSituation } from './espn-game-detail';
import { buildEspnScoreboardUrl, resolveEspnTarget } from './espn-scoreboard-url';

/** ESPN is intermittently slow; the page render must not wait on it. */
const ESPN_TIMEOUT_MS = 5000;

export interface ScoreboardQuery {
  /** 1-based NFL week. Falls back to 1 when absent or unparseable. */
  week?: number | string | null;
  /** Season year; falls back to the current season. */
  year?: number | string | null;
  /** The request's query string, for the ?espnSeason/?espnWeek/?espnYear override. */
  params?: URLSearchParams;
  /**
   * Caller's abort. A page may start this in parallel with its own data load
   * and only afterwards learn it does not need the answer (the live-scoring
   * pages fall back to the bundled sample whenever the MFL feed is empty, which
   * is the whole offseason) — aborting drops the request and its timer instead
   * of leaving both running on every such view.
   */
  signal?: AbortSignal;
}

export function parseScoreboardWeek(raw: number | string | null | undefined): number {
  const n = typeof raw === 'number' ? raw : parseInt(`${raw ?? ''}`, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function parseScoreboardYear(raw: number | string | null | undefined): number {
  const n = typeof raw === 'number' ? raw : parseInt(`${raw ?? ''}`, 10);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : getCurrentSeasonYear();
}

/** Map one ESPN scoreboard event to the shape every consumer reads. */
export function parseScoreboardEvent(event: any): NflGame {
  const comp = event?.competitions?.[0] ?? {};
  const competitors: any[] = comp.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  const status = comp.status ?? event?.status ?? {};
  const state: 'pre' | 'in' | 'post' = status?.type?.state ?? 'pre';

  // `situation` exists only while the game is being played. Parsing it resolves
  // possession from ESPN's numeric team id and canonicalizes the code, so a
  // consumer can compare it against a player's own NFL team.
  const situation = state === 'in' ? parseGameSituation(comp) : null;

  return {
    id: String(event?.id ?? ''),
    state,
    shortDetail: status?.type?.shortDetail ?? '',
    period: Number(status?.period) || 0,
    clock: status?.displayClock ?? '',
    home: { code: canonicalNflCode(home?.team?.abbreviation ?? ''), score: Number(home?.score) || 0 },
    away: { code: canonicalNflCode(away?.team?.abbreviation ?? ''), score: Number(away?.score) || 0 },
    possession: situation?.possession || null,
    date: String(event?.date ?? ''),
    situation,
    broadcast: parseBroadcast(comp),
  } satisfies NflGame;
}

/**
 * Fetch and parse the slate. NEVER throws — an ESPN outage comes back as
 * `ok: false` with an empty `games`, because both callers render a page and
 * neither should 500 over a decorative rail.
 */
export async function fetchNflScoreboard(query: ScoreboardQuery): Promise<NflScoreboardResponse> {
  const week = parseScoreboardWeek(query.week);
  const year = parseScoreboardYear(query.year);
  const params = query.params ?? new URLSearchParams();

  const target = resolveEspnTarget(params, week, year);
  const espnUrl = buildEspnScoreboardUrl(target.slot, target.year);
  const espnSlot = { ...target.slot, year: target.year, overridden: target.overridden };

  // The caller's abort and our own timeout both have to be able to end this.
  const signal = query.signal
    ? AbortSignal.any([query.signal, AbortSignal.timeout(ESPN_TIMEOUT_MS)])
    : AbortSignal.timeout(ESPN_TIMEOUT_MS);

  try {
    const res = await fetch(espnUrl, { signal });
    if (!res.ok) return { ok: false, week, games: [], espnSlot };
    const data = await res.json();
    const events: any[] = data?.events ?? [];
    return { ok: true, week, games: events.map(parseScoreboardEvent), espnSlot };
  } catch (error) {
    // A caller that aborted is not an outage and must not be logged as one.
    if (!query.signal?.aborted) console.error('Error fetching NFL scoreboard:', error);
    return { ok: false, week, games: [], espnSlot };
  }
}

/**
 * The slate for a live-scoring page's SERVER render, as `initialGames`.
 *
 * Returns undefined rather than [] when there is nothing to show, so the strip
 * falls back to its own client fetch instead of rendering an empty rail — and
 * so an ESPN outage is never mistaken for a real empty week.
 */
export async function fetchInitialNflGames(query: ScoreboardQuery): Promise<NflGame[] | undefined> {
  const board = await fetchNflScoreboard(query);
  return board.ok && board.games.length > 0 ? board.games : undefined;
}
