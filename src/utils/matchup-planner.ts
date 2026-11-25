/**
 * Matchup Planner — the numbers behind Brandon's private planner page
 * (/theleague/admin/matchup-planner, /afl-fantasy/admin/matchup-planner).
 *
 * "What does each NFL defense give up to each position, in THIS league's
 * scoring, and who does my player face in the weeks I care about?"
 *
 * Three inputs, all keyed by MFL's own team codes (KCC, SFO, LVR …):
 *
 *   - MFL's `TYPE=pointsAllowed` export: season TOTALS per defense and
 *     position, scored with the league's rules. It is the authority for the
 *     season view. It takes no week parameter (W= is ignored, verified live
 *     2026-11-25), so it cannot answer "lately".
 *   - `playerScores-by-week.json` (every player's score, every week) joined to
 *     `players.json` (position + current team) and the NFL schedule. Summing a
 *     week's scores by the defense each player faced rebuilds the same totals
 *     week by week — 187 of 192 team/position totals matched MFL exactly on
 *     2026-11-25. The five that did not are players who changed teams: the
 *     players feed only knows today's team, so his pre-trade weeks are charged
 *     to the wrong defense. Good enough for a recent-form window; the season
 *     view uses MFL's totals instead.
 *   - The full NFL schedule (`nflSchedule-full.json`), for opponents, byes and
 *     which games are final.
 *
 * Averages divide by the games each defense has actually PLAYED, so a team
 * that has had its bye is not averaged over a game it never played.
 *
 * Rank follows the site's existing opponent-rank convention (nfl-matchups.ts):
 * 1 = gives up the FEWEST points (toughest matchup), 32 = gives up the most
 * (softest, best for your player).
 */

import { fpaTier } from './nfl-matchups';

/** Positions MFL's pointsAllowed export covers, in display order. */
export const PLANNER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'PK', 'Def'] as const;
export type PlannerPosition = (typeof PLANNER_POSITIONS)[number];

export const POSITION_LABELS: Record<PlannerPosition, string> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  PK: 'K',
  Def: 'DEF',
};

export function isPlannerPosition(pos: string): pos is PlannerPosition {
  return (PLANNER_POSITIONS as readonly string[]).includes(pos);
}

/** The recent-form window, in games played. */
export const RECENT_GAMES = 4;

export type AllowedWindow = 'season' | 'recent';

const asArray = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

// ── Schedule ────────────────────────────────────────────────────────────────

export interface ScheduleSlot {
  opp: string;
  home: boolean;
  /** The game is final (MFL: no seconds left and a score posted). */
  done: boolean;
  kickoff: number;
}

/** week → team → its game that week. A team absent from a week is on bye. */
export type ScheduleIndex = Map<number, Map<string, ScheduleSlot>>;

/** Index MFL's `nflSchedule` / `fullNflSchedule` export by week and team. */
export function indexSchedule(payload: any): ScheduleIndex {
  const weeks = asArray(payload?.fullNflSchedule?.nflSchedule ?? payload?.nflSchedule);
  const index: ScheduleIndex = new Map();
  for (const w of weeks) {
    const week = Number(w?.week);
    if (!Number.isInteger(week) || week < 1) continue;
    const slots = index.get(week) ?? new Map<string, ScheduleSlot>();
    for (const m of asArray(w?.matchup)) {
      const teams = asArray(m?.team);
      if (teams.length !== 2) continue;
      const done = String(m?.gameSecondsRemaining ?? '') === '0' && teams.every((t: any) => String(t?.score ?? '') !== '');
      const kickoff = Number(m?.kickoff) || 0;
      const [a, b] = teams;
      if (!a?.id || !b?.id) continue;
      slots.set(String(a.id), { opp: String(b.id), home: String(a.isHome) === '1', done, kickoff });
      slots.set(String(b.id), { opp: String(a.id), home: String(b.isHome) === '1', done, kickoff });
    }
    index.set(week, slots);
  }
  return index;
}

