/**
 * Centralized input loader for the scouting system. All file paths and
 * normalization live here so generators stay focused on prompt construction.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();

function readJSON(rel) {
  const full = path.join(REPO_ROOT, rel);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function tryReadJSON(rel) {
  try {
    return readJSON(rel);
  } catch {
    return null;
  }
}

/**
 * Load everything the rookie-draft generator needs for one season.
 *
 * @param {number} year - Draft year (e.g. 2026)
 * @returns {object} bundle of inputs
 */
export function loadRookieDraftInputs(year) {
  const yr = String(year);

  const teamsConfig = readJSON('src/data/theleague.config.json');
  const franchises = teamsConfig.teams ?? [];

  const rosters = readJSON(`data/theleague/mfl-feeds/${yr}/rosters.json`);
  const players = readJSON(`data/theleague/mfl-feeds/${yr}/players.json`);
  const league = readJSON(`data/theleague/mfl-feeds/${yr}/league.json`);
  const draftResults = tryReadJSON(`data/theleague/mfl-feeds/${yr}/draftResults.json`);
  const futureDraftPicks = tryReadJSON(`data/theleague/mfl-feeds/${yr}/futureDraftPicks.json`);
  const adpDynasty = tryReadJSON(`data/theleague/mfl-feeds/${yr}/adp-dynasty.json`);

  const rspBoard = readJSON('data/fantasy-expert/sources/rsp/2026-pre-draft.json');
  const fbgRookies = tryReadJSON('data/fantasy-expert/sources/fbg/2026-rookies.json');
  const consensusBoard = tryReadJSON('data/fantasy-expert/sources/consensus/2026-post-draft.json');
  const rspOwnership = readJSON('data/theleague/rsp-league-ownership.json');

  // Build player-id → metadata map
  const playerArr = Array.isArray(players?.players?.player)
    ? players.players.player
    : players?.players?.player ? [players.players.player] : [];
  const playerById = new Map();
  for (const p of playerArr) {
    if (!p?.id) continue;
    playerById.set(p.id, {
      id: p.id,
      name: p.name ?? '',
      position: p.position ?? '',
      team: p.team ?? '',
      draftYear: p.draft_year ?? '',
      draftRound: p.draft_round ?? '',
      draftPick: p.draft_pick ?? '',
    });
  }

  // Pick ownership for the target year, derived from draftResults if present.
  // draftResults.draftPick has { round, pick, franchise } even pre-draft.
  const pickOwnership = []; // { round, pick, franchiseId }[]
  const picks = draftResults?.draftResults?.draftUnit?.draftPick;
  if (picks) {
    const pickArr = Array.isArray(picks) ? picks : [picks];
    for (const p of pickArr) {
      const round = parseInt(p.round, 10);
      const pick = parseInt(p.pick, 10);
      if (!round || !pick || !p.franchise) continue;
      pickOwnership.push({ round, pick, franchiseId: p.franchise });
    }
    pickOwnership.sort((a, b) => a.round - b.round || a.pick - b.pick);
  }

  // Filter dynasty ADP to rookies (cross-ref by player ID where draftYear === target)
  const rookieAdp = []; // { rank, playerId, name, position, averagePick }[]
  const adpEntries = adpDynasty?.adp?.player;
  if (adpEntries) {
    const adpArr = Array.isArray(adpEntries) ? adpEntries : [adpEntries];
    for (const e of adpArr) {
      const meta = playerById.get(e.id);
      if (!meta) continue;
      // Best-effort: rookies have draft_year matching the target year and no NFL experience.
      if (String(meta.draftYear) !== yr) continue;
      rookieAdp.push({
        rank: parseInt(e.rank, 10),
        playerId: e.id,
        name: meta.name,
        position: meta.position,
        averagePick: parseFloat(e.averagePick),
      });
    }
    rookieAdp.sort((a, b) => a.rank - b.rank);
  }

  // RSP affinity per franchise
  const rspAffinity = rspOwnership.affinity ?? {};

  return {
    year,
    franchises,
    salaryCap: parseInt(league?.league?.salaryCapAmount ?? '45000000', 10),
    rosters,
    players,
    playerById,
    pickOwnership,
    futureDraftPicks,
    rookieAdp,
    rspBoard: rspBoard.players ?? [],
    fbgRookies: fbgRookies?.players ?? [],
    consensusBoard: consensusBoard?.players ?? [],
    rspAffinity,
  };
}

/**
 * For a single franchise, compute roster summary metrics from the MFL rosters
 * feed. Returns capUsed, position counts, contracts expiring, etc.
 */
export function summarizeFranchiseRoster(franchiseId, rosters, playerById) {
  const franchiseEntries = rosters?.rosters?.franchise;
  const list = Array.isArray(franchiseEntries) ? franchiseEntries : franchiseEntries ? [franchiseEntries] : [];
  const entry = list.find(f => f.id === franchiseId);
  if (!entry) {
    return { capUsed: 0, players: [], contractsExpiring: 0, byPosition: {}, taxiCount: 0, irCount: 0, activeCount: 0 };
  }
  const playerArr = Array.isArray(entry.player) ? entry.player : entry.player ? [entry.player] : [];

  let capUsed = 0;
  let contractsExpiring = 0;
  let taxiCount = 0;
  let irCount = 0;
  let activeCount = 0;
  const byPosition = { QB: 0, RB: 0, WR: 0, TE: 0, PK: 0, DEF: 0 };
  const players = [];

  for (const p of playerArr) {
    const salary = parseFloat(p.salary ?? '0');
    const contractYear = parseInt(p.contractYear ?? '0', 10);
    capUsed += salary;
    if (contractYear === 1) contractsExpiring++;
    if (p.status === 'TAXI_SQUAD') taxiCount++;
    else if (p.status === 'INJURED_RESERVE') irCount++;
    else if (p.status === 'ROSTER') activeCount++;

    const meta = playerById.get(p.id);
    if (meta) {
      const pos = (meta.position || '').toUpperCase();
      if (byPosition[pos] !== undefined) byPosition[pos]++;
      players.push({
        id: p.id,
        name: meta.name,
        position: meta.position,
        team: meta.team,
        salary,
        contractYear,
        status: p.status,
      });
    }
  }

  return { capUsed, players, contractsExpiring, byPosition, taxiCount, irCount, activeCount };
}
