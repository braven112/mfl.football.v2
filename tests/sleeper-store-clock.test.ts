/**
 * The store app's Sleeper clock: MFL's `nflSchedule` export → seconds left per
 * NFL club, in the canonical codes the Sleeper player map uses. The store
 * build may not read ESPN, so this is the only clock its Sleeper leagues get.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearMflClockCache,
  loadMflNflClock,
  secondsRemainingFromMflSchedule,
} from '../src/utils/sleeper/store-clock';

const schedule = {
  nflSchedule: {
    week: '8',
    matchup: [
      { kickoff: '1', gameSecondsRemaining: '0', team: [{ id: 'NEP' }, { id: 'CHI' }] },
      { kickoff: '2', gameSecondsRemaining: '1325', team: [{ id: 'GBP' }, { id: 'KCC' }] },
      { kickoff: '3', gameSecondsRemaining: '3600', team: [{ id: 'JAC' }, { id: 'LVR' }] },
    ],
  },
};

describe('secondsRemainingFromMflSchedule', () => {
  it("maps MFL's club codes to the canonical ones", () => {
    const clock = secondsRemainingFromMflSchedule(schedule);
    expect(clock.get('NE')).toBe(0);
    expect(clock.get('GB')).toBe(1325);
    expect(clock.get('KC')).toBe(1325);
    expect(clock.get('JAX')).toBe(3600);
    expect(clock.get('LV')).toBe(3600);
    expect(clock.has('GBP')).toBe(false);
  });

  it('reads a single-matchup week (MFL sends an object, not an array)', () => {
    const one = { nflSchedule: { matchup: schedule.nflSchedule.matchup[1] } };
    expect(secondsRemainingFromMflSchedule(one).get('GB')).toBe(1325);
  });

  it('a club on bye is absent, and junk is ignored', () => {
    expect(secondsRemainingFromMflSchedule(schedule).has('DAL')).toBe(false);
    expect(secondsRemainingFromMflSchedule({ error: 'x' }).size).toBe(0);
    expect(secondsRemainingFromMflSchedule(null).size).toBe(0);
  });
});

describe('loadMflNflClock', () => {
  beforeEach(() => clearMflClockCache());

  const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;

  it('reads the week from MFL', async () => {
    let asked = '';
    const fetchImpl = (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify(schedule), { status: 200 });
    }) as unknown as typeof fetch;
    const clock = await loadMflNflClock({ year: 2026, week: 8 }, fetchImpl);
    expect(asked).toContain('/2026/export?TYPE=nflSchedule&W=8&JSON=1');
    expect(clock?.get('GB')).toBe(1325);
  });

  it('a failed or empty read is null, never an empty clock (which would read every game as Final)', async () => {
    expect(await loadMflNflClock({ year: 2026, week: 8 }, ok({ error: 'busy' }))).toBeNull();
    const down = (async () => new Response('', { status: 503 })) as typeof fetch;
    expect(await loadMflNflClock({ year: 2026, week: 8 }, down)).toBeNull();
    const throws = (async () => {
      throw new Error('net');
    }) as typeof fetch;
    expect(await loadMflNflClock({ year: 2026, week: 8 }, throws)).toBeNull();
  });

  it('serves every poll inside the cache window from one read', async () => {
    await loadMflNflClock({ year: 2026, week: 8 }, ok(schedule));
    clearMflClockCache();
    await loadMflNflClock({ year: 2026, week: 8 }, ok(schedule));
    // Within the cache window the second call never fetches.
    const never = (async () => {
      throw new Error('should not fetch');
    }) as typeof fetch;
    expect((await loadMflNflClock({ year: 2026, week: 8 }, never))?.get('GB')).toBe(1325);
  });
});