/** Every team code the schedule knows, sorted. */
export function scheduleTeams(schedule: ScheduleIndex): string[] {
  const teams = new Set<string>();
  for (const slots of schedule.values()) for (const t of slots.keys()) teams.add(t);
  return [...teams].sort();
}

/**
 * The first week with a game that is not final — the week being played now,
 * or the next one. Null once every game is final.
 */
export function currentWeek(schedule: ScheduleIndex): number | null {
  const weeks = [...schedule.keys()].sort((a, b) => a - b);
  for (const w of weeks) {
    for (const slot of schedule.get(w)!.values()) if (!slot.done) return w;
  }
  return null;
}

/** The last regular-season week the schedule carries (18 in a 17-game season). */
export function lastRegularWeek(schedule: ScheduleIndex): number {
  // Playoff weeks carry a handful of games; regular weeks carry 13–16.
  const regular = [...schedule.entries()].filter(([, slots]) => slots.size >= 20).map(([w]) => w);
  return regular.length ? Math.max(...regular) : 18;
}

// ── Points allowed ──────────────────────────────────────────────────────────

/** team → position → points. */
export type TeamPositionPoints = Record<string, Partial<Record<PlannerPosition, number>>>;

/** MFL's `TYPE=pointsAllowed` export → season totals per team and position. */
export function parseOfficialTotals(payload: any): TeamPositionPoints {
  const out: TeamPositionPoints = {};
  for (const team of asArray(payload?.pointsAllowed?.team)) {
    const code = String(team?.id ?? '');
    if (!code) continue;
    const row: Partial<Record<PlannerPosition, number>> = {};
    for (const p of asArray(team?.position)) {
      const name = String(p?.name ?? '');
      const pts = parseFloat(p?.points);
      if (isPlannerPosition(name) && Number.isFinite(pts)) row[name] = pts;
    }
    if (Object.keys(row).length) out[code] = row;
  }
  return out;
}

export interface PlannerPlayer {
  id: string;
  name: string;
  position: string;
  team: string;
}

/** `players.json` → id → player, planner positions only. */
export function indexPlayers(payload: any): Map<string, PlannerPlayer> {
  const out = new Map<string, PlannerPlayer>();
  for (const p of asArray(payload?.players?.player)) {
    if (!p?.id || !isPlannerPosition(String(p.position))) continue;
    out.set(String(p.id), { id: String(p.id), name: String(p.name ?? ''), position: String(p.position), team: String(p.team ?? '') });
  }
  return out;
}

/** team → week → position → points that defense allowed that week. */
export type WeeklyAllowed = Record<string, Record<number, Partial<Record<PlannerPosition, number>>>>;

/**
 * Rebuild points allowed week by week: each player's score that week is
 * charged to the defense his team faced. Only FINAL games count, so a week in
 * progress never shows up half-scored.
 */
export function buildWeeklyAllowed(
  scoresByWeek: Record<string | number, Record<string, number>>,
  players: Map<string, PlannerPlayer>,
  schedule: ScheduleIndex,
): WeeklyAllowed {
  const out: WeeklyAllowed = {};
  for (const [wk, scores] of Object.entries(scoresByWeek ?? {})) {
    const week = Number(wk);
    const slots = schedule.get(week);
    if (!slots) continue;
    // Seed every defense that played a final game this week, so a week where
    // nobody scored at a position still counts as a game with 0 allowed.
    for (const slot of slots.values()) {
      if (!slot.done) continue;
      out[slot.opp] ??= {};
      out[slot.opp][week] ??= {};
    }
    for (const [id, score] of Object.entries(scores ?? {})) {
      const p = players.get(id);
      if (!p || !Number.isFinite(score)) continue;
      const slot = slots.get(p.team);
      if (!slot?.done) continue;
      const row = (out[slot.opp] ??= {})[week] ??= {};
      const pos = p.position as PlannerPosition;
      row[pos] = (row[pos] ?? 0) + score;
    }
  }
  return out;
}

