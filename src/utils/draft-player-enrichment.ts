/**
 * Joins RSP scouting data + MFL ADP onto DraftRoomPlayer objects.
 *
 * This runs server-side at SSR time so the enriched data is shipped as part
 * of the page's DraftRoomPageData — no client fetch needed for tier badges,
 * ADP ranks, or scouting blurbs.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DraftRoomPlayer } from '../types/draft-room';
import { normalizePlayerName } from './player-name-matching';

export interface DraftPlayerEnrichment {
  rspTier?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  rspPositionRank?: string;
  rspScore?: number;
  rspGrade?: string;
  rspTypes?: string[];
  rspComparison?: string;
  rspFantasyAdvice?: string;
  rspNotes?: string;
  adpRank?: number;
  adpAveragePick?: number;
  adpMinPick?: number;
  adpMaxPick?: number;
  adpDraftSelPct?: number;
}

interface RspPlayer {
  name: string;
  position: string;
  positionRank?: string;
  preDraftScore?: number;
  preDraftGrade?: string;
  tier?: string;
  types?: string[];
  comparison?: string;
  notes?: string;
  fantasyAdvice?: string;
  school?: string;
}

interface RspIdMap {
  [name: string]: { mflId?: string };
}

let rspCache: Map<string, RspPlayer> | null = null;
let adpCache: Map<string, any> | null = null;

function loadRsp(leagueYear: number): Map<string, RspPlayer> {
  if (rspCache) return rspCache;
  const result = new Map<string, RspPlayer>();
  try {
    const idMapPath = join(process.cwd(), 'data/theleague/rsp-player-ids.json');
    const rspPath = join(
      process.cwd(),
      `data/fantasy-expert/sources/rsp/${leagueYear}-pre-draft.json`
    );
    const idMap: RspIdMap = JSON.parse(readFileSync(idMapPath, 'utf-8')).players || {};
    const rspData = JSON.parse(readFileSync(rspPath, 'utf-8'));
    const players: RspPlayer[] = rspData.players || [];

    // Build name → mflId map for fuzzy matching (normalized)
    const nameToMfl = new Map<string, string>();
    for (const [name, ids] of Object.entries(idMap)) {
      if (ids.mflId) nameToMfl.set(normalizePlayerName(name), ids.mflId);
    }

    for (const p of players) {
      const mflId = nameToMfl.get(normalizePlayerName(p.name));
      if (mflId) result.set(mflId, p);
    }
  } catch {
    // RSP data unavailable — enrichment will be a no-op
  }
  rspCache = result;
  return result;
}

function loadAdp(leagueYear: number): Map<string, any> {
  if (adpCache) return adpCache;
  const result = new Map<string, any>();
  try {
    const raw = JSON.parse(
      readFileSync(
        join(process.cwd(), `data/theleague/mfl-feeds/${leagueYear}/adp-dynasty.json`),
        'utf-8'
      )
    );
    const list = raw?.adp?.player;
    const arr = Array.isArray(list) ? list : list ? [list] : [];
    for (const p of arr) {
      if (p?.id) result.set(p.id, p);
    }
  } catch {
    // ADP data unavailable
  }
  adpCache = result;
  return result;
}

export function enrichDraftPlayers(
  players: DraftRoomPlayer[],
  leagueYear: number,
  options: { includeRsp?: boolean } = {}
): DraftRoomPlayer[] {
  // RSP scouting is licensed content — only surfaced to the owner who pays
  // for the subscription. ADP is public league data and always enriched.
  const includeRsp = options.includeRsp === true;
  const rsp = includeRsp ? loadRsp(leagueYear) : null;
  const adp = loadAdp(leagueYear);

  return players.map((p) => {
    const enrichment: DraftPlayerEnrichment = {};

    if (rsp) {
      const rspPlayer = rsp.get(p.id);
      if (rspPlayer) {
        enrichment.rspTier = (rspPlayer.tier as DraftPlayerEnrichment['rspTier']) || undefined;
        enrichment.rspPositionRank = rspPlayer.positionRank;
        enrichment.rspScore = rspPlayer.preDraftScore;
        enrichment.rspGrade = rspPlayer.preDraftGrade;
        enrichment.rspTypes = rspPlayer.types?.length ? rspPlayer.types : undefined;
        enrichment.rspComparison = rspPlayer.comparison;
        enrichment.rspFantasyAdvice = rspPlayer.fantasyAdvice;
        enrichment.rspNotes = rspPlayer.notes;
        // Also take college from RSP if MFL didn't have it
        if (!p.college && rspPlayer.school) {
          p = { ...p, college: rspPlayer.school };
        }
      }
    }

    const adpPlayer = adp.get(p.id);
    if (adpPlayer) {
      enrichment.adpRank = adpPlayer.rank ? parseInt(adpPlayer.rank, 10) : undefined;
      enrichment.adpAveragePick = adpPlayer.averagePick
        ? parseFloat(adpPlayer.averagePick)
        : undefined;
      enrichment.adpMinPick = adpPlayer.minPick ? parseInt(adpPlayer.minPick, 10) : undefined;
      enrichment.adpMaxPick = adpPlayer.maxPick ? parseInt(adpPlayer.maxPick, 10) : undefined;
      enrichment.adpDraftSelPct = adpPlayer.draftSelPct
        ? parseFloat(adpPlayer.draftSelPct)
        : undefined;
    }

    return { ...p, ...enrichment };
  });
}

export function clearEnrichmentCache() {
  rspCache = null;
  adpCache = null;
}
