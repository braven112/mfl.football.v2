import { describe, it, expect } from 'vitest';
import {
  getPositionRank,
  sortByPosition,
  annotatePositionDividers,
  annotateTierDividers,
  annotateActiveStriping,
} from '../src/scripts/rosters/roster-rows';

const ORDER = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];

describe('getPositionRank', () => {
  it('ranks by the configured order', () => {
    expect(getPositionRank('QB', ORDER)).toBe(0);
    expect(getPositionRank('DEF', ORDER)).toBe(5);
  });

  it('is case-insensitive', () => {
    expect(getPositionRank('qb', ORDER)).toBe(0);
  });

  it('sorts unknown and empty positions last, not first', () => {
    // A -1 here would float unknowns to the top of every roster.
    expect(getPositionRank('LS', ORDER)).toBe(ORDER.length);
    expect(getPositionRank('', ORDER)).toBe(ORDER.length);
    expect(getPositionRank(null, ORDER)).toBe(ORDER.length);
    expect(getPositionRank(undefined, ORDER)).toBe(ORDER.length);
  });
});

describe('sortByPosition', () => {
  it('orders by position, then salary descending', () => {
    const rows = [
      { position: 'RB', salary: 100, id: 'rb-cheap' },
      { position: 'QB', salary: 50, id: 'qb-cheap' },
      { position: 'QB', salary: 900, id: 'qb-rich' },
      { position: 'RB', salary: 300, id: 'rb-rich' },
    ];
    expect(sortByPosition(rows, ORDER).map((r) => r.id)).toEqual([
      'qb-rich', 'qb-cheap', 'rb-rich', 'rb-cheap',
    ]);
  });

  it('does not mutate the input', () => {
    const rows = [{ position: 'RB', salary: 1 }, { position: 'QB', salary: 1 }];
    const copy = [...rows];
    sortByPosition(rows, ORDER);
    expect(rows).toEqual(copy);
  });

  it('accepts a salary reader, which is how the two copies differed', () => {
    // The server copy ran salaries through parseNumber because feed values can
    // arrive as formatted strings; the client copy did not. Without the reader
    // a string salary compares as NaN and the tiebreak silently does nothing.
    const rows = [
      { position: 'QB', salary: '1,000', id: 'cheap' },
      { position: 'QB', salary: '9,000', id: 'rich' },
    ];
    const parse = (v: unknown) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
    expect(sortByPosition(rows, ORDER, { readSalary: parse }).map((r) => r.id))
      .toEqual(['rich', 'cheap']);
  });

  it('is empty-safe', () => {
    expect(sortByPosition([], ORDER)).toEqual([]);
  });
});

describe('annotatePositionDividers', () => {
  const rows = [
    { position: 'QB' }, { position: 'QB' }, { position: 'RB' }, { position: 'WR' },
  ];

  it('flags the row where the position changes', () => {
    const out = annotatePositionDividers(rows);
    expect(out.map((r) => r.positionDivider)).toEqual([false, false, true, true]);
  });

  it('honors dividerOnFirstRow — the server/client divergence', () => {
    // The frontmatter copy drew a rule above row 0; the client copy did not,
    // so first paint and re-render disagreed. Both are reproducible here.
    expect(annotatePositionDividers(rows, { dividerOnFirstRow: true })[0].positionDivider)
      .toBe(true);
    expect(annotatePositionDividers(rows, { dividerOnFirstRow: false })[0].positionDivider)
      .toBe(false);
  });

  it('honors dividerEndOnLastRow — the other half of that divergence', () => {
    expect(annotatePositionDividers(rows, { dividerEndOnLastRow: true }).at(-1)!.positionDividerEnd)
      .toBe(true);
    expect(annotatePositionDividers(rows, { dividerEndOnLastRow: false }).at(-1)!.positionDividerEnd)
      .toBe(false);
  });

  it('flags the last row of each interior group regardless of that option', () => {
    const out = annotatePositionDividers(rows, { dividerEndOnLastRow: false });
    expect(out.map((r) => r.positionDividerEnd)).toEqual([false, true, true, false]);
  });

  it('is case-insensitive about position identity', () => {
    const out = annotatePositionDividers([{ position: 'QB' }, { position: 'qb' }]);
    expect(out[1].positionDivider).toBe(false);
  });

  it('is empty-safe', () => {
    expect(annotatePositionDividers([])).toEqual([]);
  });
});

describe('annotateTierDividers', () => {
  it('flags the crossing out of active into another bucket', () => {
    const out = annotateTierDividers([
      { displayTag: 'active' }, { displayTag: 'active' }, { displayTag: 'practice' },
    ]);
    expect(out.map((r) => r.tierDivider)).toEqual([false, false, true]);
  });

  it('never flags a crossing back INTO active', () => {
    // The `!== 'active'` guard: returning to active must not draw a rule.
    const out = annotateTierDividers([{ displayTag: 'practice' }, { displayTag: 'active' }]);
    expect(out.map((r) => r.tierDivider)).toEqual([false, false]);
  });

  it('flags practice -> injured', () => {
    const out = annotateTierDividers([{ displayTag: 'practice' }, { displayTag: 'injured' }]);
    expect(out[1].tierDivider).toBe(true);
  });

  it('treats a missing tag as active', () => {
    const out = annotateTierDividers([{}, { displayTag: 'active' }]);
    expect(out.map((r) => r.tierDivider)).toEqual([false, false]);
  });
});

describe('annotateActiveStriping', () => {
  it('alternates across active rows only', () => {
    const out = annotateActiveStriping([
      { displayTag: 'active' }, { displayTag: 'active' }, { displayTag: 'active' },
    ]);
    expect(out.map((r) => r.activeStripe)).toEqual([false, true, false]);
  });

  it('does not advance the stripe counter on non-active rows', () => {
    // A practice row in the middle must not flip the zebra pattern of the
    // active rows around it.
    const out = annotateActiveStriping([
      { displayTag: 'active' },
      { displayTag: 'practice' },
      { displayTag: 'active' },
    ]);
    expect(out.map((r) => r.activeStripe)).toEqual([false, false, true]);
  });

  it('never stripes a non-active row', () => {
    const out = annotateActiveStriping([{ displayTag: 'injured' }, { displayTag: 'injured' }]);
    expect(out.every((r) => r.activeStripe === false)).toBe(true);
  });
});
