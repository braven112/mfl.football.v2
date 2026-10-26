/**
 * Ask the History — saved answers, so every answer has a link an owner can
 * drop in the group chat.
 *
 *   history-ask:<league slug>:<id>   one SavedAnswer, kept a year
 *   history-ask:<league slug>:popular   zset: answer id → owners who opened it
 *   history-ask:<league slug>:seen:<id>:<franchise>   one owner's open, counted once
 *
 * Keyed by registry slug because both leagues have a franchise 0001, and the
 * page reading an id checks it belongs to the league in the URL. The answer
 * is stored with its table, so a shared link shows what was computed when it
 * was asked even after more games are played.
 */
import { randomBytes } from 'node:crypto';
import { getRedis } from '../redis-client';
import type { AskRecordLink, AskTable } from './ask';

export interface SavedAnswer {
  id: string;
  league: string;
  question: string;
  answer: string;
  table: AskTable | null;
  steps: string[];
  /** Missing on answers saved before it existed. */
  asOf?: string;
  /** Missing on answers saved before Record Book links existed. */
  records?: AskRecordLink[];
  askedBy: { franchiseId: string; name: string | null };
  createdAt: string;
}

const KEY = (league: string, id: string) => `history-ask:${league}:${id}`;
const POPULAR = (league: string) => `history-ask:${league}:popular`;
const SEEN = (league: string, id: string, franchiseId: string) => `history-ask:${league}:seen:${id}:${franchiseId}`;
const TTL_SECONDS = 365 * 24 * 60 * 60;

export const isAnswerId = (id: string) => /^[A-Za-z0-9_-]{10}$/.test(id);

/** Save and return the answer's id, or null when Redis is unavailable. */
export async function saveAnswer(answer: Omit<SavedAnswer, 'id' | 'createdAt'>): Promise<SavedAnswer | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const saved: SavedAnswer = { ...answer, id: randomBytes(8).toString('base64url').slice(0, 10), createdAt: new Date().toISOString() };
  await redis.set(KEY(saved.league, saved.id), saved, { ex: TTL_SECONDS });
  return saved;
}

export async function readAnswer(league: string, id: string): Promise<SavedAnswer | null> {
  if (!isAnswerId(id)) return null;
  const redis = await getRedis();
  if (!redis) return null;
  const saved = (await redis.get<SavedAnswer>(KEY(league, id))) ?? null;
  return saved && saved.league === league ? saved : null;
}

/**
 * Count one owner opening a shared answer, for the History home's "most
 * shared" shelf. Only a signed-in owner of the league counts, once per
 * answer, and never the owner who asked it: an anonymous visitor cannot be
 * told apart from a refresh (client-ip.ts: the per-caller header is
 * spoofable), and the shelf is meant to show what the league passed around.
 */
export async function countAnswerOpen(saved: SavedAnswer, franchiseId: string | null): Promise<void> {
  if (!franchiseId || franchiseId === saved.askedBy.franchiseId) return;
  const redis = await getRedis();
  if (!redis) return;
  const first = await redis.set(SEEN(saved.league, saved.id, franchiseId), 1, { ex: TTL_SECONDS, nx: true });
  if (first) await redis.zincrby(POPULAR(saved.league), 1, saved.id);
}

export interface PopularAnswer {
  answer: SavedAnswer;
  /** Owners other than the asker who opened it. */
  opens: number;
}

/** The answers the most owners opened, best first. An expired answer drops off the shelf. */
export async function popularAnswers(league: string, limit = 4): Promise<PopularAnswer[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const ranked = (await redis.zrange<string | number>(POPULAR(league), 0, limit * 2 - 1, { rev: true, withScores: true })) ?? [];
  const pairs: Array<{ id: string; opens: number }> = [];
  for (let i = 0; i + 1 < ranked.length; i += 2) pairs.push({ id: String(ranked[i]), opens: Number(ranked[i + 1]) });
  if (!pairs.length) return [];
  const saved = await redis.mget<SavedAnswer>(...pairs.map((p) => KEY(league, p.id)));
  const gone = pairs.filter((_, i) => !saved[i]).map((p) => p.id);
  if (gone.length) await redis.zrem(POPULAR(league), ...gone);
  return pairs
    .map((p, i) => ({ answer: saved[i] as SavedAnswer, opens: p.opens }))
    .filter((p) => p.answer && p.answer.league === league && p.opens > 0)
    .slice(0, limit);
}
