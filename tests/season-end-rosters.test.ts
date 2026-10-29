import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  lineupsForWeek,
  restoreSeasonEndRosters,
  seasonSigningPrices,
} from '../scripts/lib/season-end-rosters.mjs';

const repoRoot = path.resolve(__dirname, '..');

const weekly = [
  {
    weeklyResults: {
      week: '13',
      matchup: [
        {
          franchise: [
            { id: '0001', player: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
            { id: '0002', player: [{ id: 'd' }, { id: 'e' }] },
          ],
        },
        // A doubleheader week lists each franchise twice.
        { franchise: [{ id: '0001', player: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }] },
      ],
    },
  },
  { weeklyResults: { week: '14', franchise: [{ id: '0001', player: [{ id: 'z' }] }] } },
];

describe('season-end rosters', () => {
  it('reads one week of lineups, starters and bench, once per player', () => {
    const lineups = lineupsForWeek(weekly, 13);
    expect(lineups.get('0001')).toEqual(['a', 'b', 'c']);
    expect(lineups.get('0002')).toEqual(['d', 'e']);
  });

  it('prices from the season’s own auction and blind-bid records, latest signing wins', () => {
    const prices = seasonSigningPrices(
      { auctionResults: { auctionUnit: { auction: [{ player: 'b', winningBid: '2000000', lastBidTime: '1' }] } } },
      {
        transactions: {
          transaction: [
            { type: 'BBID_WAIVER', transaction: 'b|500000|', timestamp: '9' },
            { type: 'BBID_WAIVER', transaction: 'c|425000|', timestamp: '5' },
            { type: 'WAIVER', added: 'e,' },
          ],
        },
      },
    );
    expect(prices.get('b')).toBe(500000);
    expect(prices.get('c')).toBe(425000);
    expect(prices.has('e')).toBe(false);
  });

  it('keeps the export, adds the players it lost, and marks a lost contract unknown', () => {
    const exported = {
      rosters: {
        franchise: [{ id: '0001', player: [{ id: 'a', salary: '7000000', contractYear: '3', status: 'ROSTER' }] }],
      },
    };
    const { feed, restored } = restoreSeasonEndRosters(
      exported,
      lineupsForWeek(weekly, 13),
      new Map([['b', 500000]]),
      new Map([['c', { salary: 900000, contractYear: '2' }]]),
    );
    expect(restored).toBe(4);
    const [one, two] = feed.rosters.franchise;
    expect(one.player[0]).toEqual(exported.rosters.franchise[0].player[0]);
    expect(one.player.find((p: any) => p.id === 'b')).toMatchObject({ salary: '500000', restored: '1' });
    expect(one.player.find((p: any) => p.id === 'c')).toMatchObject({ salary: '900000', contractYear: '2' });
    // A franchise the export lost entirely comes back from its lineup.
    expect(two.id).toBe('0002');
    expect(two.player.map((p: any) => p.salaryUnknown)).toEqual(['1', '1']);
  });

  it('never moves a player the export still has', () => {
    const exported = { rosters: { franchise: [{ id: '0002', player: [{ id: 'a', status: 'ROSTER' }] }] } };
    const { feed } = restoreSeasonEndRosters(exported, lineupsForWeek(weekly, 13));
    const ids = feed.rosters.franchise.flatMap((f: any) => f.player.map((p: any) => `${f.id}:${p.id}`));
    expect(ids).toContain('0002:a');
    expect(ids).not.toContain('0001:a');
  });

  it('TheLeague 2015 shows full teams, not just the contracts that survived', () => {
    const payloads = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'data/theleague/derived/roster-season-payloads.json'), 'utf8'),
    );
    const teams = payloads.seasons['2015'].teams;
    for (const [id, team] of Object.entries<any>(teams)) {
      if (id === 'FA') continue;
      const size = team.players.length + team.practiceSquad.length + team.injuredReserve.length;
      expect(size, `franchise ${id}`).toBeGreaterThanOrEqual(18);
    }
  });
});
