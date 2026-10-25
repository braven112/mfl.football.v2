/**
 * Ask the History — saved answers, so every answer has a link an owner can
 * drop in the group chat.
 *
 *   history-ask:<league slug>:<id>   one SavedAnswer, kept a year
 *
 * Keyed by registry slug because both leagues have a franchise 0001, and the
 * page reading an id checks it belongs to the league in the URL. The answer
 * is stored with its table, so a shared link shows what was computed when it
 * was asked even after more games are played.
 */
import { randomBytes } from 'node:crypto';
import { getRedis } from '../redis-client';
import type { AskTable } from './ask';

export interface SavedAnswer {
  id: string;
  league: string;
  question: string;
  answer: string;
  table: AskTable | null;
  steps: string[];
  askedBy: { franchiseId: string; name: string | null };
  createdAt: string;
}

const KEY = (league: string, id: string) => `history-ask:${league}:${id}`;
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
