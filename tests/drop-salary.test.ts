import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module, no type declarations
import { buildDropAdjustmentMap, resolveDropSalary } from '../scripts/lib/drop-salary.mjs';

// Real MFL salary-adjustment descriptions (from data/theleague/mfl-feeds/2026).
const adjustments = [
  { id: '0', timestamp: '1771139599', amount: '636125', description: '2026 Dead Money', franchise_id: '0001' },
  { id: '23', timestamp: '1779515000', amount: '233750', franchise_id: '0001', description: 'Dropped Flournoy, Ryan DAL WR (Salary: $467,500, Years: 2)' },
  { id: '20', timestamp: '1777817398', amount: '550000', franchise_id: '0013', description: 'Dropped Thornton, Tyquan KCC WR (Salary: $1,100,000, Years: 4)' },
  { id: '10', timestamp: '1774116905', amount: '233750', franchise_id: '0013', description: 'Dropped Mafah, Phil DAL RB (Salary: $467,500, Years: 4)' },
  { id: '11', timestamp: '1774116905', amount: '233750', franchise_id: '0013', description: 'Dropped Palmer, Joshua BUF WR (Salary: $467,500, Years: 4)' },
];

const players = new Map<string, { name: string }>([
  ['16778', { name: 'Flournoy, Ryan' }],
  ['15787', { name: 'Thornton, Tyquan' }],
  ['17063', { name: 'Mafah, Phil' }],
  ['15319', { name: 'Palmer, Joshua' }],
]);

describe('buildDropAdjustmentMap', () => {
  it('indexes only Dropped adjustments, parsing salary and player name', () => {
    const map = buildDropAdjustmentMap(adjustments);
    expect(map.has('1771139599_0001')).toBe(false); // dead money, not a drop
    expect(map.get('1779515000_0001')).toEqual([{ name: 'Flournoy, Ryan', salary: 467500 }]);
    expect(map.get('1777817398_0013')).toEqual([{ name: 'Thornton, Tyquan', salary: 1100000 }]);
  });

  it('buckets a bulk drop (shared timestamp) into one array', () => {
    const map = buildDropAdjustmentMap(adjustments);
    expect(map.get('1774116905_0013')).toEqual([
      { name: 'Mafah, Phil', salary: 467500 },
      { name: 'Palmer, Joshua', salary: 467500 },
    ]);
  });
});

describe('resolveDropSalary', () => {
  const map = buildDropAdjustmentMap(adjustments);

  it('resolves a single drop by name match', () => {
    const res = resolveDropSalary({ timestamp: '1779515000', franchise: '0001' }, ['16778'], players, map);
    expect(res).toEqual({ playerId: '16778', salary: 467500 });
  });

  it('flags a big-name drop (>$1M)', () => {
    const res = resolveDropSalary({ timestamp: '1777817398', franchise: '0013' }, ['15787'], players, map);
    expect(res).toEqual({ playerId: '15787', salary: 1100000 });
    expect(res!.salary).toBeGreaterThan(1_000_000);
  });

  it('returns the priciest player in a bulk drop', () => {
    const res = resolveDropSalary({ timestamp: '1774116905', franchise: '0013' }, ['17063', '15319'], players, map);
    expect(res!.salary).toBe(467500); // both equal here; either id is acceptable
    expect(['17063', '15319']).toContain(res!.playerId);
  });

  it('returns null when no adjustment matches the transaction', () => {
    const res = resolveDropSalary({ timestamp: '9999999999', franchise: '0001' }, ['16778'], players, map);
    expect(res).toBeNull();
  });

  it('falls back to the lone bucket entry when the name does not match', () => {
    const res = resolveDropSalary({ timestamp: '1779515000', franchise: '0001' }, ['99999'], players, map);
    expect(res).toEqual({ playerId: '99999', salary: 467500 });
  });
});
