import { describe, it, expect } from 'vitest';
// @ts-ignore — sibling .mjs module, no .d.ts
import {
  ptDateKey,
  scheduleGames,
  mainSlate,
  mainSlateFinal,
  isGamedayNow,
  matchupKey,
  leaderOf,
  isFinal,
  detectGamedayAlerts,
  buildGamedayNotifications,
  parseLivePairings,
} from '../scripts/lib/gameday-alerts.mjs';

const sec = (s: string) => Math.floor(new Date(s).getTime() / 1000);

/** A real Week 1 shape: TNF, a Friday game, 8 early, 4 late, SNF, MNF. */
const WEEK = {
  nflSchedule: {
    matchup: [
      { kickoff: sec('2026-09-10T00:20:00Z'), gameSecondsRemaining: '3600', team: [] },
      { kickoff: sec('2026-09-11T00:35:00Z'), gameSecondsRemaining: '3600', team: [] },
      ...Array.from({ length: 8 }, () => ({
        kickoff: sec('2026-09-13T17:00:00Z'),
        gameSecondsRemaining: '3600',
        team: [],
      })),
      ...Array.from({ length: 4 }, () => ({
        kickoff: sec('2026-09-13T20:25:00Z'),
        gameSecondsRemaining: '3600',
        team: [],
      })),
      { kickoff: sec('2026-09-14T00:20:00Z'), gameSecondsRemaining: '3600', team: [] },
      { kickoff: sec('2026-09-15T00:15:00Z'), gameSecondsRemaining: '3600', team: [] },
    ],
  },
};

const games = scheduleGames(WEEK);

describe('scheduleGames', () => {
  it('coerces MFL’s string numbers once, here', () => {
    expect(games).toHaveLength(16);
    expect(typeof games[0].kickoffMs).toBe('number');
    expect(typeof games[0].secondsRemaining).toBe('number');
  });

  it('survives an unwrapped singleton and a missing feed', () => {
    expect(scheduleGames({ nflSchedule: { matchup: { kickoff: '100', gameSecondsRemaining: '0' } } }))
      .toHaveLength(1);
    expect(scheduleGames(null)).toEqual([]);
  });
});

describe('ptDateKey', () => {
  /**
   * The season runs across the November DST change. A hardcoded -8 puts a
   * September Sunday-night game on Monday, and a hardcoded -7 does it in
   * December — hence Intl.
   */
  it('is DST-correct on both sides of the flip', () => {
    // 2026-09-14T00:20Z is Sunday 5:20pm PDT (UTC-7), not Monday.
    expect(ptDateKey(new Date('2026-09-14T00:20:00Z'))).toBe('2026-09-13');
    // 2026-12-14T01:20Z is Sunday 5:20pm PST (UTC-8), not Monday.
    expect(ptDateKey(new Date('2026-12-14T01:20:00Z'))).toBe('2026-12-13');
  });
});

describe('mainSlate — found in the data, not from a weekday', () => {
  it('picks the kickoff the most games share', () => {
    const slate = mainSlate(games);
    expect(slate).toHaveLength(8);
    expect(slate.every((g: any) => g.kickoffMs === sec('2026-09-13T17:00:00Z') * 1000)).toBe(true);
  });

  it('breaks a tie to the earlier window — the one that means most have played', () => {
    const tied = scheduleGames({
      nflSchedule: {
        matchup: [
          { kickoff: 200, gameSecondsRemaining: '0' },
          { kickoff: 200, gameSecondsRemaining: '0' },
          { kickoff: 100, gameSecondsRemaining: '3600' },
          { kickoff: 100, gameSecondsRemaining: '3600' },
        ],
      },
    });
    expect(mainSlate(tied)[0].kickoffMs).toBe(100_000);
  });
});

