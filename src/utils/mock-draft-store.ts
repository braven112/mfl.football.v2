/**
 * Where mock drafts live: Upstash Redis, the store the site already runs on.
 *
 * This replaced PartyKit (Oct 2026). Its host, `*.partykit.dev`, stopped
 * resolving and took every mock, best-ball and draft-room surface down at
 * once, and the owner's rule since is no third-party services. The engine's
 * rules are in `mock-draft-engine.ts`; this file is storage, the registry
 * that feeds a lobby, and the lock that keeps two requests from writing the
 * same draft at once.
 *
 * Keys (see `mock-draft-keys.mjs`, shared with the best-ball export script):
 *   session  — the board and its clock; read on every poll, so kept lean
 *   pool     — the ranked lists auto-pick reads; big, read only to pick
 *   lock     — SET NX, held for one read-modify-write
 *   registry — a hash per lobby: session id → the summary its card shows
 *
 * `pnpm dev` without a `.env.local` has no Redis, and a mock is unreachable
 * without a store, so DEV ONLY an in-process Map stands in (the same call as
 * `broadcast-tv-store.ts`). Never in a deployed build: serverless instances do
 * not share memory, so a pick written on one would be invisible to the poll
 * that lands on another.
 */

import { getRedis } from './redis-client';
import {
  advance,
  applyAction,
  needsAdvance,
  type EngineSession,
  type MockDraftAction,
  type MockDraftPool,
} from './mock-draft-engine';
import type { MockDraftSessionSummary } from '../types/draft-room';
import { mockRegistryRoom } from './mock-draft-scope';
import {
  mockDraftLockKey,
  mockDraftPoolKey,
  mockDraftRegistryKey,
  mockDraftSessionKey,
} from './mock-draft-keys.mjs';

/** A mock nobody touches for this long is gone. The board's results link dies with it. */
export const MOCK_DRAFT_TTL_SECONDS = 30 * 24 * 60 * 60;
/** A league's draft of record never expires. */
const OFFICIAL_TTL_SECONDS = 0;
const LOCK_SECONDS = 5;

/** The slice of the Redis client this file uses. */
export interface MockDraftKv {
  get<T>(key: string): Promise<T | null>;
  mget<T>(...keys: string[]): Promise<(T | null)[]>;
  set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  hget<T>(key: string, field: string): Promise<T | null>;
  hgetall<T>(key: string): Promise<Record<string, T> | null>;
  hset(key: string, fieldValues: Record<string, unknown>): Promise<number>;
  hdel(key: string, ...fields: string[]): Promise<number>;
}

/** A Map with `ex`/`nx` and hashes, enough to stand in for Redis in dev and tests. */
export function memoryMockDraftKv(clock: () => number = Date.now): MockDraftKv {
  const data = new Map<string, { value: unknown; expires: number }>();
  const live = (key: string) => {
    const hit = data.get(key);
    if (!hit) return null;
    if (hit.expires <= clock()) {
      data.delete(key);
      return null;
    }
    return hit;
  };
  // A structured clone, as a JSON round trip through Redis would give.
  const clone = <T>(v: unknown) => JSON.parse(JSON.stringify(v)) as T;
  return {
    async get<T>(key: string) {
      const hit = live(key);
      return hit ? clone<T>(hit.value) : null;
    },
    async mget<T>(...keys: string[]) {
      return keys.map((k) => {
        const hit = live(k);
        return hit ? clone<T>(hit.value) : null;
      });
    },
    async set(key, value, opts) {
      if (opts?.nx && live(key)) return null;
      data.set(key, { value: clone(value), expires: opts?.ex ? clock() + opts.ex * 1000 : Infinity });
      return 'OK';
    },
    async del(key) {
      data.delete(key);
      return 1;
    },
    async hget<T>(key: string, field: string) {
      const hash = live(key)?.value as Record<string, unknown> | undefined;
      return hash && field in hash ? clone<T>(hash[field]) : null;
    },
    async hgetall<T>(key: string) {
      const hash = live(key)?.value as Record<string, T> | undefined;
      return hash ? clone<Record<string, T>>(hash) : null;
    },
    async hset(key, fieldValues) {
      const hash = (live(key)?.value as Record<string, unknown> | undefined) ?? {};
      Object.assign(hash, clone(fieldValues));
      data.set(key, { value: hash, expires: Infinity });
      return Object.keys(fieldValues).length;
    },
    async hdel(key, ...fields) {
      const hash = live(key)?.value as Record<string, unknown> | undefined;
      if (!hash) return 0;
      let n = 0;
      for (const f of fields) if (f in hash) { delete hash[f]; n++; }
      return n;
    },
  };
}

let devKv: MockDraftKv | null = null;
let testKv: MockDraftKv | null = null;

/** Tests swap the store for a Map. */
export function __setMockDraftKvForTests(kv: MockDraftKv | null): void {
  testKv = kv;
}

export async function getMockDraftKv(): Promise<MockDraftKv | null> {
  if (testKv) return testKv;
  const redis = await getRedis();
  if (redis) return redis as unknown as MockDraftKv;
  if (import.meta.env.DEV) return (devKv ??= memoryMockDraftKv());
  return null;
}

/** Why a store call could not run, as the API reports it. */
export class MockDraftStoreError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function requireKv(): Promise<MockDraftKv> {
  const kv = await getMockDraftKv();
  if (!kv) throw new MockDraftStoreError('Draft storage is not configured.', 503);
  return kv;
}

function ttlFor(session: EngineSession): number {
  return session.official ? OFFICIAL_TTL_SECONDS : MOCK_DRAFT_TTL_SECONDS;
}

