/**
 * Speculation Matching — turns raw league state into ranked candidate trades.
 *
 * Two-team match search (per docs/plans/schefter-trade-speculation.md, §Step 2):
 *
 *   For each ordered (Buyer, Seller) pair:
 *     - Pick a "marquee" piece from Seller's tradeBait listings
 *     - Find a return package from Buyer's haves that:
 *         (a) hits at least one of Seller's positional wants
 *         (b) is within DYNASTY_PARITY_TOLERANCE of Seller's piece in dynasty value
 *         (c) fits within Seller's remaining cap space
 *     - Score by dynasty fit + drama + cap-relief drama
 *
 * Dynasty value comes from MFL's adp-dynasty.json (rank → curve) tweaked by an
 * age curve. The curve is intentionally rough — these are SPECULATION posts,
 * not optimizer output. KTC integration is left for a later phase.
 */

const DYNASTY_PARITY_TOLERANCE = 0.15;
const SALARY_CAP = 45_000_000;
const MIN_MARQUEE_VALUE = 35; // floor on the seller-piece dynasty value worth speculating about
const TARGET_PACKAGE_MIN = 1;
const TARGET_PACKAGE_MAX = 3;

// Dynasty-value floor curve. Rank-1 dynasty player = 100. Falls off
// concave-up so the top 24 stay valuable, then drops fast through ~150.
function adpRankToValue(rank) {
  if (!rank || rank <= 0) return 0;
  if (rank <= 12) return Math.round(100 - (rank - 1) * 1.5); // 100 → 83.5
  if (rank <= 36) return Math.round(82 - (rank - 12) * 1.7); // 82 → 41
  if (rank <= 100) return Math.max(8, Math.round(41 - (rank - 36) * 0.45));
  if (rank <= 200) return Math.max(2, Math.round(12 - (rank - 100) * 0.10));
  return 1;
}

// Salary-based value fallback. The on-disk MFL adp-dynasty.json only ranks
// the rookie class — veterans like Lamar Jackson don't appear. Salary is a
// surprisingly good proxy in this league because contracts have been priced
// at auction over many seasons, so high salary correlates with high quality.
//
// Curve calibrated against actual top-10 salaries ($9–11M for elite skill
// players, ~$4.5M for the 90th-percentile cutoff, sub-$1M median).
function salaryToValue(salary) {
  if (!salary || salary <= 0) return 0;
  const m = salary / 1_000_000;
  if (m >= 9) return 95;
  if (m >= 7) return 80;
  if (m >= 5) return 65;
  if (m >= 3) return 48;
  if (m >= 1.5) return 32;
  if (m >= 0.75) return 18;
  if (m >= 0.5) return 10;
  return 4;
}

// Age curve — penalize older players at positions that age fast (RB),
// minor lift for younger players. Returns a multiplier ∈ [0.4, 1.15].
function ageMultiplier(position, age) {
  if (!age || age <= 0) return 1.0;
  const pos = (position || '').toUpperCase();
  const peakWindow = {
    RB: { peak: 25, falloffStart: 27, multAtFalloff: 0.85, terminalAge: 31 },
    WR: { peak: 26, falloffStart: 29, multAtFalloff: 0.85, terminalAge: 33 },
    TE: { peak: 27, falloffStart: 30, multAtFalloff: 0.85, terminalAge: 34 },
    QB: { peak: 28, falloffStart: 33, multAtFalloff: 0.85, terminalAge: 38 },
  }[pos];
  if (!peakWindow) return 1.0;
  if (age <= peakWindow.peak - 3) return 1.15;
  if (age <= peakWindow.falloffStart) return 1.0;
  if (age >= peakWindow.terminalAge) return 0.4;
  // Linear from falloffStart (1.0) → terminalAge (0.4)
  const span = peakWindow.terminalAge - peakWindow.falloffStart;
  const t = (age - peakWindow.falloffStart) / span;
  return Math.max(0.4, 1.0 - t * 0.6);
}

/**
 * Calculate a single dynasty value for a player. Tries ADP-rank first
 * (best for rookies), then falls back to a salary-based curve (best for
 * veterans whose ADP rank isn't published in the rookie-only feed). Age
 * multiplier applies on top of either.
 */
export function valuePlayer({ player, adpRankById }) {
  const rank = adpRankById.get(player.id) ?? null;
  let base;
  if (rank) {
    base = adpRankToValue(rank);
  } else {
    base = salaryToValue(player.salary);
  }
  const mult = ageMultiplier(player.position, player.age);
  return Math.max(0, Math.round(base * mult));
}