/** Final games each team has played, by week, oldest first. */
export function playedWeeks(schedule: ScheduleIndex, team: string): number[] {
  return [...schedule.entries()]
    .filter(([, slots]) => slots.get(team)?.done)
    .map(([w]) => w)
    .sort((a, b) => a - b);
}

export interface AllowedStat {
  /** Points allowed per game; null when the team has played no games. */
  avg: number | null;
  /** 1 = fewest allowed (toughest) … N = most allowed (softest). */
  rank: number | null;
  games: number;
}

export type AllowedSummary = Record<string, Record<PlannerPosition, AllowedStat>>;

/**
 * Per-game points allowed and rank, per team and position.
 *
 * `season` uses MFL's official totals when given (falling back to the rebuilt
 * weekly sums), divided by games played. `recent` averages each team's last
 * {@link RECENT_GAMES} final games from the weekly rebuild.
 */
export function summarizeAllowed(
  teams: string[],
  schedule: ScheduleIndex,
  weekly: WeeklyAllowed,
  official: TeamPositionPoints | null,
  window: AllowedWindow,
): AllowedSummary {
  const out: AllowedSummary = {};
  for (const team of teams) {
    // Weeks with a final game AND a weekly rebuild row (a week MFL has not yet
    // scored has no row, so it cannot be averaged in).
    const played = playedWeeks(schedule, team);
    const rebuilt = played.filter((w) => weekly[team]?.[w]);
    const recentWeeks = rebuilt.slice(-RECENT_GAMES);
    const row = {} as Record<PlannerPosition, AllowedStat>;
    for (const pos of PLANNER_POSITIONS) {
      let total: number | null = null;
      let games = 0;
      if (window === 'season' && official?.[team]?.[pos] != null) {
        total = official[team][pos]!;
        games = played.length;
      } else {
        const weeks = window === 'season' ? rebuilt : recentWeeks;
        games = weeks.length;
        total = weeks.reduce((sum, w) => sum + (weekly[team]?.[w]?.[pos] ?? 0), 0);
      }
      row[pos] = { avg: games > 0 && total != null ? round1(total / games) : null, rank: null, games };
    }
    out[team] = row;
  }
  // Rank per position: fewest allowed = 1.
  for (const pos of PLANNER_POSITIONS) {
    const ranked = teams
      .filter((t) => out[t][pos].avg != null)
      .sort((a, b) => out[a][pos].avg! - out[b][pos].avg! || a.localeCompare(b));
    ranked.forEach((t, i) => {
      out[t][pos].rank = i + 1;
    });
  }
  return out;
}

