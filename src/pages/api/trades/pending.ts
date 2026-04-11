/**
 * API endpoint for fetching pending trades from MFL
 * GET /api/trades/pending
 *
 * Returns all pending trades for the authenticated user's franchise.
 * Uses mflFetch() to preserve Cookie headers across MFL's cross-origin redirects.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../utils/auth';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import { mflFetch } from '../../../utils/mfl-fetch';
import { parseAssets } from '../../../utils/trade-asset-parsing';
import type { PendingTrade } from '../../../types/trade-builder';
import leagueConfig from '../../../data/theleague.config.json';
import { getPlayerMap } from '../../../utils/player-map';

/** Resolved asset for the trade alert modal (avoids needing full player data on client) */
interface ResolvedAsset {
  type: 'player' | 'pick' | 'bbid';
  label: string;
  position?: string;
  nflTeam?: string;
  playerId?: string;
  espnId?: string;
}

/** Build a player lookup map using the unified player identity map */
function loadPlayerMap(year: number): Map<string, { name: string; position: string; team: string; espnId: string }> {
  const identityMap = getPlayerMap(year);
  const map = new Map<string, { name: string; position: string; team: string; espnId: string }>();
  for (const [id, identity] of identityMap) {
    map.set(id, {
      name: identity.name,
      position: identity.position,
      team: identity.nflTeam,
      espnId: identity.espnId || '',
    });
  }
  return map;
}

/** Resolve raw MFL asset string into labeled assets */
function resolveAssets(
  assetString: string,
  playerMap: Map<string, { name: string; position: string; team: string }>,
  teamLookup: Map<string, { name: string; abbrev: string; nameShort: string }>
): ResolvedAsset[] {
  const { playerIds, draftPicks, blindBid } = parseAssets(assetString);
  const resolved: ResolvedAsset[] = [];

  for (const id of playerIds) {
    const p = playerMap.get(id);
    if (p) {
      resolved.push({ type: 'player', label: p.name, position: p.position, nflTeam: p.team, playerId: id, espnId: p.espnId || undefined });
    } else {
      resolved.push({ type: 'player', label: `Unknown Player (${id})`, playerId: id });
    }
  }

  for (const code of draftPicks) {
    if (code.startsWith('FP_')) {
      const parts = code.split('_');
      const franchise = parts[1];
      const yr = parts[2];
      const round = parts[3];
      const team = teamLookup.get(franchise);
      const via = team ? ` (via ${team.abbrev || team.nameShort})` : '';
      resolved.push({ type: 'pick', label: `${yr} Rd ${round}${via}` });
    } else if (code.startsWith('DP_')) {
      const round = parseInt(code.split('_')[1], 10) + 1;
      resolved.push({ type: 'pick', label: `Current Rd ${round}` });
    }
  }

  if (blindBid !== null) {
    const formatted = blindBid >= 1_000_000
      ? `$${(blindBid / 1_000_000).toFixed(1)}M`
      : `$${Math.round(blindBid / 1_000).toLocaleString()}K`;
    resolved.push({ type: 'bbid', label: `${formatted} BBID` });
  }

  return resolved;
}

// Build team name → franchiseId lookup for description parsing (module-level for reuse)
const teamNameMap = new Map<string, string>();
const teamLookup = new Map<string, { name: string; abbrev: string; nameShort: string; icon: string }>();
for (const team of (leagueConfig as any).teams ?? []) {
  if (team.name && team.franchiseId) {
    teamNameMap.set(team.name.toLowerCase(), team.franchiseId);
  }
  if (team.franchiseId) {
    teamLookup.set(team.franchiseId, {
      name: team.name || '',
      abbrev: team.abbrev || '',
      nameShort: team.nameShort || '',
      icon: team.icon || '',
    });
  }
}

/** Extract proposing franchise from MFL description like "Pacific Pigskins proposed a trade to ..." */
function resolveProposer(t: any, userFranchiseId: string): string {
  const offeredTo = (t.offeredto || t.franchise2 || '').padStart(4, '0');
  if (offeredTo !== userFranchiseId) return userFranchiseId;
  const desc: string = t.description || '';
  const match = desc.match(/^(.+?)\s+proposed a trade to\s/i);
  if (match) {
    const fid = teamNameMap.get(match[1].trim().toLowerCase());
    if (fid) return fid;
  }
  return '';
}

