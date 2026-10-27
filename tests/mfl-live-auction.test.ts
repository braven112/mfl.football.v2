/**
 * The MFL Football app's auction room (package R, step 3): MFL publishes only
 * auction EVENTS, so who is up, at what, and who has been outbid are derived.
 *
 * Pinned here: a sold player is never shown as up (unless he was put up again
 * after the sale), the high bid is the highest amount rather than the latest
 * event, "outbid" means the owner bid and someone has since bid more, the
 * budget counts the team's standing high bids, and a failed read is a null,
 * never an empty room.
 */

import { describe, it, expect } from 'vitest';
import { auctionKindOf, auctionPlayerIds, buildMflLiveAuction } from '../src/utils/live/mfl-live-auction';

const league = { leagueId: '55555', leagueName: 'Work league', franchiseId: '0002', year: 2026, host: 'www49.myfantasyleague.com' };
const identity = (id: string) => ({ name: `Name ${id}`, position: 'RB', nflTeam: 'KC' });
const now = new Date('2026-03-18T20:00:00Z');

const tx = (type: string, franchise: string, player: string, amount: number, timestamp: number) => ({
  type,
  franchise,
  transaction: `${player}|${amount}|`,
  timestamp: String(timestamp),
});
// MFL lists newest first.
const transactions = (...rows: ReturnType<typeof tx>[]) => ({ transactions: { transaction: [...rows].reverse() } });

const settings = (over: Record<string, unknown> = {}) => ({
  league: {
    name: 'Work league',
    auction_kind: 'email',
    minBid: '425000',
    bidIncrement: '25000',
    franchises: { franchise: [{ id: '0001', name: 'One' }, { id: '0002', name: 'Two' }, { id: '0003', name: 'Three' }] },
    ...over,
  },
});

const build = (input: Partial<Parameters<typeof buildMflLiveAuction>[0]>) =>
  buildMflLiveAuction({
    league,
    leagueSettings: settings(),
    transactions: transactions(),
    auctionResults: { auctionResults: {} },
    identity,
    now,
    ...input,
  });

describe('buildMflLiveAuction — who is up', () => {
  it('shows a nominated, unsold player at his highest bid', () => {
    const room = build({
      transactions: transactions(
        tx('AUCTION_INIT', '0001', '100', 425000, 1000),
        tx('AUCTION_BID', '0002', '100', 500000, 2000),
        tx('AUCTION_BID', '0003', '100', 600000, 3000),
      ),
    })!;
    expect(room.status).toBe('open');
    expect(room.lots).toHaveLength(1);
    expect(room.lots[0]).toMatchObject({ highBid: 600000, highBidder: '0003', mine: false, outbid: true, bids: 3, nominatedBy: '0001' });
    expect(room.lots[0].highBidAt).toBe(new Date(3000 * 1000).toISOString());
  });

  it('keeps the highest amount, not the latest event', () => {
    const room = build({
      transactions: transactions(
        tx('AUCTION_INIT', '0001', '100', 425000, 1000),
        tx('AUCTION_BID', '0002', '100', 700000, 2000),
        tx('AUCTION_BID', '0003', '100', 650000, 3000),
      ),
    })!;
    expect(room.lots[0]).toMatchObject({ highBid: 700000, highBidder: '0002', mine: true, outbid: false });
  });

  it('never shows a sold player as up', () => {
    const room = build({
      transactions: transactions(
        tx('AUCTION_INIT', '0001', '100', 425000, 1000),
        tx('AUCTION_WON', '0001', '100', 425000, 5000),
      ),
    })!;
    expect(room.lots).toHaveLength(0);
    expect(room.status).toBe('quiet');
    expect(room.won[0]).toMatchObject({ amount: 425000, franchiseId: '0001', mine: false });
  });

  it('closes a lot from auctionResults alone too', () => {
    const room = build({
      transactions: transactions(tx('AUCTION_INIT', '0002', '100', 425000, 1000)),
      auctionResults: { auctionResults: { auctionUnit: { auction: { player: '100', franchise: '0002', winningBid: '425000', lastBidTime: '4000' } } } },
    })!;
    expect(room.lots).toHaveLength(0);
    expect(room.won[0]).toMatchObject({ mine: true, amount: 425000 });
  });

  it('shows a player put up again after an earlier sale', () => {
    const room = build({
      transactions: transactions(
        tx('AUCTION_INIT', '0001', '100', 425000, 1000),
        tx('AUCTION_WON', '0001', '100', 425000, 2000),
        tx('AUCTION_INIT', '0003', '100', 450000, 9000),
      ),
    })!;
    expect(room.lots).toHaveLength(1);
    expect(room.lots[0]).toMatchObject({ highBid: 450000, highBidder: '0003', nominatedBy: '0003', bids: 1 });
  });

  it('lists the owner’s outbid players first', () => {
    const room = build({
      transactions: transactions(
        tx('AUCTION_INIT', '0002', '100', 425000, 1000),
        tx('AUCTION_BID', '0001', '100', 450000, 1500),
        tx('AUCTION_INIT', '0003', '200', 425000, 2000),
      ),
    })!;
    expect(room.lots.map((l) => [l.player.id, l.outbid])).toEqual([
      ['100', true],
      ['200', false],
    ]);
  });

  it('is null when MFL sent neither the events nor the results', () => {
    expect(build({ transactions: { error: 'busy' }, auctionResults: null })).toBeNull();
  });

  it('is an empty room, not null, when the read worked and nothing has happened', () => {
    const room = build({})!;
    expect(room).toMatchObject({ status: 'none', lots: [], won: [] });
  });
});

