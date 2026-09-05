import { describe, it, expect } from 'vitest';
import {
  subscriptionsKey,
  hashEndpoint,
  validateSubscription,
  selectSubscriptionsToEvict,
  MAX_SUBSCRIPTIONS_PER_FRANCHISE,
} from '../src/utils/push-subscriptions';
import { buildTradeOfferPayload, leaguePushIcon } from '../src/utils/push-notify-trade';

const VALID_SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123-def',
  keys: {
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=',
    auth: 'tBHItJI5svbpez7KI4CCXg==',
  },
};

describe('subscriptionsKey', () => {
  it('scopes by league AND franchise (overlapping franchise ids must not collide)', () => {
    const a = subscriptionsKey('11111', '0001');
    const b = subscriptionsKey('22222', '0001');
    expect(a).not.toBe(b);
    expect(a).toBe('push:subs:11111:0001');
  });
});

describe('hashEndpoint', () => {
  it('is deterministic and endpoint-specific', () => {
    expect(hashEndpoint('https://a.example/x')).toBe(hashEndpoint('https://a.example/x'));
    expect(hashEndpoint('https://a.example/x')).not.toBe(hashEndpoint('https://a.example/y'));
    expect(hashEndpoint('https://a.example/x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('validateSubscription', () => {
  it('accepts a well-formed browser subscription', () => {
    const result = validateSubscription(VALID_SUB);
    expect(result).toEqual(VALID_SUB);
  });

  it('drops extra fields the client sent', () => {
    const result = validateSubscription({
      ...VALID_SUB,
      expirationTime: null,
      evil: 'payload',
      keys: { ...VALID_SUB.keys, extra: 'x' },
    });
    expect(result).toEqual(VALID_SUB);
  });

  it('rejects non-object input', () => {
    expect(validateSubscription(null)).toBeNull();
    expect(validateSubscription('str')).toBeNull();
    expect(validateSubscription(42)).toBeNull();
    expect(validateSubscription(undefined)).toBeNull();
  });

  it('rejects missing or non-https endpoints', () => {
    expect(validateSubscription({ ...VALID_SUB, endpoint: '' })).toBeNull();
    expect(validateSubscription({ ...VALID_SUB, endpoint: 'http://insecure.example/x' })).toBeNull();
    expect(validateSubscription({ ...VALID_SUB, endpoint: 'not a url' })).toBeNull();
    expect(validateSubscription({ ...VALID_SUB, endpoint: 'javascript:alert(1)' })).toBeNull();
  });

  it('rejects oversized endpoints', () => {
    const endpoint = `https://a.example/${'x'.repeat(2050)}`;
    expect(validateSubscription({ ...VALID_SUB, endpoint })).toBeNull();
  });

  it('rejects missing or malformed keys', () => {
    expect(validateSubscription({ endpoint: VALID_SUB.endpoint })).toBeNull();
    expect(validateSubscription({ endpoint: VALID_SUB.endpoint, keys: {} })).toBeNull();
    expect(
      validateSubscription({
        endpoint: VALID_SUB.endpoint,
        keys: { p256dh: VALID_SUB.keys.p256dh, auth: '' },
      }),
    ).toBeNull();
    expect(
      validateSubscription({
        endpoint: VALID_SUB.endpoint,
        keys: { p256dh: 'has spaces !', auth: VALID_SUB.keys.auth },
      }),
    ).toBeNull();
  });

  it('accepts base64url-flavored keys (no padding, - and _)', () => {
    const result = validateSubscription({
      endpoint: VALID_SUB.endpoint,
      keys: { p256dh: 'BNcR-dre_ALRFXTkOOUHK1EtK2wtaz5Ry4Yf', auth: 'tBHItJI5svbpez7K' },
    });
    expect(result).not.toBeNull();
  });
});

describe('selectSubscriptionsToEvict', () => {
  it('returns nothing while under the cap', () => {
    const entries = [
      { field: 'a', createdAt: '2026-01-01T00:00:00Z' },
      { field: 'b', createdAt: '2026-02-01T00:00:00Z' },
    ];
    expect(selectSubscriptionsToEvict(entries, 8)).toEqual([]);
  });

  it('evicts exactly enough of the oldest to make room for one more', () => {
    const entries = Array.from({ length: 9 }, (_, i) => ({
      field: `f${i}`,
      createdAt: `2026-01-0${i + 1}T00:00:00Z`,
    }));
    // 9 stored + 1 incoming, cap 8 → evict the 2 oldest
    expect(selectSubscriptionsToEvict(entries, 8)).toEqual(['f0', 'f1']);
  });

  it('treats missing/bad timestamps as oldest', () => {
    const entries = [
      { field: 'good', createdAt: '2026-01-05T00:00:00Z' },
      { field: 'bad', createdAt: 'not-a-date' },
      { field: 'missing' },
    ];
    // 3 stored + 1 incoming, cap 2 → the two timestamp-less entries go first
    expect(selectSubscriptionsToEvict(entries, 2)).toEqual(['bad', 'missing']);
  });

  it('default cap matches the exported constant', () => {
    const entries = Array.from({ length: MAX_SUBSCRIPTIONS_PER_FRANCHISE }, (_, i) => ({
      field: `f${i}`,
      createdAt: `2026-01-01T00:00:0${Math.min(i, 9)}Z`,
    }));
    expect(selectSubscriptionsToEvict(entries)).toHaveLength(1);
  });
});

describe('buildTradeOfferPayload', () => {
  const base = { leagueSlug: 'theleague', leagueName: 'The League', navSlug: 'theleague' };

  it('names the proposing team when known', () => {
    const p = buildTradeOfferPayload({ ...base, fromTeamName: 'Pacific Pigskins' });
    expect(p.title).toBe('Trade offer from Pacific Pigskins');
    expect(p.body).toContain('Pacific Pigskins');
    expect(p.body).toContain('The League');
  });

  it('falls back gracefully when the team name is unknown', () => {
    const p = buildTradeOfferPayload({ ...base, fromTeamName: null });
    expect(p.title).toBe('New trade offer');
    expect(p.body).toContain('The League');
  });

  it('links to the league home (where TradeAlertModal pops) with a per-league collapse tag', () => {
    const p = buildTradeOfferPayload({ ...base, fromTeamName: 'X' });
    expect(p.url).toBe('/theleague');
    expect(p.tag).toBe('trade-offer-theleague');

    const afl = buildTradeOfferPayload({
      leagueSlug: 'afl-fantasy',
      leagueName: 'AFL',
      navSlug: 'afl',
      fromTeamName: null,
    });
    expect(afl.url).toBe('/afl-fantasy');
    expect(afl.tag).toBe('trade-offer-afl-fantasy');
  });

  it('uses the per-league notification icon', () => {
    expect(buildTradeOfferPayload({ ...base, fromTeamName: null }).icon).toBe(leaguePushIcon('theleague'));
    expect(leaguePushIcon('afl')).not.toBe(leaguePushIcon('theleague'));
  });
});
