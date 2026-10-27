import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GROUPME_COOKIE_PATH,
  GROUPME_OAUTH_CLIENT_ID,
  GROUPME_SIGN_IN_ORIGIN,
  groupMeAuthorizeUrl,
  isWellFormedState,
} from '../src/utils/live/groupme-owner-auth';
import { buildGroupMeChatView } from '../src/utils/live/league-groupme-chat';

const { GET: start } = await import('../src/pages/api/mfl-live/groupme/start');
const { GET: callback } = await import('../src/pages/api/mfl-live/groupme/callback');

describe('the GroupMe sign-in lives where our GroupMe application says', () => {
  it('callback is https://mfl.football/api/mfl-live/groupme/callback, not v2', () => {
    expect(`${GROUPME_SIGN_IN_ORIGIN}${GROUPME_COOKIE_PATH}/callback`).toBe(
      'https://mfl.football/api/mfl-live/groupme/callback',
    );
    expect(existsSync(join(__dirname, '../src/pages/api/mfl-live/groupme/callback.ts'))).toBe(true);
    expect(existsSync(join(__dirname, '../src/pages/api/mfl-live/groupme/start.ts'))).toBe(true);
  });

  it('sends the browser to GroupMe with our client id', () => {
    expect(groupMeAuthorizeUrl()).toBe(
      `https://oauth.groupme.com/oauth/authorize?client_id=${GROUPME_OAUTH_CLIENT_ID}`,
    );
  });
});

describe('the one-time state', () => {
  it('is 32 lower-case hex characters and nothing else', () => {
    expect(isWellFormedState('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isWellFormedState('0123456789ABCDEF0123456789abcdef')).toBe(false);
    expect(isWellFormedState('abc')).toBe(false);
    expect(isWellFormedState(undefined)).toBe(false);
  });
});

const ctx = (url: string, cookie?: string) =>
  ({
    url: new URL(url),
    request: new Request(url),
    cookies: { get: (name: string) => (cookie && name === 'mfl_gm_state' ? { value: cookie } : undefined) },
  }) as any;

describe('the browser routes never act without a live state', () => {
  it('start refuses a missing or unknown state, and never redirects to GroupMe', async () => {
    const a = await start(ctx('https://mfl.football/api/mfl-live/groupme/start'));
    const b = await start(ctx('https://mfl.football/api/mfl-live/groupme/start?s=0123456789abcdef0123456789abcdef'));
    for (const res of [a, b]) {
      expect(res.status).toBe(400);
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('callback with no state cookie stores nothing, whatever token it is handed', async () => {
    const res = await callback(ctx('https://mfl.football/api/mfl-live/groupme/callback?access_token=abcdefghijklmnop'));
    expect(res.status).toBe(400);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await res.text()).not.toContain('abcdefghijklmnop');
  });
});

describe('once signed in, your own GroupMe messages are yours', () => {
  it('marks the signed-in GroupMe user as mine', () => {
    const base = {
      group_id: 'g',
      avatar_url: null,
      created_at: 1_761_590_000,
      sender_type: 'user' as const,
      favorited_by: [],
      attachments: [],
      text: 'hi',
    };
    const view = buildGroupMeChatView(
      [
        { ...base, id: '1', user_id: 'me', name: 'Brandon' },
        { ...base, id: '2', user_id: 'other', name: 'Todd' },
      ],
      '0001',
      {},
      'me',
    );
    expect(view.map((m) => m.mine)).toEqual([true, false]);
  });
});