/** Mean of every team's per-game average at a position. */
export function leagueAverage(summary: AllowedSummary, pos: PlannerPosition): number | null {
  const vals = Object.values(summary).map((r) => r[pos].avg).filter((v): v is number => v != null);
  return vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

// ── Grid ────────────────────────────────────────────────────────────────────

export interface MatchupCell {
  week: number;
  bye: boolean;
  opp: string | null;
  home: boolean;
  /** What that defense allows per game to this player's position. */
  avg: number | null;
  rank: number | null;
  /** 1 (tough, red) … 4 (soft, green); null on a bye or with no data. */
  tier: 1 | 2 | 3 | 4 | null;
}

/** A player's opponent and its points-allowed stat for each week in `weeks`. */
export function matchupCells(
  player: Pick<PlannerPlayer, 'position' | 'team'>,
  weeks: number[],
  schedule: ScheduleIndex,
  summary: AllowedSummary,
): MatchupCell[] {
  const pos = isPlannerPosition(player.position) ? player.position : null;
  return weeks.map((week) => {
    const slot = schedule.get(week)?.get(player.team);
    if (!slot) return { week, bye: true, opp: null, home: false, avg: null, rank: null, tier: null };
    const stat = pos ? summary[slot.opp]?.[pos] : undefined;
    const rank = stat?.rank ?? null;
    return {
      week,
      bye: false,
      opp: slot.opp,
      home: slot.home,
      avg: stat?.avg ?? null,
      rank,
      tier: rank != null ? fpaTier(scaleRank(rank, Object.keys(summary).length)) : null,
    };
  });
}

/**
 * One number for a stretch of weeks: the average of what the opponents allow
 * per game, with a bye counted as 0 (no game, no points). Higher = softer.
 */
export function stretchScore(cells: MatchupCell[]): number | null {
  if (!cells.length) return null;
  if (cells.some((c) => !c.bye && c.avg == null)) return null;
  return round1(cells.reduce((sum, c) => sum + (c.bye ? 0 : c.avg!), 0) / cells.length);
}

/** Season points per game from the weekly score feed (weeks with a row). */
export function pointsPerGame(
  id: string,
  team: string,
  scoresByWeek: Record<string | number, Record<string, number>>,
  schedule: ScheduleIndex,
): { ppg: number | null; games: number } {
  let total = 0;
  let games = 0;
  for (const [wk, scores] of Object.entries(scoresByWeek ?? {})) {
    const score = scores?.[id];
    if (score == null || !Number.isFinite(score)) continue;
    // Only weeks his team actually played: a 0 on a bye is not a game.
    if (!schedule.get(Number(wk))?.get(team)?.done) continue;
    total += score;
    games += 1;
  }
  return { ppg: games ? round1(total / games) : null, games };
}

// ── Query ───────────────────────────────────────────────────────────────────

export const MAX_RANGE = 5;
export const PLAYOFF_WEEKS = { from: 15, to: 17 } as const;

export interface PlannerQuery {
  view: 'grid' | 'table';
  window: AllowedWindow;
  from: number;
  to: number;
  pos: PlannerPosition | 'all';
  /** Table: the position column to sort by (most allowed first). */
  sort: PlannerPosition;
}

/** Read the planner's query string; every value is clamped to something valid. */
export function parsePlannerQuery(params: URLSearchParams, maxWeek = 18): PlannerQuery {
  const view = params.get('view') === 'table' ? 'table' : 'grid';
  const window: AllowedWindow = params.get('window') === 'recent' ? 'recent' : 'season';
  const clampWeek = (v: string | null, fallback: number) => {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isInteger(n) ? Math.min(Math.max(n, 1), maxWeek) : fallback;
  };
  let from = clampWeek(params.get('from'), Math.min(PLAYOFF_WEEKS.from, maxWeek));
  let to = clampWeek(params.get('to'), Math.min(PLAYOFF_WEEKS.to, maxWeek));
  if (from > to) [from, to] = [to, from];
  if (to - from + 1 > MAX_RANGE) to = from + MAX_RANGE - 1;
  const posParam = params.get('pos') ?? 'all';
  const pos = isPlannerPosition(posParam) ? posParam : 'all';
  const sortParam = params.get('sort') ?? '';
  const sort = isPlannerPosition(sortParam) ? sortParam : 'RB';
  return { view, window, from, to, pos, sort };
}

/** The planner link with some values changed; defaults are left out of the URL. */
export function plannerHref(path: string, league: string | null, q: PlannerQuery, patch: Partial<PlannerQuery>): string {
  const next = { ...q, ...patch };
  const sp = new URLSearchParams();
  if (league) sp.set('league', league);
  if (next.view !== 'grid') sp.set('view', next.view);
  if (next.window !== 'season') sp.set('window', next.window);
  if (next.from !== PLAYOFF_WEEKS.from || next.to !== PLAYOFF_WEEKS.to) {
    sp.set('from', String(next.from));
    sp.set('to', String(next.to));
  }
  if (next.pos !== 'all') sp.set('pos', next.pos);
  if (next.sort !== 'RB') sp.set('sort', next.sort);
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Map a rank out of `n` teams onto the 32-team scale `fpaTier` expects. */
function scaleRank(rank: number, n: number): number {
  return n > 0 && n !== 32 ? Math.max(1, Math.round((rank / n) * 32)) : rank;
}
