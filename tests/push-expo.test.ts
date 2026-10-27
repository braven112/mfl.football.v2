/**
 * Native push for the MFL Live app (src/utils/push-expo.ts) and its two
 * endpoints. The app signs in with Bearer, so both endpoints must read
 * `getMflLiveUser` — `getAuthUser` would refuse every request the app makes.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  accountTokensKey,
  leagueIndexKey,
  indexFields,
  accountsForFranchise,
  pushAccountKey,
  validateExpoToken,
  validatePlatform,
  buildExpoMessages,
  readExpoTickets,
  sendExpoMessages,
  EXPO_CHANNELS,
  EXPO_PUSH_BATCH,
  EXPO_PUSH_SEND_URL,
} from '../src/utils/push-expo';
import { NOTIFICATION_GROUPS } from '../src/config/notification-categories';

const ROOT = join(__dirname, '..');
const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

describe('storage keys', () => {
  it('keys a phone by account, never by the MFL cookie', () => {
    const account = pushAccountKey({ name: 'Brandon' })!;
    expect(account).toBe(pushAccountKey({ name: ' brandon ' }));
    expect(account).toMatch(/^[0-9a-f]{32}$/);
    expect(accountTokensKey(account)).toBe(`push:expo:acct:${account}`);
    expect(pushAccountKey({ name: '' })).toBeNull();
  });

  it('indexes teams per league — every league has a 0001', () => {
    expect(leagueIndexKey('11111')).not.toBe(leagueIndexKey('22222'));
    expect(indexFields('acct', [{ franchiseId: '0001' }, { franchiseId: '0001' }, { franchiseId: '' }])).toEqual(['0001:acct']);
  });

  it('finds every account holding a franchise, and only that franchise', () => {
    const index = { '0001:a': 'a', '0001:b': 'b', '0010:c': 'c', '00010:d': 'd' };
    expect(accountsForFranchise(index, '0001').sort()).toEqual(['a', 'b']);
    expect(accountsForFranchise(index, '0010')).toEqual(['c']);
  });

  it('never shares a key with browser subscriptions', () => {
    expect(leagueIndexKey('11111').startsWith('push:subs:')).toBe(false);
  });
});

describe('validateExpoToken', () => {
  it('accepts both Expo token spellings, trimmed', () => {
    expect(validateExpoToken(` ${TOKEN} `)).toBe(TOKEN);
    expect(validateExpoToken('ExpoPushToken[abcdefgh12345678]')).toBe('ExpoPushToken[abcdefgh12345678]');
  });

  it('refuses anything else', () => {
    for (const bad of [null, 42, '', 'ExponentPushToken[]', 'ExponentPushToken[a b c d e f]', 'https://fcm.googleapis.com/x', `${TOKEN}x`]) {
      expect(validateExpoToken(bad)).toBeNull();
    }
  });
});

describe('validatePlatform', () => {
  it('knows android and ios only', () => {
    expect(validatePlatform('android')).toBe('android');
    expect(validatePlatform('ios')).toBe('ios');
    expect(validatePlatform('web')).toBeNull();
  });
});

describe('Android channels', () => {
  it('has one channel per settings group', () => {
    expect([...EXPO_CHANNELS].sort()).toEqual(NOTIFICATION_GROUPS.map((g) => g.id).sort());
  });
});

describe('buildExpoMessages', () => {
  it('routes each category to its group channel and carries the link', () => {
    const [m] = buildExpoMessages([TOKEN], { title: 'Final', body: 'You won', url: '/live', tag: 't' }, 'scoring-final', '13522');
    expect(m).toMatchObject({
      to: TOKEN,
      title: 'Final',
      body: 'You won',
      channelId: 'live',
      priority: 'high',
      data: { category: 'scoring-final', leagueId: '13522', url: '/live', tag: 't' },
    });
  });

  it('sends league news at normal priority', () => {
    const [m] = buildExpoMessages([TOKEN], { title: 'a', body: 'b' }, 'column', '1');
    expect(m.channelId).toBe('league-news');
    expect(m.priority).toBe('default');
    expect(m.data.url).toBeUndefined();
  });
});

describe('readExpoTickets', () => {
  const messages = buildExpoMessages(['ExponentPushToken[aaaaaaaa]', 'ExponentPushToken[bbbbbbbb]', 'ExponentPushToken[cccccccc]'], { title: 'a', body: 'b' }, 'trade-offer', '1');

  it('counts ok tickets, and marks only DeviceNotRegistered tokens dead', () => {
    const r = readExpoTickets(messages, {
      data: [
        { status: 'ok', id: '1' },
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', details: { error: 'MessageRateExceeded' } },
      ],
    });
    expect(r).toEqual({ sent: 1, failed: 1, deadTokens: ['ExponentPushToken[bbbbbbbb]'] });
  });

  it('treats a malformed response as all failed, pruning nothing', () => {
    expect(readExpoTickets(messages, { errors: [{}] })).toEqual({ sent: 0, failed: 3, deadTokens: [] });
  });
});

describe('sendExpoMessages', () => {
  it('batches at 100 and never throws', async () => {
    const tokens = Array.from({ length: EXPO_PUSH_BATCH + 1 }, (_, i) => `ExponentPushToken[token${String(i).padStart(4, '0')}]`);
    const messages = buildExpoMessages(tokens, { title: 'a', body: 'b' }, 'trade-offer', '1');
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const batch = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ data: batch.map(() => ({ status: 'ok' })) }));
      })
      .mockImplementationOnce(async () => {
        throw new Error('network');
      });
    const r = await sendExpoMessages(messages, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(EXPO_PUSH_SEND_URL);
    expect(r).toEqual({ sent: EXPO_PUSH_BATCH, failed: 1, deadTokens: [] });
  });
});

describe('the app push endpoints', () => {
  for (const file of ['expo-register.ts', 'expo-test.ts']) {
    it(`${file} reads the Bearer session through getMflLiveUser`, () => {
      const src = readFileSync(join(ROOT, 'src/pages/api/push', file), 'utf8');
      expect(src).toMatch(/getMflLiveUser\(request\)/);
      expect(src).not.toMatch(/getAuthUser/);
      // Identity comes from the session, never the body.
      expect(src).not.toMatch(/body\??\.(franchiseId|leagueId|account)/);
      // The MFL cookie is a credential: it is never the storage key.
      expect(src).not.toMatch(/saveExpoToken\(user\.id/);
    });
  }

  it('app push goes through the one send door that checks preferences', () => {
    const sender = readFileSync(join(ROOT, 'src/utils/push-sender.ts'), 'utf8');
    expect(sender).toMatch(/sendAppPush\(/);
    const test = readFileSync(join(ROOT, 'src/pages/api/push/expo-test.ts'), 'utf8');
    expect(test).toMatch(/sendPushToFranchise\(/);
    expect(test).not.toMatch(/sendExpoMessages/);
  });
});
