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
 * escape hatch — no unit has cleared it in the five seasons checked; the
 * closest was the 2021 Patriots defense at 33). They still surface as
 * neutral "raw top 7" flags.
 *
 * Pure module: callers inject parsed feed JSON; no file/network I/O here.
 */

import { KEEPER_LIMIT } from './afl-keeper-constants';
import { formatMflName } from './player-name-matching';

/** First prev-season year of the keeper era (cycle = prevYear → prevYear+1). */
export const AFL_KEEPER_ERA_FIRST_PREV_YEAR = 2024;

/** #1-vs-#2 positional gap that makes a K/DEF gradable for a season. */
export const KDEF_GAP_THRESHOLD = 40;

const KDEF_POSITIONS = new Set(['PK', 'Def']);

/**
 * No team keeps two QBs, so only a roster's top-scoring QB is eligible for
 * the optimal seven, and a kept backup QB is neutral — never a miss.
 */
export const MAX_OPTIMAL_QBS = 1;

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
  players: {
    player: Array<{ id: string; name?: string; position?: string; team?: string; espn_id?: string }>;
  };
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
  /** ESPN player id from the MFL feed — powers PlayerCell's ESPN headshot cascade. */
  espnId?: string;
}

// --- Output shapes ---

export type KeeperBadge = 'hit' | 'miss' | 'got-away' | 'kdef-neutral' | 'qb2-neutral';

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
  /**
   * Kept backup QBs (beyond the team's best kept QB) — shown, never a miss
   * and never a hit; their points are excluded from keptPoints entirely.
   */
  backupQbNeutralKept: number;
  /** K/DEF that cracked the raw (unfiltered) top seven. */
  kdefRawTopSevenCount: number;
  keptPoints: number;
  optimalPoints: number;
  /**
   * keptPoints / optimalPoints, 0..1 (0 when optimalPoints is 0). The page's
   * headline measure and its ranking key: it grades the keeper decision
   * against the ceiling of the roster the manager actually had. Backup-QB
   * points are excluded from keptPoints (see gradeFranchise), which is what
   * keeps a class from scoring above its own ceiling.
   */
  efficiency: number;
}

