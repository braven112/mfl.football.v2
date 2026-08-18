import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findWeekResultsEntry,
  extractLineupStarters,
  loadRostersFeedFromDisk,
  resolveRostersPayload,
} from '../src/utils/lineup-sources';

/**
 * Lineup page data sources.
 *
 * Both lineup pages read the owner's saved lineup with
 * `export?TYPE=myStarters` — an IMPORT type MFL rejects as an export, with
 * the failure swallowed by a bare `catch`. The result was a page that never
 * showed a submitted lineup for any week and quietly rendered an
 * optimal-by-projection fill instead; on a future week that reads to an
 * owner as "the lineup I saved disappeared".
 *
 * These assert on the parsed RESULT, not on the page's source text: a grep
 * for `weeklyResults` in lineup.astro passes on the YTD fetch that was
 * always there, and would have passed for the whole life of the bug.
 */

/** MFL's shape for a week whose lineups are submitted but unplayed. */
const UNPLAYED_WEEK = {
  weeklyResults: {
    week: '12',
    matchup: [
      {
        franchise: [
          { id: '0001', isHome: '0', starters: '13592,16610,16617,17104,16080,14974,15282,13832,0514,', nonstarters: '16176,' },
          { id: '0010', isHome: '1' },
        ],
      },
    ],
  },
};

/** A played week — `player[]` rows carry status + score. */
const PLAYED_WEEK = {
  allWeeklyResults: {
    weeklyResults: [
      { week: '1', matchup: [{ franchise: [{ id: '0001', starters: '111,222,', player: [
        { id: '111', status: 'starter', score: '21.4' },
        { id: '222', status: 'starter', score: '9.1' },
        { id: '999', status: 'nonstarter', score: '30.0' },
      ] }] }] },
      { week: '2', matchup: [{ franchise: [{ id: '0001' }] }] },
    ],
  },
};

describe('findWeekResultsEntry', () => {
  it('finds the requested week inside a YTD payload', () => {
    expect(findWeekResultsEntry(PLAYED_WEEK, 1)?.week).toBe('1');
    expect(findWeekResultsEntry(PLAYED_WEEK, 2)?.week).toBe('2');
  });

  it('returns null for a week the payload does not carry', () => {
    expect(findWeekResultsEntry(PLAYED_WEEK, 7)).toBeNull();
  });

  it('accepts a single-week payload that omits the week field', () => {
    // MFL's `W=14` response has no `week` key at all — a week-keyed lookup
    // alone finds nothing, which is how a future week came back empty.
    const unlabeled = { weeklyResults: { matchup: [{ franchise: [{ id: '0001', starters: '1,' }] }] } };
    expect(findWeekResultsEntry(unlabeled, 14)).not.toBeNull();
    expect(extractLineupStarters(findWeekResultsEntry(unlabeled, 14), '0001')).toHaveLength(1);
  });

  it('survives a missing or error payload', () => {
    expect(findWeekResultsEntry(null, 3)).toBeNull();
    expect(findWeekResultsEntry({ error: { $t: 'Invalid Data Type (myStarters)' } }, 3)).toBeNull();
  });
});

describe('extractLineupStarters', () => {
  it('reads a submitted future-week lineup from the starters CSV', () => {
    const entry = findWeekResultsEntry(UNPLAYED_WEEK, 12);
    const starters = extractLineupStarters(entry, '0001');
    expect(starters.map((p) => p.id)).toEqual(
      ['13592', '16610', '16617', '17104', '16080', '14974', '15282', '13832', '0514'],
    );
    // Trailing comma in MFL's CSV must not become an empty starter.
    expect(starters.every((p) => p.id.length > 0)).toBe(true);
    expect(starters.every((p) => p.score === 0)).toBe(true);
  });

  it('reads scores from the player rows on a played week, and only starters', () => {
    const starters = extractLineupStarters(findWeekResultsEntry(PLAYED_WEEK, 1), '0001');
    expect(starters).toEqual([
      { id: '111', score: 21.4 },
      { id: '222', score: 9.1 },
    ]);
  });

  it('returns empty for a franchise with no lineup set', () => {
    expect(extractLineupStarters(findWeekResultsEntry(PLAYED_WEEK, 2), '0001')).toEqual([]);
    expect(extractLineupStarters(findWeekResultsEntry(UNPLAYED_WEEK, 12), '0010')).toEqual([]);
  });

  it('returns empty for an unknown franchise rather than another team lineup', () => {
    expect(extractLineupStarters(findWeekResultsEntry(UNPLAYED_WEEK, 12), '0099')).toEqual([]);
  });

  it('handles MFL collapsing single-element arrays to objects', () => {
    const collapsed = {
      weeklyResults: {
        week: '5',
        matchup: { franchise: { id: '0001', player: { id: '777', status: 'starter', score: '12' } } },
      },
    };
    expect(extractLineupStarters(findWeekResultsEntry(collapsed, 5), '0001')).toEqual([{ id: '777', score: 12 }]);
  });
});

describe('roster fallback', () => {
  it('keeps the live payload when it carries franchises', () => {
    const live = { rosters: { franchise: [{ id: '0001', player: [] }] } };
    expect(resolveRostersPayload(live, 'theleague', 2026)).toBe(live);
  });

  it('falls back to the committed feed when the live call returns an error body', () => {
    // MFL answers a throttled request with HTTP 200 + an error object, so
    // `res.ok` is true and the roster silently comes back empty — every slot
    // then renders "Tap to set".
    const throttled = { error: { $t: 'Too many requests' } };
    const resolved = resolveRostersPayload(throttled, 'theleague', 2026);
    expect(resolved?.rosters?.franchise?.length).toBeGreaterThan(0);
    expect(resolveRostersPayload(null, 'theleague', 2026)?.rosters?.franchise?.length).toBeGreaterThan(0);
  });

  it('reads the feed from the league registry data path, not a hardcoded one', () => {
    expect(loadRostersFeedFromDisk('theleague', 2026)?.rosters?.franchise).toBeTruthy();
    // A year with no committed feed yields null rather than throwing.
    expect(loadRostersFeedFromDisk('theleague', 1999)).toBeNull();
  });
});

describe('lineup pages use the readable export', () => {
  const pages = ['src/pages/theleague/lineup.astro', 'src/pages/afl-fantasy/lineup.astro'];

  it('never requests myStarters as an export type', () => {
    for (const page of pages) {
      const src = readFileSync(join(process.cwd(), page), 'utf8');
      expect(/TYPE=myStarters/.test(src), `${page} still exports myStarters`).toBe(false);
    }
  });

  it('prefers the on-disk player identity for a name', () => {
    // A throttled `TYPE=players` call is what put "Player 13592" on screen
    // where a name belongs; the identity map on disk already has the name.
    for (const page of pages) {
      const src = readFileSync(join(process.cwd(), page), 'utf8');
      expect(src.includes('name: identity?.name || pd?.name'), `${page} name fallback`).toBe(true);
    }
  });
});