/** Parse raw MFL trade array into resolved trade objects */
function processTrades(
  tradeArray: any[],
  userFranchiseId: string,
  playerMap: Map<string, { name: string; position: string; team: string; espnId: string }>,
) {
  return tradeArray.map((t: any) => {
    const offeredBy = resolveProposer(t, userFranchiseId);
    const offeredTo = (t.offeredto || t.franchise2 || '').padStart(4, '0');
    const willGiveUp = (t.will_give_up || t.franchise1_gave_up || '').replace(/,\s*$/, '');
    const willReceive = (t.will_receive || t.franchise2_gave_up || '').replace(/,\s*$/, '');

    const offeredByTeam = teamLookup.get(offeredBy);
    const offeredToTeam = teamLookup.get(offeredTo);

    return {
      tradeId: t.trade_id || t.id || '',
      offeredBy,
      offeredTo,
      willGiveUp,
      willReceive,
      timestamp: parseInt(t.timestamp || '0', 10),
      expires: parseInt(t.expires || '0', 10),
      comments: t.comments || '',
      byCommish: t.by_commish === '1',
      offeredByName: offeredByTeam?.name || `Team ${offeredBy}`,
      offeredToName: offeredToTeam?.name || `Team ${offeredTo}`,
      offeredByIcon: offeredByTeam?.icon || '',
      offeredToIcon: offeredToTeam?.icon || '',
      resolvedAssets: {
        willGiveUp: resolveAssets(willGiveUp, playerMap, teamLookup),
        willReceive: resolveAssets(willReceive, playerMap, teamLookup),
      },
    };
  });
}

/** Fetch and parse pending trades from MFL */
async function fetchMflTrades(
  year: number,
  leagueId: string,
  mflCookie: string,
  franchiseId?: string,
): Promise<{ trades: any[] | null; error?: string }> {
  let url = `https://api.myfantasyleague.com/${year}/export?TYPE=pendingTrades&L=${leagueId}&JSON=1`;
  if (franchiseId) url += `&FRANCHISE_ID=${franchiseId}`;

  const res = await mflFetch({ url, method: 'GET', mflUserCookie: mflCookie });
  if (!res.ok) return { trades: null, error: `MFL HTTP ${res.status}` };

  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { return { trades: null, error: 'Invalid JSON' }; }
  if (data?.error) return { trades: null, error: 'MFL auth error' };

  const pending = data?.pendingTrades;
  const raw = pending?.pendingTrade ?? pending?.trade;
  if (!raw) return { trades: [] };

  return { trades: Array.isArray(raw) ? raw : [raw] };
}

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);

  if (!user) {
    return new Response(
      JSON.stringify({ success: false, message: 'Authentication required' }),
      { status: 401, headers: JSON_HEADERS }
    );
  }

  if (!user.franchiseId) {
    return new Response(
      JSON.stringify({ success: false, message: 'No franchise associated with your account.' }),
      { status: 403, headers: JSON_HEADERS }
    );
  }

  try {
    const year = getCurrentLeagueYear();
    const leagueId = user.leagueId || '13522';
    const mflCookie = user.id;
    const playerMap = loadPlayerMap(year);

    // Fetch user's pending trades
    const result = await fetchMflTrades(year, leagueId, mflCookie);
    if (result.error) {
      console.error('[trades/pending] MFL error:', result.error);
      const status = result.error.includes('auth') ? 403 : 502;
      return new Response(
        JSON.stringify({ success: false, message: result.error }),
        { status, headers: JSON_HEADERS }
      );
    }

    const trades = result.trades?.length
      ? processTrades(result.trades, user.franchiseId, playerMap)
      : [];

    // Commissioner mode: also fetch ALL league trades for approval
    const url = new URL(request.url);
    const wantCommish = url.searchParams.get('commish') === '1';
    let commishTrades: any[] = [];

    if (wantCommish && isCommissionerOrAdmin(user)) {
      const commishResult = await fetchMflTrades(year, leagueId, mflCookie, '0000');
      if (commishResult.trades?.length) {
        // For commissioner trades, resolve proposer from description (not relative to user)
        const allLeague = processTrades(commishResult.trades, user.franchiseId, playerMap);
        // Filter out trades that involve the user's franchise (already in personal trades)
        commishTrades = allLeague.filter(
          (t: any) => t.offeredBy !== user.franchiseId && t.offeredTo !== user.franchiseId
        );
      }
    }

    return new Response(
      JSON.stringify({ success: true, trades, commishTrades, userFranchiseId: user.franchiseId }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    console.error('[trades/pending] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
