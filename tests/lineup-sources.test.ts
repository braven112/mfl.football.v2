import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findWeekMatchups,
  findWeekResultsEntry,
  extractLineupStarters,
  loadRostersFeedFromDisk,
  resolveRostersPayload,
  resolveLineupFillState,
  resolveWeekLineup,
  resolvePlayerName,
  franchiseAppearsIn,
} from '../src/utils/lineup-sources';
import { resolveSubmitButtonState } from '../src/utils/lineup-submit-state';
import { buildMatchupCards } from '../src/utils/lineup-matchup-cards';

/**
 * A league year with no feed committed under `data/<league>/mfl-feeds/`.
 * TheLeague's feeds start at 2007, so nothing will ever sync into 1999.
 *
 * `resolveWeekLineup` calls `loadWeeklyResultsFeedFromDisk` internally, so a
 * test that passes a real league year is silently reading whatever the roster
 * -sync bot last committed. Tests asserting "nothing could vouch for this
 * lineup" must use this year, or they are only true until the bot syncs a
 * lineup for that franchise and week — which is exactly how the two tests
 * below went red in Aug 2026 once week 15 gained starters for 0001. Tests
 * that deliberately exercise the disk fallback should keep a real year and
 * say so.
 */
const NO_DISK_FEED_YEAR = 1999;

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
    // Not-yet-played starters report NO score, which is not a score of zero:
    // a literal 0 defeats the `?? playerScoresMap` fallback downstream and
    // renders a real performance as 0.0.
    expect(starters.every((p) => p.score === null)).toBe(true);
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
    // Starters we can see outrank a failed read and a past week alike — the
    // mode narrows to the partial variant here only because a dropped player
    // left a slot empty, which is still a saved lineup.
    const s = resolveLineupFillState({ hasStarters: true, lineupReadOk: false, weekIsPast: true, hasProjections: false, slotsFilled: false });
    expect(s.mode).toMatch(/^saved/);
    expect(s.canSubmitUnsaved).toBe(false);
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

  it('resolves names through the shared helper rather than inline', () => {
    for (const page of pages) {
      const src = readFileSync(join(process.cwd(), page), 'utf8');
      expect(src.includes('resolvePlayerName(identity, pd, rp.id)'), `${page} name resolution`).toBe(true);
    }
  });
});

describe('resolvePlayerName', () => {
  it('prefers the identity synced to disk', () => {
    expect(resolvePlayerName({ name: 'Lamar Jackson' }, { name: 'Jackson, Lamar' }, '13592')).toBe('Lamar Jackson');
  });

  it('falls back to the live players response, then to the id', () => {
    expect(resolvePlayerName(null, { name: 'Jackson, Lamar' }, '13592')).toBe('Jackson, Lamar');
    expect(resolvePlayerName(null, null, '13592')).toBe('Player 13592');
  });

  it('does not let a throttled players response erase a name it has on disk', () => {
    // The reported symptom: `TYPE=players` came back empty, so `pd` is
    // undefined — and the page printed "Player 13592" at an owner even though
    // getPlayerMap had the name the whole time.
    expect(resolvePlayerName({ name: 'Lamar Jackson' }, undefined, '13592')).toBe('Lamar Jackson');
    // An empty string is not a name either.
    expect(resolvePlayerName({ name: '' }, { name: 'Jackson, Lamar' }, '13592')).toBe('Jackson, Lamar');
  });
});

