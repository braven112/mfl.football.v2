/**
 * The app's trade views (package M), for ANY MFL league the owner is in.
 *
 * The site's trade pages resolve names from TheLeague's and the AFL's own
 * config files; a stranger's league has none, so everything here comes from
 * that league's MFL exports, read with the owner's cookie on the league's own
 * host. Player names come from the site's player map (the whole MFL player
 * universe for the year) and, for any id it lacks, one `players` export.
 *
 * Store rules: an asset carries MFL's id, a name, a position and the NFL
 * team as text. No headshots, no ESPN ids.
 */

import type {
  MflLiveAppTradeAsset,
  MflLiveAppTradeBuilder,
  MflLiveAppTradeOffer,
  MflLiveAppTrades,
  MflLiveAppTradeSide,
  MflLiveAppTradeTeam,
} from '../../../packages/shared-types/src/mfl-live-app-trades';
import { mflFetch } from '../mfl-fetch';
import { buildMflExportUrl } from '../mfl-url';
import { getPlayerMap } from '../player-map';
import { parseAssets } from '../trade-asset-parsing';
import { fetchPendingTradeRows, fetchRosterIds, resolveTradeProposer } from '../mfl-trade-ops';

export interface TradeLeagueRef {
  leagueId: string;
  year: number;
  host: string | null;
  franchiseId: string;
  /** The owner's MFL cookie. */
  mflUserCookie: string;
}

interface PlayerInfo {
  name: string;
  position: string;
  team: string;
}

export type PlayerLookup = (ids: string[]) => Promise<Map<string, PlayerInfo>>;

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function padFid(value: unknown): string {
  const s = String(value ?? '').trim();
  return s ? s.padStart(4, '0') : '';
}

async function exportJson(ref: TradeLeagueRef, type: string, params?: Record<string, string>): Promise<any> {
  const url = buildMflExportUrl({
    type,
    leagueId: ref.leagueId,
    year: ref.year,
    params,
    host: ref.host || undefined,
  });
  const res = await mflFetch({ url, method: 'GET', mflUserCookie: ref.mflUserCookie });
  if (!res.ok) throw new Error(`MFL ${type} HTTP ${res.status}`);
  return res.json();
}

/** The league's teams from its `league` export, in MFL's order. */
export async function fetchLeagueTeams(ref: TradeLeagueRef): Promise<MflLiveAppTradeTeam[]> {
  const data = await exportJson(ref, 'league');
  return asArray<any>(data?.league?.franchises?.franchise)
    .map((f) => ({ franchiseId: padFid(f?.id), name: String(f?.name ?? '').trim() }))
    .filter((t) => t.franchiseId)
    .map((t) => ({ ...t, name: t.name || `Team ${t.franchiseId}` }));
}

/** Names for player ids: the site's year map first, then one MFL `players` export for the rest. */
export function playerLookupFor(ref: TradeLeagueRef): PlayerLookup {
  return async (ids) => {
    const known = getPlayerMap(ref.year);
    const out = new Map<string, PlayerInfo>();
    const missing: string[] = [];
    for (const id of ids) {
      const p = known.get(id);
      if (p) out.set(id, { name: p.name, position: p.position, team: p.nflTeam });
      else missing.push(id);
    }
    if (missing.length > 0) {
      try {
        const data = await exportJson(ref, 'players', { PLAYERS: missing.join(',') });
        for (const p of asArray<any>(data?.players?.player)) {
          const id = String(p?.id ?? '');
          if (!id) continue;
          out.set(id, { name: flipName(String(p?.name ?? '')), position: String(p?.position ?? ''), team: String(p?.team ?? '') });
        }
      } catch {
        // An unnamed player still shows as his id; the offer itself is intact.
      }
    }
    return out;
  };
}

/** MFL writes "Allen, Josh". */
function flipName(name: string): string {
  const [last, first] = name.split(',').map((s) => s.trim());
  return first ? `${first} ${last}` : name;
}

function teamName(teams: Map<string, string>, fid: string): string {
  return teams.get(fid) || `Team ${fid}`;
}

/**
 * Label every code in an MFL asset string. `holder` is the team giving the
 * assets: a pick that was originally theirs needs no "via".
 */
export function labelAssets(
  codes: string[],
  holder: string,
  teams: Map<string, string>,
  players: Map<string, PlayerInfo>,
): MflLiveAppTradeAsset[] {
  const out: MflLiveAppTradeAsset[] = [];
  for (const code of codes) {
    const { playerIds, draftPicks, blindBid } = parseAssets(code);
    for (const id of playerIds) {
      const p = players.get(id);
      out.push(
        p
          ? { kind: 'player', id, label: p.name, position: p.position || undefined, nflTeam: p.team || undefined }
          : { kind: 'player', id, label: `Player ${id}` },
      );
    }
    for (const pick of draftPicks) {
      if (pick.startsWith('FP_')) {
        const [, fid, year, round] = pick.split('_');
        const via = padFid(fid) !== padFid(holder) ? ` (${teamName(teams, padFid(fid))})` : '';
        out.push({ kind: 'pick', id: pick, label: `${year} Rd ${round}${via}` });
      } else {
        const [, r, p] = pick.split('_');
        const round = parseInt(r, 10) + 1;
        const slot = p != null ? `, Pick ${parseInt(p, 10) + 1}` : '';
        out.push({ kind: 'pick', id: pick, label: `This year's Rd ${round}${slot}` });
      }
    }
    if (blindBid !== null) {
      out.push({ kind: 'blind-bid', id: code.trim(), label: `$${blindBid.toLocaleString('en-US')} blind bid` });
    }
  }
  return out;
}

function splitCodes(s: unknown): string[] {
  return String(s ?? '').split(',').map((c) => c.trim()).filter(Boolean);
}

