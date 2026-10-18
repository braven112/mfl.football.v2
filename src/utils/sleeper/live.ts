/**
 * Sleeper leagues on MFL Live — discovery, and one week's live read.
 *
 * Everything here produces the SAME shapes the MFL half of the board already
 * consumes (`BoardLeague`, `LeagueLiveRead`, `LiveSnapshot`), so the board,
 * the ticker and the red-zone banner draw a Sleeper league with the code they
 * draw an MFL league with. The differences are all absorbed in this file:
 *
 *  - **League ids are prefixed** (`sl-<sleeper id>`). The selection cookie,
 *    the panel keys and every `leagueId` comparison on the board treat ids as
 *    one namespace, and an unprefixed Sleeper id is just a long number.
 *  - **Franchise ids are Sleeper roster ids**, which are small integers and
 *    collide across leagues exactly as MFL's `0001` does — so, as everywhere
 *    on this board, a franchise id means nothing without its league id.
 *  - **Sleeper scores the week itself.** Its totals are taken as they are and
 *    never re-scored under any rules of ours.
 *  - **No projections.** Sleeper documents none, and the undocumented one its
 *    app uses was deliberately not adopted (Brandon, Oct 2026: live scores
 *    only). The board draws a Sleeper matchup without a win-probability bar
 *    or projected finals rather than with an empty map's hard 100/0.
 *  - **No per-player game clock.** Sleeper sends points, not seconds, so each
 *    starter's `secondsRemaining` comes from his NFL team's game on the
 *    ESPN scoreboard the board already loads.
 *
 * SERVER-SIDE ONLY.
 */

import { canonicalNflCode } from '../espn-game-detail';
import { getRedis } from '../redis-client';
import { mapWithConcurrency } from '../fan-out';
import { hasLiveSignal, emptyLiveSnapshot, type LiveSnapshot } from '../live-scoring-snapshot';
import type { BoardLeague } from '../sunday-ticket-selection';
import type { LeagueLiveRead } from '../cross-league-live';
import type { LivePlayerRow, NflGame } from '../../types/live-scoring';
import {
  sleeperAvatarUrl,
  sleeperGet,
  type SleeperLeague,
  type SleeperLeagueUser,
  type SleeperMatchupEntry,
  type SleeperRoster,
} from './client';
import { UNRESOLVED_PREFIX, type SleeperPlayerMap } from './players';
import type { SleeperLink } from './link';

export const SLEEPER_LEAGUE_PREFIX = 'sl-';

export function sleeperBoardLeagueId(sleeperLeagueId: string): string {
  return `${SLEEPER_LEAGUE_PREFIX}${sleeperLeagueId}`;
}

export function isSleeperLeagueId(id: string): boolean {
  return id.startsWith(SLEEPER_LEAGUE_PREFIX);
}

/** The bare Sleeper id, for the API. */
export function sleeperLeagueIdOf(boardId: string): string {
  return boardId.slice(SLEEPER_LEAGUE_PREFIX.length);
}

/** Same bound as the MFL half, for the same reason: it counts leagues, which grow with the owner. */
const FAN_OUT = 8;

// ── League metadata (names, rosters) — cached an hour ───────────────────────

export interface SleeperLeagueMeta {
  /** roster id → owner user ids (owner first, then co-owners). */
  owners: Record<string, string[]>;
  /** roster id → team name. */
  names: Record<string, string>;
  /** roster id → avatar URL, or ''. */
  icons: Record<string, string>;
}

const META_TTL_S = 60 * 60;
const memoryMeta = new Map<string, { at: number; meta: SleeperLeagueMeta }>();

