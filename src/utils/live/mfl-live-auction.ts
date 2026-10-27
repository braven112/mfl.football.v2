/**
 * The MFL Football app's auction room (package R, step 3), for ANY MFL league
 * the account is in: who is up for bids and at what, what the owner's team
 * has won and can still spend, and which of its bids have been topped.
 *
 * Split like the draft room: `readMflLiveAuction` does the network work with
 * the owner's own cookie; `buildMflLiveAuction` is a pure function of MFL's
 * payloads, which is what the tests pin and what the push checker can reuse.
 *
 * ── READ-ONLY, ON PURPOSE ────────────────────────────────────────────────
 * MFL's developer API has no request for nominating or bidding: its Misc
 * requests are `live_draft`, `chat_save` and `login`, and `import
 * ?TYPE=auctionResults` loads an offline auction whole
 * (docs/claude/insights/domains/mfl-api.md, 2026-10-27). Owners bid on MFL's
 * own Auction Bid page (`options?O=43`), which `bidUrl` opens.
 *
 * ── WHAT IS "UP FOR BIDS" ────────────────────────────────────────────────
 * MFL publishes no auction state, only events. A nomination is an
 * `AUCTION_INIT`, each raise an `AUCTION_BID`, and the sale an `AUCTION_WON`
 * (or a row in `auctionResults`, which is fresher for older sales). A player
 * nominated and not yet sold is up, at his highest bid so far.
 *
 * SERVER-SIDE ONLY. Store-safe: no headshots, no ESPN ids, no NFL marks.
 */

import type {
  MflLiveAppAuctionBudget,
  MflLiveAppAuctionKind,
  MflLiveAppAuctionLot,
  MflLiveAppAuctionRoom,
  MflLiveAppAuctionStatus,
  MflLiveAppAuctionWin,
} from '../../../packages/shared-types/src/mfl-live-app-auction';
import type { OwnerLeague } from './owner-league';
import { bareHost, identityFor, readExport, toPlayer, type DraftIdentity } from './mfl-live-draft';
import { capFor, findRoster, isReadable, SLOT_BY_STATUS } from './mfl-live-team';

const asArray = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);
const pad = (id: unknown) => {
  const s = `${id ?? ''}`.trim();
  return /^\d+$/.test(s) ? s.padStart(4, '0') : s;
};
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : parseFloat(`${v ?? ''}`);
  return Number.isFinite(n) ? n : undefined;
};
/** MFL timestamps are Unix seconds. */
const iso = (v: unknown): string | undefined => {
  const s = num(v);
  return s && s > 0 ? new Date(s * 1000).toISOString() : undefined;
};

/** MFL's `auction_kind`; a league with none set runs no auction. */
export function auctionKindOf(raw: unknown): MflLiveAppAuctionKind {
  const kind = `${raw ?? ''}`.trim().toLowerCase();
  if (kind === 'email') return 'email';
  if (kind === 'live') return 'live';
  return 'none';
}

/** `"16809|475000|"` → player and amount. */
function parseAuctionTransaction(raw: unknown): { playerId: string; amount: number } | null {
  const [playerId, amount] = `${raw ?? ''}`.split('|');
  const n = num(amount);
  return playerId && /^\d+$/.test(playerId.trim()) && n !== undefined ? { playerId: playerId.trim(), amount: n } : null;
}

/** Seconds until the app should ask again: often while bids are coming in. */
export function auctionPollAfterMs(status: MflLiveAppAuctionStatus, anyOutbid: boolean): number {
  if (status === 'open') return anyOutbid ? 30_000 : 60_000;
  return 600_000;
}

export interface BuildMflLiveAuctionInput {
  league: Pick<OwnerLeague, 'leagueId' | 'leagueName' | 'franchiseId' | 'year'> & { host: string };
  leagueSettings: unknown;
  /** `transactions` with TRANS_TYPE=AUCTION_INIT,AUCTION_BID,AUCTION_WON. */
  transactions: unknown;
  auctionResults: unknown;
  /** `rosters` for the owner's team, for cap room. */
  rosters?: unknown;
  salaryAdjustments?: unknown;
  identity: (id: string) => DraftIdentity | undefined;
  now: Date;
}

interface LotState {
  playerId: string;
  highBid: number;
  highBidder: string;
  highBidAt?: number;
  nominatedAt?: number;
  nominatedBy?: string;
  bids: number;
  bidders: Set<string>;
  lastAt: number;
}

