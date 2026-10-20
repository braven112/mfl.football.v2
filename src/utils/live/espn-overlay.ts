/**
 * ESPN-first live scores: move a player's points the moment ESPN's box score
 * has a stat MFL has not counted yet, then hand back to MFL once it catches up.
 *
 * Pure and client-safe. The board's island calls `overlayPanel` every render
 * with the week's box scores (`useNflGameDetail`), each league's MFL rules
 * (`/api/live-scoring-rules`) and a memory map it owns.
 *
 * ── WHY A BASELINE, NOT A SUM ─────────────────────────────────────────────
 * ESPN's box score cannot see everything a league scores (TD-length bonuses,
 * first downs, …), so the ESPN-scored number (`itemized`) is not the score by
 * itself. Each player carries a BASELINE: the gap `U = mfl − itemized` taken
 * when the two feeds agree, and the overlay shows `itemized + U` — MFL's
 * number moved by exactly what ESPN has scored since.
 *
 * "Agree" is decided by TIME, not by stability. MFL lags ESPN by a minute or
 * three, and during that lag NEITHER number moves, so "nothing changed for two
 * polls" is just as true while they disagree. A box-score line ESPN has left
 * alone for `SETTLE_MS` is one MFL has had time to score, so that is when the
 * baseline is retaken.
 *
 * Three rules keep it from inventing points:
 *  - Until ESPN's line moves past the baseline, the score IS MFL's.
 *  - Once MFL has moved past the baseline too, the score never drops below
 *    MFL's — MFL may have counted a bonus the box score cannot see.
 *  - A first sighting where ESPN is already ahead (gap below zero) starts from
 *    U = 0, so a board opened mid-drive shows the newer number at once instead
 *    of a "Not itemized" line below zero.
 */
import type { LivePlayerRow, PlayerBoxScore, PlayerMeta } from '../../types/live-scoring';
import type { LiveMatchup, LivePanel, LiveTeam } from '../../types/live';
import { winProbability } from '../live-win-probability';
import { scorePlayerStats, type PositionRuleSet } from './scoring-rules';

/** How long ESPN's line must sit unchanged before MFL is assumed caught up. */
export const SETTLE_MS = 3 * 60_000;
/** How long a line MFL still scores below ESPN may wait before it is taken as MFL's answer. */
export const STALE_MS = 15 * 60_000;

const EPS = 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;
const same = (a: number, b: number) => Math.abs(a - b) < EPS;

export interface PlayerBaseline {
  /** The unitemized gap MFL scores beyond the box score. */
  u: number;
  /** ESPN's itemized points when the baseline was taken. */
  baseItemized: number;
  /** MFL's points when the baseline was taken. */
  baseMfl: number;
  /** ESPN's itemized points at the last observation, and since when. */
  lastItemized: number;
  itemizedSince: number;
}

/** Keyed `leagueId:playerId` — same player, same rules, same answer. */
export type OverlayMemory = Map<string, PlayerBaseline>;

export interface OverlayPlayerInput {
  key: string;
  /** MFL's live points. */
  mfl: number;
  /** ESPN's box score scored by the league's rules, or null when unknown. */
  itemized: number | null;
  now: number;
  memory: OverlayMemory;
}