describe('resolveWeekLineup', () => {
  const live = {
    weeklyResults: {
      week: '12',
      matchup: [{ franchise: [{ id: '0001', starters: '111,222,' }, { id: '0010' }] }],
    },
  };
  const base = { week: 12, franchiseId: '0001', league: 'theleague' as const, leagueYear: 2026 };

  it('takes the live answer, either way', () => {
    const found = resolveWeekLineup({ ...base, weekScopedPayload: live, ytdPayload: null });
    expect(found.lineupReadOk).toBe(true);
    expect(found.starters.map((p) => p.id)).toEqual(['111', '222']);

    // Live says this franchise has nothing — that IS an answer.
    const none = resolveWeekLineup({ ...base, franchiseId: '0010', weekScopedPayload: live, ytdPayload: null });
    expect(none.lineupReadOk).toBe(true);
    expect(none.starters).toEqual([]);
  });

  it('falls back to YTD when the week-scoped call failed', () => {
    const ytd = { allWeeklyResults: { weeklyResults: [live.weeklyResults] } };
    const r = resolveWeekLineup({ ...base, weekScopedPayload: { error: { $t: 'throttled' } }, ytdPayload: ytd });
    expect(r.starters.map((p) => p.id)).toEqual(['111', '222']);
  });

  it('prefers the live source that actually names starters', () => {
    // Ordering by presence-of-entry instead would let a week-scoped payload
    // that carries the week but not this franchise's lineup short-circuit a
    // YTD payload that has it — landing on "nothing on file" with the submit
    // button armed over a real lineup.
    const weekScopedMissingFranchise = { weeklyResults: { week: '12', matchup: [{ franchise: [{ id: '0010' }] }] } };
    const ytdWithIt = { allWeeklyResults: { weeklyResults: [live.weeklyResults] } };
    const r = resolveWeekLineup({ ...base, weekScopedPayload: weekScopedMissingFranchise, ytdPayload: ytdWithIt });
    expect(r.starters.map((p) => p.id)).toEqual(['111', '222']);
    expect(r.fromCache).toBe(false);
  });

  it('lets the committed feed CONFIRM a lineup when every live call failed, flagged as cached', () => {
    // Week 1 has real starters in the committed feed.
    const r = resolveWeekLineup({ ...base, week: 1, franchiseId: '0006', weekScopedPayload: null, ytdPayload: null });
    expect(r.lineupReadOk).toBe(true);
    expect(r.starters.length).toBeGreaterThan(0);
    expect(r.fromCache).toBe(true);
    // A daily feed proves *a* lineup, not today's — the page must say so
    // rather than rendering a clean "Lineup Saved".
    expect(resolveLineupFillState({
      hasStarters: true, lineupReadOk: true, weekIsPast: false, hasProjections: true,
      slotsFilled: true, fromCache: true,
    }).mode).toBe('saved-from-cache');
  });

  it('still hands back a disk entry it cannot vouch for, for the opponent data on it', () => {
    // lineupReadOk stays false — but weekStarters(opponentId) reads the same
    // entry, and throwing it away loses the opponent's recorded starters.
    const r = resolveWeekLineup({ ...base, week: 12, weekScopedPayload: null, ytdPayload: null });
    expect(r.lineupReadOk).toBe(false);
    expect(r.entry).not.toBeNull();
  });

  it('never lets the committed feed prove a lineup ABSENT', () => {
    // The one-way rule. The feed syncs daily, so a lineup saved this morning
    // simply isn't in it — reading its silence as "nothing on file" would arm
    // a submit button over a projection fill and overwrite that lineup.
    // Week 12 has no starters on disk, and both live calls failed here.
    const r = resolveWeekLineup({ ...base, week: 12, weekScopedPayload: null, ytdPayload: null });
    expect(r.lineupReadOk).toBe(false);
    expect(r.starters).toEqual([]);
    expect(r.fromCache).toBe(false);
    expect(resolveLineupFillState({
      hasStarters: false, lineupReadOk: r.lineupReadOk, weekIsPast: false, hasProjections: true, slotsFilled: true,
    }).canSubmitUnsaved).toBe(false);
  });
});

