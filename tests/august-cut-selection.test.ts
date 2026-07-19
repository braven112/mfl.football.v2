/**
 * Tests for the August cutdown pure selection algorithm.
 *
 * Locks in the ordering contract from the feature plan
 * (docs/features/august-roster-cuts-automation-plan.md):
 * marked-first in owner order; newest-acquisition fallback; trades never
 * count as acquisitions; no-record = oldest; under-limit → zero cuts;
 * marked-but-departed skipped; taxi/IR excluded; never cuts below target.
 */
import { describe, it, expect } from 'vitest';
import {
  selectAutoCuts,
  ACTIVE_ROSTER_STATUS,
  type AutoCutAcquisition,
  type AutoCutRosterPlayer,
} from '../src/utils/august-cut-selection';
import { TARGET_ACTIVE_COUNT } from '../src/utils/salary-calculations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roster(count: number, opts: { startId?: number; status?: string } = {}): AutoCutRosterPlayer[] {
  const { startId = 1, status = ACTIVE_ROSTER_STATUS } = opts;
  return Array.from({ length: count }, (_, i) => ({
    id: String(startId + i),
    status,
  }));
}

function acquisition(
  playerId: string,
  timestamp: number,
  type = 'FREE_AGENT',
  franchise?: string,
): AutoCutAcquisition {
  return { type, timestamp, addedPlayerIds: [playerId], franchise };
}

const TARGET = 5; // small target keeps fixtures readable

// ---------------------------------------------------------------------------
// Under / at limit — zero cuts
// ---------------------------------------------------------------------------

