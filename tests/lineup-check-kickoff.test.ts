import { describe, it, expect } from 'vitest';
import {
  parseKickoffsByTeam,
  dropLockedProblems,
  filterUnalerted,
  warningAlertKeys,
  warningDeadline,
} from '../scripts/lib/lineup-warnings.mjs';
import { isQuietHours } from '../scripts/lib/schefter-groupme-budget.mjs';
import {
  lineupCheckDecision,
  LINEUP_CHECK_LEAD_MINUTES,
  TICK_MINUTES,
} from '../src/utils/sync-cadence';

/**
 * The pre-kickoff lineup check must never warn about a locked player.
 *
 * 2026-10-04 (Week 4): the Sunday 9:15am PT GitHub schedule was delivered at
 * 12:34 PT and posted Keenan Allen (IND, London game, 6:30am PT kickoff) and
 * Colby Parkinson (LAR, 10:00am PT) as OUT — both games long under way, both
 * players locked by MFL, nothing anyone could do. This suite pins the real
 * Week 4 kickoffs against both halves of the fix: the dispatch gate runs ahead
 * of each kickoff, and the script drops whatever has already locked.
 */

// Real Week 4 2026 kickoffs (epoch seconds), from nflSchedule-full.json.
const LONDON = Date.UTC(2026, 9, 4, 13, 30) / 1000; // IND–WAS, 6:30am PDT
const EARLY = Date.UTC(2026, 9, 4, 17, 0) / 1000; //   LAR–PHI, 10:00am PDT
const LATE = Date.UTC(2026, 9, 4, 20, 25) / 1000; //   a 1:25pm PDT slot (illustrative)

const schedule = {
  nflSchedule: {
    matchup: [
      { kickoff: String(LONDON), team: [{ id: 'IND' }, { id: 'WAS' }] },
      { kickoff: String(EARLY), team: [{ id: 'LAR' }, { id: 'PHI' }] },
      { kickoff: String(LATE), team: [{ id: 'KC' }, { id: 'BUF' }] },
    ],
  },
};
const kickoffs = parseKickoffsByTeam(schedule);

const allen = { playerId: '11222', playerName: 'Keenan Allen', position: 'WR', team: 'IND', type: 'OUT' };
const parkinson = { playerId: '14871', playerName: 'Colby Parkinson', position: 'TE', team: 'LAR', type: 'OUT' };
const kelce = { playerId: '400', playerName: 'Travis Kelce', position: 'TE', team: 'KC', type: 'OUT' };
const byeGuy = { playerId: '900', playerName: 'Bye Guy', position: 'RB', team: 'SEA', type: 'BYE' };

const warning = (franchiseId: string, problems: any[], extra: any = {}) => ({
  franchiseId,
  franchiseName: `Team ${franchiseId}`,
  problems,
  emptySlots: 0,
  noLineup: false,
  ...extra,
});

const at = (iso: string) => new Date(iso);

describe('parseKickoffsByTeam', () => {
  it('maps every team in a matchup to its kickoff in milliseconds', () => {
    expect(kickoffs.get('IND')).toBe(LONDON * 1000);
    expect(kickoffs.get('WAS')).toBe(LONDON * 1000);
    expect(kickoffs.get('LAR')).toBe(EARLY * 1000);
  });

  it('coalesces a single matchup object and skips junk kickoffs', () => {
    const one = parseKickoffsByTeam({
      nflSchedule: { matchup: { kickoff: String(EARLY), team: { id: 'LAR' } } },
    });
    expect(one.get('LAR')).toBe(EARLY * 1000);
    expect(parseKickoffsByTeam({ nflSchedule: { matchup: [{ kickoff: '', team: [{ id: 'X' }] }] } }).size).toBe(0);
    expect(parseKickoffsByTeam(null).size).toBe(0);
  });
});

