/**
 * The Owners' Poll — tally and voter-scoring math.
 *
 * Pure functions (no file I/O, no league literals, no clock) behind the weekly
 * owner vote that publishes inside The Pecking Order. Same split as
 * pecking-order-math.mjs: the algorithm lives here so it is unit-testable and
 * the scoring rules exist in exactly one place.
 *
 * Only the close pass needs this — the consensus is computed once, written
 * into the week's issue JSON, and read back from there by every page. The
 * ballot rules both this and the API enforce live in
 * src/utils/owners-poll-ballot.mjs instead.
 *
 * Scoring, in full:
 *
 *   Borda. On a ballot of `slots` teams, slot 1 earns `slots` points, slot 2
 *   earns `slots - 1`, … slot `slots` earns 1. Every ballot therefore carries
 *   an identical point pool, which is what makes one owner's ballot worth
 *   exactly one owner's ballot.
 *
 *   Teams with zero points are NOT ranked 8th, 9th, 10th by the poll — they
 *   are unranked, and they are presented as their own block ordered by the
 *   Pecking Order composite. With a 7-slot ballot in a 16-team league that
 *   tail is real, and calling it a ranking would be a lie about what the
 *   ballots said. See docs/plans/owners-poll.md, "One tension worth naming".
 *
 * See docs/plans/owners-poll.md.
 */

import { normalizeFranchiseId } from '../../src/utils/franchise-id.mjs';
import { pairwiseAccuracy, toRankMap } from '../../src/utils/owners-poll-accuracy.mjs';

// Re-exported, not reimplemented: the accountability page computes accuracy at
// render time (it needs the week AFTER the ballot) and cannot import from
// scripts/, so the function lives in src/utils and both sides share it.
export { pairwiseAccuracy };

/** Points a 1-indexed ballot slot is worth on a ballot of `slots` teams. */
export function bordaPoints(slot, slots) {
  if (!Number.isInteger(slot) || !Number.isInteger(slots)) return 0;
  if (slot < 1 || slot > slots) return 0;
  return slots - slot + 1;
}

/** Total points a single ballot distributes — the same for every ballot. */
export function ballotPointPool(slots) {
  if (!Number.isInteger(slots) || slots < 1) return 0;
  return (slots * (slots + 1)) / 2;
}

/** Human-readable scoring line, derived so it can't drift from the math. */
export function describeScoring(slots, quorum, eligibleVoters) {
  return (
    `Each owner ranks ${slots} teams · ` +
    `${slots} points for 1st down to 1 for ${ordinal(slots)} · ` +
    `${quorum} of ${eligibleVoters} ballots required`
  );
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/**
 * Tally one week's ballots into a consensus.
 *
 * @param {object} args
 * @param {Array<{ franchiseId: string, ranking: string[] }>} args.ballots
 *   Already validated (see parseStoredBallot) — every ranking is exactly
 *   `slots` long, deduped, and restricted to this league's franchises.
 * @param {string[]} args.eligibleFranchiseIds Every franchise in the league.
 * @param {number} args.slots Ballot depth.
 * @param {number} args.quorum Minimum ballots to publish a consensus.
 * @param {Map<string, number>|Record<string, number>} args.compositeRankByFid
 *   The Pecking Order's algorithmic rank per franchise — the tiebreaker, and
 *   the ordering of the unranked block.
 *
 * @returns {{
 *   ballotsIn: number, eligibleVoters: number, quorum: number,
 *   hasQuorum: boolean,
 *   ranked: Array<{ rank, franchiseId, points, firstPlaceVotes, ballotsRanking,
 *     avgBallotRank, compositeRank, delta }>|null,
 *   unranked: Array<{ franchiseId, compositeRank }>|null,
 * }}
 *
 * `ranked` and `unranked` are **null**, not empty arrays, when quorum isn't
 * met. A caller that forgets to check gets a crash rather than a page that
 * silently renders a consensus of nobody.
 */
export function tallyOwnersPoll({
  ballots,
  eligibleFranchiseIds,
  slots,
  quorum,
  compositeRankByFid,
}) {
  const eligible = Array.from(eligibleFranchiseIds ?? [], (id) => normalizeFranchiseId(id));
  const composite = toRankMap(compositeRankByFid);
  const ballotsIn = Array.isArray(ballots) ? ballots.length : 0;
  const eligibleVoters = eligible.length;
  const hasQuorum = Number.isInteger(quorum) && ballotsIn >= quorum;

  const base = { ballotsIn, eligibleVoters, quorum, hasQuorum };
  if (!hasQuorum) return { ...base, ranked: null, unranked: null };

  const rows = new Map(
    eligible.map((fid) => [
      fid,
      {
        franchiseId: fid,
        points: 0,
        firstPlaceVotes: 0,
        ballotsRanking: 0,
        rankSum: 0,
        // Fall back to the end of the field rather than 0 for a franchise the
        // composite doesn't know: a 0 would make an unknown team win every
        // tiebreak and sort to the top of the unranked block.
        compositeRank: composite.get(fid) ?? eligibleVoters + 1,
      },
    ]),
  );

  for (const ballot of ballots ?? []) {
    ballot?.ranking?.forEach((rawFid, idx) => {
      const row = rows.get(normalizeFranchiseId(rawFid));
      if (!row) return; // not in this league — dropped, never tallied
      const slot = idx + 1;
      row.points += bordaPoints(slot, slots);
      row.ballotsRanking += 1;
      row.rankSum += slot;
      if (slot === 1) row.firstPlaceVotes += 1;
    });
  }

  const all = Array.from(rows.values()).map((r) => ({
    franchiseId: r.franchiseId,
    points: r.points,
    firstPlaceVotes: r.firstPlaceVotes,
    ballotsRanking: r.ballotsRanking,
    avgBallotRank: r.ballotsRanking > 0 ? r.rankSum / r.ballotsRanking : null,
    compositeRank: r.compositeRank,
  }));

  // Ranked block: anyone who received a point. Ties break on points, then most
  // first-place votes (the AP convention — a divisive team with three 1sts
  // outranks a bland one nobody put first), then the composite as a
  // deterministic last resort so the order never depends on Map iteration.
  const ranked = all
    .filter((r) => r.points > 0)
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.firstPlaceVotes - a.firstPlaceVotes ||
        a.compositeRank - b.compositeRank,
    )
    .map((r, idx) => ({
      rank: idx + 1,
      ...r,
      // Positive = the room likes them better than the machine does.
      delta: r.compositeRank - (idx + 1),
    }));

  const unranked = all
    .filter((r) => r.points === 0)
    .sort((a, b) => a.compositeRank - b.compositeRank)
    .map((r) => ({ franchiseId: r.franchiseId, compositeRank: r.compositeRank }));

  return { ...base, ranked, unranked };
}

