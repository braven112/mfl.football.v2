/**
 * Locks in the decision logic for the AFL keeper auto-finalize job
 * (scripts/afl-auto-finalize-keepers.mjs). The cron cuts real players from
 * real rosters with nobody watching, so the safety skips here are
 * load-bearing: a partial or stale plan must never be executed.
 */
import { describe, it, expect } from 'vitest';
import {
  KEEPER_LIMIT,
  parsePlanKey,
  decidePlanAction,
  resolveKeeperDeadline,
  isWithinAutoFinalizeWindow,
} from '../scripts/lib/afl-keeper-finalize.mjs';
import leagueEvents from '../src/data/afl-fantasy/league-events.json';

const KEEPERS = ['1001', '1002', '1003', '1004', '1005', '1006', '1007'];

describe('parsePlanKey', () => {
  it('parses a well-formed key', () => {
    expect(parsePlanKey('19621:2026:0004')).toEqual({
      leagueId: '19621',
      year: 2026,
      franchiseId: '0004',
    });
  });

  it('rejects malformed keys', () => {
    expect(parsePlanKey('19621:2026')).toBeNull();
    expect(parsePlanKey('19621:26:0004')).toBeNull();
    expect(parsePlanKey('')).toBeNull();
    expect(parsePlanKey(undefined)).toBeNull();
  });
});

describe('decidePlanAction', () => {
  it('cuts every rostered player outside the keeper list', () => {
    const rosterIds = [...KEEPERS, '2001', '2002', '2003'];
    const decision = decidePlanAction({ keepers: KEEPERS, rosterIds });
    expect(decision.action).toBe('cut');
    expect(decision.cuts).toEqual(['2001', '2002', '2003']);
  });

  it('skips a partial plan (fewer than 7 keepers) — the UI cannot finalize those either', () => {
    const decision = decidePlanAction({
      keepers: KEEPERS.slice(0, 5),
      rosterIds: [...KEEPERS, '2001'],
    });
    expect(decision.action).toBe('skip-partial');
    expect(decision.cuts).toEqual([]);
  });

  it('skips a stale plan where a keeper left the roster since it was saved', () => {
    const rosterIds = [...KEEPERS.slice(0, 6), '2001', '2002'];
    const decision = decidePlanAction({ keepers: KEEPERS, rosterIds });
    expect(decision.action).toBe('skip-missing-keepers');
    expect(decision.missingKeepers).toEqual(['1007']);
    expect(decision.cuts).toEqual([]);
  });

  it('reports already-finalized when the roster is exactly the keepers', () => {
    const decision = decidePlanAction({ keepers: KEEPERS, rosterIds: [...KEEPERS] });
    expect(decision.action).toBe('already-finalized');
    expect(decision.cuts).toEqual([]);
  });

  it('is idempotent: a re-run after partial success only cuts the remainder', () => {
    // First pass cut 2001 and 2002; 2003 failed and is still rostered.
    const decision = decidePlanAction({ keepers: KEEPERS, rosterIds: [...KEEPERS, '2003'] });
    expect(decision.action).toBe('cut');
    expect(decision.cuts).toEqual(['2003']);
  });

  it('compares player ids as strings even with mixed input types', () => {
    const decision = decidePlanAction({
      keepers: KEEPERS,
      rosterIds: [...KEEPERS.map(Number), 2001],
    });
    expect(decision.action).toBe('cut');
    expect(decision.cuts).toEqual(['2001']);
  });

  it('exports the same keeper limit the storage layer uses', () => {
    expect(KEEPER_LIMIT).toBe(7);
  });
});

describe('resolveKeeperDeadline', () => {
  it('resolves July 15 8:45 PM PT (PDT, UTC-7) from the league events file', () => {
    const deadline = resolveKeeperDeadline(leagueEvents.events, 2026);
    expect(deadline.toISOString()).toBe('2026-07-16T03:45:00.000Z');
  });

  it('throws when the event is missing rather than guessing a date', () => {
    expect(() => resolveKeeperDeadline([], 2026)).toThrow(/afl-keeper-deadline/);
  });
});

describe('isWithinAutoFinalizeWindow', () => {
  const deadline = new Date('2026-07-16T03:45:00.000Z');

  it('refuses to run before the deadline — never finalize early', () => {
    expect(isWithinAutoFinalizeWindow(new Date('2026-07-16T03:44:00Z'), deadline)).toBe(false);
    expect(isWithinAutoFinalizeWindow(new Date('2026-07-14T12:00:00Z'), deadline)).toBe(false);
  });

  it('runs at and shortly after the deadline', () => {
    expect(isWithinAutoFinalizeWindow(new Date('2026-07-16T03:45:00Z'), deadline)).toBe(true);
    expect(isWithinAutoFinalizeWindow(new Date('2026-07-16T04:50:00Z'), deadline)).toBe(true);
    expect(isWithinAutoFinalizeWindow(new Date('2026-07-18T00:00:00Z'), deadline)).toBe(true);
  });

  it('refuses to run after the grace window so a stray manual run months later is inert', () => {
    expect(isWithinAutoFinalizeWindow(new Date('2026-07-22T00:00:00Z'), deadline)).toBe(false);
    expect(isWithinAutoFinalizeWindow(new Date('2026-11-01T00:00:00Z'), deadline)).toBe(false);
  });
});