describe('mainSlateFinal — the swing gate', () => {
  it('is false while the main slate is being played', () => {
    expect(mainSlateFinal(games)).toBe(false);
  });

  it('is true once every main-slate game is done', () => {
    const done = games.map((g: any) =>
      g.kickoffMs === sec('2026-09-13T17:00:00Z') * 1000 ? { ...g, secondsRemaining: 0 } : g,
    );
    expect(mainSlateFinal(done)).toBe(true);
  });

  it('stays true into Sunday night and Monday, when the drama is', () => {
    // Main slate final, late window still playing, MNF not kicked off.
    const done = games.map((g: any) =>
      g.kickoffMs <= sec('2026-09-13T17:00:00Z') * 1000 ? { ...g, secondsRemaining: 0 } : g,
    );
    expect(mainSlateFinal(done)).toBe(true);
  });

  /**
   * Fails CLOSED. Staying quiet costs one missed nicety; guessing wrong buzzes
   * sixteen people about a lead change in a game that has not kicked off.
   */
  it('is false when the schedule is unreadable', () => {
    expect(mainSlateFinal([])).toBe(false);
    expect(mainSlateFinal(scheduleGames(null))).toBe(false);
  });
});

describe('isGamedayNow', () => {
  it('is true on a day with games', () => {
    expect(isGamedayNow(games, new Date('2026-09-13T18:00:00Z'))).toBe(true);
  });

  /**
   * Note which days those are. Week 1's opener kicks at 8:20pm ET Wednesday,
   * which is 5:20pm PACIFIC on the Wednesday — so "game day" is genuinely a
   * property of the schedule in this timezone, not of a weekday name. Testing
   * against a weekday list would have called this Thursday and polled a day
   * late.
   */
  it('is false on a day with no games, so the poller costs nothing most of the week', () => {
    // Friday midday PT: Thursday night is 17h behind, Sunday is two days out.
    expect(isGamedayNow(games, new Date('2026-09-11T19:00:00Z'))).toBe(false);
    // Tuesday, the deadest day of the NFL week.
    expect(isGamedayNow(games, new Date('2026-09-08T18:00:00Z'))).toBe(false);
  });

  /**
   * A Sunday-night game ends after midnight UTC but is still Sunday in
   * Pacific; the tail is what lets its final land instead of being cut off by
   * the calendar rolling over.
   */
  it('keeps polling for a few hours after the last kickoff', () => {
    // 3h after the Monday-night kickoff, which is Monday evening PT.
    expect(isGamedayNow(games, new Date('2026-09-15T03:15:00Z'))).toBe(true);
    // Two days later, nothing.
    expect(isGamedayNow(games, new Date('2026-09-17T03:15:00Z'))).toBe(false);
  });
});

const side = (id: string, score: number, secondsRemaining = 0, playersYetToPlay = 0) => ({
  id,
  score,
  secondsRemaining,
  playersYetToPlay,
});

describe('matchupKey', () => {
  /**
   * MFL reorders its pairings between polls. Keying on listing order makes a
   * reordered feed read as a brand new matchup, which re-sends every alert
   * already sent.
   */
  it('is the same whichever side MFL lists first', () => {
    expect(matchupKey({ home: side('0002', 0), away: side('0001', 0) })).toBe(
      matchupKey({ home: side('0001', 0), away: side('0002', 0) }),
    );
  });
});

describe('leaderOf / isFinal', () => {
  it('has no leader while the score is tied', () => {
    expect(leaderOf({ home: side('0001', 90), away: side('0002', 90) })).toBeNull();
  });

  it('is final only when both sides are done', () => {
    expect(isFinal({ home: side('0001', 90), away: side('0002', 80) })).toBe(true);
    expect(isFinal({ home: side('0001', 90, 900), away: side('0002', 80) })).toBe(false);
    expect(isFinal({ home: side('0001', 90, 0, 2), away: side('0002', 80) })).toBe(false);
  });

  it('falls back to the clock when MFL omits playersYetToPlay', () => {
    const noField = { id: '0001', score: 90, secondsRemaining: 0, playersYetToPlay: null };
    expect(isFinal({ home: noField, away: side('0002', 80) })).toBe(true);
  });
});

