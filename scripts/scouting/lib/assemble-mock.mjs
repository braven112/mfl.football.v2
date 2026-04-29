/**
 * Mock draft assembler. Takes per-franchise GM briefs (each with a target
 * board) plus pick ownership and walks through the draft pick-by-pick,
 * assigning the best-available named target for each franchise. Falls back
 * to global "best available" (RSP rank → ADP rank) if all named targets are
 * gone.
 */

const PICKS_PER_ROUND = 16;

function normalizeName(s) {
  return (s || '').trim().toLowerCase();
}

/**
 * Build a global "best available" board for the BPA fallback.
 * Priority: Consensus (post-NFL-draft, tiered, primary 50% weight) → RSP →
 * MFL ADP. Used when a franchise's named targets are all picked.
 */
function buildBoard(consensusBoard, rspBoard, rookieAdp) {
  const seen = new Set();
  const board = [];

  // Consensus first — it's the primary 50% weight for every franchise.
  for (const p of consensusBoard) {
    const key = normalizeName(p.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    board.push({
      name: p.name,
      position: p.position,
      consensusRank: p.rank,
      consensusTier: p.tier,
      nflTeam: p.nflTeam,
    });
  }

  // RSP fills gaps for players Consensus doesn't have (or weights low)
  const rspSorted = [...rspBoard].sort((a, b) => (b.preDraftScore || 0) - (a.preDraftScore || 0));
  for (const p of rspSorted) {
    const key = normalizeName(p.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    board.push({
      name: p.name,
      position: p.position,
      rspScore: p.preDraftScore,
      rspRank: board.length + 1,
    });
  }

  // ADP last — picks up any remaining names
  for (const a of rookieAdp) {
    const key = normalizeName(a.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    board.push({
      name: a.name,
      position: a.position,
      adpRank: a.rank,
      adpAverage: a.averagePick,
    });
  }

  return board;
}

/**
 * Pick best available from the global board, excluding already-picked names.
 */
function pickBestAvailable(board, taken) {
  for (const candidate of board) {
    if (!taken.has(normalizeName(candidate.name))) return candidate;
  }
  return null;
}

/**
 * Assemble the mock.
 *
 * @param {object} args
 * @param {Array} args.briefs - GMBrief[]
 * @param {Array} args.pickOwnership - [{round, pick, franchiseId}, ...]
 * @param {Array} [args.consensusBoard] - Consensus rookie rankings (primary)
 * @param {Array} args.rspBoard - RSP players
 * @param {Array} args.rookieAdp - filtered ADP entries
 * @param {Map} args.teamById - franchiseId → team config
 * @returns {Array} MockPick[]
 */
export function assembleMock({ briefs, pickOwnership, consensusBoard = [], rspBoard, rookieAdp, teamById }) {
  const board = buildBoard(consensusBoard, rspBoard, rookieAdp);
  const briefById = new Map(briefs.map(b => [b.franchiseId, b]));
  const taken = new Set();
  const mock = [];

  // Sort picks by round, then pick (1.01, 1.02, ..., 3.16)
  const sortedPicks = [...pickOwnership].sort((a, b) => a.round - b.round || a.pick - b.pick);

  for (const slot of sortedPicks) {
    const team = teamById.get(slot.franchiseId);
    const brief = briefById.get(slot.franchiseId);
    const overall = (slot.round - 1) * PICKS_PER_ROUND + slot.pick;

    // Try named targets first, in order of desire (highest first)
    let chosen = null;
    let pickType = 'BPA';
    let reasoning = '';
    const alsoWantedBy = [];

    if (brief) {
      const orderedTargets = [...brief.topTargets].sort((a, b) => (b.desire || 0) - (a.desire || 0));
      for (const t of orderedTargets) {
        const key = normalizeName(t.name);
        if (taken.has(key)) {
          // Check if anyone else still wanted them — only meaningful for nice-to-have data
          continue;
        }
        chosen = {
          name: t.name,
          position: t.position,
          reasoning: t.reasoning,
          desire: t.desire,
        };
        pickType = 'Target';
        reasoning = t.reasoning;
        break;
      }

      // Wildcard fallback for late rounds — only if all top targets are gone
      // and the wildcard isn't picked yet.
      if (!chosen && brief.wildcard && !taken.has(normalizeName(brief.wildcard.name))) {
        chosen = { ...brief.wildcard };
        pickType = 'Wildcard';
        reasoning = brief.wildcard.reasoning;
      }
    }

    // Ultimate fallback: BPA from global board
    if (!chosen) {
      const bpa = pickBestAvailable(board, taken);
      if (bpa) {
        let bpaReason;
        if (bpa.consensusRank !== undefined) {
          bpaReason = `Best available — Consensus #${bpa.consensusRank} (${bpa.consensusTier})`;
        } else if (bpa.rspScore !== undefined) {
          bpaReason = `Best available — RSP rank ${bpa.rspRank}`;
        } else {
          bpaReason = `Best available — ADP rank ${bpa.adpRank}`;
        }
        chosen = {
          name: bpa.name,
          position: bpa.position,
          reasoning: bpaReason,
          desire: 0.5,
        };
        pickType = 'BPA';
        reasoning = chosen.reasoning;
      }
    }

    // Cross-check: which other briefs had this player as a top target?
    if (chosen) {
      for (const otherBrief of briefs) {
        if (otherBrief.franchiseId === slot.franchiseId) continue;
        const wanted = otherBrief.topTargets.some(t => normalizeName(t.name) === normalizeName(chosen.name));
        if (wanted) {
          const otherTeam = teamById.get(otherBrief.franchiseId);
          alsoWantedBy.push(otherTeam?.nameShort || otherBrief.franchiseName);
        }
      }
      taken.add(normalizeName(chosen.name));
    }

    mock.push({
      overallPick: overall,
      round: slot.round,
      pickInRound: slot.pick,
      franchiseId: slot.franchiseId,
      franchiseName: team?.name ?? slot.franchiseId,
      player: chosen ?? { name: 'TBD', position: '', reasoning: 'No board match', desire: 0 },
      pickType,
      reasoning,
      alsoWantedBy: alsoWantedBy.length > 0 ? alsoWantedBy : undefined,
    });
  }

  return mock;
}