describe('selectAutoCuts — under-limit and boundary states', () => {
  it('returns zero cuts when under the target, even with marked players', () => {
    const result = selectAutoCuts({
      activeRoster: roster(4),
      markedPlayerIds: ['1', '2', '3'],
      target: TARGET,
    });
    expect(result.cuts).toEqual([]);
    expect(result.overage).toBe(-1);
    expect(result.activeCount).toBe(4);
  });

  it('returns zero cuts exactly at the target (marked players are safe)', () => {
    const result = selectAutoCuts({
      activeRoster: roster(TARGET),
      markedPlayerIds: ['1', '2'],
      target: TARGET,
    });
    expect(result.cuts).toEqual([]);
    expect(result.overage).toBe(0);
  });

  it('defaults target to TARGET_ACTIVE_COUNT (22)', () => {
    const result = selectAutoCuts({
      activeRoster: roster(TARGET_ACTIVE_COUNT + 1),
    });
    expect(result.target).toBe(TARGET_ACTIVE_COUNT);
    expect(result.cuts).toHaveLength(1);
  });

  it('handles an empty roster', () => {
    const result = selectAutoCuts({ activeRoster: [], target: TARGET });
    expect(result.cuts).toEqual([]);
    expect(result.activeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Marked players first
// ---------------------------------------------------------------------------

describe('selectAutoCuts — marked players', () => {
  it('cuts marked players first, in the owner-given order', () => {
    const result = selectAutoCuts({
      activeRoster: roster(8), // overage 3
      markedPlayerIds: ['7', '2', '5'],
      target: TARGET,
    });
    expect(result.cuts.map(c => c.playerId)).toEqual(['7', '2', '5']);
    expect(result.cuts.every(c => c.reason === 'marked')).toBe(true);
  });

  it('consumes only as many marked players as the overage requires', () => {
    const result = selectAutoCuts({
      activeRoster: roster(7), // overage 2
      markedPlayerIds: ['3', '1', '6', '2'],
      target: TARGET,
    });
    expect(result.cuts.map(c => c.playerId)).toEqual(['3', '1']);
  });

  it('skips marked players no longer on the roster (traded / already cut)', () => {
    const result = selectAutoCuts({
      activeRoster: roster(7), // ids 1..7, overage 2
      markedPlayerIds: ['999', '4', '888', '6'],
      target: TARGET,
    });
    expect(result.cuts.map(c => c.playerId)).toEqual(['4', '6']);
    expect(result.cuts.every(c => c.reason === 'marked')).toBe(true);
  });

  it('skips marked players who moved to taxi or IR (no longer cuttable)', () => {
    const activeRoster = [
      ...roster(7), // ids 1..7 active — overage 2
      { id: '100', status: 'TAXI_SQUAD' },
      { id: '101', status: 'INJURED_RESERVE' },
    ];
    const result = selectAutoCuts({
      activeRoster,
      markedPlayerIds: ['100', '101', '3', '5'],
      target: TARGET,
    });
    expect(result.cuts.map(c => c.playerId)).toEqual(['3', '5']);
  });

  it('deduplicates repeated marked ids, keeping the first (highest-priority) slot', () => {
    const result = selectAutoCuts({
      activeRoster: roster(8), // overage 3
      markedPlayerIds: ['2', '2', '4', '2', '6'],
      target: TARGET,
    });
    expect(result.cuts.map(c => c.playerId)).toEqual(['2', '4', '6']);
  });
});

// ---------------------------------------------------------------------------
// Fallback ordering — newest acquisitions first
// ---------------------------------------------------------------------------

describe('selectAutoCuts — last-added fallback ordering', () => {
  it('fills the overage with newest acquisitions first when nothing is marked', () => {
    const result = selectAutoCuts({
      activeRoster: roster(8), // overage 3
      acquisitions: [
        acquisition('3', 1_000),
        acquisition('6', 3_000),
        acquisition('1', 2_000),
        acquisition('8', 500),
      ],
      target: TARGET,
    });
    expect(result.cuts.map(c => c.playerId)).toEqual(['6', '1', '3']);
    expect(result.cuts.every(c => c.reason === 'last-added')).toBe(true);
    expect(result.cuts[0].acquisitionTimestamp).toBe(3_000);
    expect(result.cuts[1].acquisitionTimestamp).toBe(2_000);
    expect(result.cuts[2].acquisitionTimestamp).toBe(1_000);
  });

  it('combines marked-first with last-added fill, in execution order', () => {
    const result = selectAutoCuts({
      activeRoster: roster(9), // overage 4
      markedPlayerIds: ['5', '2'],
      acquisitions: [
        acquisition('7', 9_000),
        acquisition('3', 8_000),
        acquisition('1', 100),
      ],
      target: TARGET,
    });
    expect(result.cuts.map(c => ({ id: c.playerId, reason: c.reason }))).toEqual([
      { id: '5', reason: 'marked' },
      { id: '2', reason: 'marked' },
      { id: '7', reason: 'last-added' },
      { id: '3', reason: 'last-added' },
    ]);
  });

  it('treats players with no acquisition record as oldest (cut last)', () => {
    const result = selectAutoCuts({
      activeRoster: roster(7), // ids 1..7, overage 2
      acquisitions: [acquisition('6', 1_000)],
      target: TARGET,
    });
    // Only '6' has a record → it goes first; the second slot falls to the
    // first no-record player in roster order (stable sort).
    expect(result.cuts[0].playerId).toBe('6');
    expect(result.cuts[0].acquisitionTimestamp).toBe(1_000);
    expect(result.cuts[1].playerId).toBe('1');
    expect(result.cuts[1].acquisitionTimestamp).toBeUndefined();
  });

  it('does not re-select a marked player in the fallback phase', () => {
    const result = selectAutoCuts({
      activeRoster: roster(7), // overage 2
      markedPlayerIds: ['4'],
      acquisitions: [
        acquisition('4', 9_999), // newest — but already cut as marked
        acquisition('2', 5_000),
      ],
      target: TARGET,
    });
    expect(result.cuts.map(c => c.playerId)).toEqual(['4', '2']);
  });

  it('uses the newest timestamp when a player was acquired multiple times', () => {
    const result = selectAutoCuts({
      activeRoster: roster(6), // overage 1
      acquisitions: [
        acquisition('2', 1_000),
        acquisition('2', 4_000), // re-acquired later
        acquisition('5', 3_000),
      ],
      target: TARGET,
    });
    expect(result.cuts.map(c => c.playerId)).toEqual(['2']);
    expect(result.cuts[0].acquisitionTimestamp).toBe(4_000);
  });

  it('accepts numeric-string timestamps (raw MFL feed shape)', () => {
    const result = selectAutoCuts({
      activeRoster: roster(6), // overage 1
      acquisitions: [
        { type: 'BBID_WAIVER', timestamp: '5000', addedPlayerIds: ['3'] },
        { type: 'FREE_AGENT', timestamp: '4000', addedPlayerIds: ['1'] },
      ],
      target: TARGET,
    });
    expect(result.cuts.map(c => c.playerId)).toEqual(['3']);
    expect(result.cuts[0].acquisitionTimestamp).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Trade exclusion
// ---------------------------------------------------------------------------

describe('selectAutoCuts — trades never count as acquisitions', () => {
  it('ignores TRADE events entirely: a July trade acquisition is long-held', () => {
    const result = selectAutoCuts({
      activeRoster: roster(6), // overage 1
      acquisitions: [
        acquisition('2', 9_999_999, 'TRADE'), // most recent — but a trade
        acquisition('4', 1_000, 'FREE_AGENT'),
      ],
      target: TARGET,
    });
    // '2' is trade-acquired → treated as no-record; '4' is the only pickup.
    expect(result.cuts.map(c => c.playerId)).toEqual(['4']);
  });

  it('never targets trade acquisitions until every FA/waiver/auction pickup is exhausted', () => {
    const result = selectAutoCuts({
      activeRoster: roster(7), // overage 2
      acquisitions: [
        acquisition('1', 9_000, 'TRADE'),
        acquisition('2', 8_000, 'TRADE'),
        acquisition('3', 100, 'BBID_WAIVER'),
        acquisition('4', 50, 'AUCTION_WON'),
      ],
      target: TARGET,
    });
    // Both pickups (newest first) go before any trade-acquired player.
    expect(result.cuts.map(c => c.playerId)).toEqual(['3', '4']);
  });

  it('counts exactly the ACQUISITION_TYPES: BBID_WAIVER, FREE_AGENT, AUCTION_WON', () => {
    const result = selectAutoCuts({
      activeRoster: roster(8), // overage 3
      acquisitions: [
        acquisition('1', 1_000, 'BBID_WAIVER'),
        acquisition('2', 2_000, 'FREE_AGENT'),
        acquisition('3', 3_000, 'AUCTION_WON'),
        acquisition('4', 9_000, 'TRADE'),
        acquisition('5', 9_500, 'BBID_AUTO_PROCESS_WAIVERS'),
      ],
      target: TARGET,
    });
    expect(result.cuts.map(c => c.playerId)).toEqual(['3', '2', '1']);
  });

  it('a trade re-acquisition does not refresh an older pickup timestamp', () => {
    const result = selectAutoCuts({
      activeRoster: roster(6), // overage 1
      acquisitions: [
        acquisition('2', 1_000, 'FREE_AGENT'),
        acquisition('2', 9_000, 'TRADE'), // ignored
        acquisition('4', 2_000, 'FREE_AGENT'),
      ],
      target: TARGET,
    });
    expect(result.cuts.map(c => c.playerId)).toEqual(['4']);
  });
});

// ---------------------------------------------------------------------------
// Taxi / IR exclusion
// ---------------------------------------------------------------------------

describe('selectAutoCuts — taxi and IR are untouchable', () => {
  it('excludes taxi and IR players from the active count', () => {
    const activeRoster = [
      ...roster(TARGET), // exactly at target
      { id: '50', status: 'TAXI_SQUAD' },
      { id: '51', status: 'TAXI_SQUAD' },
      { id: '52', status: 'INJURED_RESERVE' },
    ];
    const result = selectAutoCuts({ activeRoster, target: TARGET });
    expect(result.activeCount).toBe(TARGET);
    expect(result.cuts).toEqual([]);
  });

  it('never selects a taxi/IR player in the fallback, even with the newest acquisition', () => {
    const activeRoster = [
      ...roster(6), // overage 1
      { id: '50', status: 'TAXI_SQUAD' },
      { id: '51', status: 'INJURED_RESERVE' },
    ];
    const result = selectAutoCuts({
      activeRoster,
      acquisitions: [
        acquisition('50', 9_999),
        acquisition('51', 9_998),
        acquisition('3', 100),
      ],
      target: TARGET,
    });
    expect(result.cuts.map(c => c.playerId)).toEqual(['3']);
  });
});

// ---------------------------------------------------------------------------
// Never below target / exact-overage boundary
// ---------------------------------------------------------------------------

describe('selectAutoCuts — never cuts below target', () => {
  it('cuts exactly the overage even when more players are marked', () => {
    const result = selectAutoCuts({
      activeRoster: roster(6), // overage 1
      markedPlayerIds: ['1', '2', '3', '4', '5', '6'],
      target: TARGET,
    });
    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0].playerId).toBe('1');
  });

  it('exact-overage boundary: marks exactly cover the overage, no last-added fill', () => {
    const result = selectAutoCuts({
      activeRoster: roster(8), // overage 3
      markedPlayerIds: ['8', '7', '6'],
      acquisitions: [acquisition('1', 9_999)],
      target: TARGET,
    });
    expect(result.cuts.map(c => c.playerId)).toEqual(['8', '7', '6']);
    expect(result.cuts.every(c => c.reason === 'marked')).toBe(true);
  });

  it('always returns exactly `overage` cuts across a sweep of roster sizes', () => {
    for (let size = TARGET + 1; size <= TARGET + 10; size++) {
      const result = selectAutoCuts({
        activeRoster: roster(size),
        markedPlayerIds: ['2'],
        acquisitions: [acquisition('3', 1_000)],
        target: TARGET,
      });
      expect(result.cuts).toHaveLength(size - TARGET);
      // Post-cut roster is exactly at target — never below.
      expect(result.activeCount - result.cuts.length).toBe(TARGET);
    }
  });
});

// ---------------------------------------------------------------------------
// Franchise scoping (whole-league feeds)
// ---------------------------------------------------------------------------

describe('selectAutoCuts — franchise scoping of acquisition events', () => {
  it('ignores other franchises\' acquisitions when franchiseId is given', () => {
    const result = selectAutoCuts({
      activeRoster: roster(6), // overage 1
      acquisitions: [
        acquisition('2', 9_000, 'FREE_AGENT', '0002'), // someone else's pickup
        acquisition('4', 1_000, 'FREE_AGENT', '0001'),
      ],
      target: TARGET,
      franchiseId: '0001',
    });
    expect(result.cuts.map(c => c.playerId)).toEqual(['4']);
  });

  it('counts events without a franchise field regardless of franchiseId', () => {
    const result = selectAutoCuts({
      activeRoster: roster(6), // overage 1
      acquisitions: [acquisition('3', 9_000)],
      target: TARGET,
      franchiseId: '0001',
    });
    expect(result.cuts.map(c => c.playerId)).toEqual(['3']);
  });
});
