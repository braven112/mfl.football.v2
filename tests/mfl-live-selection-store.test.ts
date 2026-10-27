/**
 * MFL Live's league selection, stored per account so the phone app and the
 * web board agree (`src/utils/mfl-live-selection-store.ts`,
 * `src/pages/api/live-leagues.ts`).
 *
 * What these pin:
 *  - the key is the hashed MFL username, never a franchise (both registry
 *    leagues have a franchise 0001) and never `user.id` (the MFL cookie);
 *  - the account beats the cookie, and a cookie with nothing stored is copied
 *    up once, without overwriting a newer save;
 *  - the app's `{ league, enabled }` toggle applies the same rules the web
 *    island does, keeps Sleeper choices it never lists, and refuses the last.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '../src/utils/session';
import { LEAGUES } from '../src/config/leagues';
import type { BoardLeague } from '../src/utils/sunday-ticket-selection';

const store = new Map<string, unknown>();
let redisAvailable = true;

vi.mock('../src/utils/redis-client', () => ({
  getRedis: async () =>
    redisAvailable
      ? {
          get: async (k: string) => store.get(k) ?? null,
          set: async (k: string, v: unknown, opts?: { nx?: boolean }) => {
            if (opts?.nx && store.has(k)) return null;
            store.set(k, v);
            return 'OK';
          },
        }
      : null,
}));

const league = (id: string, name: string, provider?: 'sleeper'): BoardLeague => ({
  id,
  name,
  franchiseId: '0001',
  franchiseName: `${name} team`,
  registered: null,
  host: null,
  isSession: false,
  ...(provider ? { provider } : {}),
});

let mflLeagues: BoardLeague[] = [];
let sleeperLeagues: BoardLeague[] = [];
vi.mock('../src/utils/cross-league-live', () => ({
  discoverBoardLeagues: async () => mflLeagues,
}));
vi.mock('../src/utils/sleeper/live', () => ({
  discoverSleeperBoardLeagues: async () => sleeperLeagues,
}));
vi.mock('../src/utils/sleeper/link', async (orig) => ({
  ...(await orig<typeof import('../src/utils/sleeper/link')>()),
  getSleeperLink: async () => null,
}));

import { GET, POST } from '../src/pages/api/live-leagues';
import {
  mflLiveLeagueChoices,
  mflLiveSelectionKey,
  normalizeMflLiveSelection,
  readMflLiveSelection,
  saveMflLiveSelection,
} from '../src/utils/mfl-live-selection-store';
import { MFL_LIVE_LEAGUE_COOKIE } from '../src/utils/mfl-live-selection';

const OWNER = { name: 'Owner' };

function token(username = 'Owner') {
  return createSessionToken({
    userId: 'mfl-cookie-value',
    username,
    franchiseId: '0001',
    leagueId: LEAGUES.theleague.id,
    role: 'owner',
  });
}

function jar(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(MFL_LIVE_LEAGUE_COOKIE, initial);
  return {
    values,
    get: (n: string) => (values.has(n) ? { value: values.get(n)! } : undefined),
    set: (n: string, v: string) => void values.set(n, v),
  };
}

function call(
  handler: typeof GET,
  init: { body?: unknown; bearer?: boolean; cookie?: string; method?: string } = {},
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.bearer !== false) headers.Authorization = `Bearer ${token()}`;
  const cookies = jar(init.cookie);
  const request = new Request('https://mfl.football/api/live-leagues', {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { cookies, res: handler({ request, cookies } as never) as Promise<Response> };
}

beforeEach(() => {
  store.clear();
  redisAvailable = true;
  mflLeagues = [league('11111', 'Alpha'), league('22222', 'Bravo'), league('33333', 'Charlie')];
  sleeperLeagues = [];
});

describe('the key', () => {
  it('is the hashed, case-folded MFL username — never a franchise or the MFL cookie', () => {
    const key = mflLiveSelectionKey({ name: 'Owner' })!;
    expect(key).toMatch(/^live:leagues:[0-9a-f]{32}$/);
    expect(mflLiveSelectionKey({ name: '  OWNER ' })).toBe(key);
    expect(key).not.toContain('0001');
    expect(key).not.toContain('mfl-cookie-value');
    expect(mflLiveSelectionKey({ name: '' })).toBeNull();
  });
});

describe('normalizeMflLiveSelection', () => {
  it('keeps a clean id list, maps empty to default, and rejects junk', () => {
    expect(normalizeMflLiveSelection(' 1, 2 ,2 ')).toBe('1,2');
    expect(normalizeMflLiveSelection('')).toBe('default');
    expect(normalizeMflLiveSelection('all')).toBe('default');
    expect(normalizeMflLiveSelection('sl-1048313518937051136')).toBe('sl-1048313518937051136');
    expect(normalizeMflLiveSelection('a;b')).toBeNull();
    expect(normalizeMflLiveSelection(Array.from({ length: 41 }, (_, i) => `${i}`).join(','))).toBeNull();
    expect(normalizeMflLiveSelection(42)).toBeNull();
  });
});

describe('readMflLiveSelection', () => {
  it('the account beats the cookie', async () => {
    await saveMflLiveSelection(OWNER, '11111');
    expect(await readMflLiveSelection(OWNER, '22222')).toBe('11111');
  });

  it('stores an object, so one numeric id is never read back as a number', async () => {
    await saveMflLiveSelection(OWNER, '11111');
    expect(store.get(mflLiveSelectionKey(OWNER)!)).toMatchObject({ leagues: '11111' });
  });

  it('with nothing stored, answers with the cookie and copies it up once', async () => {
    expect(await readMflLiveSelection(OWNER, '22222')).toBe('22222');
    expect(await readMflLiveSelection(OWNER, null)).toBe('22222');
  });

  it('the copy-up never overwrites a save that got there first', async () => {
    await saveMflLiveSelection(OWNER, '33333');
    await readMflLiveSelection({ name: 'owner' }, '22222');
    expect(await readMflLiveSelection(OWNER, null)).toBe('33333');
  });

  it('Redis down → the cookie, exactly as before', async () => {
    redisAvailable = false;
    expect(await readMflLiveSelection(OWNER, '22222')).toBe('22222');
    expect(await saveMflLiveSelection(OWNER, '11111')).toBe(false);
  });

  it('no user (a paired TV) → the cookie alone', async () => {
    await saveMflLiveSelection(OWNER, '11111');
    expect(await readMflLiveSelection(null, '22222')).toBe('22222');
  });
});

describe('mflLiveLeagueChoices', () => {
  it('lists MFL leagues only, and locks only the last league on across every provider', () => {
    const all = [league('11111', 'Alpha'), league('sl-9', 'Sleepy', 'sleeper')];
    expect(mflLiveLeagueChoices(all, ['11111']).map((c) => [c.id, c.enabled, c.locked])).toEqual([
      ['11111', true, true],
    ]);
    // A Sleeper league still on means the MFL one is not the last.
    expect(mflLiveLeagueChoices(all, ['11111', 'sl-9'])[0].locked).toBe(false);
  });
});

describe('GET /api/live-leagues', () => {
  it('401s without a session', async () => {
    const { res } = call(GET, { bearer: false });
    expect((await res).status).toBe(401);
  });

  it('accepts the app’s Bearer sign-in and starts with everything on', async () => {
    const body = await (await call(GET).res).json();
    expect(body).toMatchObject({ ok: true, explicit: false });
    expect(body.leagues.map((l: { enabled: boolean }) => l.enabled)).toEqual([true, true, true]);
  });

  it('reads the choice the web saved for the same account', async () => {
    await saveMflLiveSelection(OWNER, '22222');
    const body = await (await call(GET).res).json();
    expect(body.explicit).toBe(true);
    expect(body.leagues.map((l: { id: string; enabled: boolean; locked: boolean }) => [l.id, l.enabled, l.locked])).toEqual([
      ['11111', false, false],
      ['22222', true, true],
      ['33333', false, false],
    ]);
  });

  it('never lists a Sleeper league', async () => {
    sleeperLeagues = [league('sl-9', 'Sleepy', 'sleeper')];
    const body = await (await call(GET).res).json();
    expect(body.leagues.map((l: { id: string }) => l.id)).not.toContain('sl-9');
  });
});

describe('POST /api/live-leagues — the app’s toggle', () => {
  it('switches one league off and saves it for the account', async () => {
    const body = await (await call(POST, { body: { league: '22222', enabled: false } }).res).json();
    expect(body.ok).toBe(true);
    expect(await readMflLiveSelection(OWNER, null)).toBe('11111,33333');
  });

  it('switching the last one back on collapses to "default", so new leagues appear by themselves', async () => {
    await saveMflLiveSelection(OWNER, '11111,33333');
    const body = await (await call(POST, { body: { league: '22222', enabled: true } }).res).json();
    expect(body.explicit).toBe(false);
    expect(await readMflLiveSelection(OWNER, null)).toBe('default');
  });

  it('refuses to switch off the last league on', async () => {
    await saveMflLiveSelection(OWNER, '22222');
    const res = await call(POST, { body: { league: '22222', enabled: false } }).res;
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('last-league');
    expect(await readMflLiveSelection(OWNER, null)).toBe('22222');
  });

  it('keeps the Sleeper leagues the web switched on', async () => {
    sleeperLeagues = [league('sl-9', 'Sleepy', 'sleeper')];
    await call(POST, { body: { league: '11111', enabled: false } }).res;
    expect(await readMflLiveSelection(OWNER, null)).toBe('22222,33333,sl-9');
  });

  it('a repeated tap is a no-op, not an error', async () => {
    const res = await call(POST, { body: { league: '11111', enabled: true } }).res;
    expect(res.status).toBe(200);
    expect(store.size).toBe(0);
  });

  it('refuses a league that is not the owner’s, or a Sleeper one', async () => {
    sleeperLeagues = [league('sl-9', 'Sleepy', 'sleeper')];
    for (const id of ['99999', 'sl-9']) {
      const res = await call(POST, { body: { league: id, enabled: false } }).res;
      expect(res.status).toBe(400);
      expect((await res.json()).reason).toBe('unknown-league');
    }
  });

  it('tells the app when the save failed', async () => {
    redisAvailable = false;
    const res = await call(POST, { body: { league: '11111', enabled: false } }).res;
    expect(res.status).toBe(503);
  });
});

describe('POST /api/live-leagues — the settings island', () => {
  it('writes the cookie and the account', async () => {
    const { cookies, res } = call(POST, { body: { leagues: '11111,22222' } });
    expect(await (await res).json()).toMatchObject({ ok: true, saved: true });
    expect(cookies.values.get(MFL_LIVE_LEAGUE_COOKIE)).toBe('11111,22222');
    expect(await readMflLiveSelection(OWNER, null)).toBe('11111,22222');
  });

  it('still writes the cookie when Redis is down, so the web never loses a toggle', async () => {
    redisAvailable = false;
    const { cookies, res } = call(POST, { body: { leagues: '11111' } });
    expect(await (await res).json()).toMatchObject({ ok: true, saved: false });
    expect(cookies.values.get(MFL_LIVE_LEAGUE_COOKIE)).toBe('11111');
  });

  it('rejects junk', async () => {
    const res = await call(POST, { body: { leagues: 'a;b' } }).res;
    expect(res.status).toBe(400);
  });
});