/** The ids of every player the payloads mention, so names can be looked up in one go. */
export function auctionPlayerIds(transactions: unknown, auctionResults: unknown): string[] {
  const ids = new Set<string>();
  if (isReadable(transactions)) {
    for (const t of asArray<any>((transactions as any).transactions?.transaction)) {
      const parsed = parseAuctionTransaction(t?.transaction);
      if (parsed) ids.add(parsed.playerId);
    }
  }
  if (isReadable(auctionResults)) {
    for (const unit of asArray<any>((auctionResults as any).auctionResults?.auctionUnit)) {
      for (const a of asArray<any>(unit?.auction)) if (a?.player) ids.add(`${a.player}`.trim());
    }
  }
  return [...ids];
}

/**
 * Assemble the room. Returns null when MFL sent neither the auction's events
 * nor its results — "couldn't read it" must not look like "nothing up".
 */
export function buildMflLiveAuction(input: BuildMflLiveAuctionInput): MflLiveAppAuctionRoom | null {
  const { league, identity } = input;
  if (!isReadable(input.transactions) && !isReadable(input.auctionResults)) return null;
  const me = league.franchiseId;
  const settings = isReadable(input.leagueSettings) ? (input.leagueSettings as any).league ?? {} : {};
  const player = (id: string) => toPlayer(id, identity, league.year);

  // Sales first, from both sources, so a sold player is never shown as up.
  const sales = new Map<string, { amount: number; franchiseId: string; at?: number }>();
  if (isReadable(input.auctionResults)) {
    for (const unit of asArray<any>((input.auctionResults as any).auctionResults?.auctionUnit)) {
      for (const a of asArray<any>(unit?.auction)) {
        const id = `${a?.player ?? ''}`.trim();
        const amount = num(a?.winningBid);
        if (!id || amount === undefined) continue;
        sales.set(id, { amount, franchiseId: pad(a.franchise), at: num(a.lastBidTime) });
      }
    }
  }

  // MFL lists transactions newest first; replay them oldest first.
  const events = isReadable(input.transactions)
    ? asArray<any>((input.transactions as any).transactions?.transaction)
        .map((t) => ({ type: `${t?.type ?? ''}`, franchise: pad(t?.franchise), at: num(t?.timestamp) ?? 0, parsed: parseAuctionTransaction(t?.transaction) }))
        .filter((t) => t.parsed)
        .sort((a, b) => a.at - b.at)
    : [];

  const lots = new Map<string, LotState>();
  for (const e of events) {
    const { playerId, amount } = e.parsed!;
    if (e.type === 'AUCTION_WON') {
      const known = sales.get(playerId);
      if (!known || (known.at ?? 0) < e.at) sales.set(playerId, { amount, franchiseId: e.franchise, at: e.at || undefined });
      lots.delete(playerId);
      continue;
    }
    if (e.type !== 'AUCTION_INIT' && e.type !== 'AUCTION_BID') continue;
    let lot = lots.get(playerId);
    if (!lot || e.type === 'AUCTION_INIT') {
      // A nomination opens the player afresh (a player can be re-nominated after an unsold close).
      lot = { playerId, highBid: amount, highBidder: e.franchise, highBidAt: e.at, bids: 0, bidders: new Set(), lastAt: e.at };
      if (e.type === 'AUCTION_INIT') {
        lot.nominatedAt = e.at;
        lot.nominatedBy = e.franchise;
      }
      lots.set(playerId, lot);
    }
    lot.bids += 1;
    if (e.franchise) lot.bidders.add(e.franchise);
    lot.lastAt = e.at;
    if (amount > lot.highBid) {
      lot.highBid = amount;
      lot.highBidder = e.franchise;
      lot.highBidAt = e.at;
    }
  }
  // A sale closes the player's lot, unless he was put up again after it (a
  // player cut in-season can be auctioned a second time in the same year).
  for (const [id, sale] of sales) {
    const lot = lots.get(id);
    if (lot && (!sale.at || sale.at >= lot.lastAt)) lots.delete(id);
  }

  const openLots: MflLiveAppAuctionLot[] = [...lots.values()].map((l) => {
    const mine = l.highBidder === me;
    const lot: MflLiveAppAuctionLot = {
      player: player(l.playerId),
      highBid: l.highBid,
      highBidder: l.highBidder,
      mine,
      outbid: !mine && l.bidders.has(me),
      bids: l.bids,
    };
    const highBidAt = iso(l.highBidAt);
    if (highBidAt) lot.highBidAt = highBidAt;
    const nominatedAt = iso(l.nominatedAt);
    if (nominatedAt) lot.nominatedAt = nominatedAt;
    if (l.nominatedBy) lot.nominatedBy = l.nominatedBy;
    return lot;
  });
  openLots.sort(
    (a, b) =>
      Number(b.outbid) - Number(a.outbid) ||
      (b.highBidAt ?? '').localeCompare(a.highBidAt ?? '') ||
      a.player.name.localeCompare(b.player.name),
  );

  const won: MflLiveAppAuctionWin[] = [...sales.entries()]
    .map(([id, s]) => {
      const win: MflLiveAppAuctionWin = { player: player(id), amount: s.amount, franchiseId: s.franchiseId, mine: s.franchiseId === me };
      const wonAt = iso(s.at);
      if (wonAt) win.wonAt = wonAt;
      return win;
    })
    .sort((a, b) => (b.wonAt ?? '').localeCompare(a.wonAt ?? '') || b.amount - a.amount);

  const status: MflLiveAppAuctionStatus = openLots.length ? 'open' : won.length ? 'quiet' : 'none';
  const teams = asArray<any>(settings.franchises?.franchise)
    .map((f) => ({ franchiseId: pad(f?.id), name: `${f?.name ?? ''}`.trim() || `Team ${pad(f?.id)}` }))
    .filter((t) => t.franchiseId);

  const budget = budgetFor(settings, input, openLots, won);
  const minBid = num(settings.minBid);
  const bidIncrement = num(settings.bidIncrement);

  return {
    ok: true,
    leagueId: league.leagueId,
    leagueName: `${settings.name ?? ''}`.trim() || league.leagueName,
    year: league.year,
    franchiseId: me,
    kind: auctionKindOf(settings.auction_kind),
    status,
    ...(minBid !== undefined ? { minBid } : {}),
    ...(bidIncrement !== undefined ? { bidIncrement } : {}),
    teams,
    lots: openLots,
    won,
    ...(budget ? { budget } : {}),
    bidUrl: `https://${league.host}/${league.year}/options?L=${encodeURIComponent(league.leagueId)}&O=43`,
    generatedAt: input.now.toISOString(),
    pollAfterMs: auctionPollAfterMs(status, openLots.some((l) => l.outbid)),
  };
}

