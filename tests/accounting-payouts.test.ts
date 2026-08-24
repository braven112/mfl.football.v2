/**
 * Guard tests for the season payout planner.
 *
 * The idempotency check is the one that matters most: MFL's accounting import
 * has no upsert and no delete, so a second payout run without it pays every
 * prize a second time and the only fix is hand-written offsetting records.
 */

import { describe, it, expect } from 'vitest';
import {
  planPayouts,
  resolvePlacements,
  resolvePlayoffSeeds,
  resolveWeeklyHighScores,
} from '../src/utils/accounting-payouts.mjs';
import { LEAGUES } from '../src/config/leagues';
import { loadPayoutSeasonData } from '../src/utils/accounting-season-data';

/** A bracket whose final is decided on points. */
const bracket = (homeId: string, homePts: number, awayId: string, awayPts: number) => ({
  playoffBracket: {
    playoffRound: [
      {
        week: '17',
        playoffGame: {
          home: { franchise_id: homeId, points: String(homePts) },
          away: { franchise_id: awayId, points: String(awayPts) },
        },
      },
    ],
  },
});

describe('resolvePlacements', () => {
  const meta = [
    { id: '1', name: 'The League Championship', teamsInvolved: '7' },
    { id: '2', name: '3rd Place Bracket', teamsInvolved: '2' },
    { id: '5', name: 'The Toilet Bowl Challenge - 1.17', teamsInvolved: '7' },
  ];

  it('gives a bracket final BOTH places — winner and loser', () => {
    const places = resolvePlacements(meta, {
      '1': bracket('0010', 132, '0015', 96),
      '2': bracket('0002', 110, '0009', 101),
    });
    expect(places.get(1)).toBe('0010');
    expect(places.get(2)).toBe('0015');
    expect(places.get(3)).toBe('0002');
    expect(places.get(4)).toBe('0009');
  });

  it('never lets the Toilet Bowl claim 1st place', () => {
    // The Toilet Bowl has no "Nth place" in its name, so a naive
    // isTitleBracket() check reads it as a championship.
    const places = resolvePlacements(meta, { '5': bracket('0004', 120, '0006', 90) });
    expect(places.get(1)).toBeUndefined();
  });

  it('treats an unplayed final as undecided, not a 0-0 tie', () => {
    const places = resolvePlacements(meta, { '1': bracket('0010', 0, '0015', 0) });
    expect(places.size).toBe(0);
  });
});

describe('resolvePlayoffSeeds', () => {
  it('reads seeds off the conference brackets only', () => {
    const meta = [
      { id: '1', name: 'AFL Championship' },
      { id: '2', name: 'AL Championship' },
      { id: '3', name: 'NL Championship' },
    ];
    const conference = (a: string, b: string, c: string, d: string) => ({
      playoffBracket: {
        playoffRound: [
          {
            week: '15',
            playoffGame: [
              { home: { seed: '1', franchise_id: a }, away: { seed: '4', franchise_id: d } },
              { home: { seed: '2', franchise_id: b }, away: { seed: '3', franchise_id: c } },
            ],
          },
        ],
      },
    });
    const seeds = resolvePlayoffSeeds(meta, {
      '2': conference('0008', '0001', '0007', '0005'),
      '3': conference('0015', '0018', '0020', '0017'),
    });
    // Two conferences => two teams per seed.
    expect(seeds.get(1)).toEqual(['0008', '0015']);
    expect(seeds.get(3)).toEqual(['0007', '0020']);
  });
});