function valueDraftPick(/* pick */) {
  // Phase 1 doesn't include picks in speculation. Reserved for Phase 3 when
  // we're ready to model rookie draft slots and future-pick discounting.
  return 0;
}

function isWithinParity(sellerValue, buyerValue) {
  if (sellerValue <= 0) return false;
  const diff = Math.abs(sellerValue - buyerValue);
  return diff / sellerValue <= DYNASTY_PARITY_TOLERANCE;
}

/**
 * Coarse fixed-threshold variant — kept for unit tests and any caller that
 * doesn't have league-wide context. Use buildPositionalWantsRelative when
 * you can pass the per-position league medians.
 */
export function buildPositionalWants(franchisePlayers) {
  const counts = countPositions(franchisePlayers);
  const wants = [];
  if (counts.QB < 2) wants.push('QB');
  if (counts.RB < 4) wants.push('RB');
  if (counts.WR < 5) wants.push('WR');
  if (counts.TE < 2) wants.push('TE');
  return wants;
}

function countPositions(franchisePlayers) {
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const p of franchisePlayers) {
    if (p.status !== 'ROSTER') continue;
    if (counts[p.position] === undefined) continue;
    counts[p.position] += 1;
  }
  return counts;
}

/**
 * League-relative variant: a franchise "wants" any position where it sits
 * at or below the league median minus 1. Computes medians from the league
 * map. Use this in production — fixed thresholds don't translate across
 * months because rosters fatten dramatically right after the rookie draft
 * and trim down again before the August cut.
 */
export function buildPositionalWantsRelative(franchisePlayers, leagueMedians) {
  const counts = countPositions(franchisePlayers);
  const wants = [];
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const median = leagueMedians?.[pos] ?? 0;
    if (counts[pos] <= median - 1) wants.push(pos);
  }
  return wants;
}

/**
 * Compute the per-position median count across all franchises.
 */
export function computeLeagueMedians(playersByFranchise) {
  const buckets = { QB: [], RB: [], WR: [], TE: [] };
  for (const players of playersByFranchise.values()) {
    const counts = countPositions(players);
    for (const pos of Object.keys(buckets)) buckets[pos].push(counts[pos]);
  }
  const medians = {};
  for (const pos of Object.keys(buckets)) {
    const sorted = [...buckets[pos]].sort((a, b) => a - b);
    medians[pos] = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  }
  return medians;
}

/**
 * "Haves" = trade-bait listings the franchise has explicitly shopped, plus
 * roster surplus at saturated positions. Surplus is defined as more than
 * SURPLUS_THRESHOLD active players at a position.
 */
const SURPLUS_THRESHOLD = { QB: 3, RB: 6, WR: 7, TE: 3 };

export function buildHaves({ franchisePlayers, tradeBaitIds, adpRankById }) {
  const baitSet = new Set((tradeBaitIds ?? []).map(String));
  const positionCounts = {};
  for (const p of franchisePlayers) {
    if (p.status !== 'ROSTER') continue;
    positionCounts[p.position] = (positionCounts[p.position] ?? 0) + 1;
  }
  const haves = [];
  for (const p of franchisePlayers) {
    if (p.status !== 'ROSTER') continue;
    const onBait = baitSet.has(String(p.id));
    const isSurplus =
      SURPLUS_THRESHOLD[p.position] !== undefined &&
      positionCounts[p.position] > SURPLUS_THRESHOLD[p.position];
    if (!onBait && !isSurplus) continue;
    const value = valuePlayer({ player: p, adpRankById });
    if (value <= 0) continue;
    haves.push({
      id: p.id,
      name: p.name,
      position: p.position,
      salary: p.salary,
      contractYear: p.contractYear,
      age: p.age,
      onTradeBait: onBait,
      surplus: isSurplus,
      value,
    });
  }
  haves.sort((a, b) => b.value - a.value);
  return haves;
}

/**
 * Sum currently committed cap so we can ballpark each franchise's open room.
 * Uses the salary feed's enriched current-year salary (already escalated by MFL).
 */
export function franchiseCapSpace({ franchisePlayers }) {
  let committed = 0;
  for (const p of franchisePlayers) {
    if (p.status !== 'ROSTER') continue;
    committed += Number(p.salary) || 0;
  }
  return Math.max(0, SALARY_CAP - committed);
}

/**
 * Try to assemble a return package for `seller` that hits one of `seller`'s
 * positional wants and stays within parity tolerance. Greedy: start with the
 * highest-value buyer have that fits the seller's want, then pad with the
 * next-best surplus piece if the gap is too wide.
 */