/**
 * Cap room in a salary-cap league (an auction win lands on the roster at its
 * price, so the room already counts it), otherwise the purse less what the
 * team has won. Either way the team's standing high bids are what it would
 * still owe. Absent when MFL didn't send what the number needs.
 */
function budgetFor(
  settings: Record<string, any>,
  input: BuildMflLiveAuctionInput,
  lots: MflLiveAppAuctionLot[],
  won: MflLiveAppAuctionWin[],
): MflLiveAppAuctionBudget | undefined {
  const me = input.league.franchiseId;
  const committed = lots.filter((l) => l.mine).reduce((sum, l) => sum + l.highBid, 0);
  const usesSalaries = `${settings.usesSalaries ?? ''}` === '1';

  if (usesSalaries) {
    const roster = findRoster(input.rosters, me);
    if (!roster) return undefined;
    const players = asArray<any>(roster.player).map((p) => ({
      salary: num(p?.salary) ?? 0,
      slot: SLOT_BY_STATUS[`${p?.status ?? ''}`.toUpperCase()] ?? ('active' as const),
    }));
    const cap = capFor(settings, players, input.salaryAdjustments, me);
    if (!cap) return undefined;
    return { available: cap.room, committed, left: cap.room - committed, basis: 'cap-room' };
  }

  const own = asArray<any>(settings.franchises?.franchise).find((f) => pad(f?.id) === me);
  const purse = num(own?.salaryCapAmount) ?? num(settings.auctionStartAmount);
  if (purse === undefined) return undefined;
  const spent = won.filter((w) => w.mine).reduce((sum, w) => sum + w.amount, 0);
  const available = purse - spent;
  return { available, committed, left: available - committed, basis: 'purse' };
}

/** Read the room. Null when MFL would not give us the auction. */
export async function readMflLiveAuction(
  league: OwnerLeague,
  mflUserCookie: string,
  now: Date = new Date(),
): Promise<MflLiveAppAuctionRoom | null> {
  const [leagueSettings, transactions, auctionResults, rosters, salaryAdjustments] = await Promise.all([
    readExport(league, mflUserCookie, 'league'),
    readExport(league, mflUserCookie, 'transactions', { TRANS_TYPE: 'AUCTION_INIT,AUCTION_BID,AUCTION_WON' }),
    readExport(league, mflUserCookie, 'auctionResults'),
    readExport(league, mflUserCookie, 'rosters', { FRANCHISE: league.franchiseId }),
    readExport(league, mflUserCookie, 'salaryAdjustments'),
  ]);
  const identity = await identityFor(league.year, auctionPlayerIds(transactions, auctionResults));
  return buildMflLiveAuction({
    league: { ...league, host: bareHost(league) },
    leagueSettings,
    transactions,
    auctionResults,
    rosters,
    salaryAdjustments,
    identity,
    now,
  });
}