describe('an owner MFL never listed that week', () => {
  // MFL omits unscheduled franchises from a week's matchups entirely —
  // playoff byes and odd-sized brackets (TheLeague 2025 wk15 lists 14 of 16).
  const weekWithoutMe = {
    weeklyResults: { week: '15', matchup: [{ franchise: [{ id: '0007', starters: '9,' }, { id: '0008' }] }] },
  };
  // NO_DISK_FEED_YEAR: this block is about MFL's live answer omitting us, so
  // the on-disk feed must not be able to answer on our behalf.
  const base = { week: 15, franchiseId: '0001', league: 'theleague' as const, leagueYear: NO_DISK_FEED_YEAR };

  it('does not read that omission as "no lineup submitted"', () => {
    expect(franchiseAppearsIn(weekWithoutMe.weeklyResults, '0001')).toBe(false);
    expect(franchiseAppearsIn(weekWithoutMe.weeklyResults, '0008')).toBe(true);

    const r = resolveWeekLineup({ ...base, weekScopedPayload: weekWithoutMe, ytdPayload: null });
    expect(r.lineupReadOk).toBe(false);
    expect(resolveLineupFillState({
      hasStarters: false, lineupReadOk: r.lineupReadOk, weekIsPast: false,
      hasProjections: true, slotsFilled: true, weekScheduled: r.weekScheduled,
    }).canSubmitUnsaved).toBe(false);
  });

  it('still counts a listed franchise with no starters as a real answer', () => {
    const r = resolveWeekLineup({ ...base, franchiseId: '0008', weekScopedPayload: weekWithoutMe, ytdPayload: null });
    expect(r.lineupReadOk).toBe(true);
    expect(r.starters).toEqual([]);
  });
});

describe('a week the season does not contain', () => {
  it('says so calmly instead of crying "MFL didn\'t answer"', () => {
    // The selector offers weeks 1-22; MFL's schedule holds 17. Week 20 would
    // otherwise sit permanently under the amber overwrite warning.
    const ytd = { allWeeklyResults: { weeklyResults: [{ week: '1', matchup: [{ franchise: [{ id: '0001' }] }] }] } };
    const r = resolveWeekLineup({
      week: 20, franchiseId: '0001', league: 'theleague', leagueYear: 2026,
      weekScopedPayload: null, ytdPayload: ytd,
    });
    expect(r.weekScheduled).toBe(false);
    const state = resolveLineupFillState({
      hasStarters: false, lineupReadOk: r.lineupReadOk, weekIsPast: false,
      hasProjections: true, slotsFilled: true, weekScheduled: r.weekScheduled,
    });
    expect(state.mode).toBe('week-unscheduled');
    expect(state.canSubmitUnsaved).toBe(false);
    expect(state.canSubmitEdits).toBe(false);
  });

  it('a genuinely failed read still reports read-failed', () => {
    const r = resolveWeekLineup({
      week: 20, franchiseId: '0001', league: 'theleague', leagueYear: 2026,
      weekScopedPayload: null, ytdPayload: null,
    });
    // Disk carries weeks, so week 20's absence there is real, not a failure
    // to reach anything — but nothing can vouch for the lineup either way.
    expect(r.lineupReadOk).toBe(false);
  });
});

describe('editing does not defeat the gates', () => {
  const base = { hasStarters: false, lineupReadOk: true, weekIsPast: false, hasProjections: true, slotsFilled: true };

  it('blocks an edited submit when the read failed', () => {
    // Otherwise one deliberate swap re-enables submit and replaces the eight
    // slots the owner never chose with the page's own projection guess.
    expect(resolveLineupFillState({ ...base, lineupReadOk: false }).canSubmitEdits).toBe(false);
  });

  it('blocks an edited submit on a played week', () => {
    expect(resolveLineupFillState({ ...base, weekIsPast: true }).canSubmitEdits).toBe(false);
  });

  it('allows edits on an open week, saved or not', () => {
    expect(resolveLineupFillState(base).canSubmitEdits).toBe(true);
    expect(resolveLineupFillState({ ...base, hasStarters: true }).canSubmitEdits).toBe(true);
  });
});

describe('a saved lineup whose players have since been dropped', () => {
  it('is flagged rather than shown as a clean save with empty slots', () => {
    const s = resolveLineupFillState({
      hasStarters: true, lineupReadOk: true, weekIsPast: true, hasProjections: false, slotsFilled: false,
    });
    expect(s.mode).toBe('saved-partial');
  });
});

describe('an empty rosters payload is not a roster', () => {
  it('falls back to disk when MFL returns zero franchises', () => {
    // `payload.rosters.franchise` being truthy is the wrong question: [] passes
    // it and every slot renders "Tap to set".
    const empty = { rosters: { franchise: [] } };
    const resolved = resolveRostersPayload(empty, 'theleague', 2026);
    expect(resolved).not.toBe(empty);
    expect(resolved?.rosters?.franchise?.length).toBeGreaterThan(0);
  });
});

