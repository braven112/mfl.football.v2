/**
 * Homepage active-auction loader.
 *
 * Calls fetchLiveAuctions() directly (no SSR self-fetch) and joins each
 * active auction against the player identity map and team config. Returns
 * rows ready to render in the HpAuctionsCard. Errors and empty payloads
 * return [] but are logged server-side for visibility.
 */
import type { PlayerIdentity } from './player-map';
import { fetchLiveAuctions } from './live-auctions';

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
  /** Pre-resolved player headshot URL (for PlayerCell). */
  headshot?: string;
  /** ESPN ID — used by PlayerCell as a headshot fallback. */
  espnId?: string;
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
  /** League year (defaults to current). */
  year?: number | string;
  /** MFL league id (defaults to 13522). */
  leagueId?: string;
  playerMap: Map<string, PlayerIdentity>;
  teams: TeamConfigEntry[];
  /** Optional fetch override (e.g. for testing). */
  fetchImpl?: typeof fetch;
}

export async function loadActiveAuctions(opts: FetchOpts): Promise<HomepageAuctionRow[]> {
  const { playerMap, teams, year, leagueId, fetchImpl } = opts;

  const snapshot = await fetchLiveAuctions({ year, leagueId, fetchImpl });
  const auctions = snapshot.auctions;

  const teamById = new Map<string, TeamConfigEntry>();
  for (const t of teams) {
    if (t.franchiseId) teamById.set(t.franchiseId, t);
  }

  const rows: HomepageAuctionRow[] = [];
  for (const [playerId, auc] of Object.entries(auctions)) {
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
      headshot: ident?.headshot,
      espnId: ident?.espnId ?? undefined,
      bid: typeof auc.bid === 'number' ? auc.bid : 0,
      franchiseId: auc.franchise ?? '',
      franchiseName: team?.name ?? auc.franchise ?? 'Unknown',
      franchiseAbbrev: team?.abbrev ?? team?.nameShort ?? '',
      franchiseBanner: team?.banner,
      franchiseIcon: team?.icon,
      anchorTimestamp: anchor,
    });
  }

  console.log(
    `[homepage-auctions] snapshot=${snapshot.count} active=${rows.length}`,
  );

  // Sort soonest-to-end first; rows without an anchor sink to the bottom.
  const BID_WINDOW_SEC = 36 * 60 * 60;
  rows.sort((a, b) => {
    const endA = a.anchorTimestamp + BID_WINDOW_SEC;
    const endB = b.anchorTimestamp + BID_WINDOW_SEC;
    return endA - endB;
  });

  return rows;
}
