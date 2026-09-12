/**
 * Real NFL box scores + scoring plays. SERVER-SIDE ONLY.
 *
 * Extracted from `src/pages/api/nfl-game-detail.ts` (Sept 2026) when the
 * broadcast board needed the same slate in-process. A page must never fetch
 * its own API to render itself — that hop put our own edge in the path of a
 * first paint and, when it silently stopped landing, printed "scores will
 * appear when games begin" over a live slate. The route is now a thin wrapper
 * over this, exactly as `/api/live-scoring` is over `live-scoring-source.ts`.
 *
 * Fans out from one ESPN scoreboard call to the per-game `summary` (box score)
 * and `plays` (athlete-attributed play-by-play) endpoints, then translates
 * everything from ESPN athlete ids to MFL player ids BEFORE it crosses any
 * boundary. Callers join on MFL ids, which they already hold — no ESPN id is
 * ever shipped for joining, because `PlayerMeta.espnId` can be a COLLEGE
 * athlete id and college/NFL ids are numerically indistinguishable.
 *
 * Fan-out discipline, all of it load-bearing on a 16-game Sunday:
 *  - bounded concurrency (CONCURRENCY) and a per-request timeout, so one hung
 *    game cannot hold the invocation open;
 *  - Promise.allSettled + per-game try/catch, so one failure returns PARTIAL
 *    results rather than blanking the board;
 *  - a process-local TTL cache keyed by event id. Twelve owners watching the
 *    same slate share one fetch per game, and a FINAL game — whose numbers no
 *    longer move — is held far longer than a live one.
 */

import type {
  LiveScoringPlay,
  NflGameDetailResponse,
  PlayerBoxScore,
} from '../types/live-scoring';
import { getCurrentLeagueYear, getCurrentSeasonYear } from './league-year';
import { getGlobalPlayerMap, getPlayerMap } from './player-map';
import {
  buildPlaysUrl,
  buildSummaryUrl,
  buildTeamCodesById,
  formatStatLine,
  parseBoxScore,
  comparePlaysChronologically,
  isTwoPointConversion,
  parseNotablePlays,
  parseScoringPlays,
  type EspnNotablePlay,
  type EspnScoringPlay,
} from './espn-game-detail';
import { buildEspnScoreboardUrl, resolveEspnTarget } from './espn-scoreboard-url';
import { fetchRawScoreboard } from './nfl-scoreboard-source';
import { mapWithConcurrency } from './fan-out';


/**
 * Real NFL box scores + scoring plays. SERVER-SIDE ONLY.
 *
 * Extracted from `src/pages/api/nfl-game-detail.ts` (Sept 2026) when the
 * broadcast board needed the same slate in-process. A page must never fetch
 * its own API to render itself — that hop put our own edge in the path of a
 * first paint and, when it silently stopped landing, printed "scores will
 * appear when games begin" over a live slate. The route is now a thin wrapper
 * over this, exactly as `/api/live-scoring` is over `live-scoring-source.ts`.
 *
 * Fans out from one ESPN scoreboard call to the per-game `summary` (box score)
 * and `plays` (athlete-attributed play-by-play) endpoints, then translates
 * everything from ESPN athlete ids to MFL player ids BEFORE it crosses the
 * response boundary. The island joins on MFL ids, which it already holds — no
 * ESPN id is ever shipped for joining, because PlayerMeta.espnId can be a
 * COLLEGE athlete id and college/NFL ids are numerically indistinguishable
 * (docs/claude/insights/features/player-news.md).
 *
 * Fan-out discipline, all of it load-bearing on a 16-game Sunday:
 *  - bounded concurrency (CONCURRENCY) and a per-request timeout, so one hung
 *    game cannot hold the invocation open;
 *  - Promise.allSettled + per-game try/catch, so one failure returns PARTIAL
 *    results rather than blanking the board;
 *  - a process-local TTL cache keyed by event id (same pattern as
 *    nfl-matchups.ts). Twelve owners watching the same slate share one fetch
 *    per game, and a FINAL game — whose numbers no longer move — is held far
 *    longer than a live one. Without it a Sunday afternoon is 32 upstream
 *    fetches per viewer per minute.
 *
 * `Cache-Control: no-store`, like every live route here. A CDN-cached live box
 * score is not stale, it is WRONG while looking live — and Cloudflare has
 * stamped its own max-age on our responses before (the NFL-logo saga).
 */

/** Most games in an NFL week; a hard ceiling on the fan-out either way. */
const MAX_GAMES = 16;
/** Concurrent upstream requests inside one invocation. */
const CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 5000;
/** An in-progress game's numbers move constantly — just enough to dedupe. */
const LIVE_TTL_MS = 25_000;
/** A final game only changes on a stat correction, which lands within minutes. */
const FINAL_TTL_MS = 5 * 60_000;