describe('franchises MFL lists outside a matchup', () => {
  // A franchise with no opponent is listed directly on the week — playoff
  // byes, odd brackets, and (right now) every team in weeks 15-17 of both
  // leagues, where MFL published the weeks with no `matchup` key at all.
  // Walking only matchups loses the lineup AND reports the owner as unlisted,
  // which this module reads as "cannot confirm" — so playoff weeks would show
  // the overwrite warning and refuse to accept a lineup.
  const byeWeek = {
    weeklyResults: {
      week: '15',
      matchup: [{ franchise: [{ id: '0002' }, { id: '0003' }] }],
      franchise: [{ id: '0007', starters: '111,222,' }],
    },
  };

  it('reads a lineup off the flat franchise list', () => {
    const entry = findWeekResultsEntry(byeWeek, 15);
    expect(extractLineupStarters(entry, '0007').map((p) => p.id)).toEqual(['111', '222']);
    // and still reads the matchup rows
    expect(franchiseAppearsIn(entry, '0002')).toBe(true);
  });

  it('counts a flat-listed franchise as present', () => {
    expect(franchiseAppearsIn(findWeekResultsEntry(byeWeek, 15), '0007')).toBe(true);
  });

  it('handles a week with no matchup key at all', () => {
    const noMatchups = { weeklyResults: { week: '16', franchise: [{ id: '0001' }, { id: '0002' }] } };
    const entry = findWeekResultsEntry(noMatchups, 16);
    expect(franchiseAppearsIn(entry, '0001')).toBe(true);
    const r = resolveWeekLineup({
      week: 16, franchiseId: '0001', league: 'theleague', leagueYear: 2026,
      weekScopedPayload: noMatchups, ytdPayload: null,
    });
    // Listed with no starters = a real "nothing set yet" answer, so the owner
    // can still set a playoff lineup.
    expect(r.lineupReadOk).toBe(true);
    const state = resolveLineupFillState({
      hasStarters: false, lineupReadOk: r.lineupReadOk, weekIsPast: false,
      hasProjections: true, slotsFilled: true, weekScheduled: r.weekScheduled,
    });
    expect(state.mode).toBe('unsaved-offer');
    expect(state.canSubmitEdits).toBe(true);
  });

  it('resolves the real weeks 15-17 in both leagues as settable', () => {
    for (const league of ['theleague', 'afl-fantasy'] as const) {
      for (const week of [15, 16, 17]) {
        const r = resolveWeekLineup({
          week, franchiseId: '0001', league, leagueYear: 2026,
          weekScopedPayload: null, ytdPayload: null,
        });
        expect(r.weekScheduled, `${league} wk${week} scheduled`).toBe(true);
      }
    }
  });
});

describe('a lineup rebuilt from the daily feed', () => {
  it('is flagged, is never auto-offered, but does not strand the owner', () => {
    // Up to a day stale, so it gets its own banner — but unlike a failed
    // read this IS a lineup the owner set, not a projection guess. Blocking
    // an edit would leave them no way out mid-outage (the outage is on MFL's
    // export; submitting uses its independent import endpoint).
    const s = resolveLineupFillState({
      hasStarters: true, lineupReadOk: true, weekIsPast: false,
      hasProjections: true, slotsFilled: true, fromCache: true,
    });
    expect(s.mode).toBe('saved-from-cache');
    expect(s.canSubmitUnsaved).toBe(false);
    expect(s.canSubmitEdits).toBe(true);
  });

  it('still blocks everything when the read simply failed', () => {
    const s = resolveLineupFillState({
      hasStarters: false, lineupReadOk: false, weekIsPast: false,
      hasProjections: true, slotsFilled: true,
    });
    expect(s.canSubmitEdits).toBe(false);
    expect(s.canSubmitUnsaved).toBe(false);
  });
});