describe('dropLockedProblems — the 2026-10-04 post', () => {
  const posted = [warning('0003', [parkinson]), warning('0007', [allen])];

  it('drops BOTH players at the time the alert actually went out (12:34 PT)', () => {
    expect(dropLockedProblems(posted, kickoffs, at('2026-10-04T19:34:00Z'))).toEqual([]);
  });

  it('keeps both before the London kickoff', () => {
    const out = dropLockedProblems(posted, kickoffs, at('2026-10-04T12:15:00Z'));
    expect(out.map((w) => w.franchiseId)).toEqual(['0003', '0007']);
  });

  it('drops only the London player between the London game and the 10am slate', () => {
    const out = dropLockedProblems(posted, kickoffs, at('2026-10-04T15:45:00Z'));
    expect(out).toHaveLength(1);
    expect(out[0].problems).toEqual([parkinson]);
  });

  it('trims a locked player out of a warning that still has a fixable one', () => {
    const out = dropLockedProblems([warning('0001', [allen, kelce])], kickoffs, at('2026-10-04T18:00:00Z'));
    expect(out[0].problems).toEqual([kelce]);
  });

  it('never locks a player with no game this week (bye, unknown team)', () => {
    const out = dropLockedProblems([warning('0001', [byeGuy])], kickoffs, at('2026-10-04T21:00:00Z'));
    expect(out[0].problems).toEqual([byeGuy]);
  });

  it('keeps no-lineup / empty slots only while some game is still ahead', () => {
    const team = [warning('0002', [], { noLineup: true }), warning('0004', [], { emptySlots: 2 })];
    expect(dropLockedProblems(team, kickoffs, at('2026-10-04T20:00:00Z'))).toHaveLength(2);
    expect(dropLockedProblems(team, kickoffs, at('2026-10-04T21:00:00Z'))).toEqual([]);
  });

  it('treats nothing as locked when the schedule is unavailable — fail toward warning', () => {
    const out = dropLockedProblems(posted, new Map(), at('2026-10-04T19:34:00Z'));
    expect(out.map((w) => w.franchiseId)).toEqual(['0003', '0007']);
    // Team-level warnings too: an empty schedule is "unknown", not "week over".
    const team = [warning('0002', [], { noLineup: true }), warning('0004', [], { emptySlots: 2 })];
    expect(dropLockedProblems(team, new Map(), at('2026-10-04T19:34:00Z'))).toHaveLength(2);
  });
});

describe('filterUnalerted — once per problem per week', () => {
  const w = warning('0001', [parkinson, kelce], { emptySlots: 1 });

  it('passes everything through on the first run', () => {
    expect(filterUnalerted([w], new Set())).toEqual([w]);
  });

  it('carries only what is new on a later run', () => {
    const alerted = new Set(warningAlertKeys(warning('0001', [parkinson], { emptySlots: 1 })));
    const out = filterUnalerted([w], alerted);
    expect(out).toHaveLength(1);
    expect(out[0].problems).toEqual([kelce]);
    expect(out[0].emptySlots).toBe(0);
  });

  it('re-alerts a status change (OUT → IR is a new problem)', () => {
    const alerted = new Set(warningAlertKeys(warning('0001', [parkinson])));
    const out = filterUnalerted([warning('0001', [{ ...parkinson, type: 'IR' }])], alerted);
    expect(out[0].problems[0].type).toBe('IR');
  });

  it('is silent once everything was alerted', () => {
    expect(filterUnalerted([w], new Set(warningAlertKeys(w)))).toEqual([]);
  });

  it('keys by franchise, so the same player on two teams is two alerts', () => {
    const alerted = new Set(warningAlertKeys(warning('0001', [kelce])));
    expect(filterUnalerted([warning('0002', [kelce])], alerted)).toHaveLength(1);
  });
});