function assembleReturnPackage({ buyerHaves, sellerWants, sellerMarqueeValue, sellerCapRoom }) {
  const sellerWantSet = new Set(sellerWants);
  const wantHits = buyerHaves
    .filter((h) => sellerWantSet.has(h.position))
    .filter((h) => Number(h.salary) <= sellerCapRoom);

  for (const head of wantHits) {
    if (isWithinParity(sellerMarqueeValue, head.value)) {
      return [head];
    }
    const remaining = sellerMarqueeValue - head.value;
    if (remaining <= 0) continue; // head is too valuable; would over-pay seller
    // Find a "throw-in" surplus piece that closes the gap to within parity.
    const throwIn = buyerHaves.find(
      (h) =>
        h.id !== head.id &&
        Number(h.salary) <= Math.max(0, sellerCapRoom - Number(head.salary)) &&
        Math.abs(remaining - h.value) / sellerMarqueeValue <= DYNASTY_PARITY_TOLERANCE,
    );
    if (throwIn) return [head, throwIn];
  }
  return null;
}

function detectCapReliefDrama({ marqueeSalary, sellerCapRoom }) {
  // Fires when the seller is unloading a Brock-Osweiler-tier piece — i.e.
  // the marquee salary exceeds the seller's open cap room by 1.5×. That's
  // a "they had to clear room" framing for Schefter to lean on.
  return marqueeSalary > sellerCapRoom * 1.5;
}

function scoreCandidate({ marquee, returnPkg, divisionsAreSame }) {
  const valuePack = returnPkg.reduce((sum, p) => sum + p.value, 0);
  const fit = Math.max(0, 100 - Math.abs(marquee.value - valuePack));
  const drama = divisionsAreSame ? 25 : 10;
  const baitBonus = marquee.onTradeBait ? 15 : 0;
  const surplusPenalty = !marquee.onTradeBait && marquee.surplus ? -5 : 0;
  return Math.round(fit + drama + baitBonus + surplusPenalty);
}

/**
 * Top-level: enumerate every ordered (Buyer, Seller) pair and produce the
 * top candidates by score. Caller passes already-loaded data — this helper
 * stays IO-free for testability.
 *
 * @param {object} args
 * @param {Map<string, Array>} args.playersByFranchise - franchiseId → enriched player rows
 * @param {Map<string, Array<string>>} args.tradeBaitByFranchise - franchiseId → player IDs
 * @param {Map<string, number>} args.adpRankById - playerId → ADP rank
 * @param {Map<string, {division:string,nameMedium:string}>} args.teams
 * @param {number} [args.limit=5]
 * @returns {Array<{seller:string, buyer:string, marquee:object, returnPkg:Array, score:number, capRelief:boolean, scoreBreakdown?:string}>}
 */