/**
 * Full-field rank per franchise: the ranked block 1..k, then the unranked
 * block continuing k+1..N in composite order.
 *
 * The unranked positions are NOT a claim that the poll ordered those teams —
 * they exist so the voter metrics below have a defined distance for every
 * team. Don't render them as poll ranks.
 */
export function consensusRankMap(tally) {
  const map = new Map();
  if (!tally?.ranked) return map;
  for (const row of tally.ranked) map.set(row.franchiseId, row.rank);
  let next = tally.ranked.length + 1;
  for (const row of tally.unranked ?? []) map.set(row.franchiseId, next++);
  return map;
}

/**
 * Mean absolute distance between a ballot and the final consensus.
 *
 * Independence, not accuracy — a high score is a badge, not a demerit, and the
 * UI must label it that way. Null when the consensus has no rank for anything
 * on the ballot (i.e. no quorum).
 */
export function contrarianIndex(ranking, consensusRankByFid) {
  const consensus = toRankMap(consensusRankByFid);
  const list = Array.from(ranking ?? [], (id) => normalizeFranchiseId(id));
  let sum = 0;
  let counted = 0;

  list.forEach((fid, idx) => {
    const theirs = consensus.get(fid);
    if (theirs == null) return;
    sum += Math.abs(theirs - (idx + 1));
    counted += 1;
  });

  return counted > 0 ? sum / counted : null;
}

/**
 * How much higher an owner rates their own team than the room does.
 *
 * Positive = homer. Self-voting is allowed precisely so this exists.
 *
 * An owner who left their own team off the ballot entirely is treated as
 * having ranked it `slots + 1` — the most charitable bounded reading, since
 * "off a 7-team ballot" in a 16-team league could mean anywhere from 8th to
 * 16th. That caps how much credit a modest owner gets for omitting themselves,
 * which is the right direction to err.
 */
export function homerIndex({ franchiseId, ranking, consensusRankByFid, slots }) {
  const fid = normalizeFranchiseId(franchiseId);
  const consensus = toRankMap(consensusRankByFid);
  const theirs = consensus.get(fid);
  if (theirs == null) return null;

  const list = Array.from(ranking ?? [], (id) => normalizeFranchiseId(id));
  const idx = list.indexOf(fid);
  const ownRank = idx >= 0 ? idx + 1 : slots + 1;
  return theirs - ownRank;
}