/** The lobby card for a session, built from the session so it can never disagree with it. */
export function summarize(session: EngineSession): MockDraftSessionSummary {
  const index = Math.min(session.currentPickIndex, Math.max(0, session.draftOrder.length - 1));
  const round = Math.floor(index / Math.max(1, session.picksPerRound)) + 1;
  return {
    id: session.id,
    createdBy: session.createdBy,
    createdAt: session.createdAt,
    status: session.status,
    participantCount: session.participants.length,
    totalTeams: session.picksPerRound,
    currentRound: round,
    currentPickInRound: index - (round - 1) * session.picksPerRound + 1,
    timerSeconds: session.timerSeconds,
    totalRounds: session.totalRounds,
  };
}

/** Lobby registry a session lists in. Official drafts list in the league's plain one. */
export function registryRoomFor(session: Pick<EngineSession, 'leagueId'> & { unit?: string }): string {
  return mockRegistryRoom(session.leagueId, session.unit ?? null);
}

async function writeSession(kv: MockDraftKv, session: EngineSession): Promise<void> {
  session.version = (session.version ?? 0) + 1;
  const ttl = ttlFor(session);
  await kv.set(mockDraftSessionKey(session.id), session, ttl ? { ex: ttl } : undefined);
  if (session.unlisted) return;
  await kv.hset(mockDraftRegistryKey(registryRoomFor(session)), { [session.id]: summarize(session) });
}

/** Create (or, for an official draft, recreate) a session and list it in its lobby. */
export async function createMockDraft(session: EngineSession, pool: MockDraftPool): Promise<void> {
  const kv = await requireKv();
  const ttl = ttlFor(session);
  await kv.set(mockDraftPoolKey(session.id), pool, ttl ? { ex: ttl } : undefined);
  session.version = 0;
  await writeSession(kv, session);
}

async function withLock<T>(kv: MockDraftKv, id: string, wait: boolean, fn: () => Promise<T>): Promise<T | null> {
  const key = mockDraftLockKey(id);
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // A pick waits its turn (up to ~3 s); a poll that finds the lock taken just
  // shows the board as it is — whoever holds the lock is already advancing it.
  for (let attempt = 0; attempt < (wait ? 30 : 1); attempt++) {
    if (await kv.set(key, token, { nx: true, ex: LOCK_SECONDS })) {
      try {
        return await fn();
      } finally {
        if ((await kv.get<string>(key)) === token) await kv.del(key);
      }
    }
    if (wait) await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/**
 * Read one session as of now — catching up an expired clock and the AI picks
 * behind it first. Null when the session does not exist (never created, or
 * expired). Throws `MockDraftStoreError` only when there is no store at all.
 */
export async function readMockDraft(id: string, now = Date.now()): Promise<EngineSession | null> {
  const kv = await requireKv();
  const session = await kv.get<EngineSession>(mockDraftSessionKey(id));
  if (!session || !needsAdvance(session, now)) return session;

  const advanced = await withLock(kv, id, false, async () => {
    const [fresh, pool] = await kv.mget<unknown>(mockDraftSessionKey(id), mockDraftPoolKey(id));
    const current = fresh as EngineSession | null;
    if (!current) return null;
    if (advance(current, (pool as MockDraftPool | null) ?? {}, now)) await writeSession(kv, current);
    return current;
  });
  return advanced ?? session;
}

/** Apply an owner's action under the lock. */
export async function actOnMockDraft(
  id: string,
  actor: string,
  action: MockDraftAction,
  now = Date.now,
): Promise<{ ok: true; session: EngineSession } | { ok: false; error: string; status: number }> {
  const kv = await requireKv();
  const result = await withLock(kv, id, true, async () => {
    const [fresh, pool] = await kv.mget<unknown>(mockDraftSessionKey(id), mockDraftPoolKey(id));
    const session = fresh as EngineSession | null;
    if (!session) return { ok: false as const, error: 'Session not found', status: 404 };
    const outcome = applyAction(session, (pool as MockDraftPool | null) ?? {}, actor, action, now());
    if (!outcome.ok) return { ...outcome, status: 409 };
    await writeSession(kv, outcome.session);
    return outcome;
  });
  return result ?? { ok: false, error: 'The draft is busy — try again.', status: 503 };
}

/** Every session listed in a lobby, dropping (and pruning) any whose session has expired. */
export async function listMockDrafts(registryRoom: string, now = Date.now()): Promise<MockDraftSessionSummary[]> {
  const kv = await requireKv();
  const key = mockDraftRegistryKey(registryRoom);
  const entries = Object.values((await kv.hgetall<MockDraftSessionSummary>(key)) ?? {});
  const cutoff = now - MOCK_DRAFT_TTL_SECONDS * 1000;
  const stale = entries.filter((e) => !e?.id?.includes('-official-') && Date.parse(e.createdAt) < cutoff);
  if (stale.length) await kv.hdel(key, ...stale.map((e) => e.id));
  return entries.filter((e) => e?.id && !stale.includes(e));
}

/** A lobby's entry for one session, or null. */
export async function getMockDraftSummary(
  registryRoom: string,
  id: string,
): Promise<MockDraftSessionSummary | null> {
  const kv = await requireKv();
  return kv.hget<MockDraftSessionSummary>(mockDraftRegistryKey(registryRoom), id);
}

/**
 * Take a session off its lobby. The session itself is left to expire: anyone
 * holding a direct link keeps a working board, same as PartyKit left it. It is
 * flagged so its next save does not list it again.
 */
export async function unlistMockDraft(registryRoom: string, id: string): Promise<void> {
  const kv = await requireKv();
  await kv.hdel(mockDraftRegistryKey(registryRoom), id);
  await withLock(kv, id, true, async () => {
    const session = await kv.get<EngineSession>(mockDraftSessionKey(id));
    if (!session || session.unlisted) return;
    session.unlisted = true;
    await writeSession(kv, session);
  });
}
