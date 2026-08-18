import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findWeekResultsEntry,
  extractLineupStarters,
  loadRostersFeedFromDisk,
  resolveRostersPayload,
  resolveLineupFillState,
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

  it('takes an unlabeled single entry only when the caller opts in', () => {
    // Belt-and-braces for a week-scoped fetch, where the request itself names
    // the week. Live `W=<n>` responses DO carry `week` — an early reading that
    // said otherwise was a truncated dump of a payload whose nondeterministic
    // key order put `week` last.
    const unlabeled = { weeklyResults: { matchup: [{ franchise: [{ id: '0001', starters: '1,' }] }] } };
    expect(findWeekResultsEntry(unlabeled, 14, { allowUnlabeled: true })).not.toBeNull();
    expect(findWeekResultsEntry(unlabeled, 14)).toBeNull();
  });

  it('never answers a YTD lookup with a different week', () => {
    // The hazard the opt-in exists to prevent: a season with exactly one
    // entry would otherwise return week 1's lineups for a week-12 lookup,
    // and the page would render another week's starters as this week's.
    const oneWeekSoFar = { allWeeklyResults: { weeklyResults: { matchup: [{ franchise: [{ id: '0001', starters: '111,222,' }] }] } } };
    expect(findWeekResultsEntry(oneWeekSoFar, 12)).toBeNull();
    expect(extractLineupStarters(findWeekResultsEntry(oneWeekSoFar, 12), '0001')).toEqual([]);
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

describe('resolveLineupFillState', () => {
  const base = { hasStarters: false, lineupReadOk: true, weekIsPast: false, hasProjections: true, slotsFilled: true };

  it('reports a saved lineup and offers nothing to submit', () => {
    const s = resolveLineupFillState({ ...base, hasStarters: true });
    expect(s.mode).toBe('saved');
    expect(s.canSubmitUnsaved).toBe(false);
  });

  it('offers to save the fill on an open week with nothing on file', () => {
    const s = resolveLineupFillState(base);
    expect(s.mode).toBe('unsaved-offer');
    expect(s.canSubmitUnsaved).toBe(true);
  });

  it('REFUSES to offer a submit when the read failed', () => {
    // The destructive case. Both weeklyResults calls failing yields zero
    // starters — identical to a week nobody set — so treating it as "nothing
    // on file" arms the button over a projection fill, and one tap replaces a
    // lineup the owner really had. Must stay false.
    const s = resolveLineupFillState({ ...base, lineupReadOk: false });
    expect(s.mode).toBe('read-failed');
    expect(s.canSubmitUnsaved).toBe(false);
  });

  it('keeps refusing when a failed read coincides with an open week and projections', () => {
    for (const weekIsPast of [true, false]) {
      for (const hasProjections of [true, false]) {
        const s = resolveLineupFillState({ ...base, lineupReadOk: false, weekIsPast, hasProjections });
        expect(s.canSubmitUnsaved, `past=${weekIsPast} proj=${hasProjections}`).toBe(false);
      }
    }
  });

  it('never offers a submit on a week that has already been played', () => {
    const s = resolveLineupFillState({ ...base, weekIsPast: true });
    expect(s.mode).toBe('past-unset');
    expect(s.canSubmitUnsaved).toBe(false);
  });

  it('will not offer to submit a lineup that is short a slot', () => {
    // A thin roster (AFL pre-draft) can't fill nine. The banner still names
    // the fill, but the server-rendered button must already be inert — the
    // client's own allFilled check only runs after hydration.
    const s = resolveLineupFillState({ ...base, slotsFilled: false });
    expect(s.mode).toBe('unsaved-offer');
    expect(s.canSubmitUnsaved).toBe(false);
  });

  it('reports whether the fill is projection-ordered or just roster order', () => {
    expect(resolveLineupFillState(base).fillIsProjected).toBe(true);
    // No projections (throttled projectedScores) means the "best projected
    // lineup" copy would be a lie — the sort is a no-op on an empty map.
    expect(resolveLineupFillState({ ...base, hasProjections: false }).fillIsProjected).toBe(false);
  });

  it('prefers visible starters over every other signal', () => {
    const s = resolveLineupFillState({ hasStarters: true, lineupReadOk: false, weekIsPast: true, hasProjections: false, slotsFilled: false });
    expect(s.mode).toBe('saved');
  });
});

describe('the pages consume that decision', () => {
  const pages = ['src/pages/theleague/lineup.astro', 'src/pages/afl-fantasy/lineup.astro'];

  it('gates the submit affordance on canSubmitUnsaved, not on the weaker !lineupOnFile', () => {
    for (const page of pages) {
      const src = readFileSync(join(process.cwd(), page), 'utf8');
      expect(src.includes('resolveLineupFillState('), `${page} uses the resolver`).toBe(true);
      expect(src.includes('disabled={!canSubmitUnsaved}'), `${page} SSR button gate`).toBe(true);
      expect(src.includes('!hasChanges && data.canSubmitUnsaved && allFilled'), `${page} client gate`).toBe(true);
      // The two differ exactly in the destructive case, so the weak form is
      // a regression even though it reads equivalently.
      expect(src.includes('!hasChanges && !data.lineupOnFile && allFilled'), `${page} weak gate`).toBe(false);
    }
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
