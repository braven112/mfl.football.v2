/**
 * AFL Keeper Analysis — hindsight grading of keeper selections.
 *
 * The AFL keeps 7 players per franchise each offseason, but MFL has no
 * formal keeper construct for the league — keeps are implicit (whoever
 * survives the offseason cut). This module reconstructs each franchise's
 * actual keeper class from the committed MFL feeds and grades it against
 * the hindsight-optimal seven by next-season regular-season points:
 *
 *   kept(F) = prevYearRoster(F) ∩ curYearOpeningRoster(F) − curYearDraftPicks(F)
 *
 * Kickers and team defenses are excluded from the optimal-seven grading
 * unless the league's #1 scorer at that position finished
 * KDEF_GAP_THRESHOLD+ points clear of #2 that season (positional-dominance
 * escape hatch — historically only the 2021 Patriots defense qualified).
 * They still surface as neutral "raw top 7" flags.
 *
 * Pure module: callers inject parsed feed JSON; no file/network I/O here.
 */

import { KEEPER_LIMIT } from './afl-keepers-storage';
import { formatMflName } from './player-name-matching';

/** First prev-season year of the keeper era (cycle = prevYear → prevYear+1). */
export const AFL_KEEPER_ERA_FIRST_PREV_YEAR = 2024;

/** #1-vs-#2 positional gap that makes a K/DEF gradable for a season. */
export const KDEF_GAP_THRESHOLD = 40;

const KDEF_POSITIONS = new Set(['PK', 'Def']);

// --- Feed shapes (loose — MFL JSON is stringly typed) ---

interface MflWeeklyPlayer {
  id: string;
  score?: string;
  status?: string;
}

interface MflWeeklyFranchise {
  id: string;
  player?: MflWeeklyPlayer[] | MflWeeklyPlayer;
}

interface MflMatchup {
  regularSeason?: string;
  franchise?: MflWeeklyFranchise[] | MflWeeklyFranchise;
}

interface MflWeeklyResultsEntry {
  weeklyResults: {
    week?: string;
    matchup?: MflMatchup[] | MflMatchup;
    /** Bye/consolation weeks can list franchises outside matchups. */
    franchise?: MflWeeklyFranchise[] | MflWeeklyFranchise;
  };
}

export type WeeklyResultsRaw = MflWeeklyResultsEntry[];

export interface MflPlayersFeed {
  players: { player: Array<{ id: string; name?: string; position?: string; team?: string }> };
}

export interface MflRostersFeed {
  rosters: {
    franchise: Array<{
      id: string;
      player?: Array<{ id: string }> | { id: string };
    }>;
  };
}

export interface MflDraftResultsFeed {
  draftResults?: {
    draftUnit?:
      | Array<{ draftPick?: Array<{ franchise?: string; player?: string }> | { franchise?: string; player?: string } }>
      | { draftPick?: Array<{ franchise?: string; player?: string }> | { franchise?: string; player?: string } };
  };
}

export interface PlayerInfo {
  id: string;
  /** Display name ("First Last" — converted from MFL "Last, First"). */
  name: string;
  position: string;
  nflTeam: string;
}

// --- Output shapes ---

export type KeeperBadge = 'hit' | 'miss' | 'got-away' | 'kdef-neutral';

export interface AnalyzedPlayer extends PlayerInfo {
  points: number;
  /** 1-based rank on this franchise's prev roster by points (raw, all positions). */
  rank: number;
  kept: boolean;
  /** In the (K/DEF-filtered) hindsight-optimal seven. */
  optimal: boolean;
  /** In the unfiltered raw top seven (powers the K/DEF flag). */
  rawTopSeven: boolean;
  badge: KeeperBadge | null;
}

export interface FranchiseAnalysis {
  franchiseId: string;
  players: AnalyzedPlayer[];
  keptCount: number;
  hits: number;
  misses: number;
  gotAway: number;
  /** Kept K/DEF in a non-exception season — shown, never counted as a miss. */
  kdefNeutralKept: number;
  /** K/DEF that cracked the raw (unfiltered) top seven. */
  kdefRawTopSevenCount: number;
  keptPoints: number;
  optimalPoints: number;
  /** keptPoints / optimalPoints, 0..1+ (0 when optimalPoints is 0). */
  efficiency: number;
}

