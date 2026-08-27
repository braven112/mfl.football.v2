/**
 * My Draft List — MFL read/write layer.
 *
 * Each case here is one of the live findings from 2026-08-27 (written up in
 * docs/claude/insights/domains/mfl-api.md). They are the failure modes that
 * would otherwise be invisible: MFL answers errors with HTTP 200, its import
 * replies in XML while its export replies in JSON, its one-player list is an
 * object rather than an array, and its write erases the board it replaces.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mflFetch = vi.fn();
vi.mock('../src/utils/mfl-fetch', () => ({
  mflFetch: (...args: unknown[]) => mflFetch(...args),
}));

import {
  parseMflError,
  normalizePlayerIds,
  pullDraftList,
  pushDraftList,
} from '../src/utils/mfl-draft-list';
import { LEAGUES } from '../src/config/leagues';

const league = LEAGUES['afl-fantasy'];
const base = { league, year: 2026, mflUserCookie: 'cookie-value' };

const respond = (body: string, status = 200) =>
  mflFetch.mockResolvedValueOnce(new Response(body, { status }));

beforeEach(() => mflFetch.mockReset());

describe('parseMflError', () => {
  it('reads an export-style JSON error', () => {
    expect(parseMflError('{"error":{"$t":"Must be logged in as an owner to see my draft list."}}'))
      .toBe('Must be logged in as an owner to see my draft list.');
  });

  it('reads an import-style XML error', () => {
    expect(parseMflError('<?xml version="1.0"?><error>API requires a logged in user</error>'))
      .toBe('API requires a logged in user');
  });

  it('treats an HTML page as an error, not as a clean response', () => {
    // MFL serves its developer-portal and maintenance pages with a 200 and no
    // <error> element; without this branch a total failure parses as success.
    expect(parseMflError('<!DOCTYPE html><html><head><title>MFL</title></head></html>'))
      .toMatch(/web page/i);
  });

  it('treats an empty body as an error', () => {
    expect(parseMflError('   ')).toMatch(/empty/i);
  });

  it('returns null for a clean payload', () => {
    expect(parseMflError('{"myDraftList":{"player":[]}}')).toBeNull();
  });
});

describe('normalizePlayerIds', () => {
  it('keeps order, drops duplicates, and rejects non-ids', () => {
    expect(normalizePlayerIds(['14836', '14836', 'abc', '', null, '17634', '  15379  ']))
      .toEqual(['14836', '17634', '15379']);
  });
});

describe('pullDraftList', () => {
  it('reads an ordered list', async () => {
    respond('{"myDraftList":{"player":[{"id":"14836"},{"id":"17634"}]}}');
    await expect(pullDraftList(base)).resolves.toEqual({ ok: true, playerIds: ['14836', '17634'] });
  });

  it('handles the ONE-player list MFL sends as an object, not an array', async () => {
    respond('{"myDraftList":{"player":{"id":"14836"}}}');
    const result = await pullDraftList(base);
    expect(result.playerIds).toEqual(['14836']);
  });

  it('distinguishes an empty board from a failed read', async () => {
    respond('{"myDraftList":{}}');
    await expect(pullDraftList(base)).resolves.toEqual({ ok: true, playerIds: [] });

    respond('{"error":{"$t":"Must be logged in as an owner to see my draft list."}}');
    const failed = await pullDraftList(base);
    expect(failed.ok).toBe(false);
    expect(failed.playerIds).toEqual([]);
  });

  it('does not trust HTTP 200 — an error body with a 200 still fails', async () => {
    respond('{"error":{"$t":"nope"}}', 200);
    await expect(pullDraftList(base)).resolves.toMatchObject({ ok: false, error: 'nope' });
  });
});

describe('pushDraftList', () => {
  it('refuses an empty list instead of erasing the board', async () => {
    const result = await pushDraftList({ ...base, playerIds: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/i);
    expect(mflFetch).not.toHaveBeenCalled();
  });

  it('puts TYPE and L in the QUERY STRING and only PLAYERS in the body', async () => {
    // Body-only TYPE/L sends api. into a redirect that drops them and returns
    // MFL's HTML dev-portal page instead of an API response.
    respond('<?xml version="1.0"?><status>OK</status>');
    await pushDraftList({ ...base, playerIds: ['14836', '17634'] });

    const call = mflFetch.mock.calls[0][0];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('TYPE=myDraftList');
    expect(call.url).toContain(`L=${league.id}`);
    expect(call.body).toBe('PLAYERS=14836%2C17634');
    expect(call.body).not.toContain('TYPE=');
  });

  it('writes to the league OWN host, not api.myfantasyleague.com', async () => {
    // api. 302s POST /import to the league host and mflFetch folds the body
    // into the redirect target's query string — a truncation risk for a big
    // board. Going direct avoids the hop entirely.
    respond('<?xml version="1.0"?><status>OK</status>');
    await pushDraftList({ ...base, playerIds: ['14836'] });
    expect(mflFetch.mock.calls[0][0].url).toContain(league.mflHost);
    expect(mflFetch.mock.calls[0][0].url).not.toContain('api.myfantasyleague.com');
  });

  it('preserves board ORDER — the order is the ranking', async () => {
    respond('<?xml version="1.0"?><status>OK</status>');
    await pushDraftList({ ...base, playerIds: ['17634', '14836', '15379'] });
    expect(decodeURIComponent(mflFetch.mock.calls[0][0].body)).toBe('PLAYERS=17634,14836,15379');
  });

  it('fails on an XML error returned with HTTP 200', async () => {
    respond('<?xml version="1.0"?><error>API requires a logged in user</error>', 200);
    await expect(pushDraftList({ ...base, playerIds: ['14836'] }))
      .resolves.toMatchObject({ ok: false, error: 'API requires a logged in user' });
  });

  it('fails when MFL serves its HTML portal page', async () => {
    respond('<!DOCTYPE html><html><body>Developers Program</body></html>');
    const result = await pushDraftList({ ...base, playerIds: ['14836'] });
    expect(result.ok).toBe(false);
  });

  it('succeeds on a clean status response', async () => {
    respond('<?xml version="1.0"?><status>OK</status>');
    await expect(pushDraftList({ ...base, playerIds: ['14836'] })).resolves.toEqual({ ok: true });
  });
});