describe('detectGamedayAlerts', () => {
  const playing = (a: number, b: number) => ({
    home: side('0001', a, 900, 1),
    away: side('0002', b, 900, 1),
  });

  it('sends nothing on the first poll — there is no previous leader', () => {
    const { alerts, nextState } = detectGamedayAlerts({
      pairings: [playing(50, 40)],
      swingsAllowed: true,
    });
    expect(alerts).toEqual([]);
    expect(nextState['leader:0001-0002']).toBe('0001');
  });

  it('fires a swing when the lead changes after the main slate', () => {
    const { alerts } = detectGamedayAlerts({
      pairings: [playing(40, 50)],
      state: { 'leader:0001-0002': '0001' },
      swingsAllowed: true,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'swing', leader: '0002', previousLeader: '0001' });
  });

  /**
   * The whole point of the gate. A lead change at 10:30am, with eleven
   * starters yet to play, is not a result.
   */
  it('stays silent on a lead change before the main slate is final', () => {
    const { alerts } = detectGamedayAlerts({
      pairings: [playing(40, 50)],
      state: { 'leader:0001-0002': '0001' },
      swingsAllowed: false,
    });
    expect(alerts).toEqual([]);
  });

  /**
   * The leader must be recorded even while swings are suppressed, or the first
   * poll after the slate ends compares against nothing and misses the change
   * of hands that happened during the window.
   */
  it('records the leader even when swings are not yet allowed', () => {
    const { nextState } = detectGamedayAlerts({
      pairings: [playing(40, 50)],
      swingsAllowed: false,
    });
    expect(nextState['leader:0001-0002']).toBe('0002');
  });

  it('caps swings at one per matchup per week — a see-saw is not five buzzes', () => {
    const state = { 'leader:0001-0002': '0002', 'swing:0001-0002': '0002' };
    const { alerts } = detectGamedayAlerts({
      pairings: [playing(60, 50)],
      state,
      swingsAllowed: true,
    });
    expect(alerts.filter((a: any) => a.kind === 'swing')).toEqual([]);
  });

  it('does not treat a tie as a change of hands', () => {
    const { alerts, nextState } = detectGamedayAlerts({
      pairings: [playing(50, 50)],
      state: { 'leader:0001-0002': '0001' },
      swingsAllowed: true,
    });
    expect(alerts).toEqual([]);
    expect(nextState['leader:0001-0002']).toBeUndefined();
  });

  /**
   * The caller stores state with HSET, which can only add and overwrite.
   * Dropping the key from `nextState` alone leaves the pre-tie leader sitting
   * in Redis, and the next poll compares against a leader the game no longer
   * has — so a cleared leader has to be reported as an explicit removal.
   */
  it('reports a cleared leader as a removal, not just an absence', () => {
    const { removed } = detectGamedayAlerts({
      pairings: [playing(50, 50)],
      state: { 'leader:0001-0002': '0001' },
      swingsAllowed: true,
    });
    expect(removed).toEqual(['leader:0001-0002']);
  });

  it('has nothing to remove when there was no leader to begin with', () => {
    const { removed } = detectGamedayAlerts({ pairings: [playing(50, 50)] });
    expect(removed).toEqual([]);
  });

  it('fires a final once, per matchup', () => {
    const done = { home: side('0001', 91.2), away: side('0002', 88.4) };
    const first = detectGamedayAlerts({ pairings: [done], swingsAllowed: true });
    expect(first.alerts.filter((a: any) => a.kind === 'final')).toHaveLength(1);

    const second = detectGamedayAlerts({
      pairings: [done],
      state: first.nextState,
      swingsAllowed: true,
    });
    expect(second.alerts.filter((a: any) => a.kind === 'final')).toEqual([]);
  });

  /**
   * Per matchup, not per league: a Sunday-only matchup should land Sunday
   * night rather than waiting on whoever has a Monday-night player.
   */
  it('finals one matchup while another is still playing', () => {
    const { alerts } = detectGamedayAlerts({
      pairings: [
        { home: side('0001', 91), away: side('0002', 88) },
        { home: side('0003', 60, 1800, 3), away: side('0004', 55, 1800, 2) },
      ],
      swingsAllowed: true,
    });
    expect(alerts.map((a: any) => a.kind)).toEqual(['final']);
    expect(alerts[0].key).toBe('0001-0002');
  });

  it('ignores a malformed pairing rather than throwing mid-slate', () => {
    const { alerts } = detectGamedayAlerts({
      pairings: [{ home: {}, away: side('0002', 10) } as any],
      swingsAllowed: true,
    });
    expect(alerts).toEqual([]);
  });
});

