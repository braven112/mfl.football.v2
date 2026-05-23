import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module, no type declarations
import { parseRosterMove } from '../scripts/lib/roster-move-parse.mjs';

describe('parseRosterMove — MFL roster-move transaction parsing', () => {
  it('treats a leading-pipe transaction as a pure drop, never an add', () => {
    // Regression: "Pacific Pigskins claims WR Flournoy, Ryan" — a drop was
    // reported as a pickup because the leading pipe was stripped before split.
    const { addedIds, droppedIds } = parseRosterMove('|13134,');
    expect(addedIds).toEqual([]);
    expect(droppedIds).toEqual(['13134']);
  });

  it('parses an add-only transaction (trailing pipe, empty drop side)', () => {
    const { addedIds, droppedIds } = parseRosterMove('14056,|');
    expect(addedIds).toEqual(['14056']);
    expect(droppedIds).toEqual([]);
  });

  it('parses an add/drop swap', () => {
    const { addedIds, droppedIds } = parseRosterMove('11643,|13128,');
    expect(addedIds).toEqual(['11643']);
    expect(droppedIds).toEqual(['13128']);
  });

  it('parses a bulk drop (multiple dropped IDs, empty add side)', () => {
    const { addedIds, droppedIds } = parseRosterMove('|14056,14800,11761,11674,');
    expect(addedIds).toEqual([]);
    expect(droppedIds).toEqual(['14056', '14800', '11761', '11674']);
  });

  it('parses a BBID add/drop with bid amount', () => {
    const { addedIds, droppedIds, bbidAmount } = parseRosterMove('11947,|425000|16444,');
    expect(addedIds).toEqual(['11947']);
    expect(droppedIds).toEqual(['16444']);
    expect(bbidAmount).toBe(425000);
  });

  it('parses a BBID add-only winning bid (empty drop side)', () => {
    const { addedIds, droppedIds, bbidAmount } = parseRosterMove('0507,|650000|');
    expect(addedIds).toEqual(['0507']);
    expect(droppedIds).toEqual([]);
    expect(bbidAmount).toBe(650000);
  });

  it('does not mistake the bid amount for a player ID', () => {
    const { addedIds, droppedIds } = parseRosterMove('14071,|3600000|');
    expect(addedIds).toEqual(['14071']);
    expect(droppedIds).toEqual([]);
  });

  it('returns empty results for an empty or whitespace transaction', () => {
    expect(parseRosterMove('')).toEqual({ addedIds: [], droppedIds: [], bbidAmount: undefined });
    expect(parseRosterMove('   ')).toEqual({ addedIds: [], droppedIds: [], bbidAmount: undefined });
    // @ts-expect-error — defensive: undefined input
    expect(parseRosterMove(undefined)).toEqual({ addedIds: [], droppedIds: [], bbidAmount: undefined });
  });
});
