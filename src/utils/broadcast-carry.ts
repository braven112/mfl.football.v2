/**
 * Hold a league's last good numbers across a poll its feed did not answer.
 *
 * PURE, and client-safe — the island imports it.
 *
 * ## The bug this exists for (Sep 2026, live slate)
 *
 * The board had exactly one rule for a failed read, and it was written at the
 * wrong granularity. `/api/broadcast-live` answers `ok: false` when the
 * ASSEMBLER fails, and the island throws on that and keeps its last good
 * payload. But an assembly in which one league's MFL read failed is a
 * SUCCESSFUL assembly — `ok: true` at the top, with that league contributing
 * `{ ok: false, teams: {}, winProbability: [] }` and nothing else, exactly as
 * `assembleBroadcastBoard` intends ("one dead feed is not an outage").
 *
 * The island then `setPoll(body)`'d it wholesale. No client code reads a
 * league's own `ok`, so an empty `teams` map renders as every default: `0.0`,
 * `Proj 0.0`, `0 to play`, and an empty player strip. On a live afternoon,
 * with four MFL reads per poll every eight seconds, MFL throttles one league
 * often enough that a television reset a real 87.0 to 0.0 and crept back up
 * over the next few polls — repeatedly, all day.
 *
 * "The feed says nothing" and "we could not reach the feed" are different
 * facts all the way to the pixels. That was already the rule for the whole
 * response; this applies it per league, which is the granularity the payload
 * actually fails at.
 *
 * ## Why it is bounded
 *
 * Carrying forever trades a wrong number for a frozen one — a score that has
 * not moved in three hours, presented as live, is its own lie. Past
 * `maxAgeMs` the carry expires and the league falls back to the honest empty
 * league the server sent. The island passes its own `STALE_MS`, so the board
 * gives up on a league at the same age it already stops claiming to be
 * current.
 */

import type { BroadcastLeagueScore } from '../types/live-broadcast';

/** One league's last good score, and when we received it. */
export interface CarriedLeagueScore {
  score: BroadcastLeagueScore;
  /** `Date.now()` at the poll that produced it. */
  at: number;
}

export interface CarryResult {
  /** The poll's leagues, with failed ones substituted where a carry exists. */
  leagues: BroadcastLeagueScore[];
  /** The next carry map. Replaces the previous one wholesale. */
  carried: Map<string, CarriedLeagueScore>;
}

/**
 * Substitute the last good numbers for any league whose read failed.
 *
 * A league is carried only on `ok: false`. `ok: true` with an empty `teams`
 * is the HEALTHY shape of a bye or an unplayed week, and overwriting that
 * with last week's numbers would print a score over a game nobody played —
 * the same "no games" / "couldn't read it" merge the server side already
 * refuses to make.
 *
 * The carried entry keeps its original `ok: false`, so the value stays
 * self-describing for anything that later learns to read it; only the numbers
 * are borrowed.
 */
export function carryLeagueScores(
  incoming: readonly BroadcastLeagueScore[],
  carried: ReadonlyMap<string, CarriedLeagueScore>,
  now: number,
  maxAgeMs: number,
): CarryResult {
  const next = new Map<string, CarriedLeagueScore>();
  const leagues: BroadcastLeagueScore[] = [];

  for (const league of incoming) {
    if (league.ok) {
      // A good read is the new truth AND the new fallback.
      next.set(league.leagueId, { score: league, at: now });
      leagues.push(league);
      continue;
    }

    const held = carried.get(league.leagueId);
    if (!held || now - held.at > maxAgeMs) {
      // Nothing to carry, or the carry has gone stale enough that a frozen
      // number is worse than an empty one. Ship what the server said.
      leagues.push(league);
      continue;
    }

    // Borrow the numbers, keep the failure flag, and keep the ORIGINAL
    // timestamp — a carry must age out on the last good READ, not on the last
    // poll that failed to replace it, or a league whose feed dies is carried
    // forever by its own failures.
    next.set(league.leagueId, held);
    leagues.push({ ...held.score, leagueId: league.leagueId, ok: false });
  }

  return { leagues, carried: next };
}

/** Seed the carry map from a payload already on screen (the first paint). */
export function seedCarry(
  leagues: readonly BroadcastLeagueScore[],
  at: number,
): Map<string, CarriedLeagueScore> {
  const out = new Map<string, CarriedLeagueScore>();
  for (const league of leagues) if (league.ok) out.set(league.leagueId, { score: league, at });
  return out;
}
