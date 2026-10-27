/**
 * The MFL Football app's My Team page (`/api/mfl-live/team`): the pure half,
 * `buildMflLiveTeam`, against small MFL payloads in the shapes MFL serves.
 */
import { describe, expect, it } from 'vitest';
import { buildMflLiveTeam, type BuildMflLiveTeamInput } from '../src/utils/live/mfl-live-team';

const league = {
  leagueId: '55555',
  leagueName: 'From myleagues',
  franchiseId: '0003',
  franchiseName: 'From myleagues',
  year: 2026,
  host: 'https://www44.myfantasyleague.com',
};

const identities: Record<string, { name: string; position: string; nflTeam: string }> = {
  '1': { name: 'Bench Kicker', position: 'PK', nflTeam: 'KC' },
  '2': { name: 'Star Back', position: 'RB', nflTeam: 'SF' },
  '3': { name: 'Hurt Receiver', position: 'WR', nflTeam: 'GB' },
  '4': { name: 'Taxi Quarterback', position: 'QB', nflTeam: 'NYJ' },
  '5': { name: 'Starting Quarterback', position: 'QB', nflTeam: 'BUF' },
};

function input(overrides: Partial<BuildMflLiveTeamInput> = {}): BuildMflLiveTeamInput {
  return {
    league,
    rosters: {
      rosters: {
        franchise: [
          { id: '0001', week: '8', player: [{ id: '9', status: 'ROSTER', salary: '1' }] },
          {
            id: '0003',
            week: '8',
            player: [
              { id: '1', status: 'ROSTER', salary: '500000.00', contractYear: '1', contractInfo: '' },
              { id: '2', status: 'ROSTER', salary: '9000000.00', contractYear: '3', contractInfo: 'Ext 2027' },
              { id: '3', status: 'INJURED_RESERVE', salary: '2000000.00', contractYear: '2' },
              { id: '4', status: 'TAXI_SQUAD', salary: '1000000.00', contractYear: '1' },
              { id: '5', status: 'ROSTER', salary: '3000000.00', contractYear: '2' },
              { id: '77', status: 'ROSTER', salary: '100000.00', contractYear: '1' },
            ],
          },
        ],
      },
    },
    leagueSettings: {
      league: {
        name: 'Pigskin Pals',
        usesSalaries: '1',
        usesContractYear: '1',
        salaryCapAmount: '20000000',
        includeIRWithSalary: '100',
        includeTaxiWithSalary: '50',
        rosterSize: '22',
        injuredReserve: '3',
        taxiSquad: '3',
        franchises: {
          franchise: [
            { id: '0001', name: 'Rivals' },
            { id: '0003', name: 'Home Team', icon: 'https://example.test/crest.png', logo: 'http://insecure.test/x.png' },
          ],
        },
      },
    },
    futurePicks: {
      futureDraftPicks: {
        franchise: [
          {
            id: '0003',
            futureDraftPick: [
              { year: '2028', round: '1', originalPickFor: '0003' },
              { year: '2027', round: '2', originalPickFor: '0001' },
              { year: '2027', round: '1', originalPickFor: '0003' },
            ],
          },
        ],
      },
    },
    draftResults: {
      draftResults: {
        draftUnit: {
          unit: 'LEAGUE',
          draftPick: [
            { round: '01', pick: '04', franchise: '0003', player: '17473' },
            { round: '02', pick: '07', franchise: '0003', player: '' },
            { round: '02', pick: '08', franchise: '0001', player: '' },
          ],
        },
      },
    },
    adjustments: {
      salaryAdjustments: {
        salaryAdjustment: [
          { franchise_id: '0003', amount: '250000', description: 'Dead money' },
          { franchise_id: '0001', amount: '999999', description: 'Not ours' },
        ],
      },
    },
    identity: (id) => identities[id],
    injuries: { '3': { injuryStatus: 'IR', injuryBodyPart: 'Knee - ACL' }, '5': { injuryStatus: 'Questionable' } },
    byes: { SF: 14, GB: 5, BUF: 7, KC: 10 },
    now: new Date('2026-10-27T12:00:00Z'),
    ...overrides,
  };
}

