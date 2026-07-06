import { describe, it, expect } from 'vitest';
import {
  selectMostRecentDraftPick,
  getMostRecentDraftPick,
} from '../src/utils/hero-data/draft-hero-data';

/**
 * getMostRecentDraftPick reads the MFL draftResults feed and returns the pick
 * with the latest timestamp. selectMostRecentDraftPick is the pure core —
 * exercised here with fixtures so timestamp/tie-break/shape logic is covered
 * without depending on the live feed.
 */

function pick(overrides: Record<string, any> = {}) {
  return {
    round: '01',
    pick: '01',
    franchise: '0007',
    player: '17472',
    timestamp: '1777756190',
    comments: '',
    ...overrides,
  };
}

function feed(picks: any) {
  return { draftResults: { draftUnit: { draftPick: picks } } };
}

describe('selectMostRecentDraftPick', () => {
  it('returns null for null / undefined input', () => {
    expect(selectMostRecentDraftPick(null)).toBeNull();
    expect(selectMostRecentDraftPick(undefined)).toBeNull();
  });

  it('returns null when the draftResults shape is missing', () => {
    expect(selectMostRecentDraftPick({})).toBeNull();
    expect(selectMostRecentDraftPick({ draftResults: {} })).toBeNull();
    expect(selectMostRecentDraftPick({ draftResults: { draftUnit: {} } })).toBeNull();
  });

  it('returns null when there are no picks (empty array)', () => {
    expect(selectMostRecentDraftPick(feed([]))).toBeNull();
  });

  it('handles a single-object draftPick (not an array)', () => {
    const result = selectMostRecentDraftPick(
      feed(pick({ player: '99999', franchise: '0003', timestamp: '1700000000' })),
    );
    expect(result).toEqual({ playerId: '99999', franchiseId: '0003', timestamp: 1700000000 });
  });

  it('returns the pick with the MAX numeric timestamp', () => {
    const result = selectMostRecentDraftPick(
      feed([
        pick({ player: 'A', pick: '01', timestamp: '1000' }),
        pick({ player: 'B', pick: '02', timestamp: '3000' }),
        pick({ player: 'C', pick: '03', timestamp: '2000' }),
      ]),
    );
    expect(result?.playerId).toBe('B');
    expect(result?.timestamp).toBe(3000);
  });

  it('compares timestamps numerically, not lexicographically', () => {
    // Lexicographic string compare would rank '900' > '1000'. Numeric must win.
    const result = selectMostRecentDraftPick(
      feed([
        pick({ player: 'A', timestamp: '900' }),
        pick({ player: 'B', timestamp: '1000' }),
      ]),
    );
    expect(result?.playerId).toBe('B');
    expect(result?.timestamp).toBe(1000);
  });

  it('breaks timestamp ties by later round, then later pick', () => {
    // MFL stamps a batch of pre-draft-list auto-picks with one shared timestamp.
    const result = selectMostRecentDraftPick(
      feed([
        pick({ player: 'R2P1', round: '02', pick: '13', timestamp: '5000' }),
        pick({ player: 'R3P16', round: '03', pick: '16', timestamp: '5000' }),
        pick({ player: 'R3P14', round: '03', pick: '14', timestamp: '5000' }),
      ]),
    );
    expect(result?.playerId).toBe('R3P16');
  });

  it('ignores unfilled picks (empty / whitespace player)', () => {
    const result = selectMostRecentDraftPick(
      feed([
        pick({ player: 'REAL', timestamp: '1000' }),
        pick({ player: '', timestamp: '9999' }),
        pick({ player: '   ', timestamp: '8888' }),
      ]),
    );
    expect(result?.playerId).toBe('REAL');
    expect(result?.timestamp).toBe(1000);
  });

  it('returns null when every pick is unfilled', () => {
    expect(
      selectMostRecentDraftPick(feed([pick({ player: '' }), pick({ player: '  ' })])),
    ).toBeNull();
  });

  it('skips picks with a non-numeric timestamp', () => {
    const result = selectMostRecentDraftPick(
      feed([
        pick({ player: 'GOOD', timestamp: '1000' }),
        pick({ player: 'BAD', timestamp: 'not-a-number' }),
      ]),
    );
    expect(result?.playerId).toBe('GOOD');
  });

  it('coerces numeric player/franchise ids to strings', () => {
    const result = selectMostRecentDraftPick(
      feed(pick({ player: 17472, franchise: 7, timestamp: '1777756190' })),
    );
    expect(result).toEqual({ playerId: '17472', franchiseId: '7', timestamp: 1777756190 });
  });
});

describe('getMostRecentDraftPick (live 2026 feed)', () => {
  it('returns null for a year with no draftResults feed on disk', () => {
    expect(getMostRecentDraftPick(1999)).toBeNull();
  });

  it('reads the frozen 2026 feed and returns its latest pick', () => {
    // 2026 draftResults is a completed, frozen draft. Its final batch (picks
    // 13-16 of round 3) shares timestamp 1778196342; the last slot (03/16)
    // wins the tie-break — player 17526, franchise 0011.
    const result = getMostRecentDraftPick(2026);
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(1778196342);
    expect(result!.playerId).toBe('17526');
    expect(result!.franchiseId).toBe('0011');
  });
});
