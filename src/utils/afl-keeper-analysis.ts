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
 * Classes are graded on POINTS OVER REPLACEMENT, not raw points. Raw points
 * lie in two directions at once: they flatter a kicker (whose 154-point
 * season is ~60 points better than a free one) and they flatter whoever
 * inherited the deepest roster. PoR plus the real lineup slots fixes both,
 * and it replaced four hand-written special cases that were each
 * approximating some piece of it — the K/DEF exclusion, its dominance
 * threshold, the one-QB cap, and the backup-QB points carve-out.
 *
 * Pure module: callers inject parsed feed JSON; no file/network I/O here.
 */

import { KEEPER_LIMIT } from './afl-keeper-constants';
import { formatMflName } from './player-name-matching';

/** First prev-season year of the keeper era (cycle = prevYear → prevYear+1). */
export const AFL_KEEPER_ERA_FIRST_PREV_YEAR = 2024;

/**
 * Lineup slots one franchise starts each week. The AFL starts 9: one QB,
 * one kicker, one defense, and six flex from RB/WR/TE.
 *
 * These caps are what make a keeper slot worth anything: a player with no
 * free slot has nowhere to play, so keeping him buys zero startable
 * production no matter what he scored. That covers a second QB (which the
 * old MAX_OPTIMAL_QBS rule handled by hand) and equally a second kicker or
 * defense, or a SEVENTH flex keep — only six of RB/WR/TE can start.
 */
export const LINEUP_SLOTS = { QB: 1, PK: 1, Def: 1, FLEX: 6 } as const;
export type SlotGroup = keyof typeof LINEUP_SLOTS;

const FLEX_POSITIONS = new Set(['RB', 'WR', 'TE']);

/**
 * Games a keeper who does NOT win a starting slot actually starts, by group.
 *
 * Bench keeps are not worthless and they are not equal to each other. A
 * seventh skill player covers the bye of ANY of the six flex starters, so he
 * is in the lineup roughly six times; a second quarterback only covers QB1's
 * single bye (or an injury), so he plays about once. Treating both as zero —
 * or both as equal — misprices the most common keeper decision on the board.
 *
 * Only the FIRST bench keep at a group earns this; a third QB or an eighth
 * skill player is behind someone who already covers the bye, so he starts
 * ~never and scores 0.
 */
export const BENCH_EXPECTED_STARTS: Record<SlotGroup, number> = {
  QB: 1,
  PK: 1,
  Def: 1,
  FLEX: 6,
};

/** Which starting slot a position competes for, or null if it can't start. */
export function slotGroupFor(position: string): SlotGroup | null {
  if (FLEX_POSITIONS.has(position)) return 'FLEX';
  if (position === 'QB' || position === 'PK' || position === 'Def') return position;
  return null;
}

/**
 * Minimum weeks rostered before a player can set a replacement baseline.
 * Someone rostered for two weeks is a churn artifact, not the guy you would
 * actually have started all year.
 */
const REPLACEMENT_MIN_WEEKS = 8;

/**
 * How many players we need to see BEYOND the last startable slot before the
 * boundary player counts as a measured replacement level rather than a guess.
 */
const MIN_OBSERVATIONS_PAST_SLOTS = 3;

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

/** MFL playerScores (W=YTD): season totals for every player in the pool. */
export interface MflPlayerScoresFeed {
  playerScores?: {
    week?: string;
    playerScore?: Array<{ id?: string; score?: string }> | { id?: string; score?: string };
  };
}

/**
 * Season totals from the YTD playerScores feed, keyed by player id.
 * Returns undefined when the feed is absent or unusable so callers can fall
 * back rather than silently grading against an empty baseline.
 */
export function parsePlayerScoresYtd(
  feed: MflPlayerScoresFeed | undefined
): Map<string, number> | undefined {
  const rows = asArray(feed?.playerScores?.playerScore);
  if (rows.length === 0) return undefined;
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!row?.id) continue;
    const score = Number.parseFloat(row.score ?? '');
    if (!Number.isFinite(score)) continue;
    totals.set(row.id, score);
  }
  return totals.size > 0 ? totals : undefined;
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

export type KeeperBadge = 'hit' | 'miss' | 'got-away';

