import { describe, it, expect } from 'vitest';
import { buildAppLineupView, isLineupSeason, type AppLineupInputs } from '../src/utils/live/mfl-live-app-lineup';
import { lineupSlotsFor, assignLineupSlots } from '../src/utils/lineup-slots';
import { parseLineupSubmission } from '../src/utils/lineup-write';

/**
 * The MFL Football app's Set Lineup view (package J), for a league that is
 * NOT one of ours (no registry entry, no committed feeds), so every answer
 * comes from MFL's payloads alone.
 *
 * The state that matters most is the one the site's page learned the hard
 * way: "no lineup on file" and "couldn't read it" both produce zero
 * starters, and only the first may ever be submitted.
 */

const LEAGUE = {
  leagueId: '99999',
  leagueName: 'Outside League',
  franchiseId: '0003',
  franchiseName: 'Visitors',
  year: 2026,
  host: 'https://www12.myfantasyleague.com',
};

// QB 1, RB 2-4, WR 2-4, TE 1-2, PK 1, Def 1, 9 starters: one FLEX.
const STARTERS = {
  count: '9',
  position: [
    { name: 'QB', limit: '1' },
    { name: 'RB', limit: '2-4' },
    { name: 'WR', limit: '2-4' },
    { name: 'TE', limit: '1-2' },
    { name: 'PK', limit: '1' },
    { name: 'Def', limit: '1' },
  ],
};

const ROSTER: [string, string, string, string][] = [
  // id, name, position, team
  ['101', 'Arm, Quinn', 'QB', 'KC'],
  ['201', 'Back, Rhett', 'RB', 'KC'],
  ['202', 'Runner, Bo', 'RB', 'DAL'],
  ['203', 'Bye, Bobby', 'RB', 'SFO'],
  ['301', 'Hands, Wade', 'WR', 'DAL'],
  ['302', 'Fly, Ray', 'WR', 'KC'],
  ['303', 'Deep, Will', 'WR', 'DAL'],
  ['401', 'End, Tom', 'TE', 'KC'],
  ['501', 'Boot, Kip', 'PK', 'DAL'],
  ['601', 'Chiefs, Kansas City', 'Def', 'KC'],
  ['701', 'Taxi, Tim', 'WR', 'KC'],
];

const NOW_MS = Date.UTC(2026, 9, 25, 12, 0); // Sunday morning, before kickoff
const KICK_KC = Math.floor(Date.UTC(2026, 9, 25, 17, 0) / 1000);
const KICK_DAL = Math.floor(Date.UTC(2026, 9, 25, 20, 25) / 1000);

function inputs(over: Partial<AppLineupInputs> = {}): AppLineupInputs {
  return {
    league: LEAGUE,
    week: 8,
    currentWeek: 8,
    nowMs: NOW_MS,
    leaguePayload: { league: { starters: STARTERS } },
    rostersPayload: {
      rosters: {
        franchise: {
          id: '0003',
          player: ROSTER.map(([id]) => ({ id, status: id === '701' ? 'TAXI_SQUAD' : 'ROSTER' })),
        },
      },
    },
    weekResultsPayload: null,
    ytdResultsPayload: null,
    projectionsPayload: {
      projectedScores: { playerScore: ROSTER.map(([id], i) => ({ id, score: String(30 - i) })) },
    },
    nflSchedulePayload: {
      nflSchedule: {
        matchup: [
          { kickoff: String(KICK_KC), team: [{ id: 'KCC' }, { id: 'LVR' }] },
          { kickoff: String(KICK_DAL), team: [{ id: 'DAL' }, { id: 'NYG' }] },
        ],
      },
    },
    playersPayload: {
      players: { player: ROSTER.map(([id, name, position, team]) => ({ id, name, position, team })) },
    },
    injuries: {},
    identities: new Map(),
    ...over,
  };
}

/** A week's results in which franchise 0003 is listed, with or without starters. */
function weekResults(starters: string | null) {
  return {
    weeklyResults: {
      week: '8',
      matchup: [{ franchise: [{ id: '0003', ...(starters ? { starters } : {}) }, { id: '0004' }] }],
    },
  };
}