interface GameDetail {
  boxScore: ReturnType<typeof parseBoxScore>;
  plays: EspnScoringPlay[];
  /**
   * Non-scoring plays worth interrupting a broadcast for — a 40+ yard gain
   * from scrimmage, or a takeaway. Same payload, second read: `parseScoringPlays`
   * skips everything with `scoringPlay !== true`, so the two plays an owner
   * most wants shouted across the room are invisible to it.
   */
  notable: EspnNotablePlay[];
  /** Play ids whose touchdown converted a two-pointer, read off `pointAfterAttempt`. */
  twoPointPlayIds: Set<string>;
  /** True when BOTH upstream calls for this game came back parseable. */
  complete: boolean;
}

interface CacheRow {
  detail: GameDetail;
  expiresAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __nflGameDetailCache: Map<string, CacheRow> | undefined;
}

const cache = (): Map<string, CacheRow> => {
  if (!globalThis.__nflGameDetailCache) globalThis.__nflGameDetailCache = new Map();
  return globalThis.__nflGameDetailCache;
};

/**
 * Fetch one ESPN endpoint, or null.
 *
 * Deliberately sends NO custom User-Agent. The MFL-style
 * `Mozilla/5.0 (compatible; FantasyLeague/1.0)` header this used to carry is
 * fine from a laptop and gets rejected outright from a serverless IP: on the
 * first preview deploy every call here failed in ~0.3s while
 * /api/nfl-scoreboard — same host, same URL, same deployment, no UA header —
 * succeeded. ESPN's edge is the only thing that can tell those two apart.
 * Match the route that is already proven in production and send none.
 *
 * The failure reason is logged rather than swallowed. It was silent before,
 * which is why the deploy reported an honest `ok: false` with nothing at all
 * to say WHY, and the runtime logs showed a clean 200.
 */
async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`[nfl-game-detail] upstream ${res.status} for ${url}`);
      return null;
    }
    return await res.json();
  } catch (error) {
    console.warn(`[nfl-game-detail] upstream failed for ${url}:`, (error as Error)?.message);
    return null;
  }
}

/**
 * ESPN athlete id → MFL player id, for the players we actually care about.
 *
 * Built from `nflEspnId` (straight off the feed's `espn_id`), never `espnId` —
 * the latter falls back to a COLLEGE athlete id for rookies, and a college id
 * is numerically indistinguishable from an NFL one, so joining on it resolves a
 * DIFFERENT athlete rather than failing. The season map wins over the all-years
 * union so a player who changed ids is read from the freshest feed.
 */
function buildEspnToMflMap(): Map<string, string> {
  const map = new Map<string, string>();
  const add = (identity: { mflId: string; nflEspnId: string | null }) => {
    if (identity.nflEspnId && !map.has(identity.nflEspnId)) {
      map.set(identity.nflEspnId, identity.mflId);
    }
  };
  for (const p of getPlayerMap(getCurrentLeagueYear()).values()) add(p);
  for (const p of getGlobalPlayerMap().values()) add(p);
  return map;
}

async function loadGameDetail(
  eventId: string,
  competitionId: string,
  teamCodesById: Map<string, string>,
  live: boolean,
): Promise<GameDetail> {
  const hit = cache().get(eventId);
  if (hit && hit.expiresAt > Date.now()) return hit.detail;

  const summaryUrl = buildSummaryUrl(eventId);
  const playsUrl = buildPlaysUrl(eventId, competitionId);
  const [summary, plays] = await Promise.all([
    summaryUrl ? fetchJson(summaryUrl) : Promise.resolve(null),
    playsUrl ? fetchJson(playsUrl) : Promise.resolve(null),
  ]);

  const twoPointPlayIds = new Set<string>();
  for (const item of ((plays?.items ?? []) as any[])) {
    if (isTwoPointConversion(item) && item?.id != null) twoPointPlayIds.add(String(item.id));
  }

  const detail: GameDetail = {
    boxScore: summary ? parseBoxScore(summary) : [],
    plays: plays ? parseScoringPlays(plays, teamCodesById) : [],
    notable: plays ? parseNotablePlays(plays, teamCodesById) : [],
    twoPointPlayIds,
    complete: !!summary && !!plays,
  };

  // Only cache a COMPLETE read. Caching a partial one would pin a transient
  // ESPN hiccup in front of every viewer for the whole TTL.
  if (detail.complete) {
    cache().set(eventId, {
      detail,
      expiresAt: Date.now() + (live ? LIVE_TTL_MS : FINAL_TTL_MS),
    });
  }
  return detail;
}

export interface LoadNflGameDetailOptions {
  week: number;
  year?: number;
  /** The validation override params (?espnSeason/?espnWeek/?espnYear), if any. */
  searchParams?: URLSearchParams;
}

/**
 * Fan out from one ESPN scoreboard call to every started game's box score and
 * play-by-play, translated to MFL player ids before anything leaves here.
 *
 * Never throws: a lost scoreboard is `ok: false` with empty collections, which
 * callers must keep distinct from a healthy slate with nothing in it.
 */