/** Pure: the two Sleeper lists → who owns which roster, and what it is called. */
export function buildSleeperLeagueMeta(
  rosters: readonly SleeperRoster[],
  users: readonly SleeperLeagueUser[],
): SleeperLeagueMeta {
  const byUser = new Map(users.map((u) => [u.user_id, u]));
  const meta: SleeperLeagueMeta = { owners: {}, names: {}, icons: {} };
  for (const r of rosters) {
    if (typeof r?.roster_id !== 'number') continue;
    const rid = String(r.roster_id);
    meta.owners[rid] = [r.owner_id, ...(r.co_owners ?? [])].filter((x): x is string => !!x);
    const owner = r.owner_id ? byUser.get(r.owner_id) : undefined;
    meta.names[rid] =
      (owner?.metadata?.team_name ?? '').trim() || (owner?.display_name ?? '').trim() || `Team ${rid}`;
    meta.icons[rid] = sleeperAvatarUrl(owner?.metadata?.avatar || owner?.avatar);
  }
  return meta;
}

async function loadLeagueMeta(sleeperLeagueId: string): Promise<SleeperLeagueMeta | null> {
  const hit = memoryMeta.get(sleeperLeagueId);
  if (hit && Date.now() - hit.at < META_TTL_S * 1000) return hit.meta;

  const key = `live:sleeper:league:${sleeperLeagueId}`;
  const redis = await getRedis().catch(() => null);
  const cached = await redis?.get<SleeperLeagueMeta>(key).catch(() => null);
  if (cached?.owners) {
    memoryMeta.set(sleeperLeagueId, { at: Date.now(), meta: cached });
    return cached;
  }

  const [rosters, users] = await Promise.all([
    sleeperGet(`/league/${sleeperLeagueId}/rosters`),
    sleeperGet(`/league/${sleeperLeagueId}/users`),
  ]);
  if (!Array.isArray(rosters) || !Array.isArray(users)) return hit?.meta ?? null;
  const meta = buildSleeperLeagueMeta(rosters as SleeperRoster[], users as SleeperLeagueUser[]);
  memoryMeta.set(sleeperLeagueId, { at: Date.now(), meta });
  await redis?.set(key, meta, { ex: META_TTL_S }).catch(() => undefined);
  return meta;
}

/** Exported for tests only. */
export function clearSleeperLeagueCache(): void {
  memoryMeta.clear();
}

/** The viewer's roster in a league: the one they own, else one they co-own. */
export function findViewerRoster(meta: SleeperLeagueMeta, sleeperUserId: string): string | null {
  for (const [rid, owners] of Object.entries(meta.owners)) {
    if (owners[0] === sleeperUserId) return rid;
  }
  for (const [rid, owners] of Object.entries(meta.owners)) {
    if (owners.includes(sleeperUserId)) return rid;
  }
  return null;
}

// ── Discovery ───────────────────────────────────────────────────────────────

export interface SleeperBoardLeague extends BoardLeague {
  provider: 'sleeper';
}

/**
 * The linked account's Sleeper NFL leagues for `season`, as board leagues.
 *
 * A league whose rosters cannot be read, or in which the account owns no
 * roster, is left out rather than listed as a league the viewer has no team
 * in. Never throws; a failed read is an empty list, so the board falls back
 * to MFL alone.
 */
