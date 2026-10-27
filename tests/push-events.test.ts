/**
 * League events → alerts (src/utils/push-events.ts), the app defaults in the
 * category registry, the outside-league door in push-sender.ts, and the
 * encrypted MFL sign-in the one-minute checker reads with.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, unknown>();
const hashes = new Map<string, Map<string, unknown>>();

vi.mock('../src/utils/redis-client', () => ({
  getRedis: async () => ({
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    },
    del: async (k: string) => (store.delete(k) ? 1 : 0),
    hgetall: async (k: string) => {
      const h = hashes.get(k);
      return h ? Object.fromEntries(h) : null;
    },
    hset: async (k: string, fv: Record<string, unknown>) => {
      const h = hashes.get(k) ?? new Map();
      for (const [f, v] of Object.entries(fv)) h.set(f, v);
      hashes.set(k, h);
      return 1;
    },
    hdel: async (k: string, ...fields: string[]) => {
      for (const f of fields) hashes.get(k)?.delete(f);
      return 1;
    },
    hlen: async (k: string) => hashes.get(k)?.size ?? 0,
  }),
}));

const sendNotification = vi.fn(async () => undefined);
vi.mock('web-push', () => ({
  default: { sendNotification: (...a: unknown[]) => sendNotification(...(a as [])) },
}));

import { alertsFor, eventKey, notifyLeagueEvent } from '../src/utils/push-events';
import { saveExpoToken, indexAccountTeams } from '../src/utils/push-expo';
import { subscriptionsKey } from '../src/utils/push-subscriptions';
import { isCategoryEnabled, getNotificationCategory } from '../src/config/notification-categories';
import { encryptionKey, seal, unseal, saveCredential, readCredential, credentialKey } from '../src/utils/push-credentials';
import { LEAGUES } from '../src/config/leagues';

const OUTSIDE = '987654';
const THELEAGUE = LEAGUES.theleague;
const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
  const batch = JSON.parse(init.body as string) as unknown[];
  return new Response(JSON.stringify({ data: batch.map(() => ({ status: 'ok' })) }));
});

async function phone(account: string, leagueId: string, franchiseId: string, n: string) {
  await saveExpoToken(account, `ExponentPushToken[${n.padEnd(10, 'x')}]`, 'android');
  await indexAccountTeams(account, [{ leagueId, franchiseId }]);
}

function sentTo(): string[] {
  return fetchSpy.mock.calls.flatMap(([, init]) =>
    (JSON.parse((init as RequestInit).body as string) as Array<{ to: string }>).map((m) => m.to),
  );
}

beforeEach(() => {
  store.clear();
  hashes.clear();
  fetchSpy.mockClear();
  sendNotification.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
  process.env.VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
  process.env.JWT_SECRET = 'push-events-test';
  delete process.env.PUSH_CREDENTIAL_KEY;
});

describe('alertsFor', () => {
  it('sends chat to everyone but the sender, clipped, one notification per league', () => {
    const alerts = alertsFor({
      kind: 'chat', leagueId: OUTSIDE, key: 'm1', fromFranchiseId: '0001', fromName: 'Pigskins',
      text: 'x'.repeat(300), franchiseIds: ['0001', '0002', '0003', '0002'],
    });
    expect(alerts.map((a) => a.franchiseId)).toEqual(['0002', '0003']);
    expect(alerts[0].category).toBe('league-chat');
    expect(alerts[0].payload.body.length).toBeLessThanOrEqual(140);
    expect(alerts[0].payload.tag).toBe(`chat-${OUTSIDE}`);
  });

  it('tells only the owner a trade or pick is about', () => {
    expect(alertsFor({ kind: 'trade-offer', leagueId: OUTSIDE, key: 't', fromFranchiseId: '0001', toFranchiseId: '0004', fromName: 'A' })
      .map((a) => [a.franchiseId, a.category])).toEqual([['0004', 'trade-offer']]);
    expect(alertsFor({ kind: 'draft-on-clock', leagueId: OUTSIDE, franchiseId: '0007', overall: 13, round: 2, pick: 1 })[0])
      .toMatchObject({ franchiseId: '0007', category: 'draft-on-clock', payload: { title: "You're on the clock" } });
  });

  it('words waiver results, and says nothing about an empty run', () => {
    expect(alertsFor({ kind: 'waiver-result', leagueId: OUTSIDE, key: 'w', franchiseId: '0002', added: ['A', 'B', 'C'] })[0].payload.body)
      .toBe('You got A, B and C.');
    expect(alertsFor({ kind: 'waiver-result', leagueId: OUTSIDE, key: 'w', franchiseId: '0002', added: [] })).toEqual([]);
  });

  it('keys an event the same way for both callers', () => {
    expect(eventKey({ kind: 'draft-on-clock', leagueId: '1', franchiseId: '0001', overall: 5, round: 1, pick: 5 })).toBe('draft-on-clock:5');
    // A league drafting on two boards counts overall from 1 on each.
    expect(eventKey({ kind: 'draft-on-clock', leagueId: '1', franchiseId: '0001', overall: 5, round: 1, pick: 5, unit: 'CONFERENCE01' })).toBe('draft-on-clock:CONFERENCE01:5');
    expect(eventKey({ kind: 'trade-accepted', leagueId: '1', key: '99', toFranchiseId: '0001', fromName: 'x' })).toBe('trade-accepted:99');
  });
});

describe('app defaults', () => {
  it('turns the launch-gate alerts on for the app only', () => {
    for (const id of ['trade-accepted', 'waiver-result', 'league-chat', 'draft-on-clock']) {
      expect(getNotificationCategory(id), id).not.toBeNull();
      expect(isCategoryEnabled(id, {}, THELEAGUE, {}, 'app'), id).toBe(true);
      expect(isCategoryEnabled(id, {}, THELEAGUE, {}, 'web'), id).toBe(false);
    }
  });

  it('keeps the site\'s defaults for alerts the site already sent (owner, 2026-10-27)', () => {
    for (const id of ['scoring-final', 'scoring-swing', 'article']) {
      expect(isCategoryEnabled(id, {}, THELEAGUE, {}, 'app'), id).toBe(false);
    }
    expect(isCategoryEnabled('trade-offer', {}, THELEAGUE, {}, 'app')).toBe(true);
  });

  it("lets an owner's explicit choice win on both", () => {
    expect(isCategoryEnabled('league-chat', { 'league-chat': false }, THELEAGUE, {}, 'app')).toBe(false);
    expect(isCategoryEnabled('league-chat', { 'league-chat': true }, THELEAGUE, {}, 'web')).toBe(true);
  });
});

describe('notifyLeagueEvent', () => {
  it('reaches app owners in a league this site does not run, once per event', async () => {
    await phone('acctA', OUTSIDE, '0001', 'a');
    await phone('acctB', OUTSIDE, '0002', 'b');
    const event = {
      kind: 'chat' as const, leagueId: OUTSIDE, key: 'm1', fromFranchiseId: '0001', fromName: 'A',
      text: 'hi', franchiseIds: ['0001', '0002'],
    };
    expect(await notifyLeagueEvent(event)).toBe(1);
    expect(sentTo()).toEqual(['ExponentPushToken[bxxxxxxxxx]']);
    // The checker sees the same message a minute later: no second alert.
    expect(await notifyLeagueEvent(event)).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('never sends a feature-gated or admin alert to an outside league', async () => {
    await phone('acctA', OUTSIDE, '0001', 'a');
    const { sendPushToFranchise } = await import('../src/utils/push-sender');
    for (const category of ['lineup-deadline', 'ops-job-failure', 'rumor']) {
      const r = await sendPushToFranchise(OUTSIDE, '0001', { title: 't', body: 'b' }, category);
      expect(r.total, category).toBe(0);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('in our leagues, sends each transport only what its default allows', async () => {
    await phone('acctT', THELEAGUE.id, '0003', 't');
    hashes.set(subscriptionsKey(THELEAGUE.id, '0003'), new Map([[
      'f',
      JSON.stringify({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ', auth: 'tBHItJI5svbpez7KI4CCXg==' } }),
    ]]));
    await notifyLeagueEvent({ kind: 'trade-accepted', leagueId: THELEAGUE.id, key: 'x1', toFranchiseId: '0003', fromName: 'A' });
    expect(sentTo()).toEqual(['ExponentPushToken[txxxxxxxxx]']);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe('the stored MFL sign-in', () => {
  it('round-trips, and is never stored in the clear', async () => {
    expect(await saveCredential('acct', 'MFL-COOKIE-VALUE')).toBe(true);
    expect(String(store.get(credentialKey('acct')))).not.toContain('MFL-COOKIE-VALUE');
    expect(await readCredential('acct')).toBe('MFL-COOKIE-VALUE');
  });

  it('refuses a tampered value or another key', () => {
    const key = encryptionKey()!;
    const sealed = seal('secret', key);
    expect(unseal({ ...sealed, ct: Buffer.from('nope').toString('base64') }, key)).toBeNull();
    expect(unseal(sealed, encryptionKey({ JWT_SECRET: 'other' } as NodeJS.ProcessEnv)!)).toBeNull();
    expect(unseal('not json', key)).toBeNull();
  });

  it('stores nothing when the server has no secret', () => {
    expect(encryptionKey({} as NodeJS.ProcessEnv)).toBeNull();
  });
});