describe('buildMflLiveAuction — budget', () => {
  it('in a salary-cap league, is cap room less the team’s standing high bids', () => {
    const room = build({
      leagueSettings: settings({ usesSalaries: '1', salaryCapAmount: '10000000', includeIRWithSalary: '100', includeTaxiWithSalary: '50' }),
      rosters: {
        rosters: {
          franchise: {
            id: '0002',
            player: [
              { id: '1', status: 'ROSTER', salary: '4000000' },
              { id: '2', status: 'TAXI_SQUAD', salary: '1000000' },
            ],
          },
        },
      },
      salaryAdjustments: { salaryAdjustments: { salaryAdjustment: { franchise_id: '0002', amount: '500000' } } },
      transactions: transactions(tx('AUCTION_INIT', '0002', '100', 1000000, 1000)),
    })!;
    // 10m - (4m + 0.5 × 1m + 0.5m dead) = 5m room; 1m standing bid.
    expect(room.budget).toEqual({ available: 5000000, committed: 1000000, left: 4000000, basis: 'cap-room' });
  });

  it('in a purse league, is the purse less wins and standing high bids', () => {
    const room = build({
      leagueSettings: settings({ auctionStartAmount: '200' }),
      transactions: transactions(
        tx('AUCTION_INIT', '0002', '100', 30, 1000),
        tx('AUCTION_WON', '0002', '100', 30, 2000),
        tx('AUCTION_INIT', '0002', '200', 10, 3000),
      ),
    })!;
    expect(room.budget).toEqual({ available: 170, committed: 10, left: 160, basis: 'purse' });
  });

  it('is left out when MFL didn’t send the roster a cap league needs', () => {
    const room = build({ leagueSettings: settings({ usesSalaries: '1', salaryCapAmount: '10000000' }), rosters: null })!;
    expect(room.budget).toBeUndefined();
  });
});

describe('buildMflLiveAuction — the rest', () => {
  it('opens MFL’s own Auction Bid page on the league’s host', () => {
    expect(build({})!.bidUrl).toBe('https://www49.myfantasyleague.com/2026/options?L=55555&O=43');
  });

  it('reads the league’s bid rules and auction kind', () => {
    expect(build({})).toMatchObject({ kind: 'email', minBid: 425000, bidIncrement: 25000 });
    expect(auctionKindOf('live')).toBe('live');
    expect(auctionKindOf('')).toBe('none');
  });

  it('asks again often while bids are coming in, rarely otherwise', () => {
    const open = build({ transactions: transactions(tx('AUCTION_INIT', '0001', '100', 1, 1)) })!;
    expect(open.pollAfterMs).toBeLessThanOrEqual(60_000);
    expect(build({})!.pollAfterMs).toBeGreaterThanOrEqual(600_000);
  });

  it('collects every player id named, for one name lookup', () => {
    expect(
      auctionPlayerIds(transactions(tx('AUCTION_INIT', '0001', '100', 1, 1)), {
        auctionResults: { auctionUnit: { auction: { player: '200' } } },
      }).sort(),
    ).toEqual(['100', '200']);
  });
});