export interface AnalyzedPlayer extends PlayerInfo {
  /** Raw regular-season points — what the table's Pts column shows. */
  points: number;
  /** Points above a freely available player at the same slot. Drives grades. */
  pointsOverReplacement: number;
  /** 1-based rank on this franchise's prev roster by raw points. */
  rank: number;
  kept: boolean;
  /** In the value-maximising keeper set this roster could have picked. */
  optimal: boolean;
  /** Whether he fills a starting slot or covers byes; null if unplaced. */
  role: KeeperRole | null;
  badge: KeeperBadge | null;
}

export interface FranchiseAnalysis {
  franchiseId: string;
  players: AnalyzedPlayer[];
  keptCount: number;
  hits: number;
  misses: number;
  gotAway: number;
  /**
   * Keeps valued as bye-week cover rather than starters. A seventh skill
   * player covers six starters' byes (~6 starts); a second QB covers one.
   */
  benchKept: number;
  /**
   * Keeps that missed the optimal set but had no better alternative on the
   * roster — a slot spent on nobody, not a decision anyone got wrong.
   * `hits + misses + fillerKept === keptCount`.
   */
  fillerKept: number;
  /** PoR delivered by the best lineup-legal seven out of the players kept. */
  keptValue: number;
  /** PoR of the best lineup-legal seven the roster could have kept. */
  optimalValue: number;
  /**
   * keptValue / optimalValue, 0..1 (0 when optimalValue is 0). The page's
   * headline measure and ranking key. Bounded at 1 by construction: both
   * sides are built by the same slot-capped selection over the same PoR
   * values, and the kept set is a subset of the roster.
   */
  efficiency: number;
}