describe('a fill with no projections behind it', () => {
  it('is not offered for one-tap submission', () => {
    // The banner says "just your roster in order. Set them before
    // submitting" — a green enabled Submit beside that is a contradiction.
    const s = resolveLineupFillState({
      hasStarters: false, lineupReadOk: true, weekIsPast: false,
      hasProjections: false, slotsFilled: true,
    });
    expect(s.mode).toBe('unsaved-offer');
    expect(s.canSubmitUnsaved).toBe(false);
    // The owner can still build one deliberately.
    expect(s.canSubmitEdits).toBe(true);
  });
});

describe('Set Optimal respects starter eligibility', () => {
  it('excludes taxi-squad and IR players client-side too', () => {
    // The server fill filters them; the button rebuilding the lineup in the
    // browser has to agree, or one tap seats an ineligible player.
    for (const page of ['src/pages/theleague/lineup.astro', 'src/pages/afl-fantasy/lineup.astro']) {
      const src = readFileSync(join(process.cwd(), page), 'utf8');
      expect(src.includes("p.rosterStatus === 'ROSTER')"), `${page} Set Optimal filter`).toBe(true);
    }
  });
});

describe('resolveSubmitButtonState', () => {
  // The real data-loss guard lives in this function, so it is tested by
  // behavior. The previous version of these assertions grepped the page for
  // `data.canSubmitEdits` and stayed green when the conjunct was deleted.
  const open = { changes: 0, allFilled: true, lineupOnFile: false, canSubmitEdits: true, canSubmitUnsaved: true };

  it('offers to save an untouched fill on an open week', () => {
    const s = resolveSubmitButtonState(open);
    expect(s.disabled).toBe(false);
    expect(s.text).toBe('Submit Lineup');
    expect(s.showChanges).toBe(false);
  });

  it('enables an edited lineup and counts the changes', () => {
    const s = resolveSubmitButtonState({ ...open, changes: 2, lineupOnFile: true, canSubmitUnsaved: false });
    expect(s.disabled).toBe(false);
    expect(s.showChanges).toBe(true);
  });

  it('REFUSES an edited lineup when submitting is unsafe', () => {
    // canSubmitEdits false = the read failed or the week can't take one.
    // Deleting this conjunct is the regression these tests exist for.
    const s = resolveSubmitButtonState({ ...open, changes: 2, canSubmitEdits: false, canSubmitUnsaved: false });
    expect(s.disabled).toBe(true);
    expect(s.text).toBe('Submit Lineup');
  });

  it('refuses on an unsafe week no matter how many slots changed', () => {
    for (const changes of [1, 5, 9]) {
      expect(resolveSubmitButtonState({
        ...open, changes, canSubmitEdits: false, canSubmitUnsaved: false,
      }).disabled, `changes=${changes}`).toBe(true);
    }
  });

  it('never enables a partial lineup', () => {
    expect(resolveSubmitButtonState({ ...open, allFilled: false }).disabled).toBe(true);
    expect(resolveSubmitButtonState({ ...open, changes: 3, allFilled: false }).disabled).toBe(true);
  });

  it('says a lineup is saved only when one really is', () => {
    const saved = resolveSubmitButtonState({ ...open, lineupOnFile: true, canSubmitUnsaved: false });
    expect(saved.text).toBe('Lineup Saved');
    expect(saved.disabled).toBe(true);
  });

  it('does not claim a flat "Lineup Saved" over a day-old cached copy', () => {
    const cached = resolveSubmitButtonState({
      ...open, lineupOnFile: true, canSubmitUnsaved: false, fromCache: true,
    });
    expect(cached.text).toBe('Saved (last sync)');
    expect(cached.disabled).toBe(true);
  });

  it('never claims saved when nothing is on file', () => {
    const s = resolveSubmitButtonState({ ...open, canSubmitUnsaved: false, canSubmitEdits: false });
    expect(s.text).not.toBe('Lineup Saved');
    expect(s.disabled).toBe(true);
  });
});