export interface KeeperAnalysisSummary {
  /** Franchise ids ranked by keptPoints desc. */
  rankedFranchiseIds: string[];
  bestFranchiseId: string | null;
  worstFranchiseId: string | null;
  /** Franchises whose raw top seven contained ≥1 K/DEF. */
  franchisesWithKdefInRawTopSeven: number;
  /** Franchises that actually kept a K/DEF. */
  franchisesThatKeptKdef: number;
  /** Positions gradable this cycle under the dominance rule (usually empty). */
  kdefExceptions: Array<{ position: string; playerId: string; playerName: string; gap: number }>;
  totalHits: number;
  totalMisses: number;
  totalGotAway: number;
}

export interface KeeperAnalysis {
  franchises: FranchiseAnalysis[];
  summary: KeeperAnalysisSummary;
  /** True when the points season hasn't produced any scores yet (pre-week-1). */
  previewMode: boolean;
  /** Highest completed regular-season week (0 in preview mode). */
  throughWeek: number;
}

// --- Helpers ---

function asArray<T>(value: T[] | T | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Sum regular-season points per player for a season.
 *
 * Dedupes on (playerId, week): the AFL runs duplicate-player AL/NL
 * conferences, so the same NFL player can appear on one roster in each
 * conference the same week — summing naively would double-count him.
 */
export function computeSeasonPoints(weeklyRaw: WeeklyResultsRaw): {
  points: Map<string, number>;
  maxCompletedWeek: number;
} {
  const perPlayerWeek = new Map<string, number>();
  let maxCompletedWeek = 0;

  for (const entry of weeklyRaw ?? []) {
    const wr = entry?.weeklyResults;
    if (!wr) continue;
    const week = Number.parseInt(wr.week ?? '', 10);
    const franchises: MflWeeklyFranchise[] = [];
    for (const matchup of asArray(wr.matchup)) {
      if (matchup.regularSeason !== undefined && matchup.regularSeason !== '1') continue;
      franchises.push(...asArray(matchup.franchise));
    }
    franchises.push(...asArray(wr.franchise));

    let weekHasScores = false;
    for (const franchise of franchises) {
      for (const player of asArray(franchise.player)) {
        if (!player?.id) continue;
        const score = Number.parseFloat(player.score ?? '');
        if (!Number.isFinite(score)) continue;
        weekHasScores = true;
        perPlayerWeek.set(`${player.id}|${week}`, score);
      }
    }
    if (weekHasScores && Number.isFinite(week)) {
      maxCompletedWeek = Math.max(maxCompletedWeek, week);
    }
  }

  const points = new Map<string, number>();
  for (const [key, score] of perPlayerWeek) {
    const pid = key.slice(0, key.indexOf('|'));
    points.set(pid, (points.get(pid) ?? 0) + score);
  }
  return { points, maxCompletedWeek };
}

/** Build id → PlayerInfo from players feeds; prev-year primary (covers retirees), cur-year overlays fresher NFL team codes. */
export function buildPlayersById(
  prevPlayers: MflPlayersFeed | undefined,
  curPlayers: MflPlayersFeed | undefined
): Map<string, PlayerInfo> {
  const byId = new Map<string, PlayerInfo>();
  for (const feed of [prevPlayers, curPlayers]) {
    for (const p of feed?.players?.player ?? []) {
      if (!p?.id) continue;
      const existing = byId.get(p.id);
      byId.set(p.id, {
        id: p.id,
        name: p.name ? formatMflName(p.name) : (existing?.name ?? `Player #${p.id}`),
        position: p.position ?? existing?.position ?? '?',
        nflTeam: p.team ?? existing?.nflTeam ?? '',
      });
    }
  }
  return byId;
}

/**
 * Positions (PK/Def) whose league #1 finished KDEF_GAP_THRESHOLD+ points
 * clear of #2 — gradable that season under the dominance rule.
 */
export function computeKdefExceptions(
  points: Map<string, number>,
  playersById: Map<string, PlayerInfo>
): KeeperAnalysisSummary['kdefExceptions'] {
  const exceptions: KeeperAnalysisSummary['kdefExceptions'] = [];
  for (const position of KDEF_POSITIONS) {
    const ranked = [...points.entries()]
      .filter(([pid]) => playersById.get(pid)?.position === position)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (ranked.length < 2) continue;
    const gap = ranked[0][1] - ranked[1][1];
    if (gap >= KDEF_GAP_THRESHOLD) {
      exceptions.push({
        position,
        playerId: ranked[0][0],
        playerName: playersById.get(ranked[0][0])?.name ?? `Player #${ranked[0][0]}`,
        gap,
      });
    }
  }
  return exceptions;
}

/**
 * A franchise's opening roster for the points season: week-1 rostered
 * players (starters + nonstarters) once the season has begun, else the
 * current rosters feed (live pre-draft cycle — keeps only, verified 7/7).
 */
export function getOpeningRosterPids(
  curWeeklyRaw: WeeklyResultsRaw | undefined,
  curRosters: MflRostersFeed | undefined,
  franchiseId: string
): Set<string> {
  const weekOne = (curWeeklyRaw ?? []).find((e) => e?.weeklyResults?.week === '1');
  if (weekOne) {
    const pids = new Set<string>();
    const franchises = [
      ...asArray(weekOne.weeklyResults.matchup).flatMap((m) => asArray(m.franchise)),
      ...asArray(weekOne.weeklyResults.franchise),
    ];
    for (const fr of franchises) {
      if (fr.id !== franchiseId) continue;
      for (const p of asArray(fr.player)) if (p?.id) pids.add(p.id);
    }
    if (pids.size > 0) return pids;
  }
  const franchise = curRosters?.rosters?.franchise?.find((f) => f.id === franchiseId);
  return new Set(asArray(franchise?.player).map((p) => p.id));
}

/** Draft picks per franchise for the points season. */
export function getDraftedPidsByFranchise(
  draftResults: MflDraftResultsFeed | undefined
): Map<string, Set<string>> {
  const byFranchise = new Map<string, Set<string>>();
  for (const unit of asArray(draftResults?.draftResults?.draftUnit)) {
    for (const pick of asArray(unit?.draftPick)) {
      const fid = pick?.franchise;
      const pid = pick?.player;
      if (!fid || !pid || pid === '----') continue;
      if (!byFranchise.has(fid)) byFranchise.set(fid, new Set());
      byFranchise.get(fid)!.add(pid);
    }
  }
  return byFranchise;
}

/** kept = prevRoster ∩ opening − drafted. */
export function reconstructKeepers(
  prevRosterPids: Set<string>,
  curOpeningPids: Set<string>,
  curDraftedPids: Set<string>
): Set<string> {
  const kept = new Set<string>();
  for (const pid of prevRosterPids) {
    if (curOpeningPids.has(pid) && !curDraftedPids.has(pid)) kept.add(pid);
  }
  return kept;
}

/** Deterministic ranking: points desc, then id asc. */
function rankByPoints(pids: Iterable<string>, points: Map<string, number>): string[] {
  return [...pids].sort(
    (a, b) => (points.get(b) ?? 0) - (points.get(a) ?? 0) || a.localeCompare(b)
  );
}

/**
 * The hindsight-optimal seven for a prev roster (K/DEF excluded unless the
 * position earned a dominance exception) plus the unfiltered raw top seven.
 */
export function computeOptimalSeven(
  prevRosterPids: Set<string>,
  points: Map<string, number>,
  playersById: Map<string, PlayerInfo>,
  exceptionPositions: Set<string>
): { optimal: string[]; rawTopSeven: string[] } {
  const ranked = rankByPoints(prevRosterPids, points);
  const eligible = ranked.filter((pid) => {
    const position = playersById.get(pid)?.position ?? '?';
    return !KDEF_POSITIONS.has(position) || exceptionPositions.has(position);
  });
  return {
    optimal: eligible.slice(0, KEEPER_LIMIT),
    rawTopSeven: ranked.slice(0, KEEPER_LIMIT),
  };
}

/** Assemble one franchise's analyzed, ranked roster + grade tallies. */
export function gradeFranchise(
  franchiseId: string,
  prevRosterPids: Set<string>,
  kept: Set<string>,
  points: Map<string, number>,
  playersById: Map<string, PlayerInfo>,
  exceptionPositions: Set<string>
): FranchiseAnalysis {
  const { optimal, rawTopSeven } = computeOptimalSeven(
    prevRosterPids,
    points,
    playersById,
    exceptionPositions
  );
  const optimalSet = new Set(optimal);
  const rawTopSet = new Set(rawTopSeven);
  const ranked = rankByPoints(prevRosterPids, points);

  const players: AnalyzedPlayer[] = ranked.map((pid, i) => {
    const info = playersById.get(pid) ?? {
      id: pid,
      name: `Player #${pid}`,
      position: '?',
      nflTeam: '',
    };
    const isKept = kept.has(pid);
    const isOptimal = optimalSet.has(pid);
    const isKdef = KDEF_POSITIONS.has(info.position);
    const gradable = !isKdef || exceptionPositions.has(info.position);

    let badge: KeeperBadge | null = null;
    if (isKept && isOptimal) badge = 'hit';
    else if (isKept && !gradable) badge = 'kdef-neutral';
    else if (isKept) badge = 'miss';
    else if (isOptimal) badge = 'got-away';

    return {
      ...info,
      points: points.get(pid) ?? 0,
      rank: i + 1,
      kept: isKept,
      optimal: isOptimal,
      rawTopSeven: rawTopSet.has(pid),
      badge,
    };
  });

  const keptPlayers = players.filter((p) => p.kept);
  const keptPoints = keptPlayers.reduce((sum, p) => sum + p.points, 0);
  const optimalPoints = optimal.reduce((sum, pid) => sum + (points.get(pid) ?? 0), 0);

  return {
    franchiseId,
    players,
    keptCount: kept.size,
    hits: players.filter((p) => p.badge === 'hit').length,
    misses: players.filter((p) => p.badge === 'miss').length,
    gotAway: players.filter((p) => p.badge === 'got-away').length,
    kdefNeutralKept: players.filter((p) => p.badge === 'kdef-neutral').length,
    kdefRawTopSevenCount: players.filter(
      (p) => p.rawTopSeven && KDEF_POSITIONS.has(p.position)
    ).length,
    keptPoints,
    optimalPoints,
    efficiency: optimalPoints > 0 ? keptPoints / optimalPoints : 0,
  };
}

export interface BuildKeeperAnalysisInput {
  prevRosters: MflRostersFeed;
  prevPlayers?: MflPlayersFeed;
  curPlayers?: MflPlayersFeed;
  curWeeklyRaw?: WeeklyResultsRaw;
  curRosters?: MflRostersFeed;
  curDraftResults?: MflDraftResultsFeed;
}

/** Full page model for one cycle (prev-season rosters → cur-season points). */
export function buildKeeperAnalysis(input: BuildKeeperAnalysisInput): KeeperAnalysis {
  const playersById = buildPlayersById(input.prevPlayers, input.curPlayers);
  const { points, maxCompletedWeek } = computeSeasonPoints(input.curWeeklyRaw ?? []);
  const exceptions = computeKdefExceptions(points, playersById);
  const exceptionPositions = new Set(exceptions.map((e) => e.position));
  const draftedByFranchise = getDraftedPidsByFranchise(input.curDraftResults);

  const franchises: FranchiseAnalysis[] = [];
  for (const franchise of input.prevRosters?.rosters?.franchise ?? []) {
    const prevPids = new Set(asArray(franchise.player).map((p) => p.id));
    if (prevPids.size === 0) continue;
    const opening = getOpeningRosterPids(input.curWeeklyRaw, input.curRosters, franchise.id);
    const kept = reconstructKeepers(
      prevPids,
      opening,
      draftedByFranchise.get(franchise.id) ?? new Set()
    );
    franchises.push(
      gradeFranchise(franchise.id, prevPids, kept, points, playersById, exceptionPositions)
    );
  }

  franchises.sort(
    (a, b) => b.keptPoints - a.keptPoints || a.franchiseId.localeCompare(b.franchiseId)
  );

  const rankedFranchiseIds = franchises.map((f) => f.franchiseId);
  const summary: KeeperAnalysisSummary = {
    rankedFranchiseIds,
    bestFranchiseId: rankedFranchiseIds[0] ?? null,
    worstFranchiseId: rankedFranchiseIds[rankedFranchiseIds.length - 1] ?? null,
    franchisesWithKdefInRawTopSeven: franchises.filter((f) => f.kdefRawTopSevenCount > 0).length,
    franchisesThatKeptKdef: franchises.filter((f) =>
      f.players.some((p) => p.kept && KDEF_POSITIONS.has(p.position))
    ).length,
    kdefExceptions: exceptions,
    totalHits: franchises.reduce((sum, f) => sum + f.hits, 0),
    totalMisses: franchises.reduce((sum, f) => sum + f.misses, 0),
    totalGotAway: franchises.reduce((sum, f) => sum + f.gotAway, 0),
  };

  const previewMode = points.size === 0;
  return { franchises, summary, previewMode, throughWeek: maxCompletedWeek };
}
