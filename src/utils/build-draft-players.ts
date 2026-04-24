/**
 * Shared server-side utility for building the DraftRoomPlayer[] array
 * used by /theleague/draft-room, /theleague/mock-draft/[sessionId], and
 * /theleague/mock-draft/[sessionId]/results.
 *
 * Previously this logic was duplicated across three Astro pages. The duplicates
 * diverged (results.astro skipped identity resolution) and — more importantly —
 * mock-draft/[sessionId] shipped the full ~229 KB player array even though it
 * hard-codes `draftContext="rookie"` and only needs ~15 KB of rookies.
 *
 * Supports an optional `rookieOnly` flag to filter at build time.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DraftRoomPlayer } from '../types/draft-room';
import { getPlayerHeadshot, getCollegeHeadshot } from '../constants/roster-constants';
import { getPlayerMap } from './player-map';
import { enrichDraftPlayers, type DraftPlayerEnrichment } from './draft-player-enrichment';

/** Franchise IDs authorized to see licensed RSP (Rookie Scouting Portfolio) data. */
const RSP_AUTHORIZED_FRANCHISES = new Set(['0001']);

interface BuildDraftPlayersOptions {
  /** When true, only rookies are returned (filters by status=R or draft_year === leagueYear) */
  rookieOnly?: boolean;
  /** When true, joins ADP metadata onto each player (default: true). ADP is public. */
  enrich?: boolean;
  /**
   * Authenticated viewer's franchise ID — gates RSP scouting enrichment.
   * RSP is licensed content (Matt Waldman's Rookie Scouting Portfolio) so
   * only the subscribing owner sees tiers, grades, scouting notes, and advice.
   * ADP stays public for everyone.
   */
  viewerFranchiseId?: string;
}

const DRAFTABLE = new Set(['QB', 'RB', 'WR', 'TE', 'PK', 'DEF']);

function normPos(pos: string): string {
  if (!pos) return '';
  const upper = pos.toUpperCase();
  if (upper.startsWith('TM') || upper === 'DEF' || upper === 'D/ST') return 'DEF';
  if (upper === 'PK' || upper === 'K') return 'PK';
  return upper;
}

function formatName(mflName: string): string {
  if (!mflName) return '';
  const parts = mflName.split(', ');
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : mflName;
}

let collegeMapCache: Record<string, { espnCollegeId?: string }> | null = null;
function loadCollegeMap(): Record<string, { espnCollegeId?: string }> {
  if (collegeMapCache) return collegeMapCache;
  try {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), 'data/theleague/espn-college-ids.json'), 'utf-8')
    );
    collegeMapCache = raw?.players || {};
  } catch {
    collegeMapCache = {};
  }
  return collegeMapCache!;
}

function loadRawPlayers(leagueYear: number): any[] {
  try {
    const raw = JSON.parse(
      readFileSync(
        join(process.cwd(), `data/theleague/mfl-feeds/${leagueYear}/players.json`),
        'utf-8'
      )
    );
    const p = raw?.players?.player;
    if (!p) return [];
    return Array.isArray(p) ? p : [p];
  } catch {
    return [];
  }
}

export function buildDraftPlayers(
  leagueYear: number,
  options: BuildDraftPlayersOptions = {}
): DraftRoomPlayer[] {
  const { rookieOnly = false, enrich = true, viewerFranchiseId } = options;
  const includeRsp = !!viewerFranchiseId && RSP_AUTHORIZED_FRANCHISES.has(viewerFranchiseId);
  const leagueYearStr = String(leagueYear);
  const identityMap = getPlayerMap(leagueYear);
  const collegeMap = loadCollegeMap();
  const rawPlayers = loadRawPlayers(leagueYear);

  // Pre-filter to draftable positions and (optionally) rookies before mapping.
  // This cuts the work substantially when rookieOnly=true (229 KB → ~15 KB).
  const filtered = rawPlayers.filter((p) => {
    const pos = normPos(p.position || '');
    if (!DRAFTABLE.has(pos)) return false;
    if (rookieOnly) {
      return p.status === 'R' || p.draft_year === leagueYearStr;
    }
    return true;
  });

  const players: DraftRoomPlayer[] = filtered.map((p: any) => {
    const identity = identityMap.get(p.id);

    let headshot: string;
    if (identity) {
      headshot = identity.headshot;
    } else {
      const nflEspnId = p.espn_id || '';
      const collegeEspnId = collegeMap[p.id]?.espnCollegeId || '';
      if (nflEspnId) {
        headshot = getPlayerHeadshot(p.id, nflEspnId);
      } else if (collegeEspnId) {
        headshot = getCollegeHeadshot(collegeEspnId);
      } else {
        headshot = getPlayerHeadshot(p.id);
      }
    }

    const ageNum = p.age ? parseInt(p.age, 10) : undefined;
    const draftYearNum = p.draft_year ? parseInt(p.draft_year, 10) : undefined;

    return {
      id: p.id,
      name: identity?.name ?? formatName(p.name || ''),
      position: identity?.position ?? normPos(p.position || ''),
      nflTeam: identity?.nflTeam ?? (p.team || '').toUpperCase(),
      headshot,
      isRookie: p.status === 'R' || p.draft_year === leagueYearStr,
      mflId: p.id,
      espnId:
        identity?.espnId ??
        (p.espn_id || collegeMap[p.id]?.espnCollegeId || undefined),
      age: Number.isFinite(ageNum) ? ageNum : undefined,
      college: p.college || undefined,
      draftYear: Number.isFinite(draftYearNum) ? draftYearNum : undefined,
    };
  });

  return enrich ? enrichDraftPlayers(players, leagueYear, { includeRsp }) : players;
}

export type { DraftPlayerEnrichment };