/**
 * Owner-view `pendingTrades` rows → offers from the owner's side. In that
 * view `will_give_up` is what the VIEWER gives and `offeredto` is always the
 * other team (src/utils/owner-trade-reports.ts#normalizeRaw).
 */
export async function buildTradeOffers(
  rows: any[],
  ref: TradeLeagueRef,
  teamList: MflLiveAppTradeTeam[],
  lookupPlayers: PlayerLookup,
): Promise<MflLiveAppTradeOffer[]> {
  const me = padFid(ref.franchiseId);
  const teams = new Map(teamList.map((t) => [t.franchiseId, t.name]));
  const nameToFid = new Map(teamList.map((t) => [t.name.toLowerCase(), t.franchiseId]));

  const parsed = rows.map((t) => {
    const proposer = resolveTradeProposer(t, me, nameToFid);
    const direction: MflLiveAppTradeOffer['direction'] = proposer === me ? 'outgoing' : 'incoming';
    const offeredTo = padFid(t.offeredto ?? t.franchise2);
    const partnerFid = direction === 'outgoing' ? offeredTo : proposer;
    return { t, direction, partnerFid, give: splitCodes(t.will_give_up), get: splitCodes(t.will_receive) };
  });

  const ids = [...new Set(parsed.flatMap((p) => [...p.give, ...p.get]).filter((c) => /^\d+$/.test(c)))];
  const players = ids.length ? await lookupPlayers(ids) : new Map<string, PlayerInfo>();

  return parsed.map(({ t, direction, partnerFid, give, get }) => ({
    tradeId: String(t.trade_id ?? t.id ?? ''),
    direction,
    partner: {
      franchiseId: partnerFid,
      // An incoming offer whose proposer MFL named in a way we could not match.
      name: partnerFid ? teamName(teams, partnerFid) : 'Another team',
    },
    youGive: labelAssets(give, me, teams, players),
    youGet: labelAssets(get, partnerFid, teams, players),
    comments: String(t.comments ?? ''),
    proposedAt: parseInt(String(t.timestamp ?? '0'), 10) || 0,
    expiresAt: parseInt(String(t.expires ?? '0'), 10) || 0,
  }));
}

export class TradeReadError extends Error {}

/** Every pending offer the owner is a party to. Throws TradeReadError when MFL will not say. */
export async function loadAppTrades(ref: TradeLeagueRef): Promise<{ view: MflLiveAppTrades; rows: any[] }> {
  const [pending, teams] = await Promise.all([
    fetchPendingTradeRows({ leagueId: ref.leagueId, year: ref.year, mflUserCookie: ref.mflUserCookie, host: ref.host }),
    fetchLeagueTeams(ref),
  ]);
  if (pending.trades === null) throw new TradeReadError(pending.error || 'MFL did not return trades');
  const offers = await buildTradeOffers(pending.trades, ref, teams, playerLookupFor(ref));
  return {
    view: { leagueId: ref.leagueId, franchiseId: padFid(ref.franchiseId), offers },
    rows: pending.trades,
  };
}

/** `futureDraftPicks` export → franchiseId → FP_ codes it holds. */
export function parseFuturePicks(data: any): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of asArray<any>(data?.futureDraftPicks?.franchise)) {
    const fid = padFid(f?.id);
    out[fid] = asArray<any>(f?.futureDraftPick)
      .filter((p) => p?.year && p?.round && p?.originalPickFor)
      .map((p) => `FP_${padFid(p.originalPickFor)}_${p.year}_${p.round}`);
  }
  return out;
}

function side(
  fid: string,
  teams: Map<string, string>,
  rosters: Record<string, string[]>,
  picks: Record<string, string[]>,
  players: Map<string, PlayerInfo>,
): MflLiveAppTradeSide {
  const playerAssets = labelAssets(rosters[fid] ?? [], fid, teams, players)
    .sort((a, b) => (a.position ?? '').localeCompare(b.position ?? '') || a.label.localeCompare(b.label));
  return {
    franchiseId: fid,
    name: teamName(teams, fid),
    players: playerAssets,
    picks: labelAssets(picks[fid] ?? [], fid, teams, players),
  };
}

/**
 * The trade builder: the owner's roster and future picks, and — when
 * `withFid` names another team in the league — that team's.
 * Picks are FUTURE picks only; a pick in a draft under way is not offered here.
 */
export async function loadTradeBuilder(ref: TradeLeagueRef, withFid: string | null): Promise<MflLiveAppTradeBuilder> {
  const me = padFid(ref.franchiseId);
  const [teamList, rosters, picksData] = await Promise.all([
    fetchLeagueTeams(ref),
    fetchRosterIds({ leagueId: ref.leagueId, year: ref.year, mflUserCookie: ref.mflUserCookie, host: ref.host }),
    // A league that does not trade picks answers with an error or nothing.
    exportJson(ref, 'futureDraftPicks').catch(() => null),
  ]);
  const teams = new Map(teamList.map((t) => [t.franchiseId, t.name]));
  const picks = parseFuturePicks(picksData);
  const partner = withFid ? padFid(withFid) : null;
  const theirsFid = partner && partner !== me && teams.has(partner) ? partner : null;

  const ids = [...(rosters[me] ?? []), ...(theirsFid ? rosters[theirsFid] ?? [] : [])];
  const players = ids.length ? await playerLookupFor(ref)(ids) : new Map<string, PlayerInfo>();

  return {
    leagueId: ref.leagueId,
    teams: teamList.filter((t) => t.franchiseId !== me),
    mine: side(me, teams, rosters, picks, players),
    ...(theirsFid ? { theirs: side(theirsFid, teams, rosters, picks, players) } : {}),
  };
}
