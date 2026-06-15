import { describe, it, expect } from 'vitest';
import {
  calculateAFLDraftOrder,
  parseConferenceChampions,
  parseNITResults,
} from '../src/utils/afl-draft-utils';
import type { StandingsFranchise } from '../src/types/standings';

/**
 * Build a minimal standings franchise. `wins`/`losses` drive the reverse-record
 * sort; everything else is filled with neutral defaults so tiebreakers don't
 * interfere with the assertions.
 */
function franchise(id: string, wins: number, losses: number): StandingsFranchise {
  return {
    id,
    fname: `Team ${id}`,
    divwlt: '',
    divpct: '',
    divw: String(wins),
    divl: String(losses),
    divt: '0',
    h2hwlt: '',
    h2hpct: '',
    h2hw: '',
    h2hl: '',
    h2ht: '',
    nondivwlt: '',
    nondivpct: '',
    nondivw: '0',
    nondivl: '0',
    nondivt: '0',
    all_play_wlt: '',
    all_play_pct: '0',
    pf: '0',
    pa: '0',
    pwr: '0',
    pp: '0',
    vp: '0',
    op: '0',
    strk: '',
    eliminated: '0',
  };
}

// 12 AL teams (conference '00') with strictly increasing win totals, so
// reverse-record order is unambiguous: id 'a01' is worst, 'a12' is best.
function buildConference(prefix: string, conference: string) {
  const teams: StandingsFranchise[] = [];
  const config = new Map<string, { id: string; name: string; conference: string }>();
  for (let i = 1; i <= 12; i++) {
    const id = `${prefix}${String(i).padStart(2, '0')}`;
    teams.push(franchise(id, i - 1, 16 - (i - 1))); // worst record first
    config.set(id, { id, name: `Team ${id}`, conference });
  }
  return { teams, config };
}

describe('calculateAFLDraftOrder', () => {
  it('orders round 1 by reverse record when there is no champion (worst pick 1)', () => {
    const { teams, config } = buildConference('a', '00');
    const orders = calculateAFLDraftOrder(teams, config, new Map(), new Map());
    const al = orders.find(o => o.conference === 'American League')!;
    const round1 = al.picks.filter(p => p.round === 1).sort((a, b) => a.pickInRound - b.pickInRound);

    expect(round1).toHaveLength(12);
    expect(round1[0].franchiseId).toBe('a01'); // worst record -> pick 1
    expect(round1[11].franchiseId).toBe('a12'); // best record -> pick 12
  });

  it('forces the conference champion to the last pick without colliding positions', () => {
    const { teams, config } = buildConference('a', '00');
    // Make a mid-pack team (a06) the champion. Pre-fix this collided at position 12.
    const champions = new Map<string, string>([['00', 'a06']]);
    const orders = calculateAFLDraftOrder(teams, config, champions, new Map());
    const al = orders.find(o => o.conference === 'American League')!;
    const round1 = al.picks.filter(p => p.round === 1).sort((a, b) => a.pickInRound - b.pickInRound);

    // Champion is forced to the last pick (12).
    expect(round1[11].franchiseId).toBe('a06');
    expect(round1[11].isLeagueWinner).toBe(true);

    // Every pick position 1..12 is used exactly once (no collision / no gap).
    const positions = round1.map(p => p.pickInRound).sort((x, y) => x - y);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    // The worst-record non-champion still gets pick 1.
    expect(round1[0].franchiseId).toBe('a01');
    // The best-record non-champion (a12) is now pick 11 (just ahead of the champ).
    expect(round1[10].franchiseId).toBe('a12');
  });

  it('applies the +1.5 NIT bonus to reorder round 1 only', () => {
    const { teams, config } = buildConference('a', '00');
    // a11 has the 2nd-best record (base position 11, 2 base points). With the
    // +1.5 NIT bonus it reaches 3.5 points, jumping ahead of a10 (base 3 points)
    // but staying behind a09 (base 4 points).
    const nit = new Map([['00', [{ franchiseId: 'a11', finishPosition: 1 }]]]);
    const orders = calculateAFLDraftOrder(teams, config, new Map(), nit);
    const al = orders.find(o => o.conference === 'American League')!;
    const round1 = al.picks.filter(p => p.round === 1).sort((a, b) => a.pickInRound - b.pickInRound);

    const idxA11 = round1.findIndex(p => p.franchiseId === 'a11');
    const idxA10 = round1.findIndex(p => p.franchiseId === 'a10');
    const idxA09 = round1.findIndex(p => p.franchiseId === 'a09');
    // a11 jumps ahead of a10 (earlier pick) but remains behind a09.
    expect(idxA11).toBeLessThan(idxA10);
    expect(idxA11).toBeGreaterThan(idxA09);
  });

  it('produces 9 rounds of 12 picks, with all later rounds identical to each other', () => {
    const { teams, config } = buildConference('a', '00');
    const orders = calculateAFLDraftOrder(teams, config, new Map(), new Map());
    const al = orders.find(o => o.conference === 'American League')!;
    expect(al.picks).toHaveLength(108); // 12 teams * 9 rounds

    const round2 = al.picks.filter(p => p.round === 2).sort((a, b) => a.pickInRound - b.pickInRound);
    const round5 = al.picks.filter(p => p.round === 5).sort((a, b) => a.pickInRound - b.pickInRound);
    expect(round5.map(p => p.franchiseId)).toEqual(round2.map(p => p.franchiseId));
  });

  it('applies the NIT bonus to Round 1 ONLY — Rounds 2-9 use the base reverse-standings order', () => {
    const { teams, config } = buildConference('a', '00');
    // a11 (2nd-best record, base position 11, 2 pts) gets +1.5 -> 3.5 pts, so in
    // Round 1 it jumps ahead of a10 (base position 10, 3 pts). In Round 2 it must
    // revert to its base slot BEHIND a10.
    const nit = new Map([['00', [{ franchiseId: 'a11', finishPosition: 1 }]]]);
    const orders = calculateAFLDraftOrder(teams, config, new Map(), nit);
    const al = orders.find(o => o.conference === 'American League')!;

    const round1 = al.picks.filter(p => p.round === 1).sort((a, b) => a.pickInRound - b.pickInRound);
    const round2 = al.picks.filter(p => p.round === 2).sort((a, b) => a.pickInRound - b.pickInRound);

    // Round 1: NIT bump puts a11 ahead of a10.
    expect(round1.findIndex(p => p.franchiseId === 'a11'))
      .toBeLessThan(round1.findIndex(p => p.franchiseId === 'a10'));

    // Round 2: base order restores a10 ahead of a11 (no NIT carryover).
    expect(round2.findIndex(p => p.franchiseId === 'a10'))
      .toBeLessThan(round2.findIndex(p => p.franchiseId === 'a11'));

    // Round 2 is the pure reverse-record order: a01 worst -> pick 1 ... a12 -> 11, champ-less so a12 last data team.
    expect(round2[0].franchiseId).toBe('a01');
  });
});

