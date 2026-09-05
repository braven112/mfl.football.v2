/**
 * Ballot-builder interaction rules (src/utils/owners-poll-builder.ts).
 *
 * These are the tap-to-add mechanics the island relies on, tested without
 * mounting React.
 */
import { describe, it, expect } from 'vitest';
import {
  toggleTeam,
  moveTeam,
  isComplete,
  slotOf,
  sanitizeSelection,
} from '../src/utils/owners-poll-builder';

const SLOTS = 7;
const FIELD = Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(4, '0'));

describe('toggleTeam', () => {
  it('appends in tap order', () => {
    let sel: string[] = [];
    sel = toggleTeam(sel, '0005', SLOTS);
    sel = toggleTeam(sel, '0002', SLOTS);
    expect(sel).toEqual(['0005', '0002']);
  });

  it('removes a picked team and renumbers the rest by position', () => {
    const sel = toggleTeam(['0001', '0002', '0003'], '0002', SLOTS);
    expect(sel).toEqual(['0001', '0003']);
    expect(slotOf(sel, '0003')).toBe(2);
  });

  it('ignores a tap past the limit rather than silently dropping a pick', () => {
    const full = FIELD.slice(0, SLOTS);
    // Evicting the last pick to make room would discard a deliberate choice
    // without telling the owner.
    expect(toggleTeam(full, '0009', SLOTS)).toEqual(full);
  });

  it('still allows removal when the ballot is full', () => {
    const full = FIELD.slice(0, SLOTS);
    expect(toggleTeam(full, '0001', SLOTS)).toHaveLength(SLOTS - 1);
  });

  it('never mutates the input', () => {
    const sel = ['0001'];
    const next = toggleTeam(sel, '0002', SLOTS);
    expect(sel).toEqual(['0001']);
    expect(next).not.toBe(sel);
  });
});

describe('moveTeam', () => {
  it('swaps with the neighbour in each direction', () => {
    expect(moveTeam(['0001', '0002', '0003'], '0002', -1)).toEqual(['0002', '0001', '0003']);
    expect(moveTeam(['0001', '0002', '0003'], '0002', 1)).toEqual(['0001', '0003', '0002']);
  });

  it('is a no-op at the ends and for an unpicked team', () => {
    const sel = ['0001', '0002'];
    expect(moveTeam(sel, '0001', -1)).toEqual(sel);
    expect(moveTeam(sel, '0002', 1)).toEqual(sel);
    expect(moveTeam(sel, '0009', -1)).toEqual(sel);
  });
});

describe('isComplete / slotOf', () => {
  it('is complete only at exactly slots', () => {
    expect(isComplete(FIELD.slice(0, 6), SLOTS)).toBe(false);
    expect(isComplete(FIELD.slice(0, SLOTS), SLOTS)).toBe(true);
  });

  it('reports 1-indexed slots and null when unpicked', () => {
    expect(slotOf(['0004', '0009'], '0009')).toBe(2);
    expect(slotOf(['0004'], '0009')).toBeNull();
  });
});

describe('sanitizeSelection', () => {
  it('keeps a valid prefill intact', () => {
    const ranking = FIELD.slice(0, SLOTS);
    expect(sanitizeSelection(ranking, FIELD, SLOTS)).toEqual(ranking);
  });

  it('drops teams the page does not know, leaving a finishable short ballot', () => {
    // A stale prefill (franchise left the league) must not open as a ballot
    // that looks complete and is then rejected on submit.
    const result = sanitizeSelection(
      ['0001', '9999', '0003', '0004', '0005', '0006', '0007'],
      FIELD,
      SLOTS,
    );
    expect(result).toEqual(['0001', '0003', '0004', '0005', '0006', '0007']);
    expect(isComplete(result, SLOTS)).toBe(false);
  });

  it('dedupes and truncates past slots', () => {
    expect(sanitizeSelection(['0001', '0001', '0002'], FIELD, SLOTS)).toEqual(['0001', '0002']);
    expect(sanitizeSelection(FIELD, FIELD, SLOTS)).toHaveLength(SLOTS);
  });

  it('returns an empty selection for junk', () => {
    expect(sanitizeSelection(null, FIELD, SLOTS)).toEqual([]);
    expect(sanitizeSelection(undefined, FIELD, SLOTS)).toEqual([]);
    expect(sanitizeSelection(['x', 1 as unknown as string], FIELD, SLOTS)).toEqual([]);
  });
});