export async function discoverSleeperBoardLeagues(
  link: SleeperLink | null,
  season: number,
): Promise<SleeperBoardLeague[]> {
  if (!link?.userId) return [];
  const body = await sleeperGet(`/user/${encodeURIComponent(link.userId)}/leagues/nfl/${season}`);
  if (!Array.isArray(body)) return [];
  const leagues = (body as SleeperLeague[]).filter((l) => l && typeof l.league_id === 'string');

  const settled = await mapWithConcurrency(leagues, FAN_OUT, async (l): Promise<SleeperBoardLeague | null> => {
    const meta = await loadLeagueMeta(l.league_id);
    if (!meta) return null;
    const rid = findViewerRoster(meta, link.userId);
    if (!rid) return null;
    return {
      id: sleeperBoardLeagueId(l.league_id),
      name: String(l.name ?? '').trim() || 'Sleeper league',
      franchiseId: rid,
      franchiseName: meta.names[rid] ?? '',
      registered: null,
      host: null,
      isSession: false,
      provider: 'sleeper',
    };
  });
  const out: SleeperBoardLeague[] = [];
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled' && outcome.value) out.push(outcome.value);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The viewer's own team name and mark in each Sleeper league, for the settings rows. */
export async function readSleeperViewerMarks(
  leagues: readonly BoardLeague[],
): Promise<Record<string, { name: string; icon: string }>> {
  const out: Record<string, { name: string; icon: string }> = {};
  for (const league of leagues) {
    if (!isSleeperLeagueId(league.id)) continue;
    const meta = memoryMeta.get(sleeperLeagueIdOf(league.id))?.meta;
    out[league.id] = {
      name: meta?.names[league.franchiseId] ?? league.franchiseName,
      icon: meta?.icons[league.franchiseId] ?? '',
    };
  }
  return out;
}

/**
 * Every Sleeper player on the viewer's own rosters, with the leagues he is in.
 *
 * Read fresh (a roster changes with every waiver claim) and only by the two
 * places that act on the viewer's own team: the fix list and the endpoint
 * that checks a fix is for a player the owner actually rosters. A league that
 * cannot be read contributes nobody; it is never an error.
 */
export async function readViewerSleeperPlayers(
  leagues: readonly BoardLeague[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const sleeperLeagues = leagues.filter((l) => isSleeperLeagueId(l.id));
  const settled = await mapWithConcurrency(sleeperLeagues, FAN_OUT, async (league) => {
    const body = await sleeperGet(`/league/${sleeperLeagueIdOf(league.id)}/rosters`);
    if (!Array.isArray(body)) return [];
    const mine = (body as SleeperRoster[]).find((r) => String(r?.roster_id) === league.franchiseId);
    return (mine?.players ?? []).filter((sid) => sid && sid !== '0');
  });
  settled.forEach((outcome, i) => {
    if (outcome.status !== 'fulfilled') return;
    for (const sid of outcome.value) {
      const list = out.get(sid) ?? [];
      if (!list.includes(sleeperLeagues[i].name)) list.push(sleeperLeagues[i].name);
      out.set(sid, list);
    }
  });
  return out;
}

// ── One week's live read ────────────────────────────────────────────────────

/** A full NFL game, in seconds — `nflGameStateFromSeconds`'s "not started" line. */
const GAME_SECONDS = 3600;

/** Game-seconds left for each NFL club this week, from the ESPN scoreboard. */
export function secondsRemainingByTeam(games: readonly NflGame[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of games) {
    let seconds: number;
    if (g.state === 'post') seconds = 0;
    else if (g.state === 'pre') seconds = GAME_SECONDS;
    else {
      const [m, s] = String(g.clock ?? '').split(':').map((n) => Number.parseInt(n, 10));
      const clock = (Number.isFinite(m) ? m : 0) * 60 + (Number.isFinite(s) ? s : 0);
      const period = Number(g.period) || 1;
      // Overtime is past regulation: what is left is the OT clock alone, and a
      // live game is never reported as zero (that reads as final).
      seconds = Math.max(1, period >= 5 ? clock : (4 - period) * 900 + clock);
      seconds = Math.min(seconds, GAME_SECONDS - 1);
    }
    for (const code of [g.home?.code, g.away?.code]) {
      if (code) out.set(canonicalNflCode(code), seconds);
    }
  }
  return out;
}

/**
 * One Sleeper week → a `LiveSnapshot`. Pure.
 *
 * - Franchise ids are roster ids, as strings.
 * - Matchups pair the two rosters sharing a `matchup_id`; a roster with none
 *   (a bye, or a league scoring against the median only) has no opponent.
 * - Starter rows come from `starters` + `starters_points`, empty slots ('0')
 *   dropped. The bench is `players` minus `starters`.
 * - Every row's id is the player's MFL id where the map resolved one, else
 *   `sleeper:<id>` (see `UNRESOLVED_PREFIX`).
 * - A starter whose club is not on this week's slate (a bye, or a free agent
 *   Sleeper still lists) is counted as finished: there is nothing left for
 *   him to score.
 */
export function sleeperWeekToSnapshot(
  entries: readonly SleeperMatchupEntry[],
  players: SleeperPlayerMap,
  secondsByTeam: ReadonlyMap<string, number>,
): LiveSnapshot {
  const snapshot = emptyLiveSnapshot();
  const byMatchup = new Map<number, string[]>();

  const rowFor = (sid: string, points: number, status: string): LivePlayerRow => {
    const p = players[sid];
    const team = p?.team ?? '';
    return {
      id: p?.mfl || `${UNRESOLVED_PREFIX}${sid}`,
      live: Number.isFinite(points) ? points : 0,
      secondsRemaining: team ? (secondsByTeam.get(team) ?? 0) : 0,
      status,
    };
  };

  for (const e of entries) {
    if (typeof e?.roster_id !== 'number') continue;
    const fid = String(e.roster_id);
    const starters = (e.starters ?? []).filter((id) => id && id !== '0');
    const starterSet = new Set(starters);
    const startersPoints = e.starters_points ?? [];
    const playersPoints = e.players_points ?? {};

    snapshot.players[fid] = (e.starters ?? [])
      .map((sid, i) => ({ sid, points: Number(startersPoints[i] ?? playersPoints[sid] ?? 0) }))
      .filter(({ sid }) => sid && sid !== '0')
      .map(({ sid, points }) => rowFor(sid, points, 'starter'));

    const bench = (e.players ?? [])
      .filter((sid) => sid && !starterSet.has(sid))
      .map((sid) => rowFor(sid, Number(playersPoints[sid] ?? 0), 'nonstarter'));
    if (bench.length) snapshot.bench[fid] = bench;

    snapshot.scores[fid] = Number(e.custom_points ?? e.points ?? 0) || 0;
    snapshot.remaining[fid] = snapshot.players[fid].reduce((s, r) => s + r.secondsRemaining, 0);
    snapshot.playersYetToPlay[fid] = snapshot.players[fid].filter(
      (r) => r.secondsRemaining >= GAME_SECONDS,
    ).length;

    if (typeof e.matchup_id === 'number') {
      const list = byMatchup.get(e.matchup_id) ?? [];
      list.push(fid);
      byMatchup.set(e.matchup_id, list);
    }
  }

  // Sleeper's own matchup order, so "Game 1" stays put across polls.
  for (const id of [...byMatchup.keys()].sort((a, b) => a - b)) {
    const [home, away] = byMatchup.get(id) ?? [];
    if (home && away) snapshot.matchups.push({ home, away });
  }
  return snapshot;
}

/**
 * This week's live read for each Sleeper league, in the order given.
 *
 * Fault-isolated per league, exactly like `readCrossLeagueLive`: a league that
 * fails is `ok: false` and costs nobody else. Projections are always empty —
 * see this module's header.
 */
export async function readSleeperLive(input: {
  leagues: readonly BoardLeague[];
  week: number;
  players: SleeperPlayerMap;
  games: readonly NflGame[];
}): Promise<LeagueLiveRead[]> {
  const secondsByTeam = secondsRemainingByTeam(input.games);
  const settled = await mapWithConcurrency(input.leagues, FAN_OUT, async (league) => {
    const sid = sleeperLeagueIdOf(league.id);
    const [entries, meta] = await Promise.all([
      sleeperGet(`/league/${sid}/matchups/${input.week}`),
      loadLeagueMeta(sid),
    ]);
    if (!Array.isArray(entries)) {
      return failed(league);
    }
    const snapshot = sleeperWeekToSnapshot(entries as SleeperMatchupEntry[], input.players, secondsByTeam);
    return {
      league,
      ok: true,
      snapshot,
      projections: new Map<string, number>(),
      hasSignal: hasLiveSignal(snapshot),
      franchiseNames: meta?.names ?? {},
      franchiseIcons: meta?.icons ?? {},
    } satisfies LeagueLiveRead;
  });
  return settled.map((s, i) => (s.status === 'fulfilled' ? s.value : failed(input.leagues[i])));
}

function failed(league: BoardLeague): LeagueLiveRead {
  return {
    league,
    ok: false,
    snapshot: null,
    projections: new Map<string, number>(),
    hasSignal: false,
    franchiseNames: {},
    franchiseIcons: {},
  };
}
