/**
 * Tests for GroupMe native-reply detection in the Schefter listener.
 *
 * Contract pinned here:
 *  - A reply attachment whose reply_id/base_reply_id matches a cached
 *    Schefter-bot message ID turns the reply into a tip, even when the body
 *    contains no "schefter"/"claude"/"schefty" mention.
 *  - Low-effort reply bodies (e.g. "lol", "🔥🔥🔥", "thanks!") are rejected so
 *    single-word reactions don't pollute the tip queue.
 *  - Schefter's own messages (sender_type==='bot', name matches /schefter/i)
 *    are identified and cached — never fed back in as tips.
 *  - Roger bot posts are never cached and never trigger replies.
 *  - Source-level guards: the persistence path uses the expected Redis key,
 *    a 48h TTL, and caps the list at 50 entries.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  detectMention,
  detectReplyToSchefter,
  isSchefterBotMessage,
  validateReplyContent,
  ingestGroupMeMentions,
  // @ts-ignore — .mjs imported via allowJs; no TS declarations
} from '../scripts/schefter-groupme-listen.mjs';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

// ── Redis fake ──────────────────────────────────────────────────────────────
// Supports the subset of commands the listener uses: get/set, llen, lpush,
// ltrim, lrange, expire. Values are stored as strings to match Upstash behavior.

class FakeRedis {
  strings = new Map<string, string>();
  lists = new Map<string, string[]>();
  expireCalls: Array<{ key: string; seconds: number }> = [];

  async get(key: string) {
    return this.strings.get(key) ?? null;
  }
  async set(key: string, value: unknown, opts?: { nx?: boolean }) {
    if (opts?.nx && this.strings.has(key)) return null;
    this.strings.set(key, String(value));
    return 'OK';
  }
  async llen(key: string) {
    return this.lists.get(key)?.length ?? 0;
  }
  async lpush(key: string, ...values: string[]) {
    const list = this.lists.get(key) ?? [];
    // lpush inserts each value at the head, left-to-right, so the LAST arg
    // ends up at index 0 — matches Upstash/Redis semantics.
    for (const v of values) list.unshift(String(v));
    this.lists.set(key, list);
    return list.length;
  }
  async ltrim(key: string, start: number, stop: number) {
    const list = this.lists.get(key) ?? [];
    const end = stop < 0 ? list.length + stop + 1 : stop + 1;
    this.lists.set(key, list.slice(start, end));
    return 'OK';
  }
  async lrange(key: string, start: number, stop: number) {
    const list = this.lists.get(key) ?? [];
    const end = stop < 0 ? list.length + stop + 1 : stop + 1;
    return list.slice(start, end);
  }
  async expire(key: string, seconds: number) {
    this.expireCalls.push({ key, seconds });
    return 1;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'msg_' + Math.random().toString(36).slice(2, 10),
    created_at: Math.floor(Date.now() / 1000),
    sender_type: 'user',
    user_id: 'user_123',
    sender_id: 'user_123',
    name: 'Pacific Pigskins',
    text: '',
    attachments: [],
    ...overrides,
  };
}

// Stub global fetch so ingestGroupMeMentions' HTTP path can be exercised
// without a live GroupMe. Each test installs a response stack.
function installFetchStub(messages: unknown[]) {
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    return new Response(
      JSON.stringify({ response: { messages } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return () => {
    global.fetch = originalFetch;
  };
}

// ── isSchefterBotMessage ────────────────────────────────────────────────────

describe('isSchefterBotMessage', () => {
  const priorSenderId = process.env.GROUPME_SCHEFTER_BOT_SENDER_ID;
  afterEach(() => {
    if (priorSenderId === undefined) delete process.env.GROUPME_SCHEFTER_BOT_SENDER_ID;
    else process.env.GROUPME_SCHEFTER_BOT_SENDER_ID = priorSenderId;
  });

  it('matches by explicit sender-id env var', () => {
    process.env.GROUPME_SCHEFTER_BOT_SENDER_ID = 'bot_sender_42';
    const msg = makeMessage({
      sender_type: 'bot',
      user_id: 'bot_sender_42',
      name: 'Not A Schefter Name',
    });
    expect(isSchefterBotMessage(msg)).toBe(true);
  });

  it('matches by sender_type === bot + display name regex', () => {
    delete process.env.GROUPME_SCHEFTER_BOT_SENDER_ID;
    expect(
      isSchefterBotMessage(
        makeMessage({ sender_type: 'bot', name: 'Schefter', user_id: 'bot_abc' }),
      ),
    ).toBe(true);
    expect(
      isSchefterBotMessage(
        makeMessage({ sender_type: 'bot', name: 'Claude Schefter', user_id: 'bot_abc' }),
      ),
    ).toBe(true);
    expect(
      isSchefterBotMessage(
        makeMessage({ sender_type: 'bot', name: 'Schefty', user_id: 'bot_abc' }),
      ),
    ).toBe(true);
  });

  it('rejects Roger bot messages (no accidental Roger reply support)', () => {
    delete process.env.GROUPME_SCHEFTER_BOT_SENDER_ID;
    expect(
      isSchefterBotMessage(
        makeMessage({ sender_type: 'bot', name: 'Ask Roger', user_id: 'bot_roger' }),
      ),
    ).toBe(false);
  });

  it('rejects human messages even if their display name contains "schefter"', () => {
    delete process.env.GROUPME_SCHEFTER_BOT_SENDER_ID;
    expect(
      isSchefterBotMessage(
        makeMessage({ sender_type: 'user', name: 'fake schefter impersonator' }),
      ),
    ).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isSchefterBotMessage(null as unknown as object)).toBe(false);
    expect(isSchefterBotMessage(undefined as unknown as object)).toBe(false);
    expect(isSchefterBotMessage({} as object)).toBe(false);
  });
});

// ── detectReplyToSchefter ───────────────────────────────────────────────────

describe('detectReplyToSchefter', () => {
  it('returns the reply_id when it matches the known-bot-message set', () => {
    const botIds = new Set(['bot_msg_1', 'bot_msg_2']);
    const reply = makeMessage({
      attachments: [{ type: 'reply', reply_id: 'bot_msg_2', base_reply_id: 'bot_msg_2' }],
    });
    expect(detectReplyToSchefter(reply, botIds)).toBe('bot_msg_2');
  });

  it('falls back to base_reply_id when reply_id does not match', () => {
    const botIds = new Set(['bot_msg_root']);
    const reply = makeMessage({
      attachments: [{ type: 'reply', reply_id: 'some_user_msg', base_reply_id: 'bot_msg_root' }],
    });
    expect(detectReplyToSchefter(reply, botIds)).toBe('bot_msg_root');
  });

  it('returns null when the reply targets a non-Schefter message', () => {
    const botIds = new Set(['bot_msg_1']);
    const reply = makeMessage({
      attachments: [{ type: 'reply', reply_id: 'random_user_msg', base_reply_id: 'random_user_msg' }],
    });
    expect(detectReplyToSchefter(reply, botIds)).toBeNull();
  });

  it('returns null when the message has no attachments', () => {
    expect(detectReplyToSchefter(makeMessage({ attachments: [] }), new Set(['x']))).toBeNull();
    expect(detectReplyToSchefter(makeMessage({ attachments: undefined }), new Set(['x']))).toBeNull();
  });

  it('ignores non-reply attachments (images, mentions)', () => {
    const botIds = new Set(['bot_msg_1']);
    const msg = makeMessage({
      attachments: [
        { type: 'image', url: 'https://i.groupme.com/x' },
        { type: 'mentions', user_ids: ['u1'] },
      ],
    });
    expect(detectReplyToSchefter(msg, botIds)).toBeNull();
  });
});

// ── validateReplyContent ────────────────────────────────────────────────────

describe('validateReplyContent', () => {
  it('accepts reply bodies with real content', () => {
    expect(validateReplyContent('Do you think Chase is actually available?').valid).toBe(true);
    expect(validateReplyContent('Source on the Pacheco deal?').valid).toBe(true);
  });

  it('rejects empty / missing / non-string input', () => {
    expect(validateReplyContent('').valid).toBe(false);
    expect(validateReplyContent(null as unknown as string).valid).toBe(false);
    expect(validateReplyContent(undefined as unknown as string).valid).toBe(false);
    expect(validateReplyContent(42 as unknown as string).valid).toBe(false);
  });

  it('rejects bodies shorter than 5 chars', () => {
    const r = validateReplyContent('ok');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('too-short');
  });

  it('rejects emoji-only reactions', () => {
    const r = validateReplyContent('🔥🔥🔥');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('too-short-after-strip');
  });

  it('rejects low-effort whole-message acks ("lol", "thanks", "yep")', () => {
    for (const body of ['lol', 'LMAO', 'thanks', 'thanks!', 'yep.', 'thx', 'nice!!!', 'hahahaha']) {
      const r = validateReplyContent(body);
      expect(r.valid, `expected ${JSON.stringify(body)} to be rejected`).toBe(false);
    }
  });

  it('accepts longer reactions that happen to start with an ack word', () => {
    expect(validateReplyContent('lol what a trade, what is he thinking').valid).toBe(true);
    expect(validateReplyContent('thanks for breaking that one').valid).toBe(true);
  });
});

// ── detectMention regression guard ─────────────────────────────────────────

describe('detectMention (regression — native-reply work should not break name-based detection)', () => {
  it('still matches "schefter, thoughts?"', () => {
    const r = detectMention('Schefter, thoughts on the Chase trade?');
    expect(r?.match).toBe(true);
  });
  it('still rejects acks like "thanks claude"', () => {
    const r = detectMention('thanks claude for the update');
    expect(r?.match).toBe(false);
  });
});

// ── ingestGroupMeMentions end-to-end with FakeRedis ────────────────────────

describe('ingestGroupMeMentions — native-reply integration', () => {
  const priorEnv = { ...process.env };

  beforeEach(() => {
    // Token + group id are required to reach the fetch stub; sender-id is
    // optional — we let the name-regex fallback identify Schefter for clarity.
    process.env.GROUPME_SERVICE_TOKEN = 'fake-token';
    process.env.GROUPME_GROUP_ID = 'fake-group';
    delete process.env.GROUPME_SCHEFTER_BOT_SENDER_ID;
  });

  afterEach(() => {
    process.env = { ...priorEnv };
  });

  it('enqueues a reply-as-tip when the reply targets a cached Schefter post', async () => {
    const redis = new FakeRedis();
    // Pre-seed the bot-message-ID cache with a prior Schefter post.
    await redis.lpush('schefter:groupme:bot_message_ids', 'prior_schefter_post');

    const userReply = makeMessage({
      id: 'reply_001',
      text: 'Wait so is Chase actually being shopped or is this smoke',
      attachments: [
        { type: 'reply', reply_id: 'prior_schefter_post', base_reply_id: 'prior_schefter_post' },
      ],
    });

    const restore = installFetchStub([userReply]);
    try {
      const result = await ingestGroupMeMentions({ redis, dryRun: false });
      expect(result.detected).toBe(1);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].variant).toBe('native-reply');
      expect(result.accepted[0].signals.replyTo).toBe('prior_schefter_post');

      const queue = redis.lists.get('schefter:tips:queue') ?? [];
      expect(queue).toHaveLength(1);
      const tip = JSON.parse(queue[0]);
      expect(tip.source).toBe('groupme');
      expect(tip.replyToGroupMeId).toBe('prior_schefter_post');
    } finally {
      restore();
    }
  });

  it('rejects low-effort reply bodies and does not enqueue them', async () => {
    const redis = new FakeRedis();
    await redis.lpush('schefter:groupme:bot_message_ids', 'prior_post');

    const lowEffort = makeMessage({
      id: 'reply_low',
      text: 'lol',
      attachments: [{ type: 'reply', reply_id: 'prior_post', base_reply_id: 'prior_post' }],
    });

    const restore = installFetchStub([lowEffort]);
    try {
      const result = await ingestGroupMeMentions({ redis, dryRun: false });
      expect(result.detected).toBe(0);
      expect((redis.lists.get('schefter:tips:queue') ?? []).length).toBe(0);
      expect(result.rejected.some((r: { reason: string }) => r.reason.startsWith('reply-'))).toBe(true);
    } finally {
      restore();
    }
  });

  it('caches Schefter-bot messages seen in-batch so subsequent replies are recognized', async () => {
    const redis = new FakeRedis();
    // No pre-seed. The bot post arrives first, then a reply to it, in the
    // same fetch — the listener must track the bot id before evaluating the
    // reply.
    const schefterPost = makeMessage({
      id: 'schefter_new_post',
      sender_type: 'bot',
      user_id: 'bot_schefter_xyz',
      name: 'Schefter',
      text: 'Source: Bring The Pain acquires Pacheco from Computer Jocks',
      created_at: Math.floor(Date.now() / 1000) - 60,
    });
    const reply = makeMessage({
      id: 'reply_002',
      text: 'What did they give up in return though?',
      attachments: [
        { type: 'reply', reply_id: 'schefter_new_post', base_reply_id: 'schefter_new_post' },
      ],
    });

    const restore = installFetchStub([schefterPost, reply]);
    try {
      const result = await ingestGroupMeMentions({ redis, dryRun: false });
      expect(result.detected).toBe(1);
      expect(result.accepted[0].signals.replyTo).toBe('schefter_new_post');

      const cached = redis.lists.get('schefter:groupme:bot_message_ids') ?? [];
      expect(cached).toContain('schefter_new_post');
    } finally {
      restore();
    }
  });

  it('does not cache Roger posts and does not treat replies to Roger as tips', async () => {
    const redis = new FakeRedis();
    const rogerPost = makeMessage({
      id: 'roger_post',
      sender_type: 'bot',
      user_id: 'bot_roger',
      name: 'Ask Roger',
      text: 'Tagging period ends in 3 days.',
    });
    const replyToRoger = makeMessage({
      id: 'reply_r',
      text: 'Who has been tagged this year anyway',
      attachments: [{ type: 'reply', reply_id: 'roger_post', base_reply_id: 'roger_post' }],
    });

    const restore = installFetchStub([rogerPost, replyToRoger]);
    try {
      const result = await ingestGroupMeMentions({ redis, dryRun: false });
      expect(result.detected).toBe(0);
      const cached = redis.lists.get('schefter:groupme:bot_message_ids') ?? [];
      expect(cached).not.toContain('roger_post');
    } finally {
      restore();
    }
  });

  it('respects dryRun — no Redis writes for queue or bot-ID cache', async () => {
    const redis = new FakeRedis();
    const schefterPost = makeMessage({
      id: 'dry_post',
      sender_type: 'bot',
      name: 'Schefter',
      text: 'headline',
    });
    const reply = makeMessage({
      id: 'dry_reply',
      text: 'serious question what happens next',
      attachments: [{ type: 'reply', reply_id: 'dry_post', base_reply_id: 'dry_post' }],
    });

    const restore = installFetchStub([schefterPost, reply]);
    try {
      const result = await ingestGroupMeMentions({ redis, dryRun: true });
      expect(result.detected).toBe(1);
      expect((redis.lists.get('schefter:tips:queue') ?? []).length).toBe(0);
      expect((redis.lists.get('schefter:groupme:bot_message_ids') ?? []).length).toBe(0);
    } finally {
      restore();
    }
  });

  it('name-regex path still works for replies to non-Schefter messages', async () => {
    const redis = new FakeRedis();
    const textOnlyMention = makeMessage({
      id: 'name_msg',
      text: 'Schefter: is the Chase trade real?',
    });

    const restore = installFetchStub([textOnlyMention]);
    try {
      const result = await ingestGroupMeMentions({ redis, dryRun: false });
      expect(result.detected).toBe(1);
      expect(result.accepted[0].variant).toBe('schefter');
    } finally {
      restore();
    }
  });
});

// ── Source-level invariants ────────────────────────────────────────────────
//
// These are cheap guards on the persistence shape so future refactors don't
// silently drop the TTL or change the Redis key.
describe('schefter-groupme-listen.mjs — persistence invariants', () => {
  const src = read('scripts/schefter-groupme-listen.mjs');

  it('uses the expected Redis key for bot message IDs', () => {
    expect(src).toMatch(/schefter:groupme:bot_message_ids/);
  });

  it('caps the bot-message-ID list at 50 entries', () => {
    expect(src).toMatch(/MAX_TRACKED_BOT_MESSAGES\s*=\s*50/);
  });

  it('writes a 48h TTL on the bot-message-ID list', () => {
    // 48 * 60 * 60
    expect(src).toMatch(/48\s*\*\s*60\s*\*\s*60/);
  });

  it('tracks Schefter-bot message IDs BEFORE applying the bot-skip filter', () => {
    const trackIdx = src.indexOf('isSchefterBotMessage(msg)');
    const skipIdx = src.indexOf("if (msg.sender_type === 'bot') continue;");
    expect(trackIdx).toBeGreaterThan(-1);
    expect(skipIdx).toBeGreaterThan(-1);
    expect(trackIdx).toBeLessThan(skipIdx);
  });
});