describe('buildMflLiveTeam', () => {
  it('acts on the account’s own franchise and names it from the league', () => {
    const page = buildMflLiveTeam(input())!;
    expect(page.ok).toBe(true);
    expect(page.franchiseId).toBe('0003');
    expect(page.franchiseName).toBe('Home Team');
    expect(page.leagueName).toBe('Pigskin Pals');
    expect(page.week).toBe(8);
    expect(page.players.map((p) => p.id)).not.toContain('9');
  });

  it('only ships an https crest', () => {
    expect(buildMflLiveTeam(input())!.icon).toBe('https://example.test/crest.png');
  });

  it('orders active, IR, taxi, by position within each', () => {
    const page = buildMflLiveTeam(input())!;
    expect(page.players.map((p) => `${p.slot}:${p.id}`)).toEqual([
      'active:5',
      'active:2',
      'active:1',
      'active:77',
      'ir:3',
      'taxi:4',
    ]);
    expect(page.players.find((p) => p.id === '1')!.position).toBe('K');
  });

  it('keeps the injury designation apart from the roster slot', () => {
    const page = buildMflLiveTeam(input())!;
    expect(page.players.find((p) => p.id === '5')).toMatchObject({ slot: 'active', injury: { status: 'Questionable' } });
    expect(page.players.find((p) => p.id === '3')).toMatchObject({ slot: 'ir', injury: { status: 'IR', detail: 'Knee - ACL' } });
  });

  it('adds byes and contracts, and names an unknown player by id rather than dropping him', () => {
    const page = buildMflLiveTeam(input())!;
    expect(page.players.find((p) => p.id === '2')).toMatchObject({
      byeWeek: 14,
      salary: 9_000_000,
      contractYears: 3,
      contractInfo: 'Ext 2027',
    });
    expect(page.players.find((p) => p.id === '77')).toMatchObject({ name: 'Player 77', position: '' });
    expect(page.players.find((p) => p.id === '77')!.byeWeek).toBeUndefined();
  });

  it('counts the cap with MFL’s own IR and taxi shares plus adjustments', () => {
    const page = buildMflLiveTeam(input())!;
    // active 500k + 9m + 3m + 100k, IR 2m at 100%, taxi 1m at 50%, dead money 250k
    const committed = 12_600_000 + 2_000_000 + 500_000 + 250_000;
    expect(page.cap).toEqual({ cap: 20_000_000, committed, room: 20_000_000 - committed, adjustments: 250_000 });
    expect(page.limits).toEqual({ roster: 22, ir: 3, taxi: 3 });
  });

  it('has no cap or salaries in a league without them', () => {
    const settings = input().leagueSettings as any;
    const page = buildMflLiveTeam(
      input({ leagueSettings: { league: { ...settings.league, usesSalaries: '0', usesContractYear: '0' } } }),
    )!;
    expect(page.cap).toBeNull();
    expect(page.usesContracts).toBe(false);
    expect(page.players.every((p) => p.salary === undefined && p.contractYears === undefined)).toBe(true);
  });

  it('lists this year’s unmade picks and future picks, soonest first, naming traded ones', () => {
    const page = buildMflLiveTeam(input())!;
    expect(page.picks.map((p) => p.label)).toEqual([
      '2026 2.07',
      '2027 Round 1',
      '2027 Round 2 (from Rivals)',
      '2028 Round 1',
    ]);
  });

  it('reads a conference draft, where draftUnit is an array', () => {
    const page = buildMflLiveTeam(
      input({
        draftResults: {
          draftResults: {
            draftUnit: [
              { unit: 'DIVISION', draftPick: [{ round: '1', pick: '3', franchise: '0003', player: '' }] },
              { unit: 'DIVISION', draftPick: [] },
            ],
          },
        },
      }),
    )!;
    expect(page.picks[0].label).toBe('2026 1.03');
  });

  it('treats an unreadable roster as a failed read, never an empty team', () => {
    expect(buildMflLiveTeam(input({ rosters: { error: { $t: 'API requires logged in user' } } }))).toBeNull();
    expect(buildMflLiveTeam(input({ rosters: null }))).toBeNull();
    expect(buildMflLiveTeam(input({ rosters: { rosters: { franchise: [{ id: '0001' }] } } }))).toBeNull();
  });

  it('still renders the roster when the decorating reads failed', () => {
    const page = buildMflLiveTeam(
      input({ leagueSettings: { error: 'x' }, futurePicks: null, draftResults: null, adjustments: null }),
    )!;
    expect(page.players).toHaveLength(6);
    expect(page.cap).toBeNull();
    expect(page.picks).toEqual([]);
    expect(page.franchiseName).toBe('From myleagues');
  });

  it('ships nothing an app store forbids', () => {
    expect(JSON.stringify(buildMflLiveTeam(input()))).not.toMatch(/headshot|espn/i);
  });
});