export interface KeeperAnalysisSummary {
  /**
   * Franchise ids ranked by efficiency desc (keptPoints breaks ties) — the
   * page's single measure of a keeper class. See the sort in
   * buildKeeperAnalysis for why it isn't raw kept points.
   */
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

export interface KeeperSnapshot {
  /** ISO date (YYYY-MM-DD) the snapshot was taken. */
  date: string;
  rosters: MflRostersFeed;
}

export interface KeeperAnalysis {
  franchises: FranchiseAnalysis[];
  summary: KeeperAnalysisSummary;
  /**
   * Where the keeper classes came from: 'official' = a post-deadline
   * roster-history snapshot with every franchise at exactly KEEPER_LIMIT
   * (the roster IS the keeps between the July 15 cut deadline and the
   * late-August draft); 'reconstructed' = inferred from prev roster ∩
   * opening roster − conference draft picks (cycles that predate the
   * snapshot archive).
   */
  keeperSource: 'official' | 'reconstructed';
  /** Snapshot date backing an 'official' source, else null. */
  keeperSnapshotDate: string | null;
  /** True when the points season hasn't produced any scores yet (pre-week-1). */
  previewMode: boolean;
  /**
   * Highest regular-season week with any recorded scores (0 in preview
   * mode). During a live game weekend this includes the in-flight week —
   * scores accrue as the feeds refresh.
   */
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
const seasonPointsMemo = new WeakMap<
  WeeklyResultsRaw,
  { points: Map<string, number>; maxCompletedWeek: number }
>();

export function computeSeasonPoints(weeklyRaw: WeeklyResultsRaw): {
  points: Map<string, number>;
  maxCompletedWeek: number;
} {
  // The feed arrays come from eager import.meta.glob modules whose identity
  // is stable for the life of the deploy, so a WeakMap memo makes every
  // request after the first a lookup.
  const memoized = weeklyRaw ? seasonPointsMemo.get(weeklyRaw) : undefined;
  if (memoized) return memoized;

  const perPlayerWeek = new Map<string, number>();
  let maxCompletedWeek = 0;

  for (const entry of weeklyRaw ?? []) {
    const wr = entry?.weeklyResults;
    if (!wr) continue;
    const week = Number.parseInt(wr.week ?? '', 10);
    // A missing/unparseable week would collapse every such entry onto one
    // `pid|NaN` dedupe key (last write wins) — skip the entry entirely.
    if (!Number.isFinite(week)) continue;

    const matchups = asArray(wr.matchup);
    const regularMatchups = matchups.filter((m) => m.regularSeason !== '0');
    const franchises: MflWeeklyFranchise[] = regularMatchups.flatMap((m) =>
      asArray(m.franchise)
    );
    // Top-level franchise blocks (franchises idle that week) only belong in
    // regular-season totals when the week itself is a regular-season week —
    // i.e. it has at least one regular-season matchup. Playoff weeks list
    // eliminated franchises here with real scores (2025's week 17 carries
    // six as regularSeason:'0' matchups; 2026's weeks 15-17 have NO matchup
    // entries at all, only 24 top-level blocks), and counting either shape
    // inflates "regular-season" totals and maxCompletedWeek.
    if (regularMatchups.length > 0) {
      franchises.push(...asArray(wr.franchise));
    }

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
    if (weekHasScores) {
      maxCompletedWeek = Math.max(maxCompletedWeek, week);
    }
  }

  const points = new Map<string, number>();
  for (const [key, score] of perPlayerWeek) {
    const pid = key.slice(0, key.indexOf('|'));
    points.set(pid, (points.get(pid) ?? 0) + score);
  }
  const result = { points, maxCompletedWeek };
  if (weeklyRaw) seasonPointsMemo.set(weeklyRaw, result);
  return result;
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
        espnId: p.espn_id ?? existing?.espnId,
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
 * players (starters + nonstarters) once the season has begun. The
 * rosters.json fallback applies ONLY when the season has no week-1 entry
 * at all (live pre-draft cycle, where the roster is the keeps — verified
 * 7/7): for a completed season, rosters.json is the FINAL snapshot, and
 * falling back to it would count mid-season re-acquisitions as "keeps".
 * A franchise absent from an existing week 1 returns an empty set — a
 * loudly-wrong 0-keep card beats a silently redefined keeper class.
 */
export function getOpeningRosterPids(
  curWeeklyRaw: WeeklyResultsRaw | undefined,
  curRosters: MflRostersFeed | undefined,
  franchiseId: string
): Set<string> {
  const weekOne = (curWeeklyRaw ?? []).find((e) => e?.weeklyResults?.week === '1');
  if (weekOne) {
    const franchises = [
      ...asArray(weekOne.weeklyResults.matchup).flatMap((m) => asArray(m.franchise)),
      ...asArray(weekOne.weeklyResults.franchise),
    ];
    // Pre-season, the feed already carries a week-1 SCHEDULE SHELL: matchup
    // franchises with id/isHome/spread but no player lists. Week 1 is only
    // authoritative once ANY franchise carries players; a bare shell falls
    // through to the rosters fallback below (live pre-draft cycle).
    const weekOneHasPlayers = franchises.some((fr) => asArray(fr.player).some((p) => p?.id));
    if (weekOneHasPlayers) {
      const pids = new Set<string>();
      for (const fr of franchises) {
        if (fr.id !== franchiseId) continue;
        for (const p of asArray(fr.player)) if (p?.id) pids.add(p.id);
      }
      return pids;
    }
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

/**
 * For each franchise, every player drafted in ITS draft unit (= its
 * conference — the AFL's AL and NL draft separately from duplicate player
 * pools). A player drafted anywhere in the franchise's own unit re-entered
 * that conference's pool and can't be one of its keeps (covers
 * drafted-elsewhere-then-traded-back), while the SAME NFL player being
 * drafted in the other conference says nothing about this one.
 */
export function getUnitDraftedPidsByFranchise(
  draftResults: MflDraftResultsFeed | undefined
): Map<string, Set<string>> {
  const byFranchise = new Map<string, Set<string>>();
  for (const unit of asArray(draftResults?.draftResults?.draftUnit)) {
    const unitPids = new Set<string>();
    const unitFids = new Set<string>();
    for (const pick of asArray(unit?.draftPick)) {
      if (pick?.franchise) unitFids.add(pick.franchise);
      const pid = pick?.player;
      if (pid && pid !== '----') unitPids.add(pid);
    }
    for (const fid of unitFids) {
      const existing = byFranchise.get(fid);
      if (existing) {
        for (const pid of unitPids) existing.add(pid);
      } else {
        byFranchise.set(fid, new Set(unitPids));
      }
    }
  }
  return byFranchise;
}

/**
 * The official keeper list from post-deadline roster snapshots.
 *
 * Between the keeper cut deadline and the draft, every franchise's MFL
 * roster IS its keeper class — but the cuts process over several days
 * after the deadline (2026: declarations due July 15, rosters settled to
 * 24×7 on July 17). So: take the snapshots in date order and return the
 * first one where EVERY expected franchise is present with exactly
 * KEEPER_LIMIT players. Requiring coverage of `expectedFranchiseIds`
 * (the prev-season roster's franchises) guards against a truncated
 * snapshot payload qualifying with its missing franchises silently
 * zeroed. Returns null when no snapshot qualifies (archive gaps,
 * pre-2026 cycles, cuts that never settle inside the window).
 */
export function resolveOfficialKeepers(
  snapshots: KeeperSnapshot[],
  expectedFranchiseIds: Iterable<string>
): { byFranchise: Map<string, Set<string>>; date: string } | null {
  const expected = [...expectedFranchiseIds];
  if (expected.length === 0) return null;
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  for (const snapshot of sorted) {
    const byFranchise = new Map<string, Set<string>>();
    for (const fr of snapshot.rosters?.rosters?.franchise ?? []) {
      byFranchise.set(fr.id, new Set(asArray(fr.player).map((p) => p.id)));
    }
    const settled = expected.every((fid) => byFranchise.get(fid)?.size === KEEPER_LIMIT);
    if (settled) return { byFranchise, date: snapshot.date };
  }
  return null;
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
 * The hindsight-optimal seven for a prev roster plus the unfiltered raw
 * top seven. Position rules:
 * - K/DEF excluded unless the position earned a dominance exception.
 * - At most one QB (the roster's top scorer) — no team keeps two.
 */
export function computeOptimalSeven(
  prevRosterPids: Set<string>,
  points: Map<string, number>,
  playersById: Map<string, PlayerInfo>,
  exceptionPositions: Set<string>
): { optimal: string[]; rawTopSeven: string[] } {
  const ranked = rankByPoints(prevRosterPids, points);
  let qbsTaken = 0;
  const eligible = ranked.filter((pid) => {
    const position = playersById.get(pid)?.position ?? '?';
    if (KDEF_POSITIONS.has(position) && !exceptionPositions.has(position)) return false;
    if (position === 'QB') {
      if (qbsTaken >= MAX_OPTIMAL_QBS) return false;
      qbsTaken += 1;
    }
    return true;
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

  // The marginal alternative: the lowest-scoring optimal player the team
  // did NOT keep. A kept K/DEF or backup QB that outscored them was a good
  // keeper in hindsight — grade it a hit, not a neutral.
  const optimalNotKept = optimal.filter((pid) => !kept.has(pid));
  const marginalAltPoints = optimalNotKept.length
    ? Math.min(...optimalNotKept.map((pid) => points.get(pid) ?? 0))
    : Infinity;

  // A team's best-scoring kept QB grades normally; further kept QBs are
  // backups — nobody keeps two, so they can never be a miss.
  const topKeptQb = ranked.find((pid) => kept.has(pid) && playersById.get(pid)?.position === 'QB');

  const players: AnalyzedPlayer[] = ranked.map((pid, i) => {
    const info = playersById.get(pid) ?? {
      id: pid,
      name: `Player #${pid}`,
      position: '?',
      nflTeam: '',
    };
    const playerPoints = points.get(pid) ?? 0;
    const isKept = kept.has(pid);
    const isOptimal = optimalSet.has(pid);
    const isNeutralKdef =
      KDEF_POSITIONS.has(info.position) && !exceptionPositions.has(info.position);
    const isBackupKeptQb = isKept && info.position === 'QB' && pid !== topKeptQb;
    const beatMarginalAlt = playerPoints > marginalAltPoints;

    // A backup QB can only start on the starter's bye or an injury, so his
    // season total was never actually available to the lineup — it can't pay
    // off a keeper slot and never grades a hit. A kicker or defense DOES
    // start every week, so a K/DEF that beat the marginal alternative is a
    // real, earned hit.
    let badge: KeeperBadge | null = null;
    if (isKept && isOptimal) badge = 'hit';
    else if (isKept && isNeutralKdef) badge = beatMarginalAlt ? 'hit' : 'kdef-neutral';
    else if (isBackupKeptQb) badge = 'qb2-neutral';
    else if (isKept) badge = 'miss';
    else if (isOptimal) badge = 'got-away';

    return {
      ...info,
      points: playerPoints,
      rank: i + 1,
      kept: isKept,
      optimal: isOptimal,
      rawTopSeven: rawTopSet.has(pid),
      badge,
    };
  });

  // Kept points count each QB slot ONCE: only the best kept QB contributes.
  // A backup QB's season total is startable-in-theory only (bye weeks and
  // injuries), so crediting it overstates what the keeper class actually put
  // in lineups — and, because the optimal seven allows just one QB, crediting
  // it also let a team's kept points exceed its own ceiling. Kickers and
  // defenses keep counting in full: they start every week.
  const keptPlayers = players.filter((p) => p.kept);
  const keptPoints = keptPlayers.reduce(
    (sum, p) => (p.badge === 'qb2-neutral' ? sum : sum + p.points),
    0
  );
  const optimalPoints = optimal.reduce((sum, pid) => sum + (points.get(pid) ?? 0), 0);

  return {
    franchiseId,
    players,
    keptCount: kept.size,
    hits: players.filter((p) => p.badge === 'hit').length,
    misses: players.filter((p) => p.badge === 'miss').length,
    gotAway: players.filter((p) => p.badge === 'got-away').length,
    kdefNeutralKept: players.filter((p) => p.badge === 'kdef-neutral').length,
    backupQbNeutralKept: players.filter((p) => p.badge === 'qb2-neutral').length,
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
  /**
   * Post-deadline roster-history snapshots for the points season (July
   * window). When one qualifies as official (all franchises at exactly
   * KEEPER_LIMIT), it becomes the keeper source and reconstruction is
   * skipped.
   */
  keeperSnapshots?: KeeperSnapshot[];
}

/** Full page model for one cycle (prev-season rosters → cur-season points). */
export function buildKeeperAnalysis(input: BuildKeeperAnalysisInput): KeeperAnalysis {
  const playersById = buildPlayersById(input.prevPlayers, input.curPlayers);
  const { points, maxCompletedWeek } = computeSeasonPoints(input.curWeeklyRaw ?? []);
  const exceptions = computeKdefExceptions(points, playersById);
  const exceptionPositions = new Set(exceptions.map((e) => e.position));
  const unitDrafted = getUnitDraftedPidsByFranchise(input.curDraftResults);
  const prevFranchises = input.prevRosters?.rosters?.franchise ?? [];
  const official = resolveOfficialKeepers(
    input.keeperSnapshots ?? [],
    prevFranchises.map((f) => f.id)
  );

  const franchises: FranchiseAnalysis[] = [];
  for (const franchise of prevFranchises) {
    const prevPids = new Set(asArray(franchise.player).map((p) => p.id));
    if (prevPids.size === 0) continue;
    const drafted = unitDrafted.get(franchise.id) ?? new Set<string>();
    let kept: Set<string>;
    if (official) {
      // The official list intersected with the prev roster (the page grades
      // last season's roster, so a keep acquired via offseason trade isn't a
      // hindsight call about it), minus the conference draft pool — a keep
      // dropped after the settle date and re-drafted re-entered the pool,
      // same invariant the reconstruction path enforces.
      kept = new Set(
        [...(official.byFranchise.get(franchise.id) ?? [])].filter(
          (pid) => prevPids.has(pid) && !drafted.has(pid)
        )
      );
    } else {
      const opening = getOpeningRosterPids(input.curWeeklyRaw, input.curRosters, franchise.id);
      kept = reconstructKeepers(prevPids, opening, drafted);
    }
    franchises.push(
      gradeFranchise(franchise.id, prevPids, kept, points, playersById, exceptionPositions)
    );
  }

  // Rank by efficiency (share of the optimal seven captured), NOT by raw
  // kept points. Raw points mostly measure how good the roster already was:
  // across the 2024→2025 cycle the optimal-seven bar ranged from 875 to 1842
  // points, a 2.1x spread nobody chose. Ranking on it called The Show the
  // league's worst keeper class for keeping 89% of a thin roster's ceiling,
  // while two franchises that went a perfect 7-for-7 at 100% of optimal
  // ranked behind a team that had made a mistake. Efficiency grades the
  // decision instead of the inheritance. Kept points break ties (same share
  // of a bigger ceiling is the better class) before the id tiebreak keeps it
  // deterministic.
  franchises.sort(
    (a, b) =>
      b.efficiency - a.efficiency ||
      b.keptPoints - a.keptPoints ||
      a.franchiseId.localeCompare(b.franchiseId)
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
  return {
    franchises,
    summary,
    previewMode,
    throughWeek: maxCompletedWeek,
    keeperSource: official ? 'official' : 'reconstructed',
    keeperSnapshotDate: official?.date ?? null,
  };
}