describe('resolveWeeklyHighScores', () => {
  it('splits a tie rather than picking a winner', () => {
    // Both constitutions say prize ties split. Winner-takes-all here quietly
    // underpays an owner every time two teams land on the same score.
    const weeks = resolveWeeklyHighScores([
      { week: 1, scores: { '0001': 120, '0002': 120, '0003': 90 } },
    ]);
    expect(weeks[0].winners).toEqual(['0001', '0002']);
  });

  it('ignores an unplayed week of all zeroes', () => {
    const weeks = resolveWeeklyHighScores([{ week: 5, scores: { '0001': 0, '0002': 0 } }]);
    expect(weeks).toHaveLength(0);
  });

  it('stops at the regular-season cutoff', () => {
    const weeks = resolveWeeklyHighScores(
      [
        { week: 14, scores: { '0001': 100 } },
        { week: 15, scores: { '0002': 200 } },
      ],
      { throughWeek: 14 }
    );
    expect(weeks.map((w) => w.week)).toEqual([14]);
  });
});

describe('idempotency', () => {
  const payouts = {
    prizePool: 300,
    prizes: [
      { key: 'champion', label: 'League Champion', amount: 300, source: { kind: 'placement', place: 1 } },
    ],
  };
  const data = {
    bracketMeta: [{ id: '1', name: 'The League Championship', teamsInvolved: '7' }],
    brackets: { '1': bracket('0010', 132, '0015', 96) },
  };

  it('plans a prize that is not in the ledger', () => {
    const plan = planPayouts({ year: 2025, payouts, data, existingRecords: [] });
    expect(plan.lines[0].status).toBe('payable');
    expect(plan.lines[0].description).toBe('2025 League Champion');
  });

  it('marks a prize already in the ledger as paid, not payable', () => {
    // This is the whole safety net for a re-run.
    const plan = planPayouts({
      year: 2025,
      payouts,
      data,
      existingRecords: [
        { franchiseId: '0010', amount: 300, description: '2025 League Champion' },
      ],
    });
    expect(plan.lines[0].status).toBe('already-paid');
    expect(plan.totals.payable).toBe(0);
  });

  it('flags a same-description record at a DIFFERENT amount as a conflict', () => {
    const plan = planPayouts({
      year: 2025,
      payouts,
      data,
      existingRecords: [
        { franchiseId: '0010', amount: 250, description: '2025 League Champion' },
      ],
    });
    expect(plan.lines[0].status).toBe('conflict');
    expect(plan.totals.conflicts).toBe(1);
  });

  it('keeps each franchise\'s planned lines individually distinct', () => {
    // The idempotency key is (franchiseId, description), NOT description
    // alone — two conferences each have a seed 3, so the same description on
    // two different franchises is correct and must both be payable. What must
    // never repeat is a description WITHIN one franchise.
    const seedPayouts = {
      prizePool: 400,
      prizes: [
        { key: 'wild-card', label: 'Wild Card', amount: 100, source: { kind: 'playoff-seed', seeds: [3] } },
      ],
    };
    const plan = planPayouts({
      year: 2025,
      payouts: seedPayouts,
      data: {
        bracketMeta: [{ id: '2', name: 'AL Championship' }, { id: '3', name: 'NL Championship' }],
        brackets: {
          '2': { playoffBracket: { playoffRound: [{ playoffGame: [{ home: { seed: '3', franchise_id: '0007' }, away: { seed: '2', franchise_id: '0001' } }] }] } },
          '3': { playoffBracket: { playoffRound: [{ playoffGame: [{ home: { seed: '3', franchise_id: '0020' }, away: { seed: '2', franchise_id: '0018' } }] }] } },
        },
      },
    });
    expect(plan.lines).toHaveLength(2);
    expect(plan.lines.every((line: any) => line.status === 'payable')).toBe(true);

    const keys = plan.lines.map((line: any) => `${line.franchiseId}|${line.description}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('pays the second of two same-seed franchises even when the first is already paid', () => {
    // The regression this guards: keying idempotency on description alone
    // would mark the NL wild card as a repeat of the AL one and skip it.
    const seedPayouts = {
      prizePool: 200,
      prizes: [
        { key: 'wild-card', label: 'Wild Card', amount: 100, source: { kind: 'playoff-seed', seeds: [3] } },
      ],
    };
    const plan = planPayouts({
      year: 2025,
      payouts: seedPayouts,
      data: {
        bracketMeta: [{ id: '2', name: 'AL Championship' }, { id: '3', name: 'NL Championship' }],
        brackets: {
          '2': { playoffBracket: { playoffRound: [{ playoffGame: [{ home: { seed: '3', franchise_id: '0007' }, away: { seed: '2', franchise_id: '0001' } }] }] } },
          '3': { playoffBracket: { playoffRound: [{ playoffGame: [{ home: { seed: '3', franchise_id: '0020' }, away: { seed: '2', franchise_id: '0018' } }] }] } },
        },
      },
      existingRecords: [
        { franchiseId: '0007', amount: 100, description: '2025 Wild Card (seed 3)' },
      ],
    });
    const byFranchise = Object.fromEntries(
      plan.lines.map((line: any) => [line.franchiseId, line.status])
    );
    expect(byFranchise['0007']).toBe('already-paid');
    expect(byFranchise['0020']).toBe('payable');
  });
});

describe('unresolved prizes', () => {
  it('reports a prize it cannot derive instead of skipping it silently', () => {
    // A run that quietly omits the NIT looks identical to one where nobody won.
    const plan = planPayouts({
      year: 2025,
      payouts: {
        prizePool: 50,
        prizes: [{ key: 'nit', label: 'NIT Champion', amount: 50, source: { kind: 'award', slug: 'nit' } }],
      },
      data: { awards: {} },
    });
    expect(plan.lines).toHaveLength(0);
    expect(plan.unresolved[0].label).toBe('NIT Champion');
  });
});

/* ── Against real committed seasons ─────────────────────────────────────── */

describe('2025 season, real feeds', () => {
  it("reconciles TheLeague's plan to the constitution's prize pool", () => {
    const league = LEAGUES['theleague'];
    const plan = planPayouts({
      year: 2025,
      payouts: league.payouts,
      data: loadPayoutSeasonData(league, 2025),
    });
    expect(plan.unresolved).toEqual([]);
    // The constitution says "approximately $712" — the derived plan lands on it.
    expect(plan.totals.planned).toBe(712);
    expect(plan.totals.drift).toBe(0);
  });

  it("resolves every AFL prize, four division titles and four wild cards", () => {
    const league = LEAGUES['afl-fantasy'];
    const plan = planPayouts({
      year: 2025,
      payouts: league.payouts,
      data: loadPayoutSeasonData(league, 2025),
    });
    expect(plan.unresolved).toEqual([]);

    const count = (key: string) => plan.lines.filter((line: any) => line.key === key).length;
    // The AFL pays the FOUR playoff-qualifying division winners, not all six
    // division titles — see the registry note.
    expect(count('division-title')).toBe(4);
    expect(count('wild-card')).toBe(4);

    // $2,225 against a stated $2,220 pool: the known, deliberate drift.
    expect(plan.totals.planned).toBe(2225);
    expect(plan.totals.drift).toBe(5);
  });

  it('pays the AFL Premier League places the standings page shows', () => {
    const league = LEAGUES['afl-fantasy'];
    const plan = planPayouts({
      year: 2025,
      payouts: league.payouts,
      data: loadPayoutSeasonData(league, 2025),
    });
    const byKey = Object.fromEntries(
      plan.lines.map((line: any) => [line.key, { id: line.franchiseId, amount: line.amount }])
    );
    // Matches the tier table rendered on /afl-fantasy/standings?view=all_play.
    expect(byKey['premier-league']).toEqual({ id: '0015', amount: 225 });
    expect(byKey['premier-league-2']).toEqual({ id: '0022', amount: 150 });
    expect(byKey['premier-league-3']).toEqual({ id: '0002', amount: 100 });
    expect(byKey['premier-league-4']).toEqual({ id: '0019', amount: 50 });
    expect(byKey['dleague-champion']).toEqual({ id: '0017', amount: 50 });
  });
});