export interface KeeperAnalysisSummary {
  /**
   * Franchise ids ranked by efficiency desc (keptValue breaks ties) — the
   * page's single measure of a keeper class. See the sort in
   * buildKeeperAnalysis for why it isn't raw value.
   */
  rankedFranchiseIds: string[];
  bestFranchiseId: string | null;
  worstFranchiseId: string | null;
  /** Points-per-week a free replacement returned at each slot this season. */
  replacement: ReplacementLevels;
  /**
   * True when replacement came from the full-pool YTD feed. False means it
   * was estimated from rostered players only, which cannot see free agents
   * and biases the baseline upward at thin positions.
   */
  replacementFromFullPool: boolean;
  /**
   * Groups whose observed pool was shallower than their startable slots, so
   * replacement fell back to the worst visible player. Those groups' values
   * are biased upward — the page says so rather than presenting them as fact.
   */
  replacementClamped: ReplacementClamped;
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
  { points: Map<string, number>; weeks: Map<string, number>; maxCompletedWeek: number }
>();

export function computeSeasonPoints(weeklyRaw: WeeklyResultsRaw): {
  points: Map<string, number>;
  /** Weeks the player was rostered by someone (the denominator for PoR). */
  weeks: Map<string, number>;
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
  const weeks = new Map<string, number>();
  for (const [key, score] of perPlayerWeek) {
    const pid = key.slice(0, key.indexOf('|'));
    points.set(pid, (points.get(pid) ?? 0) + score);
    weeks.set(pid, (weeks.get(pid) ?? 0) + 1);
  }
  const result = { points, weeks, maxCompletedWeek };
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

/** Points-per-week a freely available player returns, by slot group. */
export type ReplacementLevels = Record<SlotGroup, number>;

/**
 * Groups where the observed pool was shallower than the number of startable
 * slots, so replacement fell back to "the worst player we could see" — which
 * is not a replacement level and biases that group's values upward. Surfaced
 * so the page can say so instead of presenting the number as fact.
 */
export type ReplacementClamped = SlotGroup[];

/**
 * Replacement level: the per-week rate of the best player at each slot group
 * you could NOT have started, i.e. the guy sitting one spot past the last
 * starting slot in your player pool.
 *
 * The pool is ONE CONFERENCE (12 teams), not the 24-franchise league. The
 * AFL's two conferences draft independently from the same NFL player
 * universe — the same player can be rostered in both at once — so a manager
 * competes with 11 rivals for starters, not 23. Using 24 would place
 * replacement far too deep and inflate everyone's value over it.
 *
 * The conferences are separate pools but share ONE baseline, which is
 * deliberate and was measured, not assumed: in 2025, 273 of ~306 rostered
 * players appeared in BOTH conferences, and restricting the calculation to
 * either conference alone produced identical replacement rates at every slot
 * (QB 19.59, FLEX 11.03, PK 7.26, Def 6.95). Both conferences independently
 * roster the same productive players, so the player sitting at each slot
 * boundary is the same one. Splitting the baseline per conference would be
 * more code for a guaranteed no-op.
 *
 * This is the whole reason the grading no longer needs position filters. A
 * kicker's raw total looks like a mid-tier running back's, but nearly all of
 * it is available for free — measured over replacement, Brandon Aubrey's 154
 * points become ~60 while Christian McCaffrey's 328 stay ~305. The old
 * K/DEF exclusion and its dominance-threshold escape hatch were hand-made
 * approximations of this number.
 *
 * `ytdTotals` (MFL's playerScores W=YTD feed) is authoritative because it
 * covers EVERY player, including the free agents that define replacement.
 * Without it we fall back to the rostered pool, which can only see players
 * somebody kept — that biases replacement upward at thin positions, so the
 * fallback is an approximation, not an equivalent.
 */
export function computeReplacementLevels(
  points: Map<string, number>,
  weeks: Map<string, number>,
  playersById: Map<string, PlayerInfo>,
  /** Franchises competing for one player pool — a conference, not the league. */
  teamsPerPool: number,
  maxCompletedWeek: number,
  ytdTotals?: Map<string, number>,
  /**
   * Weeks the YTD totals actually span. MFL's W=YTD includes playoff weeks
   * (the 2025 feed is stamped week 18) while our points are regular-season
   * only (week 14), so dividing a YTD total by maxCompletedWeek inflates
   * replacement ~17% at every slot. Divide by the feed's own week instead so
   * numerator and denominator share a basis.
   */
  ytdWeeks?: number
): { levels: ReplacementLevels; clamped: ReplacementClamped } {
  const levels: ReplacementLevels = { QB: 0, PK: 0, Def: 0, FLEX: 0 };
  const clamped: ReplacementClamped = [];
  if (teamsPerPool <= 0 || maxCompletedWeek <= 0) return { levels, clamped };

  // Season totals for everyone we can see, preferring the full-pool feed —
  // but ONLY when we know how many weeks those totals span. MFL may stamp the
  // feed's week as the literal string "YTD", which parses to NaN; silently
  // falling back to maxCompletedWeek would divide an 18-week total by 14 and
  // inflate replacement ~29% with `replacementFromFullPool` still reporting
  // true, so the page would never warn. A span shorter than the regular
  // season is equally untrustworthy.
  const ytdSpan = ytdWeeks && Number.isFinite(ytdWeeks) ? ytdWeeks : 0;
  const ytdUsable = ytdSpan >= maxCompletedWeek;
  const useYtd = !!ytdTotals && ytdTotals.size > 0 && ytdUsable;
  const rates: Record<SlotGroup, number[]> = { QB: [], PK: [], Def: [], FLEX: [] };
  const source = useYtd ? ytdTotals! : points;
  for (const [pid, total] of source) {
    const group = slotGroupFor(playersById.get(pid)?.position ?? '');
    if (!group) continue;
    // The YTD feed has no games-played, so its totals are full-season by
    // definition; the rostered fallback must normalise by weeks rostered and
    // ignore short stints that would drag the baseline down.
    if (useYtd) {
      rates[group].push(total / ytdSpan);
    } else {
      const w = weeks.get(pid) ?? 0;
      if (w < Math.min(REPLACEMENT_MIN_WEEKS, maxCompletedWeek)) continue;
      rates[group].push(total / w);
    }
  }

  for (const group of Object.keys(levels) as SlotGroup[]) {
    const list = rates[group].sort((a, b) => b - a);
    if (list.length === 0) continue;
    // Index of the first player past the last startable one in the pool.
    const startable = LINEUP_SLOTS[group] * teamsPerPool;
    // Clamped when we cannot see past the last startable slot, and equally
    // when we can barely see past it: with 13 kickers against 12 slots the
    // "replacement kicker" is the single worst one anybody rostered, which is
    // an estimate, not a measurement.
    if (list.length < startable + MIN_OBSERVATIONS_PAST_SLOTS) clamped.push(group);
    levels[group] = list[Math.min(startable, list.length - 1)] ?? 0;
  }
  return { levels, clamped };
}

/**
 * A player's value over a freely available alternative, charged only for the
 * weeks he was actually rostered — a half-season keeper is measured against
 * half a season of replacement, not a full one.
 */
export function pointsOverReplacement(
  pid: string,
  points: Map<string, number>,
  playersById: Map<string, PlayerInfo>,
  replacement: ReplacementLevels,
  seasonWeeks: number,
  /** Games he actually starts. Defaults to the full season (a starting keep). */
  expectedStarts?: number
): number {
  const group = slotGroupFor(playersById.get(pid)?.position ?? '');
  if (!group || seasonWeeks <= 0) return 0;
  // A keeper slot is a SEASON-LONG commitment, so the charge is a full
  // season of replacement — not one scaled to the weeks he happened to be
  // rostered. Scaling by weeks rostered reduces value to
  // `weeks × (rate − replacement)`, which lets a hot one-week sample beat a
  // full-season starter: Younghoe Koo (1 week, 9.7 points) made a franchise's
  // optimal seven and rendered as a "Got away" row. If a keeper missed games,
  // the hole in the lineup is his cost to carry.
  const rate = (points.get(pid) ?? 0) / seasonWeeks;
  // Clamp bench starts to the season length. BENCH_EXPECTED_STARTS.FLEX is 6,
  // so before Week 6 an unclamped bench keep would be credited more starts
  // than the season has had — making riding the bench worth MORE than
  // starting, and breaking the precondition (starter multiplier >= bench
  // multiplier) that makes selectBestKeepers exact.
  const starts = Math.min(expectedStarts ?? seasonWeeks, seasonWeeks);
  return starts * (rate - replacement[group]);
}

/** Where a keeper sits in the lineup: a starting slot, or bye-week cover. */
export type KeeperRole = 'starter' | 'bench';

export interface SelectedKeeper {
  pid: string;
  role: KeeperRole;
  value: number;
}

/**
 * The most valuable KEEPER_LIMIT-sized set from `pids`, given the lineup
 * slots — and, unlike a pure starters-only model, crediting bye-week cover.
 *
 * Within a group the highest-rate players take the starting slots and the
 * next one becomes bench cover, so a group's value depends only on HOW MANY
 * of it you take. That makes exact selection cheap: enumerate the per-group
 * counts (each capped at starters + 1 bench, since a further backup sits
 * behind someone who already covers the bye) and keep the best total. No
 * greedy heuristic, no matroid argument required.
 */
export function selectBestKeepers(
  pids: Iterable<string>,
  playersById: Map<string, PlayerInfo>,
  valueOf: (pid: string, group: SlotGroup, role: KeeperRole) => number
): SelectedKeeper[] {
  const byGroup = new Map<SlotGroup, string[]>();
  for (const pid of pids) {
    const group = slotGroupFor(playersById.get(pid)?.position ?? '');
    if (!group) continue;
    (byGroup.get(group) ?? byGroup.set(group, []).get(group)!).push(pid);
  }

  const groups = [...byGroup.keys()];
  // Rank each group by its starter-basis value, then precompute what taking
  // exactly k of that group is worth (starters first, then one bench slot).
  const ranked = new Map<SlotGroup, SelectedKeeper[]>();
  for (const group of groups) {
    const sorted = byGroup
      .get(group)!
      .sort((a, b) => valueOf(b, group, 'starter') - valueOf(a, group, 'starter') || a.localeCompare(b));
    const cap = Math.min(sorted.length, LINEUP_SLOTS[group] + 1);
    ranked.set(
      group,
      sorted.slice(0, cap).map((pid, i) => {
        const role: KeeperRole = i < LINEUP_SLOTS[group] ? 'starter' : 'bench';
        return { pid, role, value: valueOf(pid, group, role) };
      })
    );
  }

  let best: SelectedKeeper[] = [];
  let bestValue = 0;
  const walk = (gi: number, remaining: number, picked: SelectedKeeper[], total: number) => {
    if (gi === groups.length) {
      if (total > bestValue) {
        bestValue = total;
        best = [...picked];
      }
      return;
    }
    const list = ranked.get(groups[gi])!;
    for (let k = 0; k <= Math.min(list.length, remaining); k++) {
      const take = list.slice(0, k);
      // A negative-value keep never helps, so stop extending this group.
      if (k > 0 && take[k - 1].value <= 0) break;
      walk(gi + 1, remaining - k, [...picked, ...take], total + take.reduce((sum, x) => sum + x.value, 0));
    }
  };
  walk(0, KEEPER_LIMIT, [], 0);
  return best;
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

/** Assemble one franchise's analyzed, ranked roster + grade tallies. */
export function gradeFranchise(
  franchiseId: string,
  prevRosterPids: Set<string>,
  kept: Set<string>,
  points: Map<string, number>,
  playersById: Map<string, PlayerInfo>,
  replacement: ReplacementLevels,
  seasonWeeks: number
): FranchiseAnalysis {
  const valueOf = (pid: string, _group: SlotGroup, role: KeeperRole) =>
    pointsOverReplacement(
      pid,
      points,
      playersById,
      replacement,
      seasonWeeks,
      role === 'starter' ? seasonWeeks : BENCH_EXPECTED_STARTS[_group]
    );

  // The ceiling: the best keeper set this roster could have picked.
  const optimal = selectBestKeepers(prevRosterPids, playersById, valueOf);
  const optimalById = new Map(optimal.map((k) => [k.pid, k]));
  // What the class delivered: the same selection over the players kept, so
  // the numerator can never outrun the denominator.
  const keptBest = selectBestKeepers(kept, playersById, valueOf);
  const keptById = new Map(keptBest.map((k) => [k.pid, k]));

  // Rows stay ordered by raw points — that is the column an owner scans.
  const ranked = rankByPoints(prevRosterPids, points);

  const players: AnalyzedPlayer[] = ranked.map((pid, i) => {
    const info = playersById.get(pid) ?? {
      id: pid,
      name: `Player #${pid}`,
      position: '?',
      nflTeam: '',
    };
    const isKept = kept.has(pid);
    const optimalEntry = optimalById.get(pid);
    const keptEntry = keptById.get(pid);

    // Badge assignment happens after the loop — whether a non-optimal keep
    // is a MISS depends on whether a better player was actually available,
    // which is a franchise-level fact (see missIds below).
    let badge: KeeperBadge | null = null;
    if (isKept && optimalEntry) badge = 'hit';
    else if (optimalEntry) badge = 'got-away';

    return {
      ...info,
      points: points.get(pid) ?? 0,
      // Starter-basis value: what he'd be worth holding a starting slot all
      // season. Used for ordering, not rendered — the card shows raw points.
      pointsOverReplacement: pointsOverReplacement(
        pid,
        points,
        playersById,
        replacement,
        seasonWeeks
      ),
      role: (keptEntry ?? optimalEntry)?.role ?? null,
      rank: i + 1,
      kept: isKept,
      optimal: !!optimalEntry,
      badge,
    };
  });

  // A keep only counts as a MISS when someone better actually got away.
  // Every got-away displaced exactly one keep, so the count of misses is the
  // count of got-aways — capped by how many non-optimal keeps there are.
  //
  // Without this, a thin roster whose ceiling holds only three players worth
  // keeping graded "100% of optimal · 3/7 hits": it captured everything there
  // was to capture, yet four keeps were branded misses for having no better
  // alternative to pick. The remaining keeps are filler — a slot spent on
  // nobody, which is not a decision anyone got wrong.
  const gotAwayCount = optimal.filter((k) => !kept.has(k.pid)).length;
  // Rank the candidates by what they were actually WORTH to this class — the
  // role-aware value from keptBest where it exists, starter basis otherwise.
  // Sorting on the starter-basis number instead would blame a keep by a
  // figure the valuation itself rejects: a redundant QB2 with a big starter
  // number but ~1 game of real cover would outrank a modest flex and escape
  // the Miss badge, inverting the decision this page exists to price.
  const realisedValue = (p: AnalyzedPlayer) =>
    keptById.get(p.id)?.value ?? p.pointsOverReplacement;
  const nonOptimalKeeps = players
    .filter((p) => p.kept && !p.optimal)
    .sort((a, b) => realisedValue(a) - realisedValue(b));
  const missIds = new Set(
    nonOptimalKeeps.slice(0, Math.min(nonOptimalKeeps.length, gotAwayCount)).map((p) => p.id)
  );
  for (const p of players) if (missIds.has(p.id)) p.badge = 'miss';

  const keptValue = keptBest.reduce((sum, k) => sum + k.value, 0);
  const optimalValue = optimal.reduce((sum, k) => sum + k.value, 0);

  return {
    franchiseId,
    players,
    keptCount: kept.size,
    hits: players.filter((p) => p.badge === 'hit').length,
    misses: missIds.size,
    /** Keeps with no better alternative on the roster — not a wrong call. */
    fillerKept: players.filter((p) => p.kept && !p.optimal && !missIds.has(p.id)).length,
    gotAway: players.filter((p) => p.badge === 'got-away').length,
    benchKept: keptBest.filter((k) => k.role === 'bench').length,
    keptValue,
    optimalValue,
    efficiency: optimalValue > 0 ? keptValue / optimalValue : 0,
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
  /**
   * Franchises sharing one player pool. The AFL's conferences roster
   * independently from the same NFL universe, so this is 12 (one
   * conference), NOT the 24 franchises the page renders. Defaults to the
   * franchise count for callers with a single undivided pool.
   */
  teamsPerPool?: number;
  /**
   * MFL playerScores W=YTD for the points season — season totals for EVERY
   * player, not just rostered ones. Authoritative for replacement level,
   * because replacement is by definition set by players nobody kept. Omit
   * it and the baseline falls back to the rostered pool (see
   * computeReplacementLevels).
   */
  curPlayerScoresYtd?: MflPlayerScoresFeed;
}

/** Full page model for one cycle (prev-season rosters → cur-season points). */
export function buildKeeperAnalysis(input: BuildKeeperAnalysisInput): KeeperAnalysis {
  const playersById = buildPlayersById(input.prevPlayers, input.curPlayers);
  const { points, weeks, maxCompletedWeek } = computeSeasonPoints(input.curWeeklyRaw ?? []);
  const unitDrafted = getUnitDraftedPidsByFranchise(input.curDraftResults);
  const prevFranchises = input.prevRosters?.rosters?.franchise ?? [];
  const official = resolveOfficialKeepers(
    input.keeperSnapshots ?? [],
    prevFranchises.map((f) => f.id)
  );

  const ytdTotals = parsePlayerScoresYtd(input.curPlayerScoresYtd);
  const ytdWeeks = Number.parseInt(input.curPlayerScoresYtd?.playerScores?.week ?? '', 10);
  const { levels: replacement, clamped: replacementClamped } = computeReplacementLevels(
    points,
    weeks,
    playersById,
    input.teamsPerPool ?? prevFranchises.length,
    maxCompletedWeek,
    ytdTotals,
    Number.isFinite(ytdWeeks) ? ytdWeeks : undefined
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
      gradeFranchise(franchise.id, prevPids, kept, points, playersById, replacement, maxCompletedWeek)
    );
  }

  // Rank by efficiency — the share of its own ceiling a class captured — not
  // by raw value. Raw totals mostly measure the roster a manager inherited:
  // across the 2024→2025 cycle the ceiling ranged 2.1x from thinnest roster
  // to deepest, which nobody chose. Ranking on it called The Show the
  // league's worst class for nearly maxing out a thin roster while a perfect
  // 7-for-7 finished third. Captured value breaks ties (the same share of a
  // bigger ceiling is the better class), then id for determinism.
  franchises.sort(
    (a, b) =>
      b.efficiency - a.efficiency ||
      b.keptValue - a.keptValue ||
      a.franchiseId.localeCompare(b.franchiseId)
  );

  const rankedFranchiseIds = franchises.map((f) => f.franchiseId);
  const summary: KeeperAnalysisSummary = {
    rankedFranchiseIds,
    bestFranchiseId: rankedFranchiseIds[0] ?? null,
    worstFranchiseId: rankedFranchiseIds[rankedFranchiseIds.length - 1] ?? null,
    replacement,
    replacementFromFullPool: !!ytdTotals && ytdTotals.size > 0,
    replacementClamped,
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