describe('buildAppLineupView', () => {
  it('lays out the league’s own slots and names players from MFL', () => {
    const view = buildAppLineupView(inputs({ weekResultsPayload: weekResults(null) }));
    expect(view.supported).toBe(true);
    expect(view.starterCount).toBe(9);
    expect(view.slots.map((s) => s.position)).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'PK', 'DEF']);
    const qb = view.players.find((p) => p.id === '101')!;
    expect(qb.name).toBe('Quinn Arm');
    expect(qb.slots).toEqual(['QB']);
    expect(view.players.find((p) => p.id === '202')!.slots).toEqual(['RB', 'FLEX']);
  });

  it('marks a real team missing from the week’s schedule as on bye', () => {
    const view = buildAppLineupView(inputs({ weekResultsPayload: weekResults(null) }));
    const bye = view.players.find((p) => p.id === '203')!;
    expect(bye.isBye).toBe(true);
    expect(bye.kickoff).toBeNull();
    expect(view.players.find((p) => p.id === '101')!.kickoff).toBe(KICK_KC);
    expect(view.firstKickoff).toBe(KICK_KC);
  });

  it('shows a saved lineup as saved, editable before kickoff', () => {
    const view = buildAppLineupView(inputs({
      weekResultsPayload: weekResults('101,201,202,301,302,401,303,501,601'),
    }));
    expect(view.mode).toBe('saved');
    expect(view.canSubmit).toBe(true);
    expect(view.canSubmitUnsaved).toBe(false);
    expect(view.slots.find((s) => s.position === 'FLEX')!.playerId).toBe('303');
  });

  it('offers a projection fill when MFL answers with no lineup, skipping bye and taxi players', () => {
    const view = buildAppLineupView(inputs({ weekResultsPayload: weekResults(null) }));
    expect(view.mode).toBe('unsaved-offer');
    expect(view.canSubmitUnsaved).toBe(true);
    const seated = view.slots.map((s) => s.playerId);
    expect(seated).not.toContain('203');
    expect(seated).not.toContain('701');
    expect(seated.every(Boolean)).toBe(true);
  });

  it('never lets a failed read be submitted — not even after edits', () => {
    // Every weeklyResults source failed: zero starters, but NOT "no lineup".
    const view = buildAppLineupView(inputs({ weekResultsPayload: null, ytdResultsPayload: null }));
    expect(view.mode).toBe('read-failed');
    expect(view.canSubmit).toBe(false);
    expect(view.canSubmitUnsaved).toBe(false);
  });

  it('locks a player whose game has kicked off', () => {
    const view = buildAppLineupView(inputs({
      nowMs: (KICK_KC + 60) * 1000,
      weekResultsPayload: weekResults('101,201,202,301,302,401,303,501,601'),
    }));
    expect(view.players.find((p) => p.id === '101')!.locked).toBe(true);
    expect(view.players.find((p) => p.id === '301')!.locked).toBe(false);
    expect(view.slots[0]).toMatchObject({ playerId: '101', locked: true });
  });

  it('warns about a ruled-out starter and an empty slot', () => {
    const view = buildAppLineupView(inputs({
      injuries: { '201': { injuryStatus: 'Out' } },
      weekResultsPayload: weekResults('101,201,202,301,302,401,303,501,601'),
    }));
    expect(view.players.find((p) => p.id === '201')!.out).toBe(true);
    expect(view.problems.map((p) => p.kind)).toContain('out');
  });

  it('refuses a past week with no lineup', () => {
    const view = buildAppLineupView(inputs({ week: 5, weekResultsPayload: { weeklyResults: { week: '5', matchup: [{ franchise: [{ id: '0003' }] }] } } }));
    expect(view.mode).toBe('past-unset');
    expect(view.canSubmit).toBe(false);
  });

  it('is unsupported, and never submittable, when the starter rules can’t be read', () => {
    const view = buildAppLineupView(inputs({ leaguePayload: null, weekResultsPayload: weekResults(null) }));
    expect(view.supported).toBe(false);
    expect(view.canSubmit).toBe(false);
    expect(view.slots).toEqual([]);
  });
});

describe('lineupSlotsFor in any-league mode', () => {
  const IDP = {
    count: '11',
    position: [
      { name: 'QB', limit: '1' },
      { name: 'RB', limit: '2' },
      { name: 'WR', limit: '3' },
      { name: 'TE', limit: '1' },
      { name: 'DL', limit: '1-2' },
      { name: 'LB', limit: '1-2' },
      { name: 'DB', limit: '1' },
    ],
  };

  it('stays strict for the site: nine starters, no IDP', () => {
    expect(lineupSlotsFor(IDP)).toBeNull();
  });

  it('lays out any count and IDP positions for the app', () => {
    const layout = lineupSlotsFor(IDP, { anyLeague: true })!;
    expect(layout.positions).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'DL', 'LB', 'DB']);
    expect(layout.eligibility.FLEX).toEqual(['DL', 'LB']);
  });

  it('seats the flex without passing a position maximum', () => {
    const layout = lineupSlotsFor(IDP, { anyLeague: true })!;
    const slots = assignLineupSlots(
      [
        { id: 'a', position: 'DL', gameLocked: false },
        { id: 'b', position: 'DL', gameLocked: false },
        { id: 'c', position: 'DL', gameLocked: false },
        { id: 'd', position: 'LB', gameLocked: false },
      ],
      layout,
    );
    const flex = slots.find((s) => s.position === 'FLEX')!;
    expect(flex.playerId).toBe('b');
    expect(slots.filter((s) => s.playerId === 'c')).toEqual([]);
  });
});

describe('parseLineupSubmission', () => {
  it('takes the league’s own starter count', () => {
    const starters = Array.from({ length: 11 }, (_, i) => String(100 + i));
    expect(parseLineupSubmission({ week: 3, starters }, 11).ok).toBe(true);
    expect(parseLineupSubmission({ week: 3, starters }, 9).ok).toBe(false);
  });

  it('refuses a player starting twice', () => {
    expect(parseLineupSubmission({ week: 3, starters: ['1', '1'] }, 2)).toMatchObject({ ok: false });
  });
});

describe('isLineupSeason', () => {
  it('is closed the Sunday before the opener and open the week after', () => {
    expect(isLineupSeason(new Date(Date.UTC(2026, 8, 6, 18)))).toBe(false);
    expect(isLineupSeason(new Date(Date.UTC(2026, 8, 20, 18)))).toBe(true);
    expect(isLineupSeason(new Date(Date.UTC(2027, 0, 5, 18)))).toBe(true);
  });
});
