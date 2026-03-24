/**
 * API endpoint for fetching pending trades from MFL
 * GET /api/trades/pending
 *
 * Returns all pending trades for the authenticated user's franchise.
 * Uses mflFetch() to preserve Cookie headers across MFL's cross-origin redirects.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import { mflFetch } from '../../../utils/mfl-fetch';
import { parseAssets } from '../../../utils/trade-asset-parsing';
import type { PendingTrade } from '../../../types/trade-builder';
import leagueConfig from '../../../data/theleague.config.json';
import fs from 'node:fs';
import path from 'node:path';

/** Resolved asset for the trade alert modal (avoids needing full player data on client) */
interface ResolvedAsset {
  type: 'player' | 'pick' | 'bbid';
  label: string;
  position?: string;
  nflTeam?: string;
  playerId?: string;
  espnId?: string;
}

/** Build a player lookup map from the static players.json feed */
function loadPlayerMap(year: number): Map<string, { name: string; position: string; team: string; espnId: string }> {
  const map = new Map<string, { name: string; position: string; team: string; espnId: string }>();
  try {
    const feedPath = path.resolve(process.cwd(), `data/theleague/mfl-feeds/${year}/players.json`);
    if (!fs.existsSync(feedPath)) return map;
    const raw = JSON.parse(fs.readFileSync(feedPath, 'utf-8'));
    const players = raw?.players?.player;
    if (!players) return map;
    const list = Array.isArray(players) ? players : [players];
    for (const p of list) {
      if (p.id) {
        map.set(p.id, {
          name: p.name ? p.name.replace(/,\s*/, ', ') : `Player ${p.id}`,
          position: p.position || '',
          team: p.team || '',
          espnId: p.espn_id || '',
        });
      }
    }
  } catch {
    // Non-fatal — assets will show as "Unknown Player"
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

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);

  if (!user) {
    return new Response(
      JSON.stringify({ success: false, message: 'Authentication required' }),
      { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }

  if (!user.franchiseId) {
    return new Response(
      JSON.stringify({ success: false, message: 'No franchise associated with your account.' }),
      { status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const year = getCurrentLeagueYear();
    const leagueId = user.leagueId || '13522';
    const mflCookie = user.id;

    const exportUrl = `https://api.myfantasyleague.com/${year}/export?TYPE=pendingTrades&L=${leagueId}&JSON=1`;

    const mflResponse = await mflFetch({
      url: exportUrl,
      method: 'GET',
      mflUserCookie: mflCookie,
    });

    if (!mflResponse.ok) {
      console.error('[trades/pending] MFL error:', mflResponse.status);
      return new Response(
        JSON.stringify({ success: false, message: 'Failed to fetch pending trades' }),
        { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    const responseText = await mflResponse.text();

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('[trades/pending] Failed to parse MFL response as JSON');
      return new Response(
        JSON.stringify({ success: false, message: 'Invalid response from MFL' }),
        { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    // Check for MFL error responses (auth failure, etc.)
    if (data?.error) {
      console.error('[trades/pending] MFL returned error:', JSON.stringify(data.error));
      return new Response(
        JSON.stringify({ success: false, message: 'MFL authentication error. Try logging out and back in.' }),
        { status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    // MFL uses "pendingTrade" (singular) as the key, NOT "trade"
    // Empty state: { pendingTrades: "" } — guard against empty string
    const pendingTrades = data?.pendingTrades;
    const rawTrades = pendingTrades?.pendingTrade ?? pendingTrades?.trade;
    if (!rawTrades) {
      return new Response(
        JSON.stringify({ success: true, trades: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    // MFL returns single object (not array) when there's only one trade
    const tradeArray = Array.isArray(rawTrades) ? rawTrades : [rawTrades];

    // MFL pending trade fields differ from completed trade fields:
    //   Pending: trade_id, offeredto, will_give_up, will_receive, description
    //   Completed: id, franchise, franchise2, franchise1_gave_up, franchise2_gave_up
    // MFL does NOT include the proposing franchise ID explicitly.
    // We determine it by:
    //   - If offeredto !== user → user proposed it
    //   - If offeredto === user → parse proposer from description ("{TeamName} proposed a trade to ...")

    // Build team name → franchiseId lookup for description parsing
    const teamNameMap = new Map<string, string>();
    for (const team of (leagueConfig as any).teams ?? []) {
      if (team.name && team.franchiseId) {
        teamNameMap.set(team.name.toLowerCase(), team.franchiseId);
      }
    }

    /** Extract proposing franchise from MFL description like "Pacific Pigskins proposed a trade to ..." */
    function resolveProposer(t: any, userFranchiseId: string): string {
      const offeredTo = (t.offeredto || t.franchise2 || '').padStart(4, '0');
      // If offered to someone else, the user is the proposer
      if (offeredTo !== userFranchiseId) return userFranchiseId;
      // If offered to the user, parse the proposer from the description
      const desc: string = t.description || '';
      const match = desc.match(/^(.+?)\s+proposed a trade to\s/i);
      if (match) {
        const proposerName = match[1].trim().toLowerCase();
        const fid = teamNameMap.get(proposerName);
        if (fid) return fid;
      }
      // Fallback: unknown proposer — return empty string (UI should handle gracefully)
      return '';
    }

    // Build lookup maps for asset resolution
    const playerMap = loadPlayerMap(year);
    const teamLookup = new Map<string, { name: string; abbrev: string; nameShort: string; icon: string }>();
    for (const team of (leagueConfig as any).teams ?? []) {
      if (team.franchiseId) {
        teamLookup.set(team.franchiseId, {
          name: team.name || '',
          abbrev: team.abbrev || '',
          nameShort: team.nameShort || '',
          icon: team.icon || '',
        });
      }
    }

    const trades = tradeArray.map((t: any) => {
      const offeredBy = resolveProposer(t, user.franchiseId);
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
        // Resolved fields for the trade alert modal
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

    return new Response(
      JSON.stringify({ success: true, trades, userFranchiseId: user.franchiseId }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[trades/pending] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }
};
