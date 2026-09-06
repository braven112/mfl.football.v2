/**
 * MFL `liveScoring` payload → the snapshot every live surface reads.
 *
 * PURE. Extracted from `src/pages/api/live-scoring.ts` (Sept 2026) when the
 * Sunday Ticket board needed the same parse server-side for its first paint.
 * Copying it would have been the second implementation of MFL's franchise
 * shape, and this repo's forked-sibling history says how that ends — so the
 * route and the page both call this now, and it is fixture-tested directly.
 *
 * Three feed behaviours are encoded here, each one a bug that shipped:
 *
 *  - **MFL collapses a one-element list to a bare object.** `liveScoring`
 *    nests franchises under `.franchise[]` OR under `.matchup[].franchise[]`
 *    depending on the league's setup, and either can arrive as a lone object.
 *    Every list goes through `asArray`.
 *  - **A row MFL does not confirm as `nonstarter` is a STARTER.** Dropping a
 *    real starter silently subtracts his points from a matchup, which is far
 *    worse than showing one extra row.
 *  - **Bench rows travel in their OWN map.** Everything downstream reads
 *    `players` as "the rows that score this matchup" — projections, win
 *    probability, the scoring ticker. A bench row folded in there inflates
 *    every one of them with points that cannot be scored, so a caller has to
 *    opt IN to `bench`. See docs/claude/rules/live-scoring.md.
 */

import type { LivePlayerRow, MatchupPairing } from '../types/live-scoring';

/** Everything one league's `liveScoring&DETAILS=1` export yields. */
export interface LiveSnapshot {
  /** Per-franchise live fantasy total. */
  scores: Record<string, number>;
  /** Per-franchise NFL game-seconds still to be played across the lineup (0 = every game final). */
  remaining: Record<string, number>;
  /** Franchise pairings for the week, as MFL groups them. */
  matchups: MatchupPairing[];
  /** STARTERS only, keyed by franchise id. The rows that score the matchup. */
  players: Record<string, LivePlayerRow[]>;
  /** Bench rows, keyed by franchise id. A franchise with no bench is ABSENT. */
  bench: Record<string, LivePlayerRow[]>;
  /** Per-franchise count of starters whose NFL game has not kicked off. */
  playersYetToPlay: Record<string, number>;
}

export function emptyLiveSnapshot(): LiveSnapshot {
  return { scores: {}, remaining: {}, matchups: [], players: {}, bench: {}, playersYetToPlay: {} };
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/**
 * Parse an MFL `liveScoring` payload. Never throws: a malformed or empty body
 * yields an empty snapshot, which callers must tell apart from a failed
 * request themselves — `res.ok` and "the feed says nothing" are different
 * facts and merging them is the recurring bug class this file exists inside.
 */
export function parseLiveScoringPayload(data: any): LiveSnapshot {
  const snapshot = emptyLiveSnapshot();

  let franchises: any[] = [];
  if (data?.liveScoring?.franchise) {
    franchises = asArray<any>(data.liveScoring.franchise);
  } else if (data?.liveScoring?.matchup) {
    for (const matchup of asArray<any>(data.liveScoring.matchup)) {
      if (!matchup?.franchise) continue;
      const teams = asArray<any>(matchup.franchise);
      franchises.push(...teams);
      if (teams.length >= 2 && teams[0]?.id && teams[1]?.id) {
        snapshot.matchups.push({ home: String(teams[0].id), away: String(teams[1].id) });
      }
    }
  }

  for (const team of franchises) {
    if (!team?.id) continue;
    const fid = String(team.id);
    snapshot.scores[fid] = Number(team.score) || 0;
    snapshot.remaining[fid] = Number(team.gameSecondsRemaining) || 0;
    if (team.playersYetToPlay != null) {
      snapshot.playersYetToPlay[fid] = Number(team.playersYetToPlay) || 0;
    }

    // MFL nests the per-player breakdown as franchise.players.player[] in
    // liveScoring but flat franchise.player[] in weeklyResults — accept either.
    const rawPlayers = team?.players?.player ?? team?.player;
    if (!rawPlayers) continue;

    const starters: LivePlayerRow[] = [];
    const reserves: LivePlayerRow[] = [];
    for (const p of asArray<any>(rawPlayers)) {
      if (!p?.id) continue;
      const status = String(p.status || 'starter');
      const row: LivePlayerRow = {
        id: String(p.id),
        live: Number(p.score) || 0,
        secondsRemaining: Number(p.gameSecondsRemaining) || 0,
        status,
      };
      (status === 'nonstarter' ? reserves : starters).push(row);
    }
    snapshot.players[fid] = starters;
    if (reserves.length) snapshot.bench[fid] = reserves;
  }

  return snapshot;
}

/**
 * Does this snapshot describe a week MFL is actually scoring?
 *
 * MFL does not answer an unplayed week with an error, or an empty body, or
 * even an empty franchise list. It answers with a fully-formed 200: every
 * franchise present, every score "0.00", every player listed as `nonstarter`
 * (no lineup was ever submitted), and `gameSecondsRemaining` of 0. Verified
 * against both leagues for 2026 week 10 — 24 and 16 franchises, zero starters,
 * zero points.
 *
 * Read literally that payload says "both teams finished on 0.0", and a board
 * that believes it prints `Final 0.0 - 0.0` over a game that has not been
 * played. That is worse than printing nothing: it is confidently wrong, and
 * an owner has no way to tell it from a real shutout.
 *
 * The signal is STARTERS. MFL cannot be scoring a week in which no franchise
 * has a single starter on the field. A genuinely live week that is still 0-0
 * in the first quarter has starters; an unplayed week never does. A non-zero
 * score anywhere also counts, so a week whose DETAILS breakdown is missing but
 * whose totals are real still reads as live.
 *
 * This generalizes the rule docs/claude/rules/live-scoring.md states for week
 * 1 ("MFL serves no live scoring before Week 1 kicks off") to every week: the
 * pre-kickoff gap is not special, it is just the case we hit first.
 */
export function hasLiveSignal(snapshot: LiveSnapshot): boolean {
  for (const rows of Object.values(snapshot.players)) {
    if (rows.length > 0) return true;
  }
  for (const score of Object.values(snapshot.scores)) {
    if (score !== 0) return true;
  }
  return false;
}
