/**
 * A league whose feed blinked must not reset to zero.
 *
 * The bug: `/api/broadcast-live` answers `ok: true` for an assembly in which
 * one league's MFL read failed — deliberately, because one dead feed is not
 * an outage — and that league rides along as `{ ok: false, teams: {} }`. The
 * island's only retention rule gated on the WHOLE response, so the empty
 * league sailed through and rendered as 0.0 / Proj 0.0 / 0 to play / an empty
 * player strip. On a live Sunday with four MFL reads per poll every eight
 * seconds, a real 87.0 reset itself to zero and crept back repeatedly.
 *
 * Two halves are pinned here: the pure carry, and the fact that the ISLAND
 * actually routes its poll through it — the pure function passing while
 * `setPoll(body)` still shipped the raw payload is precisely the regression
 * that would look green.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { carryLeagueScores, seedCarry } from '../src/utils/broadcast-carry';
import type { BroadcastLeagueScore, BroadcastTeamScore } from '../src/types/live-broadcast';

const team = (live: number): BroadcastTeamScore => ({
  live,
  projectedFinal: live + 10,
  remainingPoints: 10,
  yetToPlay: 2,
  players: [],
});

const good = (leagueId: string, live: number): BroadcastLeagueScore => ({
  leagueId,
  ok: true,
  live: true,
  teams: { '0001': team(live), '0002': team(live - 5) },
  winProbability: [0.62],
});

const failed = (leagueId: string): BroadcastLeagueScore => ({
  leagueId,
  ok: false,
  live: false,
  teams: {},
  winProbability: [],
});

const T0 = 1_700_000_000_000;
const STALE_MS = 5 * 60_000;

describe('carryLeagueScores', () => {
  it('carries the last good numbers through a league-level failure', () => {
    const first = carryLeagueScores([good('19621', 87)], new Map(), T0, STALE_MS);
    const second = carryLeagueScores(first.leagues, first.carried, T0 + 8_000, STALE_MS);
    expect(second.leagues[0].teams['0001'].live).toBe(87);

    const blip = carryLeagueScores([failed('19621')], first.carried, T0 + 8_000, STALE_MS);
    expect(blip.leagues[0].teams['0001'].live).toBe(87);
    expect(blip.leagues[0].winProbability).toEqual([0.62]);
    // The failure is not laundered into a success — only the numbers are
    // borrowed, so anything that learns to read the flag still sees the truth.
    expect(blip.leagues[0].ok).toBe(false);
  });

  it('does not carry one league over another', () => {
    const { carried } = carryLeagueScores([good('13522', 34), good('19621', 87)], new Map(), T0, STALE_MS);
    const next = carryLeagueScores([good('13522', 36), failed('19621')], carried, T0 + 8_000, STALE_MS);
    expect(next.leagues.find((l) => l.leagueId === '13522')!.teams['0001'].live).toBe(36);
    expect(next.leagues.find((l) => l.leagueId === '19621')!.teams['0001'].live).toBe(87);
  });

  it('ages a carry out on the last good READ, not on the last failure', () => {
    // Otherwise a league whose feed dies is carried forever by its own failed
    // polls, each one refreshing the timestamp of a number that never moved.
    const { carried } = carryLeagueScores([good('19621', 87)], new Map(), T0, STALE_MS);
    let held = carried;
    for (let t = 8_000; t <= STALE_MS; t += 8_000) {
      held = carryLeagueScores([failed('19621')], held, T0 + t, STALE_MS).carried;
    }
    const expired = carryLeagueScores([failed('19621')], held, T0 + STALE_MS + 8_000, STALE_MS);
    expect(expired.leagues[0].teams).toEqual({});
    expect(expired.carried.has('19621')).toBe(false);
  });

  it('never overwrites a HEALTHY empty week — a bye is a fact, not an outage', () => {
    const { carried } = carryLeagueScores([good('19621', 87)], new Map(), T0, STALE_MS);
    const bye: BroadcastLeagueScore = { leagueId: '19621', ok: true, live: false, teams: {}, winProbability: [] };
    const next = carryLeagueScores([bye], carried, T0 + 8_000, STALE_MS);
    expect(next.leagues[0].teams).toEqual({});
  });

  it('seedCarry seeds only the leagues that read ok', () => {
    const seeded = seedCarry([good('13522', 34), failed('19621')], T0);
    expect([...seeded.keys()]).toEqual(['13522']);
  });
});

describe('the island routes its poll through the carry', () => {
  const island = readFileSync(
    join(process.cwd(), 'src/components/shared/live-broadcast/LiveBroadcast.tsx'),
    'utf8',
  );
  // The prose documenting the trap must not be what satisfies the guard.
  const code = island.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('calls carryLeagueScores in the poll handler', () => {
    expect(code).toMatch(/carryLeagueScores\(\s*body\.leagues/);
  });

  it('never hands the raw poll body straight to setPoll', () => {
    // `setPoll(body)` is the exact line that shipped the reset.
    expect(code).not.toMatch(/setPoll\(\s*body\s*\)/);
  });
});
