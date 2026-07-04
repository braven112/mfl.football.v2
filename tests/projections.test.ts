import { describe, it, expect } from 'vitest';
import { asArray } from '../src/utils/mfl-normalize';
import {
  calculateTeamProjections,
  getTeamProjection,
  getMultipleTeamProjections,
} from '../src/utils/projections';
import { buildStartingLineupFromMFL } from '../src/utils/lineup-data-builder';

/**
 * Team Projections — MFL shape normalization
 *
 * MFL feeds return lists in three shapes: an array (2+ entries), a bare
 * object (1 entry), and an empty string / empty-field object (0 entries).
 * The off-season projectedScores.json ships a single `{ id: "", score: "" }`
 * object, which previously crashed calculateTeamProjections with
 * "playerScores is not iterable" (500 on /theleague/matchup-data).
 */

const rosters = {
  rosters: {
    franchise: [
      {
        id: '0001',
        player: [
          { id: '100', status: 'ROSTER' },
          { id: '101', status: 'ROSTER' },
          { id: '102', status: 'TAXI_SQUAD' },
        ],
      },
      { id: '0011', player: [{ id: '200', status: 'ROSTER' }] },
    ],
  },
};

describe('calculateTeamProjections', () => {
  it('sums ROSTER-player projections from an array-shaped feed', () => {
    const projected = {
      projectedScores: {
        playerScore: [
          { id: '100', score: '12.5' },
          { id: '101', score: '7.5' },
          { id: '102', score: '99' }, // taxi squad — excluded
          { id: '200', score: '3' },
        ],
      },
    };
    const result = calculateTeamProjections(rosters, projected);
    expect(result.get('0001')).toBe(20);
    expect(result.get('0011')).toBe(3);
  });

  it('handles the off-season single empty playerScore object without throwing', () => {
    const projected = {
      projectedScores: { week: '23', playerScore: { id: '', score: '' } },
    };
    const result = calculateTeamProjections(rosters, projected);
    expect(result.get('0001')).toBe(0);
    expect(result.get('0011')).toBe(0);
  });

  it('handles a single-object playerScore entry (one-entry MFL list)', () => {
    const projected = {
      projectedScores: { playerScore: { id: '100', score: '9.9' } },
    };
    expect(calculateTeamProjections(rosters, projected).get('0001')).toBe(9.9);
  });

  it('handles missing/empty-string list fields', () => {
    expect(calculateTeamProjections({}, {}).size).toBe(0);
    const single = {
      rosters: {
        franchise: { id: '0001', player: { id: '100', status: 'ROSTER' } },
      },
    } as const;
    const projected = {
      projectedScores: { playerScore: [{ id: '100', score: '5' }] },
    };
    expect(calculateTeamProjections(single, projected).get('0001')).toBe(5);

    // MFL's zero-entry shape can also be a literal empty string
    expect(
      calculateTeamProjections(rosters, {
        projectedScores: { playerScore: '' },
      }).get('0001')
    ).toBe(0);
    expect(
      calculateTeamProjections({ rosters: { franchise: '' } }, projected).size
    ).toBe(0);
  });
});

describe('asArray', () => {
  it('normalizes all three MFL list shapes', () => {
    expect(asArray([{ id: '1' }])).toEqual([{ id: '1' }]);
    expect(asArray({ id: '1' })).toEqual([{ id: '1' }]);
    expect(asArray('')).toEqual([]);
    expect(asArray(null)).toEqual([]);
    expect(asArray(undefined)).toEqual([]);
  });
});

describe('buildStartingLineupFromMFL', () => {
  const players = { players: { player: [{ id: '100', name: 'Barkley, Saquon', position: 'RB', team: 'PHI' }] } };

  it('survives the off-season empty projectedScores shapes', () => {
    const rostersSingle = {
      rosters: { franchise: { id: '0001', player: { id: '100', status: 'ROSTER' } } },
    };
    for (const playerScore of [{ id: '', score: '' }, '', undefined]) {
      const lineup = buildStartingLineupFromMFL(
        '0001', 15, rostersSingle, { projectedScores: { playerScore } }, players
      );
      const everyone = [...Object.values(lineup.positions).flat(), ...lineup.bench];
      expect(everyone).toHaveLength(1);
      expect(everyone[0].projectedPoints).toBe(0);
    }
  });

  it('throws a clear error when the franchise is missing', () => {
    expect(() =>
      buildStartingLineupFromMFL('9999', 15, { rosters: { franchise: '' } }, {}, players)
    ).toThrow('No roster found for team 9999');
  });
});

describe('getTeamProjection', () => {
  it('returns 0 for an unknown franchise', () => {
    expect(getTeamProjection('9999', rosters, {})).toBe(0);
  });
});

describe('getMultipleTeamProjections', () => {
  it('returns one entry per requested franchise', () => {
    const projected = {
      projectedScores: { playerScore: [{ id: '100', score: '4' }] },
    };
    expect(getMultipleTeamProjections(['0001', '0011'], rosters, projected)).toEqual([
      { franchiseId: '0001', projection: 4 },
      { franchiseId: '0011', projection: 0 },
    ]);
  });
});
