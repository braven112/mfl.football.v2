/**
 * Tests for the Schefter Style Book tracker.
 *
 * Coverage:
 *  - detectAttackOnSchefter pure-function: subject detection, pejorative
 *    matching, negation guards, false-negative tolerance.
 *  - normalizeAuthorKey: deterministic Redis key format.
 *  - ingestGroupMeMentions integration: a personal-attack tip stamps the
 *    payload with attackOnSchefter + styleBookCount, and the Redis side-
 *    effects (INCR + INCR + SET + ZINCRBY) fire in the expected order.
 *  - Scanner prompt / anonymizeTips contract: presence of HARD RULE 15
 *    and the surfacing branch for attackOnSchefter on GroupMe tips.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  detectAttackOnSchefter,
  normalizeAuthorKey,
  ingestGroupMeMentions,
  // @ts-ignore — .mjs via allowJs, no TS declarations
} from '../scripts/schefter-groupme-listen.mjs';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

// ── FakeRedis (extended: incr, zincrby) ─────────────────────────────────────

class FakeRedis {
  strings = new Map<string, string>();
  lists = new Map<string, string[]>();
  zsets = new Map<string, Map<string, number>>();
  numbers = new Map<string, number>();
  expireCalls: Array<{ key: string; seconds: number }> = [];
  callLog: Array<{ op: string; key: string; args?: unknown[] }> = [];

  async get(key: string) {
    this.callLog.push({ op: 'get', key });
    if (this.numbers.has(key)) return this.numbers.get(key);
    return this.strings.get(key) ?? null;
  }
  async set(key: string, value: unknown, opts?: { nx?: boolean }) {
    this.callLog.push({ op: 'set', key, args: [value, opts] });
    if (opts?.nx && (this.strings.has(key) || this.numbers.has(key))) return null;
    this.strings.set(key, String(value));
    return 'OK';
  }
  async incr(key: string) {
    this.callLog.push({ op: 'incr', key });
    const next = (this.numbers.get(key) ?? 0) + 1;
    this.numbers.set(key, next);
    return next;
  }
  async zincrby(key: string, delta: number, member: string) {
    this.callLog.push({ op: 'zincrby', key, args: [delta, member] });
    const map = this.zsets.get(key) ?? new Map<string, number>();
    map.set(member, (map.get(member) ?? 0) + delta);
    this.zsets.set(key, map);
    return map.get(member);
  }
  async llen(key: string) {
    return this.lists.get(key)?.length ?? 0;
  }
  async lpush(key: string, ...values: string[]) {
    const list = this.lists.get(key) ?? [];
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

function makeMessage(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'msg_' + Math.random().toString(36).slice(2, 10),
    created_at: Math.floor(Date.now() / 1000),
    sender_type: 'user',
    user_id: 'user_123',
    sender_id: 'user_123',
    name: 'Dead Cap Walking',
    text: '',
    attachments: [],
    ...overrides,
  };
}

function installFetchStub(messages: unknown[]) {
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    return new Response(JSON.stringify({ response: { messages } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return () => {
    global.fetch = originalFetch;
  };
}

// ── detectAttackOnSchefter ──────────────────────────────────────────────────

describe('detectAttackOnSchefter', () => {
  it('catches the canonical attack ("Claude Schefter is a lil bitch")', () => {
    const r = detectAttackOnSchefter('Claude Schefter is a lil bitch');
    expect(r.attack).toBe(true);
    expect(r.keyword).toBe('bitch');
  });

  it('catches "schefty sucks"', () => {
    const r = detectAttackOnSchefter('schefty sucks man');
    expect(r.attack).toBe(true);
  });

  it('catches "the bot is a hack"', () => {
    const r = detectAttackOnSchefter('the bot is a hack');
    expect(r.attack).toBe(true);
    expect(r.keyword).toBe('hack');
  });

  it('catches "schefter is trash"', () => {
    expect(detectAttackOnSchefter('schefter is trash').attack).toBe(true);
  });

  it('catches "claude is wrong again"', () => {
    expect(detectAttackOnSchefter('claude is wrong again').attack).toBe(true);
  });

  it('respects negation: "schefter isn\'t wrong about this"', () => {
    const r = detectAttackOnSchefter("schefter isn't wrong about this");
    expect(r.attack).toBe(false);
  });

  it('respects negation: "that\'s not bad for the bot"', () => {
    const r = detectAttackOnSchefter("that's not bad for the bot");
    expect(r.attack).toBe(false);
  });

  it('rejects pejorative without Schefter subject ("this trade is trash")', () => {
    expect(detectAttackOnSchefter('this trade is trash').attack).toBe(false);
  });

  it('rejects Schefter mention without pejorative ("hey schefter any rumors?")', () => {
    expect(detectAttackOnSchefter('hey schefter any rumors?').attack).toBe(false);
  });

  it('rejects empty / too-short text', () => {
    expect(detectAttackOnSchefter('').attack).toBe(false);
    expect(detectAttackOnSchefter('bad').attack).toBe(false);
  });

  it('handles mixed case and punctuation', () => {
    const r = detectAttackOnSchefter('SCHEFTER, you are GARBAGE!!!');
    expect(r.attack).toBe(true);
  });
});

// ── normalizeAuthorKey ──────────────────────────────────────────────────────

describe('normalizeAuthorKey', () => {
  it('lowercases + underscores + strips punctuation', () => {
    expect(normalizeAuthorKey('Dead Cap Walking')).toBe('dead_cap_walking');
    expect(normalizeAuthorKey('Da Dangsters!')).toBe('da_dangsters');
    expect(normalizeAuthorKey('  Pacific Pigskins  ')).toBe('pacific_pigskins');
  });

  it('returns empty string for invalid input', () => {
    expect(normalizeAuthorKey('')).toBe('');
    expect(normalizeAuthorKey(undefined as unknown as string)).toBe('');
    expect(normalizeAuthorKey(null as unknown as string)).toBe('');
  });

  it('produces deterministic keys for the same name', () => {
    const a = normalizeAuthorKey('Dead Cap Walking');
    const b = normalizeAuthorKey('Dead Cap Walking');
    expect(a).toBe(b);
  });
});

// ── ingestGroupMeMentions integration: attack stamping + Redis side effects ─

describe('ingestGroupMeMentions — Style Book integration', () => {
  const priorToken = process.env.GROUPME_SERVICE_TOKEN;
  const priorGroup = process.env.GROUPME_GROUP_ID;

  beforeEach(() => {
    process.env.GROUPME_SERVICE_TOKEN = 'test-token';
    process.env.GROUPME_GROUP_ID = 'test-group';
  });
  afterEach(() => {
    if (priorToken === undefined) delete process.env.GROUPME_SERVICE_TOKEN;
    else process.env.GROUPME_SERVICE_TOKEN = priorToken;
    if (priorGroup === undefined) delete process.env.GROUPME_GROUP_ID;
    else process.env.GROUPME_GROUP_ID = priorGroup;
  });

  it('stamps attackOnSchefter + styleBookCount on the queued tip when attack is detected', async () => {
    const redis = new FakeRedis();
    const restore = installFetchStub([
      makeMessage({ id: 'attack_1', name: 'Dead Cap Walking', text: 'Claude Schefter is a lil bitch' }),
    ]);

    try {
      const res = await ingestGroupMeMentions({ redis, dryRun: false });
      expect(res.detected).toBe(1);

      const queuedRaw = redis.lists.get('schefter:tips:queue')?.[0];
      expect(queuedRaw).toBeDefined();
      const queued = JSON.parse(queuedRaw as string);
      expect(queued.attackOnSchefter).toBe(true);
      expect(queued.styleBookCount).toBe(1);
      expect(queued.author).toBe('Dead Cap Walking');
      // We never persist the attack keyword on the tip payload — only the flag.
      expect(queued.text).toContain('bitch'); // original text is preserved
      expect(queued).not.toHaveProperty('keyword');
    } finally {
      restore();
    }
  });

  it('increments counters across repeat attacks from the same author', async () => {
    const redis = new FakeRedis();
    const author = 'Dead Cap Walking';
    const authorKey = 'dead_cap_walking';

    // First attack
    let restore = installFetchStub([
      makeMessage({ id: 'attack_1', name: author, text: 'schefter sucks' }),
    ]);
    try {
      await ingestGroupMeMentions({ redis, dryRun: false });
    } finally {
      restore();
    }

    // Clear watermark so next call re-processes
    redis.strings.delete('schefter:groupme:last_mention_id');
    redis.numbers.delete('schefter:groupme:last_mention_id');

    // Second attack — same author, different message
    restore = installFetchStub([
      makeMessage({ id: 'attack_2', name: author, text: 'claude is a hack' }),
    ]);
    try {
      await ingestGroupMeMentions({ redis, dryRun: false });
    } finally {
      restore();
    }

    // Lifetime counter should be 2
    expect(redis.numbers.get(`schefter:style_book:${authorKey}`)).toBe(2);

    // Seasonal counter should also be 2 (same year)
    const seasonKey = Array.from(redis.numbers.keys()).find((k) =>
      k.startsWith('schefter:style_book:season:'),
    );
    expect(seasonKey).toBeDefined();
    expect(redis.numbers.get(seasonKey as string)).toBe(2);

    // Second queued tip should reflect count=2
    const queue = redis.lists.get('schefter:tips:queue') ?? [];
    const latest = JSON.parse(queue[0] as string);
    expect(latest.styleBookCount).toBe(2);
  });

  it('does not stamp attackOnSchefter on benign tips', async () => {
    const redis = new FakeRedis();
    const restore = installFetchStub([
      makeMessage({ id: 'benign_1', name: 'Wabbit', text: 'hey schefter, any rumors today?' }),
    ]);

    try {
      await ingestGroupMeMentions({ redis, dryRun: false });
      const queued = JSON.parse(
        (redis.lists.get('schefter:tips:queue')?.[0] ?? '{}') as string,
      );
      expect(queued.attackOnSchefter).toBeUndefined();
      expect(queued.styleBookCount).toBeUndefined();

      // And no style-book counters should have been incremented
      const styleBookKeys = Array.from(redis.numbers.keys()).filter((k) =>
        k.startsWith('schefter:style_book:'),
      );
      expect(styleBookKeys).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('updates the seasonal leaderboard ZSET', async () => {
    const redis = new FakeRedis();
    const restore = installFetchStub([
      makeMessage({ id: 'attack_1', name: 'Dead Cap Walking', text: 'schefter is a fraud' }),
    ]);

    try {
      await ingestGroupMeMentions({ redis, dryRun: false });
      const leaderboardKey = Array.from(redis.zsets.keys()).find((k) =>
        k.startsWith('schefter:style_book:leaderboard:'),
      );
      expect(leaderboardKey).toBeDefined();
      const lb = redis.zsets.get(leaderboardKey as string);
      expect(lb?.get('Dead Cap Walking')).toBe(1);
    } finally {
      restore();
    }
  });

  it('skips style-book writes in dryRun mode', async () => {
    const redis = new FakeRedis();
    const restore = installFetchStub([
      makeMessage({ id: 'attack_1', name: 'Dead Cap Walking', text: 'schefter is trash' }),
    ]);

    try {
      await ingestGroupMeMentions({ redis, dryRun: true });
      const styleBookKeys = Array.from(redis.numbers.keys()).filter((k) =>
        k.startsWith('schefter:style_book:'),
      );
      expect(styleBookKeys).toHaveLength(0);
      const leaderboardKeys = Array.from(redis.zsets.keys()).filter((k) =>
        k.startsWith('schefter:style_book:leaderboard:'),
      );
      expect(leaderboardKeys).toHaveLength(0);
    } finally {
      restore();
    }
  });
});

// ── Source-level contract checks ────────────────────────────────────────────

describe('source-level contract — scanner + prompt', () => {
  const scannerSrc = read('scripts/schefter-rumor-scan.mjs');
  const runningBitsSrc = read('data/schefter/running-bits.md');

  it('anonymizeTips surfaces attackOnSchefter + styleBookCount on GroupMe tips', () => {
    // The flag and count must be surfaced on the safe object so the LLM sees them.
    expect(scannerSrc).toMatch(/safe\.attackOnSchefter\s*=\s*true/);
    expect(scannerSrc).toMatch(/safe\.styleBookCount\s*=\s*tip\.styleBookCount/);
  });

  it('system prompt contains HARD RULE 15 (Style Book) and covers both named + anon', () => {
    expect(scannerSrc).toMatch(/15\.\s*Style Book \(attacks on Schefter\)/);
    expect(scannerSrc).toMatch(/attackOnSchefter:\s*true/);
    expect(scannerSrc).toMatch(/styleBookCount/);
    // Rule must distinguish GroupMe (named) and web (anonymous) flavors so
    // Schefter addresses each correctly.
    expect(scannerSrc).toMatch(/GroupMe \(named\)/);
    expect(scannerSrc).toMatch(/Web \(anonymous\)/);
    expect(scannerSrc).toMatch(/tipsterCodename/);
  });

  it('system prompt forbids quoting the attack verbatim and clapping back', () => {
    expect(scannerSrc).toMatch(/NEVER quote the attack verbatim/);
    expect(scannerSrc).toMatch(/NEVER defensive or clapping-back/);
  });

  it('running-bits.md has been extended with count-based escalation lines', () => {
    expect(runningBitsSrc).toMatch(/count === 1/);
    expect(runningBitsSrc).toMatch(/count === 2/);
    expect(runningBitsSrc).toMatch(/count >= 4/);
    expect(runningBitsSrc).toMatch(/styleBookCount/);
  });
});
