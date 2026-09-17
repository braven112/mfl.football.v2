import { describe, it, expect } from 'vitest';
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

  // These three BBID variations are all real in this league's feeds. A shape the
  // BBID pattern misses does not fail — it falls through to the FREE_AGENT
  // branch, where the BID is read as a dropped player id and the caller gets no
  // bid at all, so a $775K claim prices as $0. 738 of the 1307 recorded BBID
  // rows were being read that way.
  it('parses a BBID claim written without the comma after the add id (pre-2017)', () => {
    const { addedIds, droppedIds, bbidAmount } = parseRosterMove('8838|425000|3969');
    expect(addedIds).toEqual(['8838']);
    expect(droppedIds).toEqual(['3969']);
    expect(bbidAmount).toBe(425000);
  });

  // "0000" is MFL's pre-2017 way of writing "nothing was cut" — the slot the
  // modern format leaves empty. Neither league has ever had a player with that
  // id, and 276 rows carry it. Returned as a dropped id it reaches
  // describePlayer() in schefter-scan.mjs, which cannot look it up and falls
  // through to the literal prose `Player 0000` — the same failure as #1156,
  // armed for whenever a backfill replays an old season.
  it('reads the legacy 0000 marker as NOTHING CUT, not as a player', () => {
    expect(parseRosterMove('8838|425000|0000').droppedIds).toEqual([]);
    expect(parseRosterMove('8838|425000|0000').addedIds).toEqual(['8838']);
    expect(parseRosterMove('7598|1525000.00|0000').droppedIds).toEqual([]);
    // It is a sentinel only where MFL writes one; a real id keeps its place.
    expect(parseRosterMove('8838|425000|0000,3969').droppedIds).toEqual(['3969']);
  });

  it('parses a decimal BBID bid, including a bare trailing dot', () => {
    expect(parseRosterMove('8838|425000.5|16444').bbidAmount).toBe(425000);
    expect(parseRosterMove('8838|425000.|16444').bbidAmount).toBe(425000);
    expect(parseRosterMove('8838|425000.5|16444').droppedIds).toEqual(['16444']);
  });

  it('parses a BBID claim that drops several players', () => {
    const { addedIds, droppedIds, bbidAmount } = parseRosterMove('16171,|775000|16752,15749,');
    expect(addedIds).toEqual(['16171']);
    expect(droppedIds).toEqual(['16752', '15749']);
    expect(bbidAmount).toBe(775000);
  });

  it('never reads a BBID bid as a dropped player', () => {
    for (const raw of ['8838|425000|0000', '8838,|425000|0000,', '8838|425000.5|16444']) {
      expect(parseRosterMove(raw).droppedIds, raw).not.toContain('425000');
    }
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
