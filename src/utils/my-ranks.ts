/**
 * The site owner's own ranks, by the KIND of decision a page asks for.
 *
 * Brandon's private board (private-rankings.ts) holds several lists; each
 * page wants a different one (Brandon, 2026-11-22):
 *
 *   week      Set Lineup — this week, falling back to rest of season. NEVER
 *             dynasty: a lineup is a one-week decision.
 *   season    Free Agents, Players, Rosters — rest of season in season, the
 *             preseason redraft list off season.
 *   contract  Trade Builder, contract pages — a per-player blend that follows
 *             years left: 1 year = all redraft, 2 = half and half, 3+ = 25%
 *             redraft / 75% dynasty. A one-year deal IS a redraft.
 *   blend     Auction prep, AFL keepers — his own redraft/dynasty slider.
 *   rookie    Rookie drafts.
 *
 * Pure: the board, contract years, the blend share and the season flag come
 * in as arguments, so the tests drive every branch. The API
 * (src/pages/api/my-ranks.ts) assembles them; nothing here reaches anyone but
 * the site owner, and nothing here is persisted.
 */

import type { BoardFile, BoardPlayer } from './private-rankings-view';

export const MY_RANK_KINDS = ['week', 'season', 'contract', 'blend', 'rookie'] as const;
export type MyRankKind = (typeof MY_RANK_KINDS)[number];

export interface MyRankList {
  /** Which list this is, for the tooltip under the "My Rank" label. */
  label: string;
  /** MFL player id → overall rank (1 = best). */
  ranks: Record<string, number>;
}

export type MyRanks = Record<MyRankKind, MyRankList>;

/** Redis key for the Blend slider, one per league. Holds a number, never ranking data. */
export const blendKey = (slug: string) => `my-ranks:blend:${slug}`;

/** Default redraft share of the Blend slider, in percent. */
export const DEFAULT_BLEND_REDRAFT_PCT = 50;

/** Redraft share by contract years left (Q13). Unrostered players count as one year. */
export function contractRedraftShare(yearsLeft: number | null | undefined): number {
  const y = Number(yearsLeft);
  if (!Number.isFinite(y) || y <= 1) return 1;
  if (y === 2) return 0.5;
  return 0.25;
}

type Score = [id: string, score: number];

/** Turn scores (lower = better) into ordinal ranks 1..n. Ties keep board order. */
export function toOrdinal(scores: Score[]): Record<string, number> {
  const sorted = scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s[1] - b.s[1] || a.i - b.i);
  const out: Record<string, number> = {};
  sorted.forEach(({ s }, n) => {
    out[s[0]] = n + 1;
  });
  return out;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A player's redraft score: ROS in season, the preseason list off season, each falling back to the other. */
export function redraftScore(p: BoardPlayer, inSeason: boolean): number | null {
  const ros = p.season?.ros;
  const pre = finite(p.redraft?.fbg) ? p.redraft!.fbg! : p.redraft?.fp?.rank;
  const [first, second] = inSeason ? [ros, pre] : [pre, ros];
  if (finite(first)) return first;
  return finite(second) ? second : null;
}

function collect(players: BoardPlayer[], score: (p: BoardPlayer) => number | null): Score[] {
  const out: Score[] = [];
  for (const p of players) {
    if (!p.id) continue;
    const s = score(p);
    if (finite(s)) out.push([p.id, s]);
  }
  return out;
}

/**
 * Mix redraft and dynasty ranks. Each side is first made ordinal over the same
 * pool so the two scales match; a player on only one list keeps that side.
 */
function blendRanks(
  players: BoardPlayer[],
  inSeason: boolean,
  redraftShareFor: (id: string) => number,
): Record<string, number> {
  const red = toOrdinal(collect(players, (p) => redraftScore(p, inSeason)));
  const dyn = toOrdinal(collect(players, (p) => (finite(p.dynasty?.avg) ? p.dynasty!.avg! : null)));
  const scores: Score[] = [];
  for (const p of players) {
    if (!p.id) continue;
    const r = red[p.id];
    const d = dyn[p.id];
    if (r == null && d == null) continue;
    if (r == null) scores.push([p.id, d]);
    else if (d == null) scores.push([p.id, r]);
    else {
      const w = Math.min(1, Math.max(0, redraftShareFor(p.id)));
      scores.push([p.id, w * r + (1 - w) * d]);
    }
  }
  return toOrdinal(scores);
}

/** This week: projected points, best first; players with no weekly line follow in ROS order. */
function weekRanks(players: BoardPlayer[], inSeason: boolean): Record<string, number> {
  const weekly = players.filter((p) => p.id && finite(p.season?.weekPts));
  const byPts = toOrdinal(weekly.map((p) => [p.id!, -(p.season!.weekPts as number)] as Score));
  const n = weekly.length;
  const rest = toOrdinal(
    collect(players.filter((p) => !(p.id! in byPts)), (p) => redraftScore(p, inSeason)),
  );
  const out = { ...byPts };
  for (const [id, r] of Object.entries(rest)) out[id] = n + r;
  return out;
}

export interface MyRanksInput {
  board: BoardFile;
  /** Is the NFL season being played (ROS is the redraft list)? */
  inSeason: boolean;
  /** MFL player id → contract years left, for rostered players (TheLeague). */
  contractYears?: Record<string, number>;
  /** The Blend slider's redraft share, 0–100. */
  blendRedraftPct?: number;
}

export function buildMyRanks({ board, inSeason, contractYears = {}, blendRedraftPct = DEFAULT_BLEND_REDRAFT_PCT }: MyRanksInput): MyRanks {
  const players = board.players;
  const pct = Math.round(Math.min(100, Math.max(0, finite(blendRedraftPct) ? blendRedraftPct : DEFAULT_BLEND_REDRAFT_PCT)));
  const redraftLabel = inSeason ? 'rest of season' : 'redraft';
  return {
    week: { label: 'this week', ranks: weekRanks(players, inSeason) },
    season: { label: redraftLabel, ranks: toOrdinal(collect(players, (p) => redraftScore(p, inSeason))) },
    contract: {
      label: 'contract blend',
      ranks: blendRanks(players, inSeason, (id) => contractRedraftShare(contractYears[id])),
    },
    blend: {
      label: `your blend, ${pct}% redraft / ${100 - pct}% dynasty`,
      ranks: blendRanks(players, inSeason, () => pct / 100),
    },
    rookie: { label: 'rookie', ranks: toOrdinal(collect(players, (p) => (finite(p.rookie?.avg) ? p.rookie!.avg! : null))) },
  };
}
