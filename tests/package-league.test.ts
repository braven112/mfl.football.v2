/**
 * View models behind the package-league pages (src/utils/package-league.ts).
 * The load-bearing rule: standings are grouped, never re-sorted — MFL's order
 * already carries tiebreakers this site cannot reproduce.
 */
import { describe, expect, it } from 'vitest';
import {
  divisionLeaders,
  groupStandingsByDivision,
  rosterPlayerIds,
} from '../src/utils/package-league';

const teams = [
  { franchiseId: '0001', name: 'Rhinos', divisionId: '01', icon: '/i/1.webp' },
  { franchiseId: '0002', name: 'Freeze', divisionId: '00' },
  { franchiseId: '0003', name: 'Goats', divisionId: '01' },
  { franchiseId: '0004', name: 'Waves', divisionId: '00' },
];
const divisions = [
  { id: '00', name: 'Barry Sanders Division' },
  { id: '01', name: 'Payton Manning Division' },
];
// MFL order — deliberately NOT the order a VP or PF sort would produce.
const feed = {
  leagueStandings: {
    franchise: [
      { id: '0003', h2hw: '2', h2hl: '2', h2ht: '0', vp: '6', pf: '300.5' },
      { id: '0002', h2hw: '3', h2hl: '1', h2ht: '0', vp: '8', pf: '250' },
      { id: '0001', h2hw: '2', h2hl: '1', h2ht: '1', vp: '7', pf: '410' },
      { id: '0004', h2hw: '1', h2hl: '3', h2ht: '0', vp: '2', pf: '199' },
      { id: '0099', fname: 'Newcomers', h2hw: '0', h2hl: '4', h2ht: '0', vp: '0', pf: '100' },
    ],
  },
};

describe('groupStandingsByDivision', () => {
  const groups = groupStandingsByDivision(feed, teams, divisions);

  it('orders divisions by config and keeps MFL order inside each', () => {
    expect(groups.map((g) => g.division.name)).toEqual([
      'Barry Sanders Division',
      'Payton Manning Division',
      'Unassigned',
    ]);
    expect(groups[1].rows.map((r) => r.franchiseId)).toEqual(['0003', '0001']);
    expect(groups[1].rows.map((r) => r.place)).toEqual([1, 2]);
  });

  it('builds records, victory points and points for', () => {
    const rhinos = groups[1].rows[1];
    expect(rhinos).toMatchObject({ name: 'Rhinos', record: '2-1-1', victoryPoints: 7, pointsFor: 410, icon: '/i/1.webp' });
    expect(groups[0].rows[0].record).toBe('3-1');
  });

  it('never drops a team the branding file does not know', () => {
    expect(groups[2].rows).toEqual([expect.objectContaining({ franchiseId: '0099', name: 'Newcomers', place: 1 })]);
  });

  it('names each division leader as MFL ranks them', () => {
    expect(divisionLeaders(groups).map((l) => l.leader.franchiseId)).toEqual(['0002', '0003', '0099']);
  });

  it('handles an empty or single-row feed', () => {
    expect(groupStandingsByDivision(null, teams, divisions)).toEqual([]);
    const one = groupStandingsByDivision({ leagueStandings: { franchise: { id: '0002', h2hw: '1', h2hl: '0' } } }, teams, divisions);
    expect(one[0].rows[0].franchiseId).toBe('0002');
  });
});

describe('rosters', () => {
  const rosters = {
    rosters: {
      franchise: [
        { id: '0001', player: [{ id: '15281', status: 'ROSTER' }, { id: '99', status: 'INJURED_RESERVE' }] },
        { id: '0002', player: { id: '7', status: 'ROSTER' } },
      ],
    },
  };

  it('reads one franchise, single-player rosters included', () => {
    expect(rosterPlayerIds(rosters, '0001').map((p) => p.id)).toEqual(['15281', '99']);
    expect(rosterPlayerIds(rosters, '0002')).toEqual([{ id: '7', status: 'ROSTER' }]);
    expect(rosterPlayerIds(rosters, '0404')).toEqual([]);
  });
});