describe('a franchise MFL does not list that week', () => {
  it('is told it has no game, not that MFL went silent', () => {
    const weekWithoutMe = {
      weeklyResults: { week: '15', matchup: [{ franchise: [{ id: '0002' }, { id: '0003' }] }] },
    };
    const r = resolveWeekLineup({
      // NO_DISK_FEED_YEAR — see above. With a real year the disk copy answers
      // for us and franchiseListed flips true, which is correct behavior but
      // not the case under test here.
      week: 15, franchiseId: '0001', league: 'theleague', leagueYear: NO_DISK_FEED_YEAR,
      weekScopedPayload: weekWithoutMe, ytdPayload: null,
    });
    expect(r.franchiseListed).toBe(false);
    const state = resolveLineupFillState({
      hasStarters: false, lineupReadOk: r.lineupReadOk, weekIsPast: false, hasProjections: true,
      slotsFilled: true, weekScheduled: r.weekScheduled, franchiseListed: r.franchiseListed,
    });
    expect(state.mode).toBe('franchise-unlisted');
    expect(state.canSubmitEdits).toBe(false);
  });

  it('still reports a genuine read failure as one', () => {
    const r = resolveWeekLineup({
      week: 12, franchiseId: '0001', league: 'theleague', leagueYear: 2026,
      weekScopedPayload: null, ytdPayload: null,
    });
    expect(r.lineupReadOk).toBe(false);
    // Disk carries week 12 without our starters, so something DID answer.
    const state = resolveLineupFillState({
      hasStarters: false, lineupReadOk: false, weekIsPast: false, hasProjections: true,
      slotsFilled: true, weekScheduled: r.weekScheduled, franchiseListed: r.franchiseListed,
    });
    // Specifically read-failed: the disk copy lists us for week 12, and a
    // day-old file may not tell an owner they have no game.
    expect(state.mode).toBe('read-failed');
    expect(state.canSubmitEdits).toBe(false);
  });
});

describe('unlabeled single-week payloads with only a flat franchise list', () => {
  it('are still recognised', () => {
    // Weeks 15-17 of both feeds have no `matchup` key at all, so requiring
    // one made the opt-in dead exactly where it was needed.
    const flat = { weeklyResults: { franchise: [{ id: '0001', starters: '5,' }] } };
    expect(findWeekResultsEntry(flat, 16, { allowUnlabeled: true })).not.toBeNull();
  });
});

describe('scores MFL has not reported', () => {
  it('are null, not zero, even when the player row exists', () => {
    // An unplayed week's rows are `{ id, status }` with no score key — the
    // real shape in every committed feed. Reporting 0 there shadows the
    // playerScoresMap fallback and renders a real performance as 0.0.
    const unplayed = {
      weeklyResults: {
        week: '3',
        matchup: [{ franchise: [{ id: '0001', starters: '111,', player: [{ id: '111', status: 'starter' }] }] }],
      },
    };
    const starters = extractLineupStarters(findWeekResultsEntry(unplayed, 3), '0001');
    expect(starters).toEqual([{ id: '111', score: null }]);
  });

  it('keeps a real reported score, including a genuine zero', () => {
    const played = {
      weeklyResults: {
        week: '3',
        matchup: [{ franchise: [{ id: '0001', player: [
          { id: '111', status: 'starter', score: '0.00' },
          { id: '222', status: 'starter', score: '18.7' },
        ] }] }],
      },
    };
    expect(extractLineupStarters(findWeekResultsEntry(played, 3), '0001')).toEqual([
      { id: '111', score: 0 },
      { id: '222', score: 18.7 },
    ]);
  });
});

describe('an outage on a week the disk copy carries', () => {
  it('reports a read failure, not "no game scheduled"', () => {
    // Week 4 IS in the committed feed and DOES list franchise 0001, so
    // claiming the owner has no game would be a lie told by a day-old file.
    const r = resolveWeekLineup({
      week: 4, franchiseId: '0001', league: 'theleague', leagueYear: 2026,
      weekScopedPayload: null, ytdPayload: null,
    });
    expect(r.franchiseListed).toBe(true);
    expect(r.lineupReadOk).toBe(false);
    expect(resolveLineupFillState({
      hasStarters: false, lineupReadOk: r.lineupReadOk, weekIsPast: false, hasProjections: true,
      slotsFilled: true, weekScheduled: r.weekScheduled, franchiseListed: r.franchiseListed,
    }).mode).toBe('read-failed');
  });
});