describe('parseConferenceChampions', () => {
  const teamConfigs = new Map<string, { id: string; name: string; conference: string }>([
    ['0007', { id: '0007', name: 'AL Champ', conference: '00' }],
    ['0020', { id: '0020', name: 'NL Champ', conference: '01' }],
    ['0001', { id: '0001', name: 'SB Winner', conference: '00' }],
  ]);

  function finishedBracket(homeId: string, awayId: string, homePts: number, awayPts: number) {
    return {
      playoffBracket: {
        playoffRound: [
          { week: '16', playoffGame: { game_id: '3', home: { franchise_id: homeId, points: String(homePts) }, away: { franchise_id: awayId, points: String(awayPts) } } },
        ],
      },
    };
  }

  it('reads the AL (bracket 2) and NL (bracket 3) championship winners, not the Super Bowl', () => {
    const data = {
      brackets: {
        '1': finishedBracket('0001', '0007', 120, 100), // Super Bowl — must be ignored
        '2': finishedBracket('0007', '0001', 130, 90),  // AL champ = 0007
        '3': finishedBracket('0020', '0021', 110, 95),  // NL champ = 0020
      },
    };
    const champs = parseConferenceChampions(data, teamConfigs);
    expect(champs.get('00')).toBe('0007');
    expect(champs.get('01')).toBe('0020');
    // The Super Bowl winner (0001) must NOT be the AL champion.
    expect(champs.get('00')).not.toBe('0001');
  });

  it('returns an empty map when brackets are missing', () => {
    expect(parseConferenceChampions({}, teamConfigs).size).toBe(0);
    expect(parseConferenceChampions(null, teamConfigs).size).toBe(0);
  });

  it('omits a conference whose championship game has not been played', () => {
    const data = {
      brackets: {
        '2': finishedBracket('0007', '0001', 130, 90),
        // bracket 3 not present yet
      },
    };
    const champs = parseConferenceChampions(data, teamConfigs);
    expect(champs.get('00')).toBe('0007');
    expect(champs.has('01')).toBe(false);
  });
});

describe('parseNITResults', () => {
  it('initializes both conferences and distributes finishers by conference', () => {
    const teamConfigs = new Map<string, { id: string; name: string; conference: string }>([
      ['0005', { id: '0005', name: 'AL NIT', conference: '00' }],
      ['0018', { id: '0018', name: 'NL NIT', conference: '01' }],
    ]);
    const bracket = (winnerId: string) => ({
      playoffBracket: {
        playoffRound: [
          { playoffGame: { home: { franchise_id: winnerId, points: '100' }, away: { franchise_id: 'zzzz', points: '50' } } },
        ],
      },
    });
    const data = { brackets: { '6': bracket('0005'), '7': bracket('0018') } };
    const results = parseNITResults(data, teamConfigs);

    expect(results.has('00')).toBe(true);
    expect(results.has('01')).toBe(true);
    expect(results.get('00')?.some(r => r.franchiseId === '0005')).toBe(true);
    expect(results.get('01')?.some(r => r.franchiseId === '0018')).toBe(true);
  });
});
