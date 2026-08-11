import { describe, it, expect } from 'vitest';
import { segmentsForFranchiseRange } from '../src/utils/afl-name-history';
import aflConfig from '../data/afl-fantasy/afl.config.json';

// CURRENT_YEAR (getCurrentSeasonYear()) stays at the previous season from
// Jan 1 through Labor Day. These tests lock in the case where a punitive
// rename's closed-out history entry ends exactly at that season-year
// boundary, before the calendar has actually reached Labor Day.
const PRE_LABOR_DAY_CURRENT_YEAR = 2025;

describe('segmentsForFranchiseRange', () => {
  it('shows the live name as current when the last history entry ends exactly at CURRENT_YEAR (0014)', () => {
    const segments = segmentsForFranchiseRange(
      aflConfig as any,
      '0014',
      '0014',
      2007,
      PRE_LABOR_DAY_CURRENT_YEAR,
      true
    );
    const current = segments.find((s) => s.isCurrent);
    expect(current?.name).toBe('A Bruin Pegs Me');
    expect(current?.rebrandGroup).toBe('a-bruin-pegs-me');

    const herdEra = segments.find((s) => s.name === 'Thundering Herd');
    expect(herdEra?.isCurrent).toBe(false);
    expect(herdEra?.yearEnd).toBe(2025);
  });

  it('does the same for franchise 0023 (Cock Gobbler -> The Show), a pre-existing case of the same bug', () => {
    const segments = segmentsForFranchiseRange(
      aflConfig as any,
      '0023',
      '0023',
      2007,
      PRE_LABOR_DAY_CURRENT_YEAR,
      true
    );
    const current = segments.find((s) => s.isCurrent);
    expect(current?.name).toBe('The Show');

    const gobblerEra = segments.find((s) => s.name === 'Cock Gobbler');
    expect(gobblerEra?.isCurrent).toBe(false);
    expect(gobblerEra?.rebrandGroup).toBe('cock-gobbler');
  });

  it('still marks the closing history entry current when its name matches the live name', () => {
    const segments = segmentsForFranchiseRange(
      { teams: [{ franchiseId: '9999', name: 'Same Name', history: [{ name: 'Same Name', yearStart: 2020, yearEnd: 2025 }] }] },
      '9999',
      '9999',
      2020,
      2025,
      true
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ name: 'Same Name', isCurrent: true });
  });

  it('gap-fills with the live name when the range extends past the last history entry', () => {
    const segments = segmentsForFranchiseRange(
      { teams: [{ franchiseId: '9999', name: 'Now', history: [{ name: 'Then', yearStart: 2020, yearEnd: 2022 }] }] },
      '9999',
      '9999',
      2020,
      2025,
      true
    );
    const current = segments.find((s) => s.isCurrent);
    expect(current).toMatchObject({ name: 'Now', yearStart: 2023, yearEnd: 9999 });
  });
});
