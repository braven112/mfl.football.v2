/**
 * DELETE /api/schefter/tip/{id} — 60-second undo.
 *
 * Locks the safety properties: server-side ownership check on the queued
 * tip's hashedOwnerId, server-side window enforcement, rate-limit refund
 * with a zero floor, topic-timeline cleanup, and marinate-anchor reset when
 * the queue empties. Also guards the submit response's eager-codename
 * contract that the confirmation panel relies on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── In-memory Redis fake (list/zset/counter subset used by the undo path) ──
class FakeRedis {
  store = new Map<string, unknown>();
  lists = new Map<string, string[]>();
  zsets = new Map<string, Map<string, number>>();

  async lrange<T = string>(key: string, start: number, stop: number): Promise<T[]> {
    const l = this.lists.get(key) ?? [];
    const end = stop === -1 ? l.length : stop + 1;
    return l.slice(start, end) as T[];
  }
  async lpush(key: string, ...values: string[]): Promise<number> {
    const l = this.lists.get(key) ?? [];
    l.unshift(...values);
    this.lists.set(key, l);
    return l.length;
  }
  async lrem(key: string, count: number, value: string): Promise<number> {
    const l = this.lists.get(key) ?? [];
    const idx = l.indexOf(value);
    if (idx === -1) return 0;
    l.splice(idx, 1);
    this.lists.set(key, l);
    return 1;
  }
  async llen(key: string): Promise<number> {
    return (this.lists.get(key) ?? []).length;
  }
  async get<T = unknown>(key: string): Promise<T | null> {
    return (this.store.get(key) as T) ?? null;
  }
  async set(key: string, value: unknown): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }
  async del(key: string): Promise<number> {
    const had = this.store.has(key) || this.lists.has(key);
    this.store.delete(key);
    this.lists.delete(key);
    return had ? 1 : 0;
  }
  async incr(key: string): Promise<number> {
    const n = (Number(this.store.get(key)) || 0) + 1;
    this.store.set(key, n);
    return n;
  }
  async decr(key: string): Promise<number> {
    const n = (Number(this.store.get(key)) || 0) - 1;
    this.store.set(key, n);
    return n;
  }
  async zrem(key: string, ...members: string[]): Promise<number> {
    const z = this.zsets.get(key);
    if (!z) return 0;
    let n = 0;
    for (const m of members) if (z.delete(m)) n++;
    return n;
  }
  async zadd(key: string, entry: { score: number; member: string }): Promise<number> {
    const z = this.zsets.get(key) ?? new Map();
    z.set(entry.member, entry.score);
    this.zsets.set(key, z);
    return 1;
  }
}

const fake = new FakeRedis();

vi.mock('../src/utils/redis-client', () => ({
  getRedis: async () => fake,
}));

vi.mock('../src/utils/auth', () => ({
  getAuthUser: (req: Request) => {
    const who = req.headers.get('x-test-user');
    if (!who) return null;
    return { id: who, name: who, franchiseId: '0001', leagueId: '13522', role: 'owner' };
  },
}));

process.env.SCHEFTER_TIPSTER_SALT = 'test-salt';

const { DELETE } = await import('../src/pages/api/schefter/tip/[id]');
const { hashTipsterId } = await import('../src/utils/schefter-tipster-hash');

function makeRequest(userId: string | null, tipId: string) {
  const headers = new Headers();
  if (userId) headers.set('x-test-user', userId);
  return {
    request: new Request(`https://example.com/api/schefter/tip/${tipId}`, {
      method: 'DELETE',
      headers,
    }),
    params: { id: tipId },
  } as never;
}

function queueTip(tip: Record<string, unknown>) {
  fake.lists.set('schefter:tips:queue', [
    ...(fake.lists.get('schefter:tips:queue') ?? []),
    JSON.stringify(tip),
  ]);
}

describe('DELETE /api/schefter/tip/{id}', () => {
  beforeEach(() => {
    fake.store.clear();
    fake.lists.clear();
    fake.zsets.clear();
  });

  it('withdraws an own fresh tip, refunds the slot, and cleans the timeline', async () => {
    const hash = hashTipsterId('owner-1');
    queueTip({ id: 't1', hashedOwnerId: hash, submittedAt: Date.now(), topic: 'trade' });
    fake.store.set('schefter:tips:ratelimit:' + hash, 1);
    fake.zsets.set('schefter:topic_timeline:trade', new Map([['t1', Date.now()]]));
    fake.store.set('schefter:tips:first_tip_ts', Date.now());

    const res = await DELETE(makeRequest('owner-1', 't1'));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(fake.lists.get('schefter:tips:queue') ?? []).toHaveLength(0);
    expect(Number(fake.store.get('schefter:tips:ratelimit:' + hash))).toBe(0);
    expect(fake.zsets.get('schefter:topic_timeline:trade')?.has('t1')).toBe(false);
    // Queue emptied → marinate anchor cleared.
    expect(fake.store.has('schefter:tips:first_tip_ts')).toBe(false);
  });

  it("cannot withdraw someone else's tip (same shape as gone)", async () => {
    const otherHash = hashTipsterId('owner-2');
    queueTip({ id: 't2', hashedOwnerId: otherHash, submittedAt: Date.now(), topic: 'trade' });

    const res = await DELETE(makeRequest('owner-1', 't2'));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.gone).toBe(true);
    // Tip untouched.
    expect(fake.lists.get('schefter:tips:queue')).toHaveLength(1);
  });

  it('rejects after the undo window closes', async () => {
    const hash = hashTipsterId('owner-1');
    queueTip({ id: 't3', hashedOwnerId: hash, submittedAt: Date.now() - 2 * 60_000, topic: 'trade' });

    const res = await DELETE(makeRequest('owner-1', 't3'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('undo_window_closed');
    expect(fake.lists.get('schefter:tips:queue')).toHaveLength(1);
  });

  it('returns gone for a tip the scanner already drained', async () => {
    const res = await DELETE(makeRequest('owner-1', 'no-such-tip'));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.gone).toBe(true);
  });

  it('keeps the marinate anchor when other tips remain', async () => {
    const hash = hashTipsterId('owner-1');
    queueTip({ id: 't4', hashedOwnerId: hash, submittedAt: Date.now(), topic: 'roster' });
    queueTip({ id: 't5', hashedOwnerId: hashTipsterId('owner-3'), submittedAt: Date.now(), topic: 'trade' });
    fake.store.set('schefter:tips:first_tip_ts', 12345);

    const res = await DELETE(makeRequest('owner-1', 't4'));
    expect((await res.json()).ok).toBe(true);
    expect(fake.lists.get('schefter:tips:queue')).toHaveLength(1);
    expect(fake.store.get('schefter:tips:first_tip_ts')).toBe(12345);
  });

  it('requires auth', async () => {
    const res = await DELETE(makeRequest(null, 't1'));
    expect(res.status).toBe(401);
  });
});

describe('submit response contract (source guards)', () => {
  const tipSrc = readFileSync(
    join(__dirname, '..', 'src', 'pages', 'api', 'schefter', 'tip.ts'),
    'utf8',
  );

  it('assigns a codename eagerly on every successful submit and returns it', () => {
    expect(tipSrc).toMatch(/revealCodename = await assignCodename\(redis, hashedOwnerId, navSlug\)/);
    expect(tipSrc).toMatch(/codename: revealCodename/);
  });

  it('returns the tip id + undo window so the client can offer withdrawal', () => {
    expect(tipSrc).toMatch(/tipId: tip\.id/);
    expect(tipSrc).toMatch(/undoWindowMs: UNDO_WINDOW_MS/);
  });
});
