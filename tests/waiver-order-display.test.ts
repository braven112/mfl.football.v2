/**
 * Waiver priority, as an OWNER reads it.
 *
 * The sibling suite (afl-waiver-order.test.ts) pins how the order is WRITTEN
 * to MFL. This one pins how it is read back and shown, which has its own trap:
 * MFL's `waiverSortOrder` is a flat 1..24 across the league, serialized as two
 * conference blocks one after the other (American 1-12, National 13-24). The
 * National team holding 13 is FIRST in line, not thirteenth — and it is the
 * only line that decides any of its claims, because the AFL is a
 * duplicate-player league where the conferences never contend for the same
 * player. Showing the raw number to that owner would be a straight lie about
 * their odds, which is the whole reason `rankWithinConference` exists.
 */
import { describe, it, expect } from 'vitest';
import { readWaiverSortOrder, rankWithinConference } from '../src/utils/waiver-order';

const leaguePayload = (franchises: Array<Record<string, unknown>>) => ({
  league: { franchises: { franchise: franchises } },
});

describe('readWaiverSortOrder', () => {
  it('reads id + waiverSortOrder off an export?TYPE=league payload', () => {
    const entries = readWaiverSortOrder(
      leaguePayload([
        { id: '0001', name: 'Smokane FC', waiverSortOrder: '10' },
        { id: '0002', name: 'Someone Else', waiverSortOrder: '3' },
      ]),
    );
    expect(entries).toEqual([
      { franchiseId: '0001', sortOrder: 10 },
      { franchiseId: '0002', sortOrder: 3 },
    ]);
  });

  it('accepts the single-franchise shape, where MFL sends a bare object', () => {
    expect(
      readWaiverSortOrder({ league: { franchises: { franchise: { id: '0007', waiverSortOrder: '1' } } } }),
    ).toEqual([{ franchiseId: '0007', sortOrder: 1 }]);
  });

  it('DROPS a franchise with no usable order rather than coercing it to 0', () => {
    // A 0 would sort to the front and hand somebody a first-in-line badge they
    // do not have — the one failure mode worth a test of its own.
    const entries = readWaiverSortOrder(
      leaguePayload([
        { id: '0001', waiverSortOrder: '4' },
        { id: '0002' },
        { id: '0003', waiverSortOrder: '' },
        { id: '0004', waiverSortOrder: 'first' },
      ]),
    );
    expect(entries).toEqual([{ franchiseId: '0001', sortOrder: 4 }]);
  });

  it('survives an error body or a shape it does not recognise', () => {
    expect(readWaiverSortOrder(null)).toEqual([]);
    expect(readWaiverSortOrder({ error: 'Invalid league' })).toEqual([]);
    expect(readWaiverSortOrder({ league: {} })).toEqual([]);
  });
});

describe('rankWithinConference', () => {
  // American block 1-12, National block 13-24 — MFL's own serialization.
  const entries = [
    { franchiseId: 'AL-a', sortOrder: 3 },
    { franchiseId: 'AL-b', sortOrder: 1 },
    { franchiseId: 'AL-c', sortOrder: 2 },
    { franchiseId: 'NL-a', sortOrder: 15 },
    { franchiseId: 'NL-b', sortOrder: 13 },
    { franchiseId: 'NL-c', sortOrder: 14 },
  ];

  it('renumbers from 1 inside the conference, never showing MFL’s flat number', () => {
    expect(rankWithinConference(entries, ['NL-a', 'NL-b', 'NL-c'])).toEqual([
      { franchiseId: 'NL-b', rank: 1 },
      { franchiseId: 'NL-c', rank: 2 },
      { franchiseId: 'NL-a', rank: 3 },
    ]);
  });

  it('gives both conferences their own 1, because neither competes with the other', () => {
    const al = rankWithinConference(entries, ['AL-a', 'AL-b', 'AL-c']);
    const nl = rankWithinConference(entries, ['NL-a', 'NL-b', 'NL-c']);
    expect(al[0]).toEqual({ franchiseId: 'AL-b', rank: 1 });
    expect(nl[0]).toEqual({ franchiseId: 'NL-b', rank: 1 });
  });

  it('is unchanged when MFL renumbers the blocks', () => {
    // The blocks are an MFL serialization detail; only relative order inside a
    // conference is real. Shift the National block wholesale and nothing moves.
    const shifted = entries.map((e) =>
      e.franchiseId.startsWith('NL') ? { ...e, sortOrder: e.sortOrder + 100 } : e,
    );
    expect(rankWithinConference(shifted, ['NL-a', 'NL-b', 'NL-c'])).toEqual(
      rankWithinConference(entries, ['NL-a', 'NL-b', 'NL-c']),
    );
  });

  it('keeps a member MFL has no order for, sorted last and stable', () => {
    // Dropping them would understate how many teams are ahead of the viewer,
    // which is exactly the number the modal turns into "line up N backups".
    expect(rankWithinConference(entries, ['AL-a', 'AL-new', 'AL-b'])).toEqual([
      { franchiseId: 'AL-b', rank: 1 },
      { franchiseId: 'AL-a', rank: 2 },
      { franchiseId: 'AL-new', rank: 3 },
    ]);
  });

  it('ranks a single-pool league (no conferences) against the whole league', () => {
    expect(rankWithinConference(entries, entries.map((e) => e.franchiseId)).slice(0, 2)).toEqual([
      { franchiseId: 'AL-b', rank: 1 },
      { franchiseId: 'AL-c', rank: 2 },
    ]);
  });
});
