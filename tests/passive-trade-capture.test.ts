/**
 * Passive pending-offer capture on MFL Live loads.
 *
 * Pins the three promises the feature makes: one MFL read per account per
 * interval (claimed before any MFL call), the owner's OWN cookie and team
 * only, and a board request that is never delayed past the budget or broken
 * by a failure.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { LEAGUES } from '../src/config/leagues';
import type { AuthUser } from '../src/utils/auth';
import {
  PASSIVE_READ_INTERVAL_S,
  capturePendingOffers,
  capturePendingOffersQuietly,
  passiveCaptureKey,
  type PassiveCaptureDeps,
} from '../src/utils/live/passive-trade-capture';

const user: AuthUser = {
  id: 'mfl-cookie-abc',
  name: 'Owner',
  franchiseId: '0007',
  leagueId: '99999',
  role: 'owner',
};

function fakeRedis() {
  const keys = new Map<string, unknown>();
  const set = vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
    if (opts?.nx && keys.has(key)) return null;
    keys.set(key, value);
    return 'OK';
  });
  return { keys, set };
}

function deps(over: Partial<PassiveCaptureDeps> = {}) {
  const redis = fakeRedis();
  const d: PassiveCaptureDeps = {
    redis: async () => redis,
    findTeams: vi.fn(async () => [
      { leagueId: LEAGUES.theleague.id, franchiseId: '0003', host: 'https://www49.myfantasyleague.com' },
    ]),
    fetchRows: vi.fn(async () => ({ trades: [{ trade_id: '11', offeredto: '0005' }] })),
    report: vi.fn(async () => {}),
    ...over,
  };
  return { d, redis };
}

describe('capturePendingOffers', () => {
  it("reads the owner's TheLeague offers with their own cookie and reports them", async () => {
    const { d } = deps();
    expect(await capturePendingOffers(user, d)).toBe('reported');
    expect(d.fetchRows).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: LEAGUES.theleague.id,
        mflUserCookie: user.id,
        franchiseId: '0003',
        host: 'https://www49.myfantasyleague.com',
      }),
    );
    expect(d.report).toHaveBeenCalledWith('0003', [{ trade_id: '11', offeredto: '0005' }], LEAGUES.theleague.id);
  });

  it('reads once per interval per account, claimed before MFL is asked', async () => {
    const { d, redis } = deps();
    await capturePendingOffers(user, d);
    expect(await capturePendingOffers(user, d)).toBe('throttled');
    expect(d.fetchRows).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(passiveCaptureKey(user), expect.anything(), {
      nx: true,
      ex: PASSIVE_READ_INTERVAL_S,
    });
  });

  it('a failed read still holds the claim, so it is not retried every poll', async () => {
    const { d } = deps({ fetchRows: vi.fn(async () => ({ trades: null, error: 'MFL HTTP 500' })) });
    expect(await capturePendingOffers(user, d)).toBe('read-failed');
    expect(await capturePendingOffers(user, d)).toBe('throttled');
    expect(d.report).not.toHaveBeenCalled();
  });

  it('never puts the MFL cookie in a Redis key', () => {
    expect(passiveCaptureKey(user)).not.toContain(user.id);
    expect(passiveCaptureKey(user)).toBe(passiveCaptureKey({ id: user.id }));
    expect(passiveCaptureKey(user)).not.toBe(passiveCaptureKey({ id: 'another-cookie' }));
  });

  it('does nothing for an account with no team in a trade-rumor league', async () => {
    const { d } = deps({ findTeams: vi.fn(async () => []) });
    expect(await capturePendingOffers(user, d)).toBe('no-team');
    expect(d.fetchRows).not.toHaveBeenCalled();
  });

  it('does nothing without Redis (nowhere to report into)', async () => {
    const { d } = deps({ redis: async () => null });
    expect(await capturePendingOffers(user, d)).toBe('no-store');
    expect(d.findTeams).not.toHaveBeenCalled();
  });

  it('reads every trade-rumor league the owner is in, each on its own', async () => {
    const afl = LEAGUES['afl-fantasy'].id;
    const { d } = deps({
      findTeams: vi.fn(async () => [
        { leagueId: LEAGUES.theleague.id, franchiseId: '0003', host: null },
        { leagueId: afl, franchiseId: '0012', host: null },
      ]),
      fetchRows: vi.fn(async (o: { leagueId: string }) =>
        o.leagueId === afl ? { trades: [{ trade_id: '77' }] } : { trades: null, error: 'MFL HTTP 500' },
      ),
    });
    expect(await capturePendingOffers(user, d)).toBe('reported');
    expect(d.fetchRows).toHaveBeenCalledTimes(2);
    expect(d.report).toHaveBeenCalledTimes(1);
    expect(d.report).toHaveBeenCalledWith('0012', [{ trade_id: '77' }], afl);
  });

  it('does not report an empty offer list', async () => {
    const { d } = deps({ fetchRows: vi.fn(async () => ({ trades: [] })) });
    expect(await capturePendingOffers(user, d)).toBe('no-offers');
    expect(d.report).not.toHaveBeenCalled();
  });
});

describe('capturePendingOffersQuietly', () => {
  it('resolves at the budget when MFL is slow', async () => {
    const { d } = deps({ fetchRows: () => new Promise(() => {}) });
    const started = Date.now();
    await capturePendingOffersQuietly(user, 30, d);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('never rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { d } = deps({ redis: async () => { throw new Error('boom'); }, findTeams: async () => { throw new Error('x'); } });
    await expect(capturePendingOffersQuietly(user, 100, d)).resolves.toBeUndefined();
    const { d: d2 } = deps({ report: async () => { throw new Error('redis down'); } });
    await expect(capturePendingOffersQuietly(user, 100, d2)).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('is a no-op when signed out', async () => {
    await expect(capturePendingOffersQuietly(null)).resolves.toBeUndefined();
  });
});

describe('wiring', () => {
  it.each(['src/pages/api/live-board.ts', 'src/pages/live/index.astro'])(
    '%s runs the capture for the signed-in owner',
    (file) => {
      const src = readFileSync(file, 'utf8');
      expect(src).toMatch(/capturePendingOffersQuietly\((user|authUser)\)/);
      expect(src).toMatch(/await tradeCapture/);
    },
  );
});
