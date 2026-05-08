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
import type { PlayerModalData } from './player-modal-trigger';

interface TeamConfigEntry {
  franchiseId: string;
  name?: string;
  nameMedium?: string;
  nameShort?: string;
  abbrev?: string;
  banner?: string;
  icon?: string;
}

/** Subset of MFL `players.json` fields used to build the player modal payload. */
export interface MflPlayerExtras {
  id?: string;
  name?: string;
  position?: string;
  team?: string;
  birthdate?: string;
  college?: string;
  height?: string;
  weight?: string;
  jersey?: string;
  draft_year?: string;
  draft_round?: string;
  draft_pick?: string;
  draft_team?: string;
  espn_id?: string;
  status?: string;
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
  /** Optional payload for PlayerDetailsModal (bio, draft, college). */
  modalData?: PlayerModalData;
}

interface FetchOpts {
  /** League year (defaults to current). */
  year?: number | string;
  /** MFL league id (defaults to 13522). */
  leagueId?: string;
  playerMap: Map<string, PlayerIdentity>;
  /** Optional MFL `players.json` extras keyed by player id — used to build modal data. */
  playerExtras?: Map<string, MflPlayerExtras>;
  teams: TeamConfigEntry[];
  /** Optional fetch override (e.g. for testing). */
  fetchImpl?: typeof fetch;
}

function toNumber(value: string | undefined | null): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildModalData(
  playerId: string,
  ident: PlayerIdentity | undefined,
  extras: MflPlayerExtras | undefined,
  bid: number,
  franchiseId: string,
): PlayerModalData {
  return {
    id: playerId,
    espnId: ident?.espnId ?? extras?.espn_id ?? null,
    name: ident?.name,
    position: ident?.position ?? extras?.position,
    nflTeam: ident?.nflTeam ?? extras?.team,
    salary: bid,
    contractYears: 1,
    contractType: 'AUCTION',
    franchiseId: franchiseId || null,
    birthdate: toNumber(extras?.birthdate),
    college: extras?.college ?? null,
    height: toNumber(extras?.height),
    weight: toNumber(extras?.weight),
    number: toNumber(extras?.jersey),
    draftYear: toNumber(extras?.draft_year),
    draftRound: toNumber(extras?.draft_round),
    draftPick: toNumber(extras?.draft_pick),
    draftTeam: extras?.draft_team ?? null,
    status: extras?.status ?? null,
  };
}

export async function loadActiveAuctions(opts: FetchOpts): Promise<HomepageAuctionRow[]> {
  const { playerMap, teams, year, leagueId, fetchImpl, playerExtras } = opts;

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
    const extras = playerExtras?.get(playerId);
    const team = auc.franchise ? teamById.get(auc.franchise) : undefined;
    const franchiseId = auc.franchise ?? '';
    const bid = typeof auc.bid === 'number' ? auc.bid : 0;

    rows.push({
      playerId,
      playerName: ident?.name ?? `Player ${playerId}`,
      position: ident?.position ?? '',
      nflTeam: ident?.nflTeam ?? '',
      headshot: ident?.headshot,
      espnId: ident?.espnId ?? undefined,
      bid,
      franchiseId,
      franchiseName: team?.name ?? auc.franchise ?? 'Unknown',
      franchiseAbbrev: team?.abbrev ?? team?.nameShort ?? '',
      franchiseBanner: team?.banner,
      franchiseIcon: team?.icon,
      anchorTimestamp: anchor,
      modalData: buildModalData(playerId, ident, extras, bid, franchiseId),
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