/** The newest score for one player. MFL's own number whenever ESPN has nothing newer. */
export function overlayPlayerLive({ key, mfl, itemized, now, memory }: OverlayPlayerInput): number {
  if (itemized === null || !Number.isFinite(itemized)) return mfl;

  let m = memory.get(key);
  if (!m) {
    const gap = mfl - itemized;
    m = {
      u: Math.max(0, gap),
      // ESPN already ahead: treat the line as new, so it shows now.
      baseItemized: gap < 0 ? Number.NEGATIVE_INFINITY : itemized,
      baseMfl: mfl,
      lastItemized: itemized,
      itemizedSince: now,
    };
    memory.set(key, m);
  }

  if (!same(itemized, m.lastItemized)) {
    m.lastItemized = itemized;
    m.itemizedSince = now;
  }
  // Settled — unless MFL is still BELOW ESPN, which means it has not scored
  // the line yet (it lags past SETTLE_MS on a busy Sunday). Retaking then
  // would snap the score back to MFL's older number. A gap that stays below
  // zero long after (a league scoring something negative the box score
  // cannot see) is accepted at STALE_MS.
  const quiet = now - m.itemizedSince;
  if (quiet >= STALE_MS || (quiet >= SETTLE_MS && mfl - itemized > -EPS)) {
    m.u = mfl - itemized;
    m.baseItemized = itemized;
    m.baseMfl = mfl;
  }

  if (same(itemized, m.baseItemized)) return mfl;
  const espn = round2(itemized + m.u);
  return same(mfl, m.baseMfl) ? espn : Math.max(mfl, espn);
}

export interface OverlayContext {
  boxScore: Record<string, PlayerBoxScore>;
  /** This panel's league rules; null/undefined leaves the panel on MFL's numbers. */
  rules: PositionRuleSet[] | null | undefined;
  meta: Record<string, PlayerMeta>;
  memory: OverlayMemory;
  now: number;
}

function itemizedFor(row: LivePlayerRow, ctx: OverlayContext & { rules: PositionRuleSet[] }): number | null {
  const box = ctx.boxScore[row.id];
  const position = ctx.meta[row.id]?.position ?? '';
  if (!box?.stats || position.toUpperCase() === 'DEF') return null;
  return scorePlayerStats({
    rules: ctx.rules,
    position,
    stats: box.stats,
    fgLengths: box.fgLengths,
    total: row.live,
  }).itemized;
}

function overlayRows(
  rows: readonly LivePlayerRow[],
  leagueId: string,
  ctx: OverlayContext & { rules: PositionRuleSet[] },
): { rows: LivePlayerRow[]; delta: number } {
  let delta = 0;
  const out = rows.map((row) => {
    const live = overlayPlayerLive({
      key: `${leagueId}:${row.id}`,
      mfl: row.live,
      itemized: itemizedFor(row, ctx),
      now: ctx.now,
      memory: ctx.memory,
    });
    if (same(live, row.live)) return row;
    delta += live - row.live;
    return { ...row, live };
  });
  return { rows: out, delta };
}

function overlayTeam(team: LiveTeam, leagueId: string, ctx: OverlayContext & { rules: PositionRuleSet[] }): LiveTeam {
  const starters = overlayRows(team.players, leagueId, ctx);
  const bench = overlayRows(team.bench, leagueId, ctx);
  if (starters.delta === 0 && bench.rows.every((r, i) => r === team.bench[i])) return team;
  return {
    ...team,
    // Only starters count. Remaining points depend on the clock and the
    // projection, never on live points, so they carry over untouched.
    live: round2(team.live + starters.delta),
    projectedFinal: round2(team.projectedFinal + starters.delta),
    players: starters.rows,
    bench: bench.rows,
  };
}

/** One panel with every row on its newest score, and totals and odds to match. */
export function overlayPanel(panel: LivePanel, ctx: OverlayContext): LivePanel {
  const rules = ctx.rules;
  // A Sleeper league is not scored by MFL rules.
  if (!rules || panel.provider === 'sleeper' || panel.matchups.length === 0) return panel;
  const full = { ...ctx, rules };
  let changed = false;
  const matchups = panel.matchups.map((m): LiveMatchup => {
    const s0 = overlayTeam(m.sides[0], panel.leagueId, full);
    const s1 = overlayTeam(m.sides[1], panel.leagueId, full);
    if (s0 === m.sides[0] && s1 === m.sides[1]) return m;
    changed = true;
    return {
      ...m,
      sides: [s0, s1],
      p0: winProbability(s0.projectedFinal, s1.projectedFinal, s0.remainingPoints + s1.remainingPoints),
    };
  });
  return changed ? { ...panel, matchups } : panel;
}
