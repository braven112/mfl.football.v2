/**
 * The homepage My Team card's "this week" data (src/utils/my-team-week.ts).
 *
 * Pins the lineup half against docs/claude/rules/lineups.md: a read that
 * failed is `unknown` (never "not set"), a lineup saved since the daily sync
 * is not contradicted by the disk feed, and a starter whose game has kicked
 * off is not flagged — nobody can act on it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { lineupStatusFromStarters, loadMyTeamWeek } from '../src/utils/my-team-week';
import { clearLineupSubmittedCache } from '../src/utils/lineup-submitted';
import { getLeagueBySlug } from '../src/config/leagues';

const players = new Map([
  ['1', { name: 'Allen, Josh', position: 'QB', team: 'BUF' }],
  ['2', { name: 'Chase, JaMarr', position: 'WR', team: 'CIN' }],
  ['3', { name: 'Kelce, Travis', position: 'TE', team: 'KCC' }],
]);

const base = {
  franchiseId: '0001',
  players,
  injuries: new Map<string, string>(),
  byeTeams: new Set<string>(),
  kickoffsByTeam: new Map<string, number>(),
  requiredStarters: 3,
  now: new Date('2026-10-08T12:00:00Z'),
};

describe('lineupStatusFromStarters', () => {
  it('a failed read is unknown, never not-set', () => {
    expect(lineupStatusFromStarters({ ...base, starters: null }).state).toBe('unknown');
  });

  it('no starters listed is not-set', () => {
    expect(lineupStatusFromStarters({ ...base, starters: [] }).state).toBe('not-set');
  });

  it('a clean lineup is set with no problems', () => {
    const s = lineupStatusFromStarters({ ...base, starters: ['1', '2', '3'] });
    expect(s).toEqual({ state: 'set', problems: [], emptySlots: 0 });
  });

  it('flags OUT and BYE starters with readable names, ignores Questionable', () => {
    const s = lineupStatusFromStarters({
      ...base,
      starters: ['1', '2', '3'],
      injuries: new Map([['2', 'Out'], ['3', 'Questionable']]),
      byeTeams: new Set(['BUF']),
    });
    expect(s.problems.map((p) => [p.name, p.type])).toEqual([
      ['Josh Allen', 'BYE'],
      ['JaMarr Chase', 'OUT'],
    ]);
  });

  it('drops a starter whose game already kicked off', () => {
    const s = lineupStatusFromStarters({
      ...base,
      starters: ['1', '2', '3'],
      injuries: new Map([['2', 'Out']]),
      kickoffsByTeam: new Map([['CIN', base.now.getTime() - 1000], ['KCC', base.now.getTime() + 1000]]),
    });
    expect(s.problems).toEqual([]);
  });

  it('counts empty starting slots', () => {
    expect(lineupStatusFromStarters({ ...base, starters: ['1', '2'] }).emptySlots).toBe(1);
  });
});

describe('loadMyTeamWeek', () => {
  const league = getLeagueBySlug('theleague')!;
  const year = 2026;
  const hasFeeds = fs.existsSync(`${league.dataPath}/mfl-feeds/${year}/schedule.json`);
  const inSeason = new Date('2026-10-08T12:00:00Z');

  beforeEach(() => clearLineupSubmittedCache());

  it.skipIf(!hasFeeds)('returns null outside the season window', async () => {
    const out = await loadMyTeamWeek({
      league, franchiseId: '0001', isOwner: false, leagueYear: year, seasonYear: year,
      currentNflWeek: null, now: new Date('2026-07-01T12:00:00Z'),
    });
    expect(out).toBeNull();
  });

  it.skipIf(!hasFeeds)('omits lineup status for a viewer who is not the owner', async () => {
    const out = await loadMyTeamWeek({
      league, franchiseId: '0001', isOwner: false, leagueYear: year, seasonYear: year,
      currentNflWeek: 6, now: inSeason,
      fetchImpl: (() => { throw new Error('must not fetch'); }) as any,
    });
    if (out) expect(out.lineup).toBeNull();
  });

  it.skipIf(!hasFeeds)('an MFL error body (HTTP 200) never reads as not-set', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: 'throttled' }), { status: 200 })) as any;
    const out = await loadMyTeamWeek({
      league, franchiseId: '0001', isOwner: true, leagueYear: year, seasonYear: year,
      currentNflWeek: 6, now: inSeason, fetchImpl,
    });
    if (out) expect(out.lineup?.state).not.toBe('not-set');
  });
});
