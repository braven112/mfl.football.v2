/**
 * Script-side push fan-out (scripts/lib/push-fanout.mjs).
 *
 * The dry-run test is the one that earns its place. A push is the single side
 * effect a dry run must never have — it puts a real notification on sixteen
 * real phones — and the first version of the rumor sender pushed BEFORE the
 * script's own dry-run check, so `--dry-run` would have buzzed the league.
 * The guard now lives in this helper rather than in five scripts that each
 * have to remember it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendPushFanout, broadcast } from '../scripts/lib/push-fanout.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';

const LEAGUE = LEAGUES.theleague;
const silent = { log: () => {}, warn: () => {} };
const notifications = [{ franchiseId: '0001', title: 't', body: 'b' }];

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, sent: 1, recipients: 1 }),
  });
  vi.stubGlobal('fetch', fetchMock);
  process.env.CRON_SECRET = 'secret';
});

describe('dry run', () => {
  it('NEVER reaches the network', async () => {
    const result = await sendPushFanout({
      league: LEAGUE,
      category: 'column',
      notifications,
      dryRun: true,
      log: silent,
    });
    expect(result.skipped).toBe('dry-run');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does send when it is not a dry run', async () => {
    await sendPushFanout({ league: LEAGUE, category: 'column', notifications, log: silent });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('the request', () => {
  it('stamps the category on every notification', async () => {
    // The server filters per owner by category; a notification that arrives
    // without one is dropped there rather than delivered to someone who never
    // asked for it.
    await sendPushFanout({
      league: LEAGUE,
      category: 'rumor',
      notifications: [
        { franchiseId: '0001', title: 'a', body: 'b' },
        { franchiseId: '0002', title: 'c', body: 'd' },
      ],
      log: silent,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.notifications.every((n: { category: string }) => n.category === 'rumor')).toBe(true);
    expect(body.league).toBe('theleague');
  });

  it('authenticates with the cron secret', async () => {
    await sendPushFanout({ league: LEAGUE, category: 'column', notifications, log: silent });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer secret');
  });

  it('targets the league registry origin, not a hand-built URL', async () => {
    await sendPushFanout({ league: LEAGUE, category: 'column', notifications, log: silent });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://www.theleague.us/api/cron/push-fanout',
    );
  });

  it('requires a category', async () => {
    await expect(
      sendPushFanout({ league: LEAGUE, category: '', notifications, log: silent }),
    ).rejects.toThrow(/category/);
  });

  it('skips silently with no secret rather than failing the job', async () => {
    // Every caller has already done its real work by the time it pushes.
    delete process.env.CRON_SECRET;
    const result = await sendPushFanout({
      league: LEAGUE,
      category: 'column',
      notifications,
      log: silent,
    });
    expect(result.skipped).toBe('no secret');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when the network fails', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    const result = await sendPushFanout({
      league: LEAGUE,
      category: 'column',
      notifications,
      log: silent,
    });
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe('boom');
  });

  it('does nothing with an empty list', async () => {
    await sendPushFanout({ league: LEAGUE, category: 'column', notifications: [], log: silent });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('broadcast', () => {
  it('addresses one notification per franchise', () => {
    const out = broadcast({
      franchiseIds: ['0001', '0002'],
      title: 'T',
      body: 'B',
      url: '/news',
      tag: 'x',
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ franchiseId: '0001', title: 'T', body: 'B', url: '/news', tag: 'x' });
  });

  it('handles an empty or missing franchise list', () => {
    expect(broadcast({ franchiseIds: [] })).toEqual([]);
    expect(broadcast({})).toEqual([]);
  });
});
