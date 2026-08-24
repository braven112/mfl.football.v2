/**
 * Guard tests for accounting CSV.
 *
 * The round trip is the contract: an exported ledger must import back
 * unchanged. The commas-in-descriptions case is the one that silently
 * corrupts real data rather than failing loudly.
 */

import { describe, it, expect } from 'vitest';
import {
  parseAccountingCsv,
  toAccountingCsv,
  splitCsvLine,
  ACCOUNTING_CSV_HEADER,
} from '../src/utils/accounting-csv';

describe('splitCsvLine', () => {
  it('keeps a quoted comma inside its field', () => {
    // A naive split(',') truncates the description here and writes a real but
    // wrong ledger line.
    expect(splitCsvLine('0001,-100,"Week 3 high score, 142.6 pts"')).toEqual([
      '0001',
      '-100',
      'Week 3 high score, 142.6 pts',
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(splitCsvLine('0001,5,"He said ""nice"""')).toEqual(['0001', '5', 'He said "nice"']);
  });
});

describe('parseAccountingCsv', () => {
  it('parses a headerless file positionally', () => {
    const parsed = parseAccountingCsv('0001,-100,2026 dues\n0002,-100,2026 dues');
    expect(parsed.valid).toHaveLength(2);
    expect(parsed.valid[0]).toEqual({
      franchiseId: '0001',
      amount: -100,
      description: '2026 dues',
    });
  });

  it('matches header columns in any order', () => {
    const parsed = parseAccountingCsv('description,franchise,amount\ndues,1,-100');
    expect(parsed.valid[0]).toEqual({
      franchiseId: '0001',
      amount: -100,
      description: 'dues',
    });
  });

  it('does not eat a data row that merely looks like a header', () => {
    // "id,25,dues" has a numeric amount column, so it is data, not a header.
    const parsed = parseAccountingCsv('id,25,dues');
    expect(parsed.rows).toHaveLength(1);
  });

  it('keeps invalid rows so the preview can show them', () => {
    const parsed = parseAccountingCsv('0001,-100,dues\nnope,abc,\n0003,50,prize');
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.valid).toHaveLength(2);
    expect(parsed.rows[1].error).toBeTruthy();
  });

  it('flags a zero amount rather than writing a no-op record', () => {
    const parsed = parseAccountingCsv('0001,0,nothing');
    expect(parsed.valid).toHaveLength(0);
    expect(parsed.rows[0].error).toMatch(/zero/i);
  });

  it('reports an empty file as fatal', () => {
    expect(parseAccountingCsv('   \n\n').fatal).toBeTruthy();
  });

  it('folds an unquoted trailing comma back into the description', () => {
    // Losing the tail would write a truncated but plausible-looking record.
    const parsed = parseAccountingCsv('0001,-100,Week 3, high score');
    expect(parsed.valid[0].description).toBe('Week 3, high score');
  });
});

describe('round trip', () => {
  it('re-imports an exported ledger unchanged', () => {
    const records = [
      { franchiseId: '0001', amount: -100, description: '2026 league dues' },
      { franchiseId: '0002', amount: 300, description: '2025 League Champion' },
      { franchiseId: '0003', amount: 3, description: 'Weekly High Score - Week 3, 142.6 pts' },
    ];
    const csv = toAccountingCsv(records);
    expect(csv.split('\n')[0]).toBe(ACCOUNTING_CSV_HEADER);

    const parsed = parseAccountingCsv(csv);
    expect(parsed.valid).toEqual(records);
  });

  it('writes plain signed decimals, not currency strings', () => {
    // A "$100.00" export only survives its own parser and confuses every
    // spreadsheet that opens it.
    const csv = toAccountingCsv([{ franchiseId: '0001', amount: -100, description: 'dues' }]);
    expect(csv).toContain('-100.00');
    expect(csv).not.toContain('$');
  });
});
