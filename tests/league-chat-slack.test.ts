/**
 * The Slack half of league chat (scripts/lib/chat.mjs).
 *
 * Slack answers most failures with HTTP 200 and `ok: false`, so "the request
 * returned" must never be read as "the message posted".
 */
import { describe, expect, it } from 'vitest';
import { chatConfigFor, postToSlack, slackSenderFor, toSlackText } from '../scripts/lib/chat.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';

const okFetch = (payload: unknown, status = 200) => {
  const calls: Array<{ url: string; init: any }> = [];
  const fetchImpl = async (url: string, init: any) => {
    calls.push({ url, init });
    return { status, json: async () => payload };
  };
  return { calls, fetchImpl };
};

describe('toSlackText', () => {
  it('wraps URLs and moves trailing punctuation outside the link', () => {
    expect(toSlackText('Read it: https://x.test/news/1. Boom!')).toBe('Read it: <https://x.test/news/1>. Boom!');
  });

  it('escapes Slack control characters in prose but not inside the URL', () => {
    expect(toSlackText('A & B <3 https://x.test/?a=1&b=2')).toBe('A &amp; B &lt;3 <https://x.test/?a=1&b=2>');
  });

  it('handles empty input', () => {
    expect(toSlackText('')).toBe('');
  });
});

describe('postToSlack', () => {
  it('posts as the persona and reports success only on ok: true', async () => {
    const { calls, fetchImpl } = okFetch({ ok: true });
    const result = await postToSlack({
      token: 'xoxb-1',
      channel: 'C1',
      text: 'hi https://x.test.',
      persona: { name: 'Archie', avatarUrl: 'https://x.test/a.png' },
      fetchImpl,
    });
    expect(result).toEqual({ posted: true });
    expect(calls[0].url).toBe('https://slack.com/api/chat.postMessage');
    expect(calls[0].init.headers.Authorization).toBe('Bearer xoxb-1');
    const body = JSON.parse(calls[0].init.body);
    expect(body).toMatchObject({ channel: 'C1', text: 'hi <https://x.test>.', username: 'Archie', icon_url: 'https://x.test/a.png' });
  });

  it('treats HTTP 200 with ok: false as a failure', async () => {
    const { fetchImpl } = okFetch({ ok: false, error: 'not_in_channel' });
    let seen: unknown = null;
    const result = await postToSlack({ token: 't', channel: 'C', text: 'x', fetchImpl, onHttpError: (e) => (seen = e) });
    expect(result).toEqual({ posted: false, reason: 'slack-not_in_channel' });
    expect(seen).toBe('not_in_channel');
  });

  it('treats a non-2xx as a failure', async () => {
    const { fetchImpl } = okFetch({}, 500);
    expect(await postToSlack({ token: 't', channel: 'C', text: 'x', fetchImpl })).toEqual({ posted: false, reason: 'http-500' });
  });

  it('skips without a token or channel, and never fetches on a dry run', async () => {
    const { calls, fetchImpl } = okFetch({ ok: true });
    expect((await postToSlack({ token: '', channel: 'C', text: 'x', fetchImpl })).reason).toBe('no-bot-id');
    expect((await postToSlack({ token: 't', channel: 'C', text: 'x', dryRun: true, fetchImpl })).reason).toBe('dry-run');
    expect(calls).toHaveLength(0);
  });
});

describe('chat config', () => {
  it('every registry chat block is a known provider with its env names', () => {
    for (const league of Object.values(LEAGUES) as Array<{ slug: string; chat?: any }>) {
      if (!league.chat) continue;
      const chat = chatConfigFor(league);
      expect(chat, `${league.slug} has an unknown chat provider`).not.toBeNull();
      if (!chat) continue;
      if (chat.provider === 'groupme') expect(chat.botEnv).toMatch(/^[A-Z0-9_]+$/);
      if (chat.provider === 'slack') {
        expect(chat.tokenEnv).toMatch(/^[A-Z0-9_]+$/);
        expect(chat.channelEnv).toMatch(/^[A-Z0-9_]+$/);
      }
    }
  });

  it('only a Slack league gets a Slack sender', async () => {
    expect(slackSenderFor(LEAGUES.theleague)).toBeNull();
    expect(slackSenderFor({})).toBeNull();

    const { calls, fetchImpl } = okFetch({ ok: true });
    const league = { chat: { provider: 'slack', tokenEnv: 'SLACK_T', channelEnv: 'SLACK_C' } };
    const send = slackSenderFor(league, { persona: { name: 'Archie' }, env: { SLACK_T: 'xoxb', SLACK_C: 'C9' }, fetchImpl });
    expect(await send!({ text: 'hello' })).toEqual({ posted: true });
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ channel: 'C9', username: 'Archie' });
  });
});
