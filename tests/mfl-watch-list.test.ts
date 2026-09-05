/**
 * My Watch List — MFL read/write layer.
 *
 * The watch list import is INCREMENTAL (ADD/REMOVE) and the export shape is
 * unconfirmed live, so these cases pin: every plausible export shape reads
 * to the same set, an unrecognized shape is a failed read rather than an
 * empty list, and a write carries exactly the ADD/REMOVE MFL expects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mflFetch = vi.fn();
vi.mock('../src/utils/mfl-fetch', () => ({
  mflFetch: (...args: unknown[]) => mflFetch(...args),
}));

import {
  extractWatchListIds,
  normalizeWatchIds,
  pullWatchList,
  updateWatchList,
} from '../src/utils/mfl-watch-list';
import { LEAGUES } from '../src/config/leagues';

const league = LEAGUES['afl-fantasy'];
const base = { league, year: 2026, mflUserCookie: 'cookie-value' };

const respond = (body: string, status = 200) =>
  mflFetch.mockResolvedValueOnce(new Response(body, { status }));

beforeEach(() => mflFetch.mockReset());

describe('normalizeWatchIds', () => {
  it('dedupes, drops junk, and sorts numerically', () => {
    expect(normalizeWatchIds(['17634', 14836, '17634', 'abc', '', null, ' 9999 ']))
      .toEqual(['9999', '14836', '17634']);
  });
});

describe('extractWatchListIds', () => {
  it('reads the array shape', () => {
    expect(extractWatchListIds({ myWatchList: { player: [{ id: '17634' }, { id: '14836' }] } }))
      .toEqual(['14836', '17634']);
  });

  it('reads a one-player list emitted as a bare object', () => {
    expect(extractWatchListIds({ myWatchList: { player: { id: '17634' } } })).toEqual(['17634']);
  });

  it('reads a players wrapper, bare strings, and a comma string', () => {
    expect(extractWatchListIds({ myWatchList: { players: { player: ['1', '2'] } } })).toEqual(['1', '2']);
    expect(extractWatchListIds({ myWatchList: { player: ['3', '4'] } })).toEqual(['3', '4']);
    expect(extractWatchListIds({ myWatchList: { player: '5,6' } })).toEqual(['5', '6']);
  });

  it('treats a list object with no player key as empty', () => {
    expect(extractWatchListIds({ myWatchList: {} })).toEqual([]);
  });

  it('rejects a payload with no list at all', () => {
    expect(extractWatchListIds({ something: 1 })).toBeNull();
    expect(extractWatchListIds(null)).toBeNull();
  });
});

describe('pullWatchList', () => {
  it('returns the ids on a clean read', async () => {
    respond('{"myWatchList":{"player":[{"id":"17634"},{"id":"14836"}]}}');
    await expect(pullWatchList(base)).resolves.toEqual({ ok: true, playerIds: ['14836', '17634'] });
    expect(mflFetch.mock.calls[0][0].url).toContain('TYPE=myWatchList');
    expect(mflFetch.mock.calls[0][0].url).toContain(`L=${league.id}`);
    expect(mflFetch.mock.calls[0][0].url).toContain('JSON=1');
  });

  it('separates an empty list from a failed read', async () => {
    respond('{"myWatchList":{}}');
    await expect(pullWatchList(base)).resolves.toEqual({ ok: true, playerIds: [] });

    respond('{"error":{"$t":"API requires logged in user"}}');
    const failed = await pullWatchList(base);
    expect(failed.ok).toBe(false);
    expect(failed.playerIds).toEqual([]);
    expect(failed.error).toMatch(/logged in/);
  });

  it('reports an unrecognized shape as a failure, not as nothing watched', async () => {
    respond('{"somethingElse":{"player":[{"id":"1"}]}}');
    const res = await pullWatchList(base);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/shape/);
  });
});

describe('updateWatchList', () => {
  it('sends ADD and REMOVE in the body, TYPE/L in the query, to the league host', async () => {
    respond('<status>OK</status>');
    await expect(updateWatchList({ ...base, add: ['17634'], remove: ['14836', '9'] })).resolves.toEqual({ ok: true });
    const call = mflFetch.mock.calls[0][0];
    expect(call.method).toBe('POST');
    expect(call.url).toContain(league.mflHost);
    expect(call.url).not.toContain('api.myfantasyleague.com');
    expect(call.url).toContain('TYPE=myWatchList');
    expect(decodeURIComponent(call.body)).toBe('ADD=17634&REMOVE=9,14836');
  });

  it('omits an empty side and no-ops when both are empty', async () => {
    respond('<status>OK</status>');
    await updateWatchList({ ...base, add: ['1'] });
    expect(decodeURIComponent(mflFetch.mock.calls[0][0].body)).toBe('ADD=1');

    await expect(updateWatchList({ ...base, add: [], remove: [] })).resolves.toEqual({ ok: true });
    expect(mflFetch).toHaveBeenCalledTimes(1);
  });

  it('an id in both lists is an add', async () => {
    respond('<status>OK</status>');
    await updateWatchList({ ...base, add: ['1'], remove: ['1'] });
    expect(decodeURIComponent(mflFetch.mock.calls[0][0].body)).toBe('ADD=1');
  });

  it('reads an XML error out of a 200', async () => {
    respond('<?xml version="1.0"?><error>API requires a logged in user</error>');
    await expect(updateWatchList({ ...base, add: ['1'] })).resolves.toMatchObject({ ok: false, error: /logged in/ });
  });

  it('treats a non-2xx as a failure whatever the body says', async () => {
    respond('Bad Gateway', 502);
    const res = await updateWatchList({ ...base, add: ['1'] });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('502');
  });
});
