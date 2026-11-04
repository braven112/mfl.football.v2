/**
 * Joins RSP scouting data + MFL ADP onto DraftRoomPlayer objects.
 *
 * This runs server-side at SSR time so the enriched data is shipped as part
 * of the page's DraftRoomPageData — no client fetch needed for tier badges,
 * ADP ranks, or scouting blurbs.
 */

import { getLeagueBySlug } from '../config/leagues';
import { isLeagueDataLoaded, leagueFeedPath, preloadLeagueData, readLeagueDataSync } from './league-data';
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

/**
 * Caches are keyed BY YEAR, not just by source.
 *
 * They used to be keyed on the source alone, so the first year loaded in a
 * process won every later call. That was invisible while every caller asked
 * for the current year — but the leagues do not share a year. TheLeague rolls
 * Feb 14 and the AFL rolls June 1, so between those dates the two legitimately
 * request different seasons through this one cache; and the AFL broadcast
 * board's `?year=` rehearsal asks for a completed season on purpose. Either
 * path silently served one league another's ADP, which then drove board ranks
 * that looked entirely plausible and were a season out.
 */
let rspCaches: Map<number, Map<string, RspPlayer>> = new Map();
const adpCaches = new Map<string, Map<string, any>>();

/**
 * Which MFL ADP feed to join. Dynasty is the default (TheLeague/AFL are
 * dynasty leagues); best-ball leagues are seasonal redrafts and must show
 * redraft ADP — a dynasty board materially misranks aging veterans there.
 */
export type AdpSource = 'dynasty' | 'redraft';

// League data, read through src/utils/league-data.ts (the store, in
// production); callers await {@link preloadDraftPlayerEnrichment} first.
const theleagueDataPath = () => getLeagueBySlug('theleague')!.dataPath;
const rspIdMapPath = () => `${theleagueDataPath()}/rsp-player-ids.json`;
const rspSourcePath = (leagueYear: number) => `data/fantasy-expert/sources/rsp/${leagueYear}-pre-draft.json`;
const adpPath = (leagueYear: number, source: AdpSource) =>
  leagueFeedPath(theleagueDataPath(), leagueYear, `adp-${source}.json`);

/** Load what `enrichDraftPlayers(…, leagueYear, options)` reads. */
export function preloadDraftPlayerEnrichment(
  leagueYear: number,
  options: { includeRsp?: boolean; adpSource?: AdpSource } = {},
): Promise<void> {
  const paths = [adpPath(leagueYear, options.adpSource ?? 'dynasty')];
  if (options.includeRsp) paths.push(rspIdMapPath(), rspSourcePath(leagueYear));
  return preloadLeagueData(paths);
}

function loadRsp(leagueYear: number): Map<string, RspPlayer> {
  const cached = rspCaches.get(leagueYear);
  if (cached) return cached;
  const result = new Map<string, RspPlayer>();
  try {
    const idMap: RspIdMap = readLeagueDataSync<any>(rspIdMapPath())!.players || {};
    const rspData = readLeagueDataSync<any>(rspSourcePath(leagueYear))!;
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
  if (isLeagueDataLoaded(rspIdMapPath()) && isLeagueDataLoaded(rspSourcePath(leagueYear))) {
    rspCaches.set(leagueYear, result);
  }
  return result;
}

function loadAdp(leagueYear: number, source: AdpSource): Map<string, any> {
  const key = `${source}:${leagueYear}`;
  const cached = adpCaches.get(key);
  if (cached) return cached;
  const result = new Map<string, any>();
  try {
    const raw = readLeagueDataSync<any>(adpPath(leagueYear, source));
    const list = raw?.adp?.player;
    const arr = Array.isArray(list) ? list : list ? [list] : [];
    for (const p of arr) {
      if (p?.id) result.set(p.id, p);
    }
  } catch {
    // ADP data unavailable
  }
  if (isLeagueDataLoaded(adpPath(leagueYear, source))) adpCaches.set(key, result);
  return result;
}

export function enrichDraftPlayers(
  players: DraftRoomPlayer[],
  leagueYear: number,
  options: { includeRsp?: boolean; adpSource?: AdpSource } = {}
): DraftRoomPlayer[] {
  // RSP scouting is licensed content — only surfaced to the owner who pays
  // for the subscription. ADP is public league data and always enriched.
  const includeRsp = options.includeRsp === true;
  const rsp = includeRsp ? loadRsp(leagueYear) : null;
  const adp = loadAdp(leagueYear, options.adpSource ?? 'dynasty');

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
  rspCaches = new Map();
  adpCaches.clear();
}
