import { describe, it, expect } from 'vitest';
import { getDivisionChampions, getDivisionChampionDetails } from '../src/utils/standings';
import type { StandingsFranchise } from '../src/types/standings';

// ---------------------------------------------------------------------------
// getDivisionChampionDetails — id/name/icon per division winner, used by the
// branded division header to render the defending-champion logo.
// ---------------------------------------------------------------------------

function franchise(id: string, overrides: Partial<StandingsFranchise> = {}): StandingsFranchise {
  return {
    id,
    fname: `Team ${id}`,
    divwlt: '0-0-0',
    divpct: '0',
    divw: '0',
    divl: '0',
    divt: '0',
    h2hwlt: '0-0-0',
    h2hpct: '0',
    h2hw: '0',
    h2hl: '0',
    h2ht: '0',
    nondivwlt: '0-0-0',
    nondivpct: '0',
    nondivw: '0',
    nondivl: '0',
    nondivt: '0',
    all_play_wlt: '0-0-0',
    all_play_pct: '0',
    pf: '0',
    pa: '0',
    pwr: '0',
    pp: '0',
    vp: '0',
    op: '0',
    strk: 'W1',
    eliminated: '0',
    ...overrides,
  };
}

const config = {
  teams: [
    { franchiseId: '0001', name: 'North Alpha', division: 'North', icon: '/icons/north-alpha.png' },
    { franchiseId: '0002', name: 'North Beta', division: 'North', icon: '/icons/north-beta.png' },
    { franchiseId: '0003', name: 'South Alpha', division: 'South', icon: '/icons/south-alpha.png' },
    { franchiseId: '0004', name: 'South Beta', division: 'South', icon: '' },
  ],
  divisions: ['North', 'South'],
};

// 0002 leads North on wins; 0004 leads South on wins.
const franchises = [
  franchise('0001', { h2hwlt: '8-10-0', h2hw: '8', h2hl: '10', divwlt: '2-4-0', divw: '2', divl: '4', pf: '1500' }),
  franchise('0002', { h2hwlt: '13-5-0', h2hw: '13', h2hl: '5', divwlt: '5-1-0', divw: '5', divl: '1', pf: '1800' }),
  franchise('0003', { h2hwlt: '6-12-0', h2hw: '6', h2hl: '12', divwlt: '1-5-0', divw: '1', divl: '5', pf: '1400' }),
  franchise('0004', { h2hwlt: '11-7-0', h2hw: '11', h2hl: '7', divwlt: '4-2-0', divw: '4', divl: '2', pf: '1700' }),
];

describe('getDivisionChampionDetails', () => {
  it('returns id, config name, and icon for each division winner', () => {
    const details = getDivisionChampionDetails(franchises, config);

    expect(details).toEqual({
      North: { id: '0002', name: 'North Beta', icon: '/icons/north-beta.png' },
      South: { id: '0004', name: 'South Beta', icon: '' },
    });
  });

  it('matches the winners reported by getDivisionChampions', () => {
    const names = getDivisionChampions(franchises, config);
    const details = getDivisionChampionDetails(franchises, config);

    expect(Object.keys(details)).toEqual(Object.keys(names));
    for (const division of Object.keys(names)) {
      expect(details[division].name).toBe(names[division]);
    }
  });

  it('returns an empty record for an empty franchise list', () => {
    expect(getDivisionChampionDetails([], config)).toEqual({});
  });
});