export function findTwoTeamCandidates({
  playersByFranchise,
  tradeBaitByFranchise,
  adpRankById,
  teams,
  limit = 5,
  medians: medianOverride = null,
}) {
  const franchiseIds = Array.from(playersByFranchise.keys());
  const haves = new Map();
  const wants = new Map();
  const capRoom = new Map();
  const medians = medianOverride ?? computeLeagueMedians(playersByFranchise);

  for (const fid of franchiseIds) {
    const players = playersByFranchise.get(fid) ?? [];
    haves.set(
      fid,
      buildHaves({
        franchisePlayers: players,
        tradeBaitIds: tradeBaitByFranchise.get(fid) ?? [],
        adpRankById,
      }),
    );
    wants.set(fid, buildPositionalWantsRelative(players, medians));
    capRoom.set(fid, franchiseCapSpace({ franchisePlayers: players }));
  }

  const candidates = [];
  for (const sellerId of franchiseIds) {
    const sellerHaves = haves.get(sellerId) ?? [];
    const sellerCapOpen = capRoom.get(sellerId) ?? 0;
    const sellerTeam = teams.get(sellerId);
    for (const marquee of sellerHaves) {
      if (marquee.value < MIN_MARQUEE_VALUE) continue;
      for (const buyerId of franchiseIds) {
        if (buyerId === sellerId) continue;
        const buyerHaves = haves.get(buyerId) ?? [];
        const buyerWants = wants.get(buyerId) ?? [];
        // Buyer must have a stated need that the marquee piece fills,
        // otherwise the speculation has no narrative hook.
        if (!buyerWants.includes(marquee.position)) continue;
        const sellerWants = wants.get(sellerId) ?? [];
        if (sellerWants.length === 0) continue; // seller has no holes to plug
        const returnPkg = assembleReturnPackage({
          buyerHaves,
          sellerWants,
          sellerMarqueeValue: marquee.value,
          sellerCapRoom: sellerCapOpen,
        });
        if (!returnPkg || returnPkg.length < TARGET_PACKAGE_MIN) continue;
        if (returnPkg.length > TARGET_PACKAGE_MAX) continue;
        const buyerTeam = teams.get(buyerId);
        const score = scoreCandidate({
          marquee,
          returnPkg,
          divisionsAreSame:
            !!sellerTeam &&
            !!buyerTeam &&
            sellerTeam.division === buyerTeam.division,
        });
        candidates.push({
          seller: sellerId,
          buyer: buyerId,
          marquee,
          returnPkg,
          score,
          capRelief: detectCapReliefDrama({
            marqueeSalary: Number(marquee.salary) || 0,
            sellerCapRoom: sellerCapOpen,
          }),
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}

// ── Three-team match search (Phase 3) ─────────────────────────────────────
//
// A three-team blockbuster is an A → B → C → A cycle in which each leg sends
// a piece the receiving team wants. The trade is "balanced" when all three
// outgoing pieces sit within a relaxed parity window — three-team deals
// historically tolerate slightly more value variance than two-team because
// a third party's pick or depth piece smooths the gap.
//
// The finder enumerates ordered triples (A, B, C) and, for each, asks the
// top haves from each team to fill the cycle. Only the top THREE_TEAM_HAVES_PER_TEAM
// haves per team are tried; this keeps the search space well-bounded
// (12 × 11 × 10 × k³ where k is small).

const THREE_TEAM_PARITY_TOLERANCE = 0.22;
const THREE_TEAM_HAVES_PER_TEAM = 4;
const MIN_THREE_TEAM_PIECE_VALUE = 30;

/**
 * Returns true when the three given values are within parity, i.e. the
 * (max − min) gap is at most THREE_TEAM_PARITY_TOLERANCE × the mean. The mean
 * (not the max) is used to keep a single-outlier high value from dragging
 * the threshold up.
 */
function isThreeWayParity(a, b, c) {
  if (a <= 0 || b <= 0 || c <= 0) return false;
  const max = Math.max(a, b, c);
  const min = Math.min(a, b, c);
  const mean = (a + b + c) / 3;
  if (mean <= 0) return false;
  return (max - min) / mean <= THREE_TEAM_PARITY_TOLERANCE;
}

/**
 * Score a three-team candidate. Higher is better. Components:
 *   - Parity: tighter spread → higher score (max 60).
 *   - Drama: how many of the three pairs are divisional rivals (max 30).
 *   - Trade-bait bonus: each piece on its team's tradeBait listing adds 5.
 */
function scoreThreeTeamCandidate({ pieces, divisions }) {
  const values = [pieces.fromA.value, pieces.fromB.value, pieces.fromC.value];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const mean = (values[0] + values[1] + values[2]) / 3;
  const spreadFraction = mean > 0 ? (max - min) / mean : 1;
  // 0 spread → 60, full tolerance (0.22) → 0
  const parityScore = Math.max(
    0,
    Math.round(60 * (1 - spreadFraction / THREE_TEAM_PARITY_TOLERANCE)),
  );
  // Drama: count divisional rivalries among the 3 pairs (A-B, B-C, C-A).
  const pairs = [
    [divisions.a, divisions.b],
    [divisions.b, divisions.c],
    [divisions.c, divisions.a],
  ];
  let rivalryHits = 0;
  for (const [d1, d2] of pairs) {
    if (d1 && d2 && d1 === d2) rivalryHits += 1;
  }
  const dramaScore = rivalryHits * 10;
  const baitBonus =
    (pieces.fromA.onTradeBait ? 5 : 0) +
    (pieces.fromB.onTradeBait ? 5 : 0) +
    (pieces.fromC.onTradeBait ? 5 : 0);
  return Math.round(parityScore + dramaScore + baitBonus);
}

/**
 * Pick the highest-value have from `srcHaves` whose position is in
 * `wantedPositions`, fits the receiving team's cap room, and isn't equal to
 * any already-claimed piece id.
 */
function pickPieceFor({ srcHaves, wantedPositions, dstCapRoom, claimedIds }) {
  for (const have of srcHaves) {
    if (have.value < MIN_THREE_TEAM_PIECE_VALUE) continue;
    if (claimedIds.has(have.id)) continue;
    if (!wantedPositions.includes(have.position)) continue;
    if (Number(have.salary) > dstCapRoom) continue;
    return have;
  }
  return null;
}

/**
 * Find the single highest-scoring 3-cycle across the league. Returns null
 * when no triple satisfies the parity + cap + want constraints.
 *
 * Output shape (when non-null):
 *   {
 *     a, b, c,                       // franchise IDs in cycle order (A→B→C→A)
 *     pieces: { fromA, fromB, fromC },// pieces leaving each team
 *     score,
 *     divisionsAreRivals: boolean,
 *     anyOnTradeBait: boolean,
 *   }
 */
export function findThreeTeamCandidate({
  playersByFranchise,
  tradeBaitByFranchise,
  adpRankById,
  teams,
  medians: medianOverride = null,
}) {
  const franchiseIds = Array.from(playersByFranchise.keys());
  if (franchiseIds.length < 3) return null;

  const haves = new Map();
  const wants = new Map();
  const capRoom = new Map();
  const medians = medianOverride ?? computeLeagueMedians(playersByFranchise);

  for (const fid of franchiseIds) {
    const players = playersByFranchise.get(fid) ?? [];
    haves.set(
      fid,
      buildHaves({
        franchisePlayers: players,
        tradeBaitIds: tradeBaitByFranchise.get(fid) ?? [],
        adpRankById,
      }).slice(0, THREE_TEAM_HAVES_PER_TEAM),
    );
    wants.set(fid, buildPositionalWantsRelative(players, medians));
    capRoom.set(fid, franchiseCapSpace({ franchisePlayers: players }));
  }

  let best = null;

  for (const a of franchiseIds) {
    const havesA = haves.get(a) ?? [];
    if (havesA.length === 0) continue;
    const wantsA = wants.get(a) ?? [];
    if (wantsA.length === 0) continue;

    for (const b of franchiseIds) {
      if (b === a) continue;
      const wantsB = wants.get(b) ?? [];
      if (wantsB.length === 0) continue;
      const havesB = haves.get(b) ?? [];
      if (havesB.length === 0) continue;
      const capB = capRoom.get(b) ?? 0;

      // A → B: pick A's marquee that B wants and B can afford
      const fromA = pickPieceFor({
        srcHaves: havesA,
        wantedPositions: wantsB,
        dstCapRoom: capB,
        claimedIds: new Set(),
      });
      if (!fromA) continue;

      for (const c of franchiseIds) {
        if (c === a || c === b) continue;
        const wantsC = wants.get(c) ?? [];
        if (wantsC.length === 0) continue;
        const havesC = haves.get(c) ?? [];
        if (havesC.length === 0) continue;
        const capC = capRoom.get(c) ?? 0;
        const capA = capRoom.get(a) ?? 0;

        // B → C: pick B's piece that C wants
        const fromB = pickPieceFor({
          srcHaves: havesB,
          wantedPositions: wantsC,
          dstCapRoom: capC,
          claimedIds: new Set([fromA.id]),
        });
        if (!fromB) continue;

        // C → A: pick C's piece that A wants
        const fromC = pickPieceFor({
          srcHaves: havesC,
          wantedPositions: wantsA,
          dstCapRoom: capA,
          claimedIds: new Set([fromA.id, fromB.id]),
        });
        if (!fromC) continue;

        if (!isThreeWayParity(fromA.value, fromB.value, fromC.value)) continue;

        const teamA = teams.get(a);
        const teamB = teams.get(b);
        const teamC = teams.get(c);
        const score = scoreThreeTeamCandidate({
          pieces: { fromA, fromB, fromC },
          divisions: {
            a: teamA?.division ?? null,
            b: teamB?.division ?? null,
            c: teamC?.division ?? null,
          },
        });

        if (!best || score > best.score) {
          best = {
            a,
            b,
            c,
            pieces: { fromA, fromB, fromC },
            score,
            divisionsAreRivals:
              !!teamA &&
              !!teamB &&
              !!teamC &&
              (teamA.division === teamB.division ||
                teamB.division === teamC.division ||
                teamC.division === teamA.division),
            anyOnTradeBait:
              fromA.onTradeBait || fromB.onTradeBait || fromC.onTradeBait,
          };
        }
      }
    }
  }

  return best;
}

export const __testing__ = {
  adpRankToValue,
  ageMultiplier,
  isWithinParity,
  DYNASTY_PARITY_TOLERANCE,
  SALARY_CAP,
  MIN_MARQUEE_VALUE,
  scoreCandidate,
  assembleReturnPackage,
  THREE_TEAM_PARITY_TOLERANCE,
  THREE_TEAM_HAVES_PER_TEAM,
  MIN_THREE_TEAM_PIECE_VALUE,
  isThreeWayParity,
  scoreThreeTeamCandidate,
  pickPieceFor,
};