export async function loadNflGameDetail(
  opts: LoadNflGameDetailOptions,
): Promise<NflGameDetailResponse> {
  const parsedWeek = opts.week;
  const year = Number.isInteger(opts.year) && opts.year! >= 2000 && opts.year! <= 2100
    ? opts.year!
    : getCurrentSeasonYear();
  const url = { searchParams: opts.searchParams ?? new URLSearchParams() };

  // Validation override (?espnSeason/?espnWeek/?espnYear) — see
  // resolveEspnTarget. Both ESPN routes must honor it or the board would show
  // one slate's games next to another slate's box scores.
  const target = resolveEspnTarget(url.searchParams, parsedWeek, year);
  const espnSlot = { ...target.slot, year: target.year, overridden: target.overridden };
  // Through the SHARED cache, not a second independent fetch: the broadcast
  // board asks for the parsed slate and the play-by-play in one assembly, and
  // both need this same document. Two uncached calls per poll, every 8 seconds
  // for eight hours, is thousands of avoidable requests per television against
  // a host that has rejected us before.
  const scoreboard = await fetchRawScoreboard(buildEspnScoreboardUrl(target.slot, target.year));

  // The scoreboard is the ONE call this route cannot do without: it supplies
  // the event ids to fan out over and the team-id → code map the plays feed
  // needs. Losing it is an outage, and must not read as "no games today".
  if (!scoreboard) {
    return {
        ok: false,
        week: parsedWeek,
        year,
        fetchedAt: new Date().toISOString(),
        boxScore: {},
        plays: [],
        gamesRequested: 0,
        gamesLoaded: 0,
        espnSlot,
      } satisfies NflGameDetailResponse;
  }

  const teamCodesById = buildTeamCodesById(scoreboard);

  // Only games that have started have anything to report. A pre-game event has
  // an empty box score and no plays, so fetching it is pure cost.
  const started = ((scoreboard.events ?? []) as any[])
    .map((event) => {
      const comp = event?.competitions?.[0];
      const state = comp?.status?.type?.state ?? event?.status?.type?.state ?? 'pre';
      return {
        eventId: String(event?.id ?? ''),
        competitionId: String(comp?.id ?? event?.id ?? ''),
        live: state === 'in',
        started: state === 'in' || state === 'post',
      };
    })
    .filter((g) => g.started && g.eventId)
    .slice(0, MAX_GAMES);

  const settled = await mapWithConcurrency(started, CONCURRENCY, (g) =>
    loadGameDetail(g.eventId, g.competitionId, teamCodesById, g.live),
  );

  const espnToMfl = buildEspnToMflMap();
  const boxScore: Record<string, PlayerBoxScore> = {};
  const plays: LiveScoringPlay[] = [];
  let gamesLoaded = 0;

  settled.forEach((result, i) => {
    if (result.status !== 'fulfilled') return;
    const detail = result.value;
    if (detail.complete) gamesLoaded += 1;

    for (const line of detail.boxScore) {
      const mflId = espnToMfl.get(line.espnAthleteId);
      if (!mflId) continue;
      const statLine = formatStatLine(line);
      boxScore[mflId] = {
        playerId: mflId,
        nflTeam: line.teamCode,
        statLine,
        gameId: started[i].eventId,
      };
    }

    const emit = (play: EspnScoringPlay | EspnNotablePlay) => {
      const playerIds = play.espnAthleteIds
        .map((id) => espnToMfl.get(id))
        .filter((id): id is string => !!id);
      plays.push({
        playId: play.playId,
        gameId: started[i].eventId,
        sequence: play.sequence,
        period: play.period,
        clock: play.clock,
        text: play.text,
        typeAbbrev: play.typeAbbrev,
        typeText: play.typeText,
        nflTeam: play.teamCode,
        scoreValue: play.scoreValue,
        playerIds,
        wallclock: play.wallclock,
        yards: 'yards' in play ? play.yards : 0,
        // Both play shapes carry it now. The `in` narrowing it used to need
        // was silently emitting `false` for every SCORING turnover — the pick
        // six and the fumble-return touchdown — because only the notable shape
        // declared the field.
        isTurnover: play.isTurnover === true,
        twoPoint: detail.twoPointPlayIds.has(play.playId),
      });
    };

    for (const play of detail.plays) emit(play);
    for (const play of detail.notable) emit(play);
  });

  // Plays arrive grouped by game, and `sequence` only orders within one game —
  // merging 16 games on it interleaves them into a timeline that isn't one.
  // The game clock is the only ordering the whole slate shares.
  plays.sort(comparePlaysChronologically);

  return {
      // `ok` answers "did this route get a usable read", NOT "is there data".
      // An empty slate with ok:true is a healthy Tuesday; ok:false is an
      // outage, and the island renders them differently on purpose.
      ok: true,
      week: parsedWeek,
      year,
      fetchedAt: new Date().toISOString(),
      boxScore,
      plays,
      gamesRequested: started.length,
      gamesLoaded,
      espnSlot,
  } satisfies NflGameDetailResponse;
}