describe('drafts do not travel between read states', () => {
  const pages = ['src/pages/theleague/lineup.astro', 'src/pages/afl-fantasy/lineup.astro'];

  it('refuses to persist edits made on a base that cannot be submitted', () => {
    // One swap during a read-failed visit used to persist all nine slots —
    // eight of them the projection guess — and loadDraft() replayed it on
    // the next healthy visit, arming the bar with nine changes over the
    // owner's real lineup. The overwrite, one day later.
    for (const page of pages) {
      const src = readFileSync(join(process.cwd(), page), 'utf8');
      expect(src.includes('countChanges() === 0 || !data.canSubmitEdits'), `${page} save guard`).toBe(true);
      expect(src.includes('draft.fillMode !== data.fillMode'), `${page} load guard`).toBe(true);
    }
  });

  it('makes a submit from a cached base an explicit choice', () => {
    for (const page of pages) {
      const src = readFileSync(join(process.cwd(), page), 'utf8');
      expect(src.includes('data.lineupFromCache && !confirm('), `${page} cached-submit confirm`).toBe(true);
    }
  });
});

describe('a week that schedules more than one game', () => {
  // TheLeague runs DOUBLE-HEADERS: 2026 weeks 1-3 and 13 list 16 matchups
  // for 16 franchises, so every team plays twice off ONE submitted lineup.
  // The Set Lineup page used to stop at the first matchup containing the
  // owner, which showed one game and silently dropped the other.
  const doubleHeader = {
    week: '1',
    matchup: [
      { franchise: [{ id: '0003', isHome: '0' }, { id: '0001', isHome: '1' }] },
      { franchise: [{ id: '0002', isHome: '0' }, { id: '0004', isHome: '1' }] },
      { franchise: [{ id: '0001', isHome: '0' }, { id: '0016', isHome: '1' }] },
    ],
  };

  it('returns every game the franchise plays, in MFL order', () => {
    expect(findWeekMatchups(doubleHeader, '0001')).toEqual([
      { opponentFranchiseId: '0003', userIsHome: true },
      { opponentFranchiseId: '0016', userIsHome: false },
    ]);
  });

  it('keeps each game\'s own home/away side', () => {
    // Both games share one lineup but not one scoreboard: the owner is home
    // in the first and away in the second, and the panel that wears the
    // accent (and gets the live total) follows the game, not the week.
    const [first, second] = findWeekMatchups(doubleHeader, '0001');
    expect(first.userIsHome).toBe(true);
    expect(second.userIsHome).toBe(false);
  });

  it('reads a single-game week as exactly one game', () => {
    const single = { week: '4', matchup: { franchise: [{ id: '0001', isHome: '1' }, { id: '0009', isHome: '0' }] } };
    expect(findWeekMatchups(single, '0001')).toEqual([
      { opponentFranchiseId: '0009', userIsHome: true },
    ]);
  });

  it('returns nothing for a franchise MFL did not schedule', () => {
    // Not an error state — the page already tells that owner there is no
    // game to set a lineup for.
    expect(findWeekMatchups(doubleHeader, '0099')).toEqual([]);
    expect(findWeekMatchups(null, '0001')).toEqual([]);
    expect(findWeekMatchups({ week: '15' }, '0001')).toEqual([]);
  });

  it('finds both of the real week 1 games in TheLeague\'s committed schedule', () => {
    const schedule = JSON.parse(
      readFileSync(join(process.cwd(), 'data/theleague/mfl-feeds/2026/schedule.json'), 'utf8'),
    );
    const weeks = schedule?.schedule?.weeklySchedule ?? [];
    const week1 = (Array.isArray(weeks) ? weeks : [weeks]).find((w: any) => String(w?.week) === '1');
    const games = findWeekMatchups(week1, '0001');
    expect(games.length).toBe(2);
    expect(new Set(games.map((g) => g.opponentFranchiseId)).size).toBe(2);
  });
});

