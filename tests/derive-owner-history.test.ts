/**
 * derive-owner-history.mjs — ownerHistory from who OWNED a franchise each
 * season, for a league that renumbers its franchises (Archie's).
 *
 * The real case it was written for: the SeaBirds played as 0100 in 2023-2024
 * and as 0048 from 2025, while 0048 was the Mavericks 2022-2024. With no
 * ownerHistory the attributor credited all of 0048's seasons to the SeaBirds
 * and dropped their own two.
 */
import { describe, it, expect } from 'vitest';
import { deriveOwnerHistories, ownerKey } from '../scripts/derive-owner-history.mjs';
import { buildAttributor } from '../src/utils/owner-tenures.mjs';

const season = (pairs: Record<string, string>) => new Map(Object.entries(pairs));

describe('deriveOwnerHistories', () => {
  const ownersByYear = new Map([
    [2022, season({ '0048': 'Mav Owner', '0010': 'Steady Owner' })],
    [2023, season({ '0048': 'Mav Owner', '0100': 'Bird Owner', '0010': 'Steady Owner' })],
    [2024, season({ '0048': 'Mav Owner', '0100': 'Bird Owner', '0010': 'Steady Owner' })],
    [2025, season({ '0048': 'bird  owner', '0010': 'Steady Owner' })],
    [2026, season({ '0048': 'Bird Owner', '0010': 'Steady Owner' })],
  ]);
  const teams = [{ franchiseId: '0048' }, { franchiseId: '0010' }];

  it('follows an owner across a renumbering, open-ended at the current id', () => {
    const { histories } = deriveOwnerHistories(teams, ownersByYear);
    expect(histories['0048']).toEqual([
      { franchiseId: '0100', yearStart: 2023, yearEnd: 2024 },
      { franchiseId: '0048', yearStart: 2025, yearEnd: 9999 },
    ]);
    expect(histories['0010']).toEqual([{ franchiseId: '0010', yearStart: 2022, yearEnd: 9999 }]);
  });

  it('makes the attributor credit the right team and drop the previous occupant', () => {
    const { histories } = deriveOwnerHistories(teams, ownersByYear);
    const { attributeSeason } = buildAttributor(
      teams.map((t) => ({ ...t, ownerHistory: histories[t.franchiseId] }))
    );
    expect(attributeSeason('0100', 2023)).toBe('0048'); // the SeaBirds' own season
    expect(attributeSeason('0048', 2023)).toBeNull(); // the Mavericks', not the SeaBirds'
    expect(attributeSeason('0048', 2025)).toBe('0048');
    expect(attributeSeason('0010', 2022)).toBe('0010');
  });

  it('leaves an owner of two current teams to a human', () => {
    const both = new Map([[2026, season({ '0001': 'Same Person', '0002': 'same person' })]]);
    const { histories, issues } = deriveOwnerHistories([{ franchiseId: '0001' }, { franchiseId: '0002' }], both);
    expect(histories).toEqual({});
    expect(issues).toHaveLength(2);
  });

  it('leaves a season where one owner held two ids unattributed', () => {
    const years = new Map([
      [2025, season({ '0005': 'Two Teams', '0006': 'Two Teams' })],
      [2026, season({ '0005': 'Two Teams' })],
    ]);
    const { histories, issues } = deriveOwnerHistories([{ franchiseId: '0005' }], years);
    expect(histories['0005']).toEqual([{ franchiseId: '0005', yearStart: 2026, yearEnd: 9999 }]);
    expect(issues.some((i) => i.includes('2025'))).toBe(true);
  });

  it('never puts an owner name in anything it returns', () => {
    const out = JSON.stringify(
      deriveOwnerHistories(
        [{ franchiseId: '0048' }, { franchiseId: '0010' }, { franchiseId: '0077' }],
        ownersByYear
      )
    );
    for (const name of ['Mav Owner', 'Bird Owner', 'Steady Owner', 'mav owner', 'bird owner', 'steady owner']) {
      expect(out).not.toContain(name);
    }
  });

  it('keys owners on letters and digits only', () => {
    expect(ownerKey('  Bird   Owner ')).toBe(ownerKey('bird-owner'));
    expect(ownerKey('')).toBeNull();
    expect(ownerKey(undefined)).toBeNull();
  });
});
