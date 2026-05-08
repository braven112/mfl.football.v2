/**
 * Homepage active-auction loader.
 *
 * Calls the internal /api/live-auction endpoint at SSR time, joins each active
 * auction against the player identity map and team config, and returns rows
 * ready to render in the HpAuctionsCard. Errors and empty payloads return [].
 */
import type { PlayerIdentity } from './player-map';

interface TeamConfigEntry {
  franchiseId: string;
  name?: string;
  nameMedium?: string;
  nameShort?: string;
  abbrev?: string;
  banner?: string;
  icon?: string;
}

export interface HomepageAuctionRow {
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string;
  bid: number;
  franchiseId: string;
  franchiseName: string;
  franchiseAbbrev: string;
  franchiseBanner?: string;
  franchiseIcon?: string;
  /** Unix seconds — last meaningful bid (or init if none yet). */
  anchorTimestamp: number;
}

interface FetchOpts {
  baseUrl: URL;
  playerMap: Map<string, PlayerIdentity>;
  teams: TeamConfigEntry[];
  /** Optional override (e.g. for testing). */
  fetchImpl?: typeof fetch;
}

export async function loadActiveAuctions(opts: FetchOpts): Promise<HomepageAuctionRow[]> {
  const { baseUrl, playerMap, teams } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;

  let payload: any;
  try {
    const url = new URL('/api/live-auction', baseUrl);
    const res = await fetchImpl(url.toString());
    if (!res.ok) return [];
    payload = await res.json();
  } catch {
    return [];
  }

  const auctions = payload?.auctions;
  if (!auctions || typeof auctions !== 'object') return [];

  const teamById = new Map<string, TeamConfigEntry>();
  for (const t of teams) {
    if (t.franchiseId) teamById.set(t.franchiseId, t);
  }

  const rows: HomepageAuctionRow[] = [];
  for (const [playerId, raw] of Object.entries(auctions)) {
    const auc = raw as { bid?: number; franchise?: string; status?: string; lastBidTime?: number | null; initTime?: number | null };
    if (auc?.status !== 'active') continue;
    const anchor = auc.lastBidTime ?? auc.initTime ?? 0;
    if (typeof anchor !== 'number' || anchor <= 0) continue;

    const ident = playerMap.get(playerId);
    const team = auc.franchise ? teamById.get(auc.franchise) : undefined;

    rows.push({
      playerId,
      playerName: ident?.name ?? `Player ${playerId}`,
      position: ident?.position ?? '',
      nflTeam: ident?.nflTeam ?? '',
      bid: typeof auc.bid === 'number' ? auc.bid : 0,
      franchiseId: auc.franchise ?? '',
      franchiseName: team?.name ?? auc.franchise ?? 'Unknown',
      franchiseAbbrev: team?.abbrev ?? team?.nameShort ?? '',
      franchiseBanner: team?.banner,
      franchiseIcon: team?.icon,
      anchorTimestamp: anchor,
    });
  }

  // Sort soonest-to-end first; rows without an anchor sink to the bottom.
  const BID_WINDOW_SEC = 36 * 60 * 60;
  rows.sort((a, b) => {
    const endA = a.anchorTimestamp + BID_WINDOW_SEC;
    const endB = b.anchorTimestamp + BID_WINDOW_SEC;
    return endA - endB;
  });

  return rows;
}