describe('the Set Lineup game strip', () => {
  // Both leagues run double-headers, so both pages build the strip from the
  // SAME shared card builder + component. A page that grew its own copy would
  // drift — TheLeague's did exactly that for the whole faceoff panel.
  const lineupPages = [
    'src/pages/theleague/lineup.astro',
    'src/pages/afl-fantasy/lineup.astro',
  ];
  const STRIP = 'src/components/shared/LineupGameStrip.astro';

  it('builds a card per scheduled game on both pages, not just the first', () => {
    for (const page of lineupPages) {
      const src = readFileSync(join(process.cwd(), page), 'utf8');
      expect(src.includes('findWeekMatchups'), `${page} reads every game`).toBe(true);
      expect(src.includes('buildMatchupCards'), `${page} shares the card builder`).toBe(true);
      expect(src.includes('<LineupGameStrip'), `${page} renders the shared strip`).toBe(true);
    }
    const strip = readFileSync(join(process.cwd(), STRIP), 'utf8');
    expect(strip.includes('cards.map')).toBe(true);
  });

  it('reads the whole league roster, so an opponent side can be built', () => {
    // The AFL page used to fetch `TYPE=rosters&FRANCHISE=<me>`; a strip built
    // on that has no opponent pool, so their projected total is 0.0.
    for (const page of lineupPages) {
      const src = readFileSync(join(process.cwd(), page), 'utf8');
      expect(src.includes('TYPE=rosters&L=${MFL_LEAGUE_ID}&JSON=1'), `${page} rosters call`).toBe(true);
    }
  });

  it('updates our projected total on every card', () => {
    // One lineup scores both games of a double-header. Updating only
    // querySelector's first hit left the second card contradicting the first.
    for (const page of lineupPages) {
      const src = readFileSync(join(process.cwd(), page), 'utf8');
      expect(src.includes("querySelectorAll('.lineup-faceoff__scoreboard')"), `${page} all boards`).toBe(true);
      expect(src.includes("querySelector('.lineup-faceoff__scoreboard')"), `${page} single board`).toBe(false);
    }
  });

  it('never drops a scheduled game, even with nothing to show on it', () => {
    // The failure mode this whole change exists to kill: a week with two
    // games rendering one card. With no projections and no roster feed, a
    // card has no composite and no totals — and must STILL be built, because
    // its band names the opponent.
    const cards = buildMatchupCards({
      userFranchiseId: '0001',
      matchups: [
        { opponentFranchiseId: '0003', userIsHome: true },
        { opponentFranchiseId: '0016', userIsHome: false },
      ],
      week: 1,
      weekIsPast: false,
      userSideIds: [],
      userProjTotal: 0,
      franchiseList: [],
      resultsWeekEntry: null,
      projMap: new Map(),
      playerScoresMap: new Map(),
      identityMap: new Map(),
      slotPositions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'PK', 'DEF'],
      slotEligibility: { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'], PK: ['PK'], DEF: ['DEF'] },
      brandFor: (id) => ({ name: `Team ${id}` }),
    });
    expect(cards.map((c) => c.opponentFranchiseId)).toEqual(['0003', '0016']);
    expect(cards.every((c) => c.faceoff === null)).toBe(true);
    // Home/away still follows the GAME, not the week.
    expect(cards.map((c) => c.userScoreSide)).toEqual(['home', 'away']);
    expect(cards[0].title).toBe('Team 0003 vs Team 0001');
  });

  it('re-inits the carousel on astro:page-load', () => {
    // The ClientRouter does not re-evaluate an already-loaded module, so a
    // once-at-module-scope init leaves the arrows dead on a return visit.
    const strip = readFileSync(join(process.cwd(), STRIP), 'utf8');
    expect(strip.includes("addEventListener('astro:page-load'")).toBe(true);
    // …and that event ALSO fires on first load, so the init must be guarded.
    expect(strip.includes('carouselWired')).toBe(true);
  });

  it('drives the carousel off scroll position alone', () => {
    // Arrows and dots only scroll; the dots, counter, arrow ends and the live
    // region are re-derived from the scroll listener, so a swipe and a click
    // land in identical states.
    const strip = readFileSync(join(process.cwd(), STRIP), 'utf8');
    expect(strip.includes("addEventListener('scroll'")).toBe(true);
    expect(strip.includes('scrollToGame')).toBe(true);
    expect(strip.includes("setAttribute('aria-live'")).toBe(true);
  });
});