describe('warningDeadline + quiet hours — the London exception', () => {
  const now = at('2026-10-04T12:15:00Z'); // 5:15am PDT, inside quiet hours

  it('a London-game player races a kickoff inside quiet hours', () => {
    const d = warningDeadline(warning('0007', [allen]), kickoffs, now);
    expect(d).toBe(LONDON * 1000);
    expect(isQuietHours(new Date(d!))).toBe(true);
  });

  it('a 10am player does not — his post waits for the run after 7am', () => {
    const d = warningDeadline(warning('0003', [parkinson]), kickoffs, now);
    expect(isQuietHours(new Date(d!))).toBe(false);
  });

  it('no lineup races the NEXT kickoff of the week, whatever it is', () => {
    expect(warningDeadline(warning('0002', [], { noLineup: true }), kickoffs, now)).toBe(LONDON * 1000);
  });

  it('a bye-only warning has no deadline', () => {
    expect(warningDeadline(warning('0001', [byeGuy]), kickoffs, now)).toBeNull();
  });
});

describe('lineupCheckDecision — dispatch ahead of every kickoff slot', () => {
  const all = [LONDON, EARLY, LATE].map(String);
  const minutesBefore = (kick: number, m: number) => new Date(kick * 1000 - m * 60_000);

  it(`dispatches ${LINEUP_CHECK_LEAD_MINUTES} minutes before each kickoff, London included`, () => {
    for (const k of [LONDON, EARLY, LATE]) {
      const d = lineupCheckDecision(minutesBefore(k, LINEUP_CHECK_LEAD_MINUTES), all);
      expect(d.dispatch).toBe(true);
      expect(d.kickoff).toBe(k);
    }
  });

  it('fires on exactly two ticks per kickoff — one dropped tick cannot skip a game', () => {
    for (const k of [LONDON, EARLY, LATE]) {
      let fired = 0;
      for (let m = 0; m <= 180; m += TICK_MINUTES) {
        if (lineupCheckDecision(minutesBefore(k, m), [String(k)]).dispatch) fired += 1;
      }
      expect(fired).toBe(2);
    }
  });

  it('never dispatches after a kickoff, or with no schedule', () => {
    expect(lineupCheckDecision(new Date(EARLY * 1000 + 60_000), [String(EARLY)]).dispatch).toBe(false);
    expect(lineupCheckDecision(new Date(), []).dispatch).toBe(false);
  });

  it('would have run before noon on 2026-10-04 — the old schedule landed at 12:34 PT', () => {
    let first: number | null = null;
    const dayStart = Date.UTC(2026, 9, 4, 7, 0); // midnight PDT
    for (let m = 0; m < 24 * 60 && first == null; m += TICK_MINUTES) {
      if (lineupCheckDecision(new Date(dayStart + m * 60_000), all).dispatch) first = dayStart + m * 60_000;
    }
    expect(first).not.toBeNull();
    expect(first!).toBeLessThan(LONDON * 1000);
  });
});

describe('the season gate admits the pre-opener dispatches', () => {
  // isSeasonWindowOpen opens AT the opener's kickoff; the check is dispatched
  // ~75 minutes before it, so a gate on `now` alone checked nothing for Week 1.
  it('opens for a run 75 minutes before the opener, and stays shut a day out', async () => {
    const { isInSeason } = await import('../scripts/schefter-lineup-check.mjs');
    const { nflWeekOneKickoff } = await import('../src/utils/pecking-order-season-window.mjs');
    const opener = nflWeekOneKickoff(2026).getTime();
    expect(isInSeason(new Date(opener - LINEUP_CHECK_LEAD_MINUTES * 60_000))).toBe(true);
    expect(isInSeason(new Date(opener - 24 * 60 * 60_000))).toBe(false);
    expect(isInSeason(new Date(Date.UTC(2026, 6, 15)))).toBe(false);
  });
});

describe('delivery is recorded only for owners a channel actually named', () => {
  it('marks the chat batch through buildFallbackPost().named, not the whole batch', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../scripts/schefter-lineup-check.mjs', import.meta.url), 'utf8');
    // buildFallbackPost sheds names past GroupMe's length cap; an owner it
    // dropped heard nothing and must be retried by the next run.
    expect(src).toMatch(/new Set\(post\.named/);
    expect(src).not.toMatch(/delivered:\s*\[\.\.\.reached,\s*\.\.\.chatBatch\]/);
  });
});