describe('buildGamedayNotifications', () => {
  const names = new Map([
    ['0001', 'Pigskins'],
    ['0002', 'Geeks'],
  ]);

  /** Fails loudly if the notification we asserted on was never built. */
  const forFranchise = (out: any[], franchiseId: string) => {
    const found = out.find((n) => n.franchiseId === franchiseId);
    if (!found) throw new Error(`no notification for ${franchiseId}`);
    return found;
  };

  it('writes each owner their own side of the final', () => {
    const { alerts } = detectGamedayAlerts({
      pairings: [{ home: side('0001', 91.24), away: side('0002', 88.4) }],
    });
    const out = buildGamedayNotifications({ alerts, teamNames: names, week: 3 });
    expect(out).toHaveLength(2);

    const winner = forFranchise(out, '0001');
    expect(winner.title).toBe('Week 3: win');
    expect(winner.body).toBe('Final 91.2-88.4 vs Geeks.');

    const loser = forFranchise(out, '0002');
    expect(loser.title).toBe('Week 3: loss');
    expect(loser.body).toBe('Final 88.4-91.2 vs Pigskins.');
  });

  it('calls a tie a tie for both', () => {
    const { alerts } = detectGamedayAlerts({
      pairings: [{ home: side('0001', 90), away: side('0002', 90) }],
    });
    const out = buildGamedayNotifications({ alerts, teamNames: names, week: 3 });
    expect(out.map((n: any) => n.title)).toEqual(['Week 3: tie', 'Week 3: tie']);
  });

  it('writes a swing from each side', () => {
    const { alerts } = detectGamedayAlerts({
      pairings: [{ home: side('0001', 40, 900, 1), away: side('0002', 50, 900, 1) }],
      state: { 'leader:0001-0002': '0001' },
      swingsAllowed: true,
    });
    const out = buildGamedayNotifications({ alerts, teamNames: names, week: 3 });
    expect(forFranchise(out, '0002').title).toBe('You just took the lead');
    expect(forFranchise(out, '0001').title).toBe('You just lost the lead');
  });

  it('tags per matchup per week, so a re-send replaces rather than duplicates', () => {
    const { alerts } = detectGamedayAlerts({
      pairings: [{ home: side('0001', 91), away: side('0002', 88) }],
    });
    const out = buildGamedayNotifications({ alerts, teamNames: names, week: 3 });
    expect(out[0].tag).toBe('scoring-final-w3-0001-0002');
    expect(out[1].tag).toBe('scoring-final-w3-0001-0002');
  });

  it('degrades to a readable line when a team name is missing', () => {
    const { alerts } = detectGamedayAlerts({
      pairings: [{ home: side('0001', 91), away: side('0009', 88) }],
    });
    const out = buildGamedayNotifications({ alerts, teamNames: names, week: 3 });
    expect(out[0].body).toBe('Final 91.0-88.0 vs your opponent.');
  });
});

describe('parseLivePairings', () => {
  it('reads MFL’s nested matchup shape', () => {
    const pairings = parseLivePairings({
      liveScoring: {
        matchup: [
          {
            franchise: [
              { id: '0001', score: '91.24', gameSecondsRemaining: '0', playersYetToPlay: '0' },
              { id: '0002', score: '88.40', gameSecondsRemaining: '900', playersYetToPlay: '1' },
            ],
          },
        ],
      },
    });
    expect(pairings).toHaveLength(1);
    expect(pairings[0].home).toEqual({
      id: '0001',
      score: 91.24,
      secondsRemaining: 0,
      playersYetToPlay: 0,
    });
    expect(pairings[0].away.playersYetToPlay).toBe(1);
  });

  it('records a missing playersYetToPlay as null, not as zero', () => {
    const [p] = parseLivePairings({
      liveScoring: {
        matchup: {
          franchise: [
            { id: '0001', score: '10', gameSecondsRemaining: '0' },
            { id: '0002', score: '20', gameSecondsRemaining: '0' },
          ],
        },
      },
    });
    // Null means "MFL didn't say", which isFinal treats as "the clock decides".
    // Zero would mean "MFL said nobody is left", which is a different claim.
    expect(p.home.playersYetToPlay).toBeNull();
  });

  it('returns nothing for a missing or half-formed payload', () => {
    expect(parseLivePairings(null)).toEqual([]);
    expect(parseLivePairings({ liveScoring: { matchup: [{ franchise: [{ id: '0001' }] }] } })).toEqual([]);
  });
});
